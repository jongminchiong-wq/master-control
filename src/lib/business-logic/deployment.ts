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

// A capital-change event for an investor (e.g. reinvested return moving
// cash_balance -> capital). `date` is the ISO date the change took effect;
// `delta` is capital_after - capital_before (positive for reinvest, could be
// negative if we ever model withdrawals).
export interface CapitalEvent {
  investorId: string;
  date: string;
  delta: number;
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
// of `selectedMonth`, plus every capital event (compound_log entry) in the
// same horizon. The allocator walks a chronological event timeline:
//
//   - alloc   event at po.poDate             → deduct deployed capital
//   - return  event at po.commissionsCleared → refund that PO's deployed capital
//   - capital event at compound_log.created_at → credit reinvested return
//
// Ties on the same date: returns fire first (free capital), then capital
// credits, then allocations — so capital credited on day D is available for
// any PO also dated D.
//
// Seeding: `investors[i].capital` is the *current* value (includes every
// past reinvest). We subtract the sum of in-horizon capital deltas so
// `remaining` starts at the pre-reinvest capital; each capital event then
// re-adds its delta at the correct point in time. This prevents a reinvest
// on day X from retroactively inflating an investor's allocation on any PO
// dated before X.
//
// `remaining` reflects investors' idle capital as of end-of-selectedMonth.
// Returned `deployments` are filtered to POs whose poDate is in selectedMonth,
// so the UI table only shows allocations for the month being viewed. (Prior-
// month deployments still influenced `remaining` — they just aren't surfaced
// as rows.)
//
// When `selectedMonth` is omitted, the function falls back to treating every
// passed-in PO and capital event as in-scope for both allocation and display,
// matching the original behaviour for callers that already scope their input.

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
type CapitalChangeEvent = {
  kind: "capital";
  date: string;
  investorId: string;
  delta: number;
};
type TimelineEvent = AllocEvent | ReturnEvent | CapitalChangeEvent;

export const calcSharedDeployments = (
  poolPOs: DeploymentPO[],
  investors: DeploymentInvestor[],
  capitalEvents: CapitalEvent[] = [],
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

  // Capital events in horizon become timeline events. Investor's current
  // `capital` already reflects every event in this list (the DB moves
  // cash_balance -> capital atomically with a compound_log insert), so the
  // delta is "applied" not "additive" — we just need to defer it to its date.
  const inHorizonCapitalEvents = capitalEvents.filter(
    (ev) => !horizon || (ev.date || "") <= horizon
  );
  for (const ev of inHorizonCapitalEvents) {
    events.push({
      kind: "capital",
      date: ev.date || "",
      investorId: ev.investorId,
      delta: ev.delta,
    });
  }

  // Stable sort: by date ascending; on the same date: returns first (free
  // capital), then capital credits, then allocations. Within the same event
  // kind, keep original order (POs by ref, capital events stable).
  const kindOrder: Record<TimelineEvent["kind"], number> = {
    return: 0,
    capital: 1,
    alloc: 2,
  };
  events.sort((a, b) => {
    const byDate = (a.date || "").localeCompare(b.date || "");
    if (byDate !== 0) return byDate;
    if (a.kind !== b.kind) return kindOrder[a.kind] - kindOrder[b.kind];
    if (a.kind === "alloc" && b.kind === "alloc") {
      return (a.po.ref || "").localeCompare(b.po.ref || "");
    }
    if (a.kind === "return" && b.kind === "return") {
      return (a.po.ref || "").localeCompare(b.po.ref || "");
    }
    return 0;
  });

  // Seed `remaining` with each investor's capital *before* any in-horizon
  // capital events. Current `investors[i].capital` already includes those
  // deltas (reinvest modifies investors.capital atomically with the log row),
  // so we subtract them back out; each capital event then re-adds its delta
  // at the correct point in the timeline.
  const deltaInHorizonByInvestor: Record<string, number> = {};
  for (const ev of inHorizonCapitalEvents) {
    deltaInHorizonByInvestor[ev.investorId] =
      (deltaInHorizonByInvestor[ev.investorId] || 0) + ev.delta;
  }
  const remaining: Record<string, number> = {};
  investors.forEach((inv) => {
    remaining[inv.id] =
      inv.capital - (deltaInHorizonByInvestor[inv.id] || 0);
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

    if (event.kind === "capital") {
      remaining[event.investorId] =
        (remaining[event.investorId] || 0) + event.delta;
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
