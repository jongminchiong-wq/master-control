// Shared "credit investor returns for a cleared PO" flow.
//
// Two pages call this: the PO-cycle page (inline, the moment admin types a
// commissions_cleared date) and the Investors-page auto-fire effect
// (fallback, in case a clear slipped through the primary path — direct SQL,
// older browser session, etc.).
//
// Both need the same pipeline: run calcSharedDeployments over the current
// pool snapshot, filter to this PO's cycle-complete deployments, and call
// the credit_investor_return RPC once per (investor, PO) — passing
// po.commissions_cleared as p_credit_date so return_credits.created_at
// reflects when the investor actually earned the money, not when the UI
// happened to load.
//
// The RPC is idempotent on (investor_id, po_id) via migration 009's
// ON CONFLICT DO NOTHING, so firing this redundantly is safe.
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  calcSharedDeployments,
  type DeploymentInvestor,
  type DeploymentPO,
  type CapitalEvent,
} from "./deployment";
import { getInvIntroTier } from "./tiers";

export interface CreditPOReturnsArgs {
  supabase: SupabaseClient;
  // The PO that was just cleared (or is being re-credited).
  poId: string;
  // The clear date admin set on purchase_orders.commissions_cleared. Passed
  // to the RPC as p_credit_date so return_credits.created_at reflects reality.
  clearDate: string;
  // Everything the allocator needs to compute the per-investor split for
  // this PO. Callers already fetch these for other reasons; we reuse them.
  investors: DeploymentInvestor[];
  poolPOs: DeploymentPO[];
  capitalEvents: CapitalEvent[];
  // Skip (investor, PO) pairs already present in return_credits. Optional —
  // the RPC itself rejects dupes, so this is purely to avoid the round-trip.
  alreadyCredited?: Set<string>;
}

export interface CreditPOReturnsResult {
  credited: number;
  duplicates: number;
  errors: string[];
}

export async function creditPOReturns({
  supabase,
  poId,
  clearDate,
  investors,
  poolPOs,
  capitalEvents,
  alreadyCredited,
}: CreditPOReturnsArgs): Promise<CreditPOReturnsResult> {
  const { deployments } = calcSharedDeployments(
    poolPOs,
    investors,
    capitalEvents
  );

  const poDeps = deployments.filter(
    (d) => d.poId === poId && d.cycleComplete
  );

  const result: CreditPOReturnsResult = {
    credited: 0,
    duplicates: 0,
    errors: [],
  };

  // Convert "YYYY-MM-DD" clear date into a timestamptz the RPC accepts.
  // Midnight UTC is close enough — the allocator only slices to date anyway
  // (see capital-events.ts).
  const creditDateIso = `${clearDate}T00:00:00Z`;

  for (const dep of poDeps) {
    const key = `${dep.investorId}:${dep.poId}`;
    if (alreadyCredited?.has(key)) {
      result.duplicates++;
      continue;
    }

    const { data, error } = await supabase.rpc("credit_investor_return", {
      p_investor_id: dep.investorId,
      p_po_id: dep.poId,
      p_amount: dep.returnAmt,
      p_deployed: dep.deployed,
      p_tier_rate: dep.returnRate,
      p_credit_date: creditDateIso,
    });

    if (error) {
      result.errors.push(`${dep.investorName}: ${error.message}`);
      continue;
    }

    const payload = data as
      | { success: boolean; error?: string; duplicate?: boolean }
      | null;

    if (payload?.duplicate) {
      result.duplicates++;
    } else if (payload?.success) {
      result.credited++;
    } else if (payload?.error) {
      result.errors.push(`${dep.investorName}: ${payload.error}`);
    }
  }

  return result;
}

// ── Introducer commission crediting ─────────────────────────
//
// Mirrors creditPOReturns but pays the *introducer*, not the funder. For
// every cycle-complete deployment on this PO whose investor has
// `introduced_by` set, credit the introducer at their tier-as-of-clearDate
// times the introducee's return on this PO. Tier rate is locked into the
// row (introducer_credits.tier_rate) so future tier upgrades only affect
// future credits — same model as return_credits.
//
// Idempotent: the credit_introducer_commission RPC ON CONFLICTs on the
// (introducer, introducee, po) triple, so refires are safe.

export interface CreditIntroducerCommissionsArgs {
  supabase: SupabaseClient;
  poId: string;
  clearDate: string;
  // Need full DeploymentInvestor records *plus* the introduced_by field —
  // we accept the lighter DeploymentInvestor for the allocator and a
  // separate map keyed by id for introducer lookup. Callers already have
  // both shapes from the same fetch.
  investors: DeploymentInvestor[];
  introducedBy: Map<string, string | null>;
  // Live capital snapshot per investor, used to compute the introducer's
  // tier from sum-of-introducees-capital at credit time. Map<investorId,
  // capital> works for any caller that already loaded the investors row.
  capitalById: Map<string, number>;
  poolPOs: DeploymentPO[];
  capitalEvents: CapitalEvent[];
  // Skip pairs already in introducer_credits — purely a round-trip optimisation.
  alreadyCredited?: Set<string>;
}

export async function creditIntroducerCommissions({
  supabase,
  poId,
  clearDate,
  investors,
  introducedBy,
  capitalById,
  poolPOs,
  capitalEvents,
  alreadyCredited,
}: CreditIntroducerCommissionsArgs): Promise<CreditPOReturnsResult> {
  const { deployments } = calcSharedDeployments(
    poolPOs,
    investors,
    capitalEvents
  );

  const poDeps = deployments.filter(
    (d) => d.poId === poId && d.cycleComplete
  );

  const result: CreditPOReturnsResult = {
    credited: 0,
    duplicates: 0,
    errors: [],
  };

  const creditDateIso = `${clearDate}T00:00:00Z`;

  for (const dep of poDeps) {
    const introducerId = introducedBy.get(dep.investorId);
    // No introducer (root investor) — nothing to pay.
    if (!introducerId) continue;
    // Defensive: someone introducing themselves makes no sense and would
    // also fail the RPC's own self-introduction guard.
    if (introducerId === dep.investorId) continue;

    const key = `${introducerId}:${dep.investorId}:${dep.poId}`;
    if (alreadyCredited?.has(key)) {
      result.duplicates++;
      continue;
    }

    // Tier rate is `tier% × sum(introducees' current capital)` — same rule
    // calcIntroducerData uses for the Investors-page tile.
    let totalCapitalIntroduced = 0;
    for (const [invId, cap] of capitalById) {
      if (introducedBy.get(invId) === introducerId) {
        totalCapitalIntroduced += cap;
      }
    }
    const tier = getInvIntroTier(totalCapitalIntroduced);
    const amount = dep.returnAmt * (tier.rate / 100);

    const { data, error } = await supabase.rpc("credit_introducer_commission", {
      p_introducer_id: introducerId,
      p_introducee_id: dep.investorId,
      p_po_id: dep.poId,
      p_amount: amount,
      p_base_return: dep.returnAmt,
      p_tier_rate: tier.rate,
      p_credit_date: creditDateIso,
    });

    if (error) {
      result.errors.push(`${dep.investorName}: ${error.message}`);
      continue;
    }

    const payload = data as
      | { success: boolean; error?: string; duplicate?: boolean }
      | null;

    if (payload?.duplicate) {
      result.duplicates++;
    } else if (payload?.success) {
      result.credited++;
    } else if (payload?.error) {
      result.errors.push(`${dep.investorName}: ${payload.error}`);
    }
  }

  return result;
}
