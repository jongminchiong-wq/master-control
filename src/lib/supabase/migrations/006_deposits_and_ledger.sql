-- ============================================================
-- Master Control — Deposits & Capital Ledger
-- Adds: deposits table (admin-entered, no approval flow)
--        admin_adjustments table (auto-logged direct capital edits)
--        v_investor_ledger view (unified chronological feed)
--        record_deposit + adjust_capital RPCs
--        Backfill of initial capital as deposits
-- ============================================================

-- ─── 1. Deposits table ──────────────────────────────────────

CREATE TABLE deposits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  investor_id uuid NOT NULL REFERENCES investors(id) ON DELETE CASCADE,
  amount decimal NOT NULL CHECK (amount > 0),
  method text,
  reference text,
  notes text,
  deposited_at date NOT NULL,
  recorded_by uuid REFERENCES users(id),
  created_at timestamptz DEFAULT now()
);

CREATE INDEX idx_deposits_investor ON deposits(investor_id);
CREATE INDEX idx_deposits_at ON deposits(deposited_at);

-- ─── 2. Admin adjustments table ─────────────────────────────
-- Signed delta: positive if capital went up, negative if down.

CREATE TABLE admin_adjustments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  investor_id uuid NOT NULL REFERENCES investors(id) ON DELETE CASCADE,
  amount decimal NOT NULL,
  reason text,
  adjusted_by uuid REFERENCES users(id),
  created_at timestamptz DEFAULT now()
);

CREATE INDEX idx_admin_adjustments_investor ON admin_adjustments(investor_id);

-- ─── 3. RLS ─────────────────────────────────────────────────

ALTER TABLE deposits ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_adjustments ENABLE ROW LEVEL SECURITY;

-- Wrap auth.uid() in (select ...) so Postgres evaluates it once per query,
-- not once per row. Avoids auth_rls_initplan performance warning.

CREATE POLICY "admin_full_deposits" ON deposits FOR ALL
  USING (EXISTS (SELECT 1 FROM users WHERE id = (select auth.uid()) AND role = 'admin'));

CREATE POLICY "admin_full_admin_adjustments" ON admin_adjustments FOR ALL
  USING (EXISTS (SELECT 1 FROM users WHERE id = (select auth.uid()) AND role = 'admin'));

CREATE POLICY "investor_read_own_deposits" ON deposits FOR SELECT
  USING (investor_id IN (SELECT id FROM investors WHERE user_id = (select auth.uid())));

CREATE POLICY "investor_read_own_adjustments" ON admin_adjustments FOR SELECT
  USING (investor_id IN (SELECT id FROM investors WHERE user_id = (select auth.uid())));

-- ─── 4. record_deposit RPC ──────────────────────────────────
-- Admin-only. Inserts deposit row and increments capital atomically.

CREATE OR REPLACE FUNCTION record_deposit(
  p_investor_id uuid,
  p_amount decimal,
  p_deposited_at date,
  p_method text DEFAULT NULL,
  p_reference text DEFAULT NULL,
  p_notes text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_deposit_id uuid;
  v_new_capital decimal;
BEGIN
  -- Admin-only
  IF NOT EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin') THEN
    RETURN json_build_object('success', false, 'error', 'Admin only');
  END IF;

  IF p_amount <= 0 THEN
    RETURN json_build_object('success', false, 'error', 'Amount must be positive');
  END IF;

  IF p_deposited_at IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'deposited_at is required');
  END IF;

  -- Insert deposit row
  INSERT INTO deposits (investor_id, amount, method, reference, notes, deposited_at, recorded_by)
    VALUES (p_investor_id, p_amount, p_method, p_reference, p_notes, p_deposited_at, auth.uid())
    RETURNING id INTO v_deposit_id;

  -- Bump capital
  UPDATE investors
    SET capital = capital + p_amount
    WHERE id = p_investor_id
    RETURNING capital INTO v_new_capital;

  IF v_new_capital IS NULL THEN
    RAISE EXCEPTION 'Investor not found: %', p_investor_id;
  END IF;

  RETURN json_build_object(
    'success', true,
    'deposit_id', v_deposit_id,
    'new_capital', v_new_capital
  );
END;
$$;

-- ─── 5. adjust_capital RPC ──────────────────────────────────
-- Admin-only. Replaces direct capital edits from the Edit form
-- so that every change lands in the ledger.

CREATE OR REPLACE FUNCTION adjust_capital(
  p_investor_id uuid,
  p_new_capital decimal,
  p_reason text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_current decimal;
  v_delta decimal;
  v_adjustment_id uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin') THEN
    RETURN json_build_object('success', false, 'error', 'Admin only');
  END IF;

  IF p_new_capital < 0 THEN
    RETURN json_build_object('success', false, 'error', 'Capital cannot be negative');
  END IF;

  SELECT capital INTO v_current
    FROM investors
    WHERE id = p_investor_id
    FOR UPDATE;

  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'Investor not found');
  END IF;

  v_delta := p_new_capital - v_current;

  -- Skip no-op edits
  IF v_delta = 0 THEN
    RETURN json_build_object('success', true, 'delta', 0, 'no_op', true);
  END IF;

  INSERT INTO admin_adjustments (investor_id, amount, reason, adjusted_by)
    VALUES (p_investor_id, v_delta, p_reason, auth.uid())
    RETURNING id INTO v_adjustment_id;

  UPDATE investors
    SET capital = p_new_capital
    WHERE id = p_investor_id;

  RETURN json_build_object(
    'success', true,
    'adjustment_id', v_adjustment_id,
    'delta', v_delta,
    'new_capital', p_new_capital
  );
