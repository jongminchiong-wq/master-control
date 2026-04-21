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
  // The "capital-committed" date for this deployment — used by the month
  // filter to decide which view this deployment surfaces in. For Pass-1
  // allocations this equals `po.poDate` (the deal's own date). For Pass-2
  // backfills (late-joining investor filling a prior-month gap) this equals
  // the investor's `dateJoined`, which is the month their money actually
  // entered the pool. Optional so consumers that construct Deployment
  // objects in tests or adapters still compile; the filter falls back to
  // `poDate` when absent, preserving pre-deployedAt behaviour.
  deployedAt?: string;
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
// past reinvest). We subtract the sum of ALL capital-event deltas so
// `remaining` starts at each investor's *initial* capital. In-horizon
// events then replay on the timeline; out-of-horizon events stay out
// (they haven't happened yet as far as the horizon is concerned). This
// keeps two-way stability: a future reinvest doesn't inflate past POs,
// and a newer reinvest doesn't retroactively disturb past-month views.
//
// `remaining` reflects investors' idle capital as of end-of-selectedMonth.
// Returned `deployments` are filtered by each row's `deployedAt` (the date
// the investor actually committed capital): Pass 1 uses po.poDate, Pass 2
// uses inv.dateJoined. So the UI table shows allocations that were made
// *during* the selected month, not just allocations against POs dated in
// that month — this is what makes a March-joiner's backfill of a Feb PO
// surface in March rather than vanishing. (Prior-month deployments still
// influenced `remaining` — they just aren't re-surfaced in later months.)
//
// When `selectedMonth` is omitted, the function falls back to treating every
// passed-in PO and capital event as in-scope for both allocation and display,
// matching the original behaviour for callers that already scope their input.
//
// Pass 2 — backfill. After the chronological timeline finishes, any PO that
// still has an unfunded gap AND is not fully cycle-complete (≥ one DO still
// unpaid and commissions_cleared not set) is offered to investors with idle
// capital, regardless of whether their dateJoined precedes the po.poDate.
// Horizon still applies: an investor must have joined on or before horizon
// to backfill. A PO with some DOs already buyer-paid is STILL eligible for
// backfill (Option 2 semantics) — this accepts a small fairness cost (late
// investor earns full tier rate on a deal where cashflow has partially
// started) in exchange for day-to-day operational practicality (the user
// needs to mark DOs paid as they come in without freezing the gap).

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

  // Seed `remaining` with each investor's *initial* capital by subtracting
  // ALL capital events (not just in-horizon). Rationale: `investors[i].capital`
  // is the current value, which already includes every past reinvest. If we
  // only subtract in-horizon deltas, an out-of-horizon future reinvest would
  // bleed into the past view (e.g. reinvesting Mar returns on 04-20 would
  // inflate March's allocation when someone flips the dropdown back to March).
  // In-horizon events replay on the timeline below to bring `remaining` up
  // to the correct value at horizon end; out-of-horizon events stay out.
  const totalDeltaByInvestor: Record<string, number> = {};
  for (const ev of capitalEvents) {
    totalDeltaByInvestor[ev.investorId] =
      (totalDeltaByInvestor[ev.investorId] || 0) + ev.delta;
  }
  const remaining: Record<string, number> = {};
  investors.forEach((inv) => {
    remaining[inv.id] = inv.capital - (totalDeltaByInvestor[inv.id] || 0);
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
        // Pass-1 allocation — committed on the PO's own date.
        deployedAt: po.poDate,
      });
    }
  }

  // ── Pass 2: backfill active unfunded POs with leftover idle capital ───────
  // A PO is "backfill-eligible" while not fully cycle-complete — at least one
  // DO is still unpaid AND commissions_cleared is not set. This lets a late-
  // joining investor fund the remaining gap on a PO even if some of its DOs
  // have already been buyer-paid. Investors are gated only by horizon (not
  // by po.poDate vs inv.dateJoined) so a historical month view stays stable:
  // viewing February must not retroactively credit a March investor.
  //
  // POs are walked oldest-first, so remaining capital fills the earliest gap
  // first. Pass 1 has already consumed what it could chronologically, so Pass
  // 2 only sees POs where Pass 1 ran short on eligible capital at their time.
  for (const po of sortedPOs) {
    const poAmt = po.poAmount || 0;
    if (poAmt <= 0) continue;

    const fullyPaid =
      po.dos && po.dos.length > 0 && po.dos.every((d) => d.buyerPaid);
    if (fullyPaid || po.commissionsCleared) continue;

    const allocsForPO = (deployedByPO[po.id] ||= []);
    const alreadyDeployed = allocsForPO.reduce((s, a) => s + a.deployed, 0);
    const unfunded = poAmt - alreadyDeployed;
    if (unfunded <= 0) continue;

    const backfillPool = investors.filter(
      (inv) =>
        inv.dateJoined &&
        (!horizon || inv.dateJoined <= horizon) &&
        (remaining[inv.id] || 0) > 0
    );
    const totalAvail = backfillPool.reduce(
      (s, inv) => s + (remaining[inv.id] || 0),
      0
    );
    if (totalAvail <= 0) continue;

    const toFund = Math.min(unfunded, totalAvail);
    let allocated = 0;

    for (let idx = 0; idx < backfillPool.length; idx++) {
      const inv = backfillPool[idx];
      const avail = remaining[inv.id] || 0;
      if (avail <= 0) continue;

      const isLast = idx === backfillPool.length - 1;
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
        // Reached only when !fullyPaid && !commissionsCleared — cycle open.
        cycleComplete: false,
        // Pass-2 backfill — committed when this investor joined the pool,
        // not when the PO was originally created. This surfaces the
        // deployment in the investor's join-month UI view.
        deployedAt: inv.dateJoined,
      });
    }
  }

  // If a selectedMonth was provided, only surface deployments committed
  // during that month. "Committed" is the investor's capital-commit date:
  //   Pass 1 → po.poDate (deal's own date, preserves original behaviour)
  //   Pass 2 → inv.dateJoined (backfill surfaces in the late-joiner's month)
  // Fallback to poDate keeps pre-deployedAt deployments (e.g. test fixtures)
  // working identically to the original PO-month filter.
  const deployments = selectedMonth
    ? deploymentsAll.filter(
        (d) => monthOf(d.deployedAt ?? d.poDate) === selectedMonth
      )
    : deploymentsAll;

  return { deployments, remaining };
};
