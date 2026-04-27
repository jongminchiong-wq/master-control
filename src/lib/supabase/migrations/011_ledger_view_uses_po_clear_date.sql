-- ============================================================
-- Master Control — v_investor_ledger uses po.commissions_cleared
--
-- Before this migration, the ledger view read return_credits.created_at
-- directly for the "Return" row date in admin Capital History. That column
-- is stamped once at insert time from the clearDate the credit RPC was
-- called with. Because the RPC is idempotent on (investor_id, po_id), if
-- admin later edits purchase_orders.commissions_cleared, the existing
-- return_credits row never re-syncs and the ledger drifts.
--
-- Fix: derive the "at" timestamp for return_credit events from the live
-- purchase_orders.commissions_cleared, falling back to rc.created_at only
-- if the PO row is missing a clear date (defensive — the credit flow
-- requires commissions_cleared to be set). This mirrors the policy already
-- encoded in src/lib/business-logic/capital-events.ts, which prefers
-- po.commissions_cleared when reconstructing capital events in memory.
--
-- Notes:
--   - return_credits.created_at is preserved untouched; it remains the
--     audit trail of when the credit RPC actually inserted the row.
--   - The view's column shape, types, security_invoker setting, and grant
--     are unchanged; generated TS types do not need regeneration.
--   - Existing stale rows are corrected the moment the view is replaced.
--   - Running balance ordering shifts for investors with multiple
--     return_credit rows (now sorted by economic date, not insert date).
--     Per-investor SUM(amount) is unchanged, so the capital invariant
--     holds — re-asserted below.
-- ============================================================

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

  -- return_credit events: prefer the PO's live commissions_cleared so the
  -- displayed date follows admin edits. Fall back to rc.created_at only if
  -- the PO is missing a clear date (or has been deleted under a hypothetical
  -- LEFT JOIN miss).
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

-- ─── Invariant re-check ────────────────────────────────────
-- capital must still equal sum(v_investor_ledger.amount) per investor.
-- Only "at" ordering changed; amounts are untouched, so this should hold
-- by construction. Belt-and-braces in case anything regressed.
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
    RAISE EXCEPTION 'Ledger invariant violated for % investor(s) after switching v_investor_ledger to po.commissions_cleared', v_bad_count;
  END IF;
END $$;
