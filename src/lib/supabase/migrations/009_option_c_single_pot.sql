-- ============================================================
-- Master Control — Option C: collapse cash_balance into capital
--
-- Rationale:
-- The two-pot model (capital + cash_balance with a 7-day auto-compound
-- window) required admins to manually click "Credit Returns" after every
-- PO clearance. When they forgot, profit sat stranded — idle only reflected
-- refunded principal, never earnings. Under Option C, every return credit
-- bumps investors.capital directly. Idle becomes immediately redeployable
-- on PO clear (principal refunded by allocator's return event + profit
-- added by this credit), and withdrawal has exactly one flavour (capital).
--
-- Migration is idempotent via IF EXISTS / IF NOT EXISTS guards so it's
-- safe to re-run against a partially-applied DB.
-- ============================================================

-- ─── 1. Fold cash_balance into capital ──────────────────────
-- One-time data migration. Every RM of cash_balance becomes capital.
-- No money is lost; investors whose cash hadn't auto-compounded yet
-- simply see that number move to their main balance immediately.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'investors'
      AND column_name = 'cash_balance'
  ) THEN
    UPDATE investors SET capital = capital + COALESCE(cash_balance, 0);
  END IF;
END $$;

-- ─── 2. Drop cash_balance + compound machinery ──────────────

ALTER TABLE investors DROP COLUMN IF EXISTS cash_balance;
ALTER TABLE investors DROP COLUMN IF EXISTS compound_at;

-- compound_log is referenced by v_investor_ledger; rebuild view below.
DROP VIEW IF EXISTS v_investor_ledger;
DROP TABLE IF EXISTS compound_log CASCADE;
DROP FUNCTION IF EXISTS reinvest_cash(uuid, text);

-- ─── 3. Drop 'returns' withdrawal type ──────────────────────
-- Only capital withdrawals exist under Option C. Any historical 'returns'
-- rows were debits against cash_balance — now that cash_balance is folded
-- into capital, reclassifying them as 'capital' keeps the ledger honest.

ALTER TABLE withdrawals DROP CONSTRAINT IF EXISTS withdrawals_type_check;
UPDATE withdrawals SET type = 'capital' WHERE type <> 'capital';
ALTER TABLE withdrawals
  ADD CONSTRAINT withdrawals_type_check CHECK (type = 'capital');

-- ─── 4. Rewrite credit_investor_return → bump capital ───────
-- Old RPC bumped cash_balance + set compound_at. New RPC bumps capital
-- directly. Still idempotent via UNIQUE(investor_id, po_id) on
-- return_credits so re-crediting a cleared PO is a no-op.
--
-- Callable by an admin user OR by the platform itself (postgres role,
-- used by the auto-credit trigger defined below).

CREATE OR REPLACE FUNCTION credit_investor_return(
  p_investor_id uuid,
  p_po_id uuid,
  p_amount decimal,
  p_deployed decimal,
  p_tier_rate decimal
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_credit_id uuid;
  v_new_capital decimal;
BEGIN
  IF NOT (
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin')
    OR current_user = 'postgres'
  ) THEN
    RETURN json_build_object('success', false, 'error', 'Admin only');
  END IF;

  INSERT INTO return_credits (investor_id, po_id, amount, deployed, tier_rate)
    VALUES (p_investor_id, p_po_id, p_amount, p_deployed, p_tier_rate)
    ON CONFLICT (investor_id, po_id) DO NOTHING
    RETURNING id INTO v_credit_id;

  IF v_credit_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Already credited', 'duplicate', true);
  END IF;

  UPDATE investors
    SET capital = capital + p_amount
    WHERE id = p_investor_id
    RETURNING capital INTO v_new_capital;

  RETURN json_build_object(
    'success', true,
    'credit_id', v_credit_id,
    'new_capital', v_new_capital
  );
END;
$$;

-- ─── 5. Rebuild v_investor_ledger without compound events ───
-- Under Option C, compound rows no longer exist. Return credits bump
-- capital (balance_after includes them). Withdrawals are 'capital' type
-- only, so the signed amount is correct for running-balance math.

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

GRANT SELECT ON v_investor_ledger TO authenticated;

-- ─── 6. Pool-wide read RLS for allocator seed ───────────────
-- The allocator's `remaining` seed subtracts every capital-event delta
-- from inv.capital. Investor-facing pages (portfolio, wallet) need to
-- see pool-wide events for this math to be stable, same rationale as
-- 007_compound_log_shared_read.sql. Capital history is no more sensitive
-- than current capital, which is already visible to every investor.

DROP POLICY IF EXISTS "investor_read_all_withdrawals" ON withdrawals;
CREATE POLICY "investor_read_all_withdrawals" ON withdrawals FOR SELECT
  USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'investor'));

DROP POLICY IF EXISTS "investor_read_all_admin_adjustments" ON admin_adjustments;
CREATE POLICY "investor_read_all_admin_adjustments" ON admin_adjustments FOR SELECT
  USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'investor'));

DROP POLICY IF EXISTS "investor_read_all_return_credits" ON return_credits;
CREATE POLICY "investor_read_all_return_credits" ON return_credits FOR SELECT
  USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'investor'));

-- ─── 7. Invariant check ─────────────────────────────────────
-- For every investor, v_investor_ledger sum must equal investors.capital.
-- If this trips, the cash_balance fold or some historical row is out
-- of whack — stop the migration rather than ship a broken ledger.

DO $$
DECLARE
  v_bad_count int;
BEGIN
  SELECT count(*) INTO v_bad_count
  FROM (
    SELECT
      i.id,
      i.capital AS expected,
      COALESCE((SELECT SUM(amount) FROM v_investor_ledger WHERE investor_id = i.id), 0) AS actual
    FROM investors i
  ) t
  WHERE abs(t.expected - t.actual) > 0.01;

  IF v_bad_count > 0 THEN
    RAISE EXCEPTION 'Ledger invariant violated for % investor(s) after Option C fold', v_bad_count;
  END IF;
END $$;
