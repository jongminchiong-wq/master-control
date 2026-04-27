-- ============================================================
-- Master Control — Back-date return_credits to the PO clear date
--
-- Before this migration, credit_investor_return always stamped a new
-- return_credits row with now(). Combined with the admin-Investors-page
-- auto-fire effect (which only runs when someone visits that page), this
-- meant a PO cleared on 6 Feb could sit uncredited until the page was
-- loaded weeks later — at which point the row landed with a "today"
-- timestamp, understating the investor's redeployable capital on every
-- historical-month view and de-syncing admin's month-scoped funding banner
-- from the investor dashboard's live view.
--
-- Fix:
--   1. Add optional p_credit_date to credit_investor_return so callers
--      (PO-cycle page "clear", Investors page auto-fire) can pass the
--      actual commissions_cleared date.
--   2. Back-fill existing rows so the ledger reflects when the investor
--      actually earned each return.
--
-- Safety:
--   - return_credits_backup_010 is retained for manual rollback.
--   - Back-fill only moves created_at; amounts are untouched, so sum()
--     over the ledger is preserved by construction.
--   - Final DO block re-asserts the capital == ledger sum invariant.
-- ============================================================

-- ─── 1. Backup table for rollback ──────────────────────────
-- To roll back the back-fill:
--   UPDATE return_credits rc SET created_at = bk.created_at
--     FROM return_credits_backup_010 bk WHERE rc.id = bk.id;
-- After verifying stability (e.g. one week), drop with:
--   DROP TABLE return_credits_backup_010;
CREATE TABLE IF NOT EXISTS return_credits_backup_010 AS
  SELECT * FROM return_credits;

-- ─── 2. Add p_credit_date parameter ────────────────────────
-- Postgres overloads functions by argument signature, so CREATE OR REPLACE
-- with a new 6-arg form leaves the old 5-arg form in place. We drop the old
-- overload explicitly after creating the new one so there's exactly one
-- canonical function and the generated TS types carry a single signature.
-- All app callers pass p_credit_date; any unknown direct-SQL callers that
-- still pass 5 args can migrate to the 6-arg form (which has DEFAULT now(),
-- so the ergonomic behaviour is identical to the old function).
CREATE OR REPLACE FUNCTION credit_investor_return(
  p_investor_id uuid,
  p_po_id uuid,
  p_amount decimal,
  p_deployed decimal,
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

  INSERT INTO return_credits (investor_id, po_id, amount, deployed, tier_rate, created_at)
    VALUES (p_investor_id, p_po_id, p_amount, p_deployed, p_tier_rate, p_credit_date)
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

-- Drop the now-shadowed 5-arg overload (see comment above step 2). Safe
-- after the 6-arg form exists with DEFAULT now().
DROP FUNCTION IF EXISTS credit_investor_return(uuid, uuid, numeric, numeric, numeric);

-- ─── 3. Back-fill created_at for existing rows ─────────────
-- For every return_credits row whose timestamp differs from its PO's
-- commissions_cleared date, reset it to the clear date. Amounts are not
-- touched, so the capital == ledger invariant is preserved by construction.
UPDATE return_credits rc
  SET created_at = po.commissions_cleared::timestamptz
  FROM purchase_orders po
  WHERE rc.po_id = po.id
    AND po.commissions_cleared IS NOT NULL
    AND rc.created_at::date <> po.commissions_cleared;

-- ─── 4. Invariant re-check ────────────────────────────────
-- capital must still equal sum(v_investor_ledger.amount) per investor.
-- Only timestamps moved; this is belt-and-braces in case the UPDATE
-- silently misbehaved (e.g. unexpected NULL coalescing).
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
    RAISE EXCEPTION 'Ledger invariant violated for % investor(s) after back-dating return_credits', v_bad_count;
  END IF;
END $$;
