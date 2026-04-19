// Investor capital deployment allocation — extracted from master-control-v2.jsx lines 2934–2969

import { INV_TIERS } from "./constants";
import { getTier } from "./tiers";

// ── Input types ─────────────────────────────────────────────

export interface DeploymentPO {
  id: string;
  ref: string;
  poDate: string;
  poAmount: number;
  channel: string;
  dos?: Array<{ buyerPaid?: string | null }>;
  commissionsCleared?: string | null;
}

export interface DeploymentInvestor {
  id: string;
  name: string;
  capital: number;
  dateJoined: string;
}

// ── Output type ─────────────────────────────────────────────

export interface Deployment {
  investorId: string;
  investorName: string;
  poId: string;
  poRef: string;
  poDate: string;
  poAmount: number;
  channel: string;
  deployed: number;
  returnAmt: number;
  returnRate: number;
  tierName: string;
  tierEmoji: string;
  cycleComplete: boolean;
}

// ── Deployment calculation ──────────────────────────────────
// Auto-pool: proportional split by capital.
//
// Callers should pass every PO whose po_date is on or before the last day
// of `selectedMonth`. The allocator walks a chronological event timeline:
//
//   - alloc event at po.poDate       → deduct deployed capital from investors
//   - return event at po.commissionsCleared (if set and ≤ end of selectedMonth)
//                                     → return that PO's deployed capital
//
// Ties on the same date: returns fire before allocations, so capital freed on
// day D is available for any PO also dated D.
//
// `remaining` reflects investors' idle capital as of end-of-selectedMonth.
// Returned `deployments` are filtered to POs whose poDate is in selectedMonth,
// so the UI table only shows allocations for the month being viewed. (Prior-
// month deployments still influenced `remaining` — they just aren't surfaced
// as rows.)
//
// When `selectedMonth` is omitted, the function falls back to treating every
// passed-in PO as in-scope for both allocation and display, matching the
// original behaviour for callers that already scope their input.

const endOfMonth = (month: string): string => {
  // month is "YYYY-MM"; returns "YYYY-MM-31" which sorts correctly against any
  // ISO date (day part) within or before that month.
  return `${month}-31`;
};

const monthOf = (date: string): string => (date ? date.slice(0, 7) : "");

type AllocEvent = { kind: "alloc"; date: string; po: DeploymentPO };
type ReturnEvent = {
  kind: "return";
  date: string;
  po: DeploymentPO;
  allocs: Array<{ investorId: string; deployed: number }>;
};
type TimelineEvent = AllocEvent | ReturnEvent;

export const calcSharedDeployments = (
  poolPOs: DeploymentPO[],
  investors: DeploymentInvestor[],
  selectedMonth?: string
): { deployments: Deployment[]; remaining: Record<string, number> } => {
  const horizon = selectedMonth ? endOfMonth(selectedMonth) : null;

  // Only consider POs whose po_date is within the horizon.
  const inScope = poolPOs.filter(
    (po) => !horizon || (po.poDate || "") <= horizon
  );

  // Build the event timeline. Allocation events exist for every in-scope PO;
  // return events exist only when commissionsCleared is set and ≤ horizon.
  const sortedPOs = [...inScope].sort(
    (a, b) =>
      (a.poDate || "").localeCompare(b.poDate || "") ||
      (a.ref || "").localeCompare(b.ref || "")
  );

  // Track deployed capital per PO so the return event knows how much to give
  // back. The allocator fills this in as it processes alloc events.
  const deployedByPO: Record<
    string,
    Array<{ investorId: string; deployed: number }>
  > = {};

  const events: TimelineEvent[] = [];
  for (const po of sortedPOs) {
    events.push({ kind: "alloc", date: po.poDate || "", po });
    const cleared = po.commissionsCleared || "";
    if (cleared && (!horizon || cleared <= horizon)) {
      events.push({
        kind: "return",
        date: cleared,
        po,
        allocs: (deployedByPO[po.id] ||= []),
      });
    }
  }

  // Stable sort: by date ascending, returns before allocs on the same date,
  // then by ref to keep allocation order deterministic.
  events.sort((a, b) => {
    const byDate = (a.date || "").localeCompare(b.date || "");
    if (byDate !== 0) return byDate;
    if (a.kind !== b.kind) return a.kind === "return" ? -1 : 1;
    return (a.po.ref || "").localeCompare(b.po.ref || "");
  });

  const remaining: Record<string, number> = {};
  investors.forEach((inv) => {
    remaining[inv.id] = inv.capital;
  });

  const deploymentsAll: Deployment[] = [];

  for (const event of events) {
    if (event.kind === "return") {
      for (const alloc of event.allocs) {
        remaining[alloc.investorId] =
          (remaining[alloc.investorId] || 0) + alloc.deployed;
      }
      continue;
    }

    const po = event.po;
    const poAmt = po.poAmount || 0;
    if (poAmt <= 0) continue;

    const fullyPaid =
      po.dos && po.dos.length > 0 && po.dos.every((d) => d.buyerPaid);

    // Only investors who joined on or before this PO date are eligible
    const eligibleInvestors = investors.filter(
      (inv) => inv.dateJoined && inv.dateJoined <= (po.poDate || "")
    );
    const totalAvail = eligibleInvestors.reduce(
      (s, inv) => s + Math.max(0, remaining[inv.id] || 0),
      0
    );
    if (totalAvail <= 0) continue;

    const toFund = Math.min(poAmt, totalAvail);
    let allocated = 0;
    const eligible = eligibleInvestors.filter(
      (inv) => (remaining[inv.id] || 0) > 0
    );

    const allocsForPO = (deployedByPO[po.id] ||= []);

    for (let idx = 0; idx < eligible.length; idx++) {
      const inv = eligible[idx];
      const avail = remaining[inv.id] || 0;
      if (avail <= 0) continue;

      // Last eligible investor gets the remainder to avoid rounding errors
      const isLast = idx === eligible.length - 1;
      const share = avail / totalAvail;
      const deployed = isLast
        ? Math.min(avail, toFund - allocated)
        : Math.min(avail, Math.floor(share * toFund));
      if (deployed <= 0) continue;

      allocated += deployed;
      remaining[inv.id] -= deployed;
      allocsForPO.push({ investorId: inv.id, deployed });

      const invTier = getTier(inv.capital, INV_TIERS);
      const invReturnRate = invTier.rate;
      const returnAmtTiered = deployed * (invReturnRate / 100);

      deploymentsAll.push({
        investorId: inv.id,
        investorName: inv.name,
        poId: po.id,
        poRef: po.ref,
        poDate: po.poDate,
        poAmount: po.poAmount,
        channel: po.channel,
        deployed,
        returnAmt: returnAmtTiered,
        returnRate: invReturnRate,
        tierName: invTier.name,
        tierEmoji: "",
        // "cycle complete" fires only when BOTH the deal is cash-collected
        // (all DOs buyer-paid) AND admin has set commissions_cleared on the PO.
        // Until both, the return hasn't flowed to the investor, so it stays
        // pending and introducer commission isn't credited.
        cycleComplete: !!(fullyPaid && po.commissionsCleared),
      });
    }
  }

  // If a selectedMonth was provided, only surface deployments for POs dated
  // in that month. Prior-month deployments have already done their job of
  // reducing `remaining` and now stay out of the UI.
  const deployments = selectedMonth
    ? deploymentsAll.filter((d) => monthOf(d.poDate) === selectedMonth)
    : deploymentsAll;

  return { deployments, remaining };
};
