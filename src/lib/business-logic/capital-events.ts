// Builds the CapitalEvent[] stream the deployment allocator consumes.
// Every write that mutates investors.capital must appear here — otherwise
// the allocator's `remaining` seed (inv.capital - sum(deltas)) lands on
// the wrong starting value. Four pages call calcSharedDeployments; without
// a shared builder they drifted out of sync (withdrawals and admin_adjustments
// were missing silently, producing negative seeds when withdrawals existed).

import type { Tables } from "@/lib/supabase/types";
import type { CapitalEvent } from "./deployment";

// Event-row shapes are spelled out structurally rather than via Tables<...>
// so the investor page can pass rows from v_deposit_events /
// v_introducer_credit_events (migration 013) — those views expose only
// the columns this builder actually reads, and Postgres surfaces them
// as nullable through the view boundary even when the underlying
// columns are NOT NULL. Admin callers passing full Tables<...> rows
// still satisfy these widened shapes. Nulls are filtered out below.
export interface DepositEventRow {
  investor_id: string | null;
  deposited_at: string | null;
  amount: number | null;
}

export interface IntroducerCreditEventRow {
  introducer_id: string | null;
  po_id: string | null;
  created_at: string | null;
  amount: number | null;
}

export interface BuildCapitalEventsArgs {
  deposits: DepositEventRow[];
  withdrawals: Tables<"withdrawals">[];
  adminAdjustments: Tables<"admin_adjustments">[];
  returnCredits: Tables<"return_credits">[];
  // Introducer commissions credited under migration 012 — these directly
  // bump investors.capital for the introducer, so they MUST surface as
  // capital events or the allocator's `remaining` seed under-shoots by
  // the credited amount and the introducer's introducer-earned RM never
  // becomes redeployable on subsequent POs. Optional default `[]` keeps
  // older callers compiling, but every page that drives the allocator
  // should fetch and pass this.
  introducerCredits?: IntroducerCreditEventRow[];
  // POs are joined in so return_credits can source their capital-event date
  // from purchase_orders.commissions_cleared (authoritative: set by admin,
  // lives on the PO row) instead of return_credits.created_at (single field
  // that drifts if a row bypasses the RPC or was written before migration
  // 010). Keeps the Feb-horizon snapshot correct even on DBs where 010
  // hasn't been applied.
  pos: Tables<"purchase_orders">[];
}

export function buildCapitalEvents(args: BuildCapitalEventsArgs): CapitalEvent[] {
  const poById = new Map(args.pos.map((p) => [p.id, p] as const));

  return [
    ...args.deposits
      .filter(
        (d): d is DepositEventRow & {
          investor_id: string;
          deposited_at: string;
        } => !!d.deposited_at && !!d.investor_id
      )
      .map((d) => ({
        investorId: d.investor_id,
        date: d.deposited_at,
        delta: Number(d.amount),
      })),
    // Capital-type withdrawals debit investors.capital at submit time
    // (submit_withdrawal in 008_wallet_self_service.sql). Rejection refunds
    // it, so filtering status != 'rejected' nets to the correct current
    // capital. Date is requested_at — the moment the debit actually happened.
    ...args.withdrawals
      .filter(
        (w) =>
          w.type === "capital" &&
          w.status !== "rejected" &&
          w.requested_at
      )
      .map((w) => ({
        investorId: w.investor_id,
        date: (w.requested_at as string).slice(0, 10),
        delta: -Number(w.amount),
      })),
    // Signed delta — positive for capital bumped up, negative for trimmed.
    ...args.adminAdjustments
      .filter((a) => a.created_at)
      .map((a) => ({
        investorId: a.investor_id,
        date: (a.created_at as string).slice(0, 10),
        delta: Number(a.amount),
      })),
    // Under Option C, return_credits directly bump investors.capital. Prefer
    // po.commissions_cleared as the event date (authoritative "when the
    // investor earned this"); fall back to rc.created_at only if the PO is
    // missing or uncleared. Without this fallback override, a row whose
    // created_at was stamped with now() (pre-migration-010 or any direct-SQL
    // write) would surface as a future-dated event and drop out of the
    // horizon filter, breaking Total = Deployed + Idle for past-month views.
    ...args.returnCredits
      .map((rc) => {
        const po = poById.get(rc.po_id);
        const date = po?.commissions_cleared
          ? po.commissions_cleared
          : rc.created_at
          ? (rc.created_at as string).slice(0, 10)
          : "";
        return {
          investorId: rc.investor_id,
          date,
          delta: Number(rc.amount),
        };
      })
      .filter((ev) => ev.date),
    // Introducer credits use the same po.commissions_cleared preference as
    // return_credits — the underlying earn date is the moment the PO cleared,
    // not when the row landed in the table. Keeps month-scoped views like
    // /investors?month=2026-02 honouring the original earn date even if a
    // backfill ran in a later month.
    ...(args.introducerCredits ?? [])
      .filter(
        (ic): ic is IntroducerCreditEventRow & { introducer_id: string } =>
          !!ic.introducer_id
      )
      .map((ic) => {
        const po = ic.po_id ? poById.get(ic.po_id) : undefined;
        const date = po?.commissions_cleared
          ? po.commissions_cleared
          : ic.created_at
          ? (ic.created_at as string).slice(0, 10)
          : "";
        return {
          investorId: ic.introducer_id,
          date,
          delta: Number(ic.amount),
        };
      })
      .filter((ev) => ev.date),
  ];
}
