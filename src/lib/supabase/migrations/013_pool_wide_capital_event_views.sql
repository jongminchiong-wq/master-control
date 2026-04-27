-- ============================================================
-- Master Control — Pool-wide capital-event views for the allocator
--
-- The shared deployment allocator (lib/business-logic/deployment.ts)
-- seeds each investor's `remaining` capital as
--   remaining[inv.id] = inv.capital - SUM(deltas in capitalEvents)
-- where capitalEvents is built from deposits + withdrawals + admin
-- adjustments + return_credits + introducer_credits (capital-events.ts).
--
-- For the seed (and the timing of capital becoming available during
-- backfill passes) to be correct on a non-admin session, the events
-- stream MUST cover ALL investors — otherwise other investors look
-- like they have more idle capital than they really do, the pool's
-- totalAvail comes out larger, and the current investor's pro-rata
-- share of every PO comes out smaller.
--
-- Migration 009 already granted investors pool-wide SELECT on:
--   - withdrawals          (investor_read_all_withdrawals)
--   - admin_adjustments    (investor_read_all_admin_adjustments)
--   - return_credits       (investor_read_all_return_credits)
--
-- Two tables were never widened:
--   - deposits              (investor_read_own_deposits — 006)
--   - introducer_credits    (introducer_read_own_credits — 012)
--
-- Loosening RLS on the underlying tables would expose private fields
-- (deposit method, reference, notes; introducee_id, base_return,
-- tier_rate). Instead, we expose two thin VIEWs containing only the
-- columns buildCapitalEvents actually consumes — investor_id/date/
-- amount and (for introducer_credits) po_id so the page can resolve
-- commissions_cleared off purchase_orders, which is already pool-wide.
--
-- security_invoker = false is the PG 15 default but spelled out for
-- intent: the view runs with the owner's privileges, so the RLS on
-- the underlying tables doesn't clip rows when an investor session
-- queries through it.
--
-- Idempotent (CREATE OR REPLACE).
--
-- Rollback recipe:
--   REVOKE SELECT ON v_introducer_credit_events FROM authenticated;
--   REVOKE SELECT ON v_deposit_events            FROM authenticated;
--   DROP VIEW IF EXISTS v_introducer_credit_events;
--   DROP VIEW IF EXISTS v_deposit_events;
-- ============================================================

-- ─── v_deposit_events ─────────────────────────────────────
-- Feeds buildCapitalEvents.deposits. Hides method, reference, notes,
-- recorded_by — only the three fields needed for a capital-delta event.
CREATE OR REPLACE VIEW v_deposit_events
  WITH (security_invoker = false) AS
SELECT investor_id, deposited_at, amount
FROM deposits;

GRANT SELECT ON v_deposit_events TO authenticated;

-- ─── v_introducer_credit_events ───────────────────────────
-- Feeds buildCapitalEvents.introducerCredits. Hides introducee_id,
-- base_return, tier_rate (the recipient of the credit and the
-- per-commission math). po_id is required so the page can join to
-- purchase_orders.commissions_cleared as the authoritative event date.
CREATE OR REPLACE VIEW v_introducer_credit_events
  WITH (security_invoker = false) AS
SELECT introducer_id, po_id, created_at, amount
FROM introducer_credits;

GRANT SELECT ON v_introducer_credit_events TO authenticated;