END;
$$;

-- ─── 6. Unified ledger view ─────────────────────────────────
-- Running balance represents Capital + Cash Balance.
-- Compound events are markers only (amount 0) to avoid double-counting
-- the return_credit that fed them.
-- Tiebreaker on id makes ordering deterministic under concurrent writes.
-- security_invoker = true makes the view honor the caller's RLS, which is
-- required — Postgres views default to security_definer and would let
-- investors read each other's ledgers.

CREATE OR REPLACE VIEW v_investor_ledger
WITH (security_invoker = true) AS
WITH events AS (
  SELECT
    investor_id,
    deposited_at::timestamptz AS at,
    'deposit'::text AS kind,
    amount,
    id::text AS ref,
    notes,
    id AS tiebreak
  FROM deposits

  UNION ALL

  SELECT
    investor_id,
    COALESCE(processed_at, reviewed_at, created_at) AS at,
    'withdrawal'::text AS kind,
    -amount AS amount,
    id::text AS ref,
    notes,
    id AS tiebreak
  FROM withdrawals
  WHERE status = 'completed'

  UNION ALL

  SELECT
    investor_id,
    created_at AS at,
    'return_credit'::text AS kind,
    amount,
    po_id::text AS ref,
    NULL::text AS notes,
    id AS tiebreak
  FROM return_credits

  UNION ALL

  SELECT
    investor_id,
    created_at AS at,
    'compound'::text AS kind,
    0::decimal AS amount,
    id::text AS ref,
    ('Moved RM ' || amount::text || ' from cash to capital')::text AS notes,
    id AS tiebreak
  FROM compound_log

  UNION ALL

  SELECT
    investor_id,
    created_at AS at,
    'admin_adjustment'::text AS kind,
    amount,
    id::text AS ref,
    reason AS notes,
    id AS tiebreak
  FROM admin_adjustments
)
SELECT
  investor_id,
  at,
  kind,
  amount,
  ref,
  notes,
  SUM(amount) OVER (PARTITION BY investor_id ORDER BY at, tiebreak
                    ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS balance_after
FROM events;

-- ─── 7. Grants ──────────────────────────────────────────────

GRANT EXECUTE ON FUNCTION record_deposit(uuid, decimal, date, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION adjust_capital(uuid, decimal, text) TO authenticated;
GRANT SELECT ON v_investor_ledger TO authenticated;

-- ─── 8. Backfill existing investors ─────────────────────────
-- For each investor, reconstruct the "original capital put in" so that
-- once existing return_credits and completed withdrawals are replayed
-- on top, the ledger balance matches the current capital + cash_balance.
--
--   initial = current_total - sum(return_credits) + sum(completed_withdrawals)
--
-- (Compounds are 0-amount markers. Admin adjustments don't exist yet.)
--
-- Guarded by NOT EXISTS so re-running the migration is safe.
-- Skips zero/negative initials, which happen naturally when an investor
-- has already withdrawn all their returns — their ledger balances without
-- an initial row.

INSERT INTO deposits (investor_id, amount, method, notes, deposited_at)
SELECT
  i.id,
  (i.capital + i.cash_balance)
    - COALESCE((SELECT SUM(amount) FROM return_credits rc WHERE rc.investor_id = i.id), 0)
    + COALESCE((SELECT SUM(amount) FROM withdrawals w WHERE w.investor_id = i.id AND w.status = 'completed'), 0),
  'initial',
  'Backfilled starting capital',
  COALESCE(i.date_joined, CURRENT_DATE)
FROM investors i
WHERE
  (i.capital + i.cash_balance)
    - COALESCE((SELECT SUM(amount) FROM return_credits rc WHERE rc.investor_id = i.id), 0)
    + COALESCE((SELECT SUM(amount) FROM withdrawals w WHERE w.investor_id = i.id AND w.status = 'completed'), 0)
    > 0
  AND NOT EXISTS (
    SELECT 1 FROM deposits d
    WHERE d.investor_id = i.id AND d.method = 'initial'
  );

-- ─── 9. Invariant assertion ─────────────────────────────────
-- For every investor, the ledger sum must equal capital + cash_balance.
-- Raises an exception if the migration left the books out of balance.

DO $$
DECLARE
  v_bad_count int;
BEGIN
  SELECT count(*) INTO v_bad_count
  FROM (
    SELECT
      i.id,
      i.capital + i.cash_balance AS expected,
      COALESCE((SELECT SUM(amount) FROM v_investor_ledger WHERE investor_id = i.id), 0) AS actual
    FROM investors i
  ) t
  WHERE abs(t.expected - t.actual) > 0.01;

  IF v_bad_count > 0 THEN
    RAISE EXCEPTION 'Ledger invariant violated for % investor(s) after backfill', v_bad_count;
  END IF;
END $$;
