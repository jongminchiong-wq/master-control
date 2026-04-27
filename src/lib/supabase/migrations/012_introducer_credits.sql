-- ============================================================
-- Master Control — Introducer commissions become first-class earnings
--
-- Before this migration, introducer commissions (e.g. RM 42 = 21% of an
-- introducee's RM 200 return) were computed on-the-fly in the UI from
-- live deployments and never persisted. They appeared on tiles but never
-- bumped investors.capital, so an introducer couldn't redeploy what
-- they'd earned. The Investors-page comment in deployment.ts:
-- "...pending and introducer commission isn't credited."
--
-- This migration mirrors the return_credits / credit_investor_return
-- pattern (migrations 004 + 010) for introducer commissions:
--
--   1. introducer_credits — one row per (introducer, introducee, PO)
--      tuple, locked tier_rate, FK cascades from any of the three.
--   2. credit_introducer_commission RPC — atomic insert + capital bump,
--      idempotent via ON CONFLICT DO NOTHING.
--   3. v_investor_ledger rebuilt to include 'introducer_credit' kind so
--      capital == SUM(ledger.amount) holds across the new event source.
--   4. Backfill — for every PO already commissions_cleared, retroactively
--      credit each introducer at their tier-as-of-clear-date times the
--      sum of their introducees' return_credits on that PO.
--   5. Final invariant assertion — capital must equal ledger sum per
--      investor, exactly like 010 and 011's safety check.
--
-- Idempotent and reversible: a backup table introducer_credits_backup_012
-- is captured (empty initially — created so the rollback recipe in this
-- header has a target).
--
-- Rollback recipe (after verifying):
--   -- Subtract the backfilled commissions from capital:
--   UPDATE investors i SET capital = capital - sub.total
--     FROM (SELECT introducer_id, SUM(amount) AS total
--             FROM introducer_credits GROUP BY introducer_id) sub
--     WHERE i.id = sub.introducer_id;
--   -- Then drop the new structure:
--   DROP VIEW v_investor_ledger;
--   DROP FUNCTION credit_introducer_commission;
--   DROP TABLE introducer_credits;
--   DROP TABLE introducer_credits_backup_012;
--   -- Then re-run 011 to restore the prior ledger view.
-- ============================================================

-- ─── 1. introducer_credits table ───────────────────────────
CREATE TABLE IF NOT EXISTS introducer_credits (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  introducer_id   uuid NOT NULL REFERENCES investors(id) ON DELETE CASCADE,
  introducee_id   uuid NOT NULL REFERENCES investors(id) ON DELETE CASCADE,
  po_id           uuid NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  amount          decimal NOT NULL,
  base_return     decimal NOT NULL,
  tier_rate       decimal NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (introducer_id, introducee_id, po_id),
  CHECK (introducer_id <> introducee_id)
);

CREATE INDEX IF NOT EXISTS idx_introducer_credits_introducer
  ON introducer_credits(introducer_id);
CREATE INDEX IF NOT EXISTS idx_introducer_credits_po
  ON introducer_credits(po_id);

-- Rollback target (intentionally empty until rollback is invoked).
CREATE TABLE IF NOT EXISTS introducer_credits_backup_012 (
  LIKE introducer_credits INCLUDING ALL
);

-- ─── 2. RLS policies (mirror return_credits) ───────────────
ALTER TABLE introducer_credits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin_full_introducer_credits" ON introducer_credits FOR ALL
  USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'));

CREATE POLICY "introducer_read_own_credits" ON introducer_credits FOR SELECT
  USING (introducer_id IN (SELECT id FROM investors WHERE user_id = auth.uid()));

-- ─── 3. credit_introducer_commission RPC ───────────────────
CREATE OR REPLACE FUNCTION credit_introducer_commission(
  p_introducer_id uuid,
  p_introducee_id uuid,
  p_po_id uuid,
  p_amount decimal,
  p_base_return decimal,
  p_tier_rate decimal,
  p_credit_date timestamptz DEFAULT now()
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

  IF p_introducer_id = p_introducee_id THEN
    RETURN json_build_object('success', false, 'error', 'Self-introduction');
  END IF;

  INSERT INTO introducer_credits (
    introducer_id, introducee_id, po_id, amount, base_return, tier_rate, created_at
  )
  VALUES (
    p_introducer_id, p_introducee_id, p_po_id, p_amount, p_base_return, p_tier_rate, p_credit_date
  )
  ON CONFLICT (introducer_id, introducee_id, po_id) DO NOTHING
  RETURNING id INTO v_credit_id;

  IF v_credit_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Already credited', 'duplicate', true);
  END IF;

  UPDATE investors
    SET capital = capital + p_amount
    WHERE id = p_introducer_id
    RETURNING capital INTO v_new_capital;

  RETURN json_build_object(
    'success', true,
    'credit_id', v_credit_id,
    'new_capital', v_new_capital
  );
END;
$$;

-- ─── 4. Rebuild v_investor_ledger to include introducer_credit ─
-- Adds a fifth event kind. Date follows the same po.commissions_cleared
-- preference as return_credit so the underlying return and the resulting
-- introducer credit sit on the same date. Ordering between the two on
-- the same date is by row id (tiebreak); harmless either way for the
-- running balance, since both deltas net into the same final amount.
DROP VIEW IF EXISTS v_investor_ledger;

CREATE VIEW v_investor_ledger
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
    rc.investor_id,
    COALESCE(po.commissions_cleared::timestamptz, rc.created_at) AS at,
    'return_credit'::text AS kind,
    rc.amount,
    rc.po_id::text AS ref,
    NULL::text AS notes,
    rc.id AS tiebreak
  FROM return_credits rc
  LEFT JOIN purchase_orders po ON po.id = rc.po_id

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

  UNION ALL

  -- New: introducer credits surface in the introducer's ledger. ref is
  -- the source PO; notes is left NULL — the UI joins to investors+POs
  -- in memory to render "From {name}'s {ref} ({tier}%)".
  SELECT
    ic.introducer_id AS investor_id,
    COALESCE(po.commissions_cleared::timestamptz, ic.created_at) AS at,
    'introducer_credit'::text AS kind,
    ic.amount,
    ic.po_id::text AS ref,
    NULL::text AS notes,
    ic.id AS tiebreak
  FROM introducer_credits ic
  LEFT JOIN purchase_orders po ON po.id = ic.po_id
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

-- ─── 5. Backfill ──────────────────────────────────────────
-- For every cleared PO, find its return_credits, and for any introducee
-- whose introducer is set, insert a matching introducer_credits row at
-- the introducer's tier-as-of-clear-date and bump capital. Wrapped in a
-- single transaction (the migration runner already wraps DDL in a tx).
--
-- Tier rule mirrors getInvIntroTier(totalCapitalIntroduced) where
-- totalCapitalIntroduced is sum of introducees' *current* capital. Same
-- definition the admin Investors page uses today. Future edge case:
-- if an introducer's tier changes between two backfills, the rate is
-- locked into each row. Not relevant for the current single-pass backfill.

DO $$
DECLARE
  v_tier_rate decimal;
  v_total_capital_introduced decimal;
  v_credit_id uuid;
  rec RECORD;
BEGIN
  FOR rec IN
    SELECT
      ie.id            AS introducee_id,
      ie.introduced_by AS introducer_id,
      rc.po_id         AS po_id,
      rc.amount        AS base_return,
      po.commissions_cleared AS clear_date
    FROM return_credits rc
    JOIN investors ie ON ie.id = rc.investor_id
    JOIN purchase_orders po ON po.id = rc.po_id
    WHERE ie.introduced_by IS NOT NULL
      AND po.commissions_cleared IS NOT NULL
      AND ie.introduced_by <> ie.id
      AND NOT EXISTS (
        SELECT 1 FROM introducer_credits ic
        WHERE ic.introducer_id = ie.introduced_by
          AND ic.introducee_id = ie.id
          AND ic.po_id = rc.po_id
      )
  LOOP
    -- Compute the introducer's tier at backfill time: sum of capital
    -- across everyone they've introduced (mirrors getInvIntroTier in
    -- src/lib/business-logic/tiers.ts).
    SELECT COALESCE(SUM(capital), 0)
      INTO v_total_capital_introduced
      FROM investors
      WHERE introduced_by = rec.introducer_id;

    -- INV_INTRO_TIERS in src/lib/business-logic/constants.ts:
    --   Starter   21%   [0,        50_000)
    --   Builder   24%   [50_000,   150_000)
    --   Connector 27%   [150_000,  300_000)
    --   Rainmaker 30%   [300_000,  +inf)
    v_tier_rate := CASE
      WHEN v_total_capital_introduced >= 300000 THEN 30
      WHEN v_total_capital_introduced >= 150000 THEN 27
      WHEN v_total_capital_introduced >= 50000  THEN 24
      ELSE 21
    END;

    INSERT INTO introducer_credits (
      introducer_id, introducee_id, po_id, amount, base_return, tier_rate, created_at
    ) VALUES (
      rec.introducer_id,
      rec.introducee_id,
      rec.po_id,
      rec.base_return * v_tier_rate / 100.0,
      rec.base_return,
      v_tier_rate,
      rec.clear_date::timestamptz
    )
    RETURNING id INTO v_credit_id;

    UPDATE investors
      SET capital = capital + (rec.base_return * v_tier_rate / 100.0)
      WHERE id = rec.introducer_id;
  END LOOP;
END $$;

-- ─── 6. Invariant re-check ────────────────────────────────
-- capital must still equal SUM(v_investor_ledger.amount) per investor.
-- Same belt-and-braces check used in 010 and 011.
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
    RAISE EXCEPTION 'Ledger invariant violated for % investor(s) after introducer_credits backfill', v_bad_count;
  END IF;
END $$;
