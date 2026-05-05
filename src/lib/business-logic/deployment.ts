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
  description?: string | null;
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
  description?: string | null;
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
// still has an unfunded gap is offered to investors with idle capital,
// regardless of whether their dateJoined precedes the po.poDate.
//
// Eligibility:
//   - Investor must have joined on or before the PO's "close-off" date:
//     commissions_cleared (if set) else horizon. This lets a late-joiner
//     backfill a PO that was open when they joined and has since cleared —
//     so their return flows through the credit pipeline instead of
//     evaporating the moment admin sets commissions_cleared. It also
//     prevents a brand-new investor from retroactively claiming credit on
//     a PO that closed before they existed (joined after clearance ⇒ reject).
//   - A PO with some DOs already buyer-paid is STILL eligible for backfill
//     (Option 2 semantics) — operational practicality over fairness edge.
//   - A PO that is fully buyer-paid but NOT yet cleared is skipped — the
//     cash cycle is mechanically over, nothing meaningful for Pass 2 to do.
//   - An investor who already funded via Pass 1 is excluded from Pass 2 on
//     the same PO, so a Mar 5 return doesn't double-allocate A's just-
//     refunded capital back onto PRX-002.
//
// Balance sheet:
//   - If the PO's capital has already returned (fullyPaid or cleared) by
//     the time Pass 2 runs, the return event already fired on the timeline
//     without the late-joiner's allocation in it. We simulate that return
//     here by refunding the deduction — otherwise end-of-horizon `remaining`
//     shows the late-joiner as still-deployed on a deal that's already
//     closed, which is wrong for the utilisation bar.
//
// cycleComplete is derived from the PO's real state, not hardcoded — so a
// backfill row on a cleared PO is cycleComplete:true and enters the same
// credit_investor_return pipeline as Pass 1 rows.

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

  // Synthetic "join" events — zero-delta trigger markers at each investor's
  // dateJoined. They do NOT add capital (seeding already puts initial capital
  // in `remaining`); they exist solely to fire the existing interleaved-
  // backfill loop below at the moment an investor joins, so their money pays
  // off older unfunded POs BEFORE any later-dated PO alloc can grab it.
  // Without this, a late-joiner sees their PRX-002 backfill shift every time
  // a new March PO is added (9,960 → 5,408 → disappearing), because Pass 1
  // consumes their capital chronologically before Pass 2 runs.
  const joinEvents: CapitalEvent[] = investors
    .filter((inv) => inv.dateJoined)
    .map((inv) => ({
      investorId: inv.id,
      date: inv.dateJoined,
      delta: 0,
    }));
  const allCapitalEvents: CapitalEvent[] = [...capitalEvents, ...joinEvents];

  // Capital events in horizon become timeline events. Investor's current
  // `capital` already reflects every event in this list (the DB moves
  // cash_balance -> capital atomically with a compound_log insert), so the
  // delta is "applied" not "additive" — we just need to defer it to its date.
  const inHorizonCapitalEvents = allCapitalEvents.filter(
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
  // ALL real capital events (not just in-horizon). Rationale: `investors[i].capital`
  // is the current value, which already includes every past reinvest. If we
  // only subtract in-horizon deltas, an out-of-horizon future reinvest would
  // bleed into the past view. Join events are zero-delta so they don't
  // affect this sum — they only trigger backfill when they fire.
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

  // Merge allocations for the same (investorId, poId, deployedAt-month) into
  // a single row. When a PO is oversubscribed and multiple capital events in
  // the same month top it up — Pass-1 plus N interleaved backfills — the raw
  // emission produces one row per event, which the UI treats as N separate
  // deployments. Merging within a month collapses them into one natural
  // "investor committed X to this PO" row.
  //
  // The month key matters: Pass-2 can emit a row for the same (investor, PO)
  // with a deployedAt in a later month (a late deposit backfilling an older
  // PO — see Test 16). That row is intentionally separate so it surfaces in
  // the month the fresh capital arrived; we must not fold it back into the
  // original Pass-1 row.
  //
  // Earliest deployedAt within the month wins, so the row stays pinned to
  // the first commitment date in that month.
  const upsertDeployment = (row: Deployment) => {
    const rowMonth = monthOf(row.deployedAt ?? row.poDate);
    const existing = deploymentsAll.find(
      (d) =>
        d.investorId === row.investorId &&
        d.poId === row.poId &&
        monthOf(d.deployedAt ?? d.poDate) === rowMonth
    );
    if (!existing) {
      deploymentsAll.push(row);
      return;
    }
    existing.deployed += row.deployed;
    existing.returnAmt += row.returnAmt;
    const rowAt = row.deployedAt ?? row.poDate;
    const existingAt = existing.deployedAt ?? existing.poDate;
    if (rowAt && existingAt && rowAt < existingAt) {
      existing.deployedAt = row.deployedAt;
    }
    existing.cycleComplete = row.cycleComplete;
  };

  for (let eventIdx = 0; eventIdx < events.length; eventIdx++) {
    const event = events[eventIdx];

    if (event.kind === "return") {
      for (const alloc of event.allocs) {
        remaining[alloc.investorId] =
          (remaining[alloc.investorId] || 0) + alloc.deployed;
      }
      continue;
    }

    if (event.kind === "capital") {
      // Batch consecutive same-date capital events. When a PO clears, every
      // investor's return-credit and introducer-commission share the clear
      // date, so they all surface in a single batch. The prior per-event
      // greedy fill let whichever event fired first in array order claim
      // the whole unfunded gap on an older PO, leaving the last investor
      // partly idle (Test 18 — five investors with same-day returns saw
      // PRX-002 funded 10,400/10,400/10,400/10,400/8,400 instead of pro-
      // rata). Batching first, then pro-rata-filling once across the batch,
      // keeps the timeline order Test 17 depends on while distributing
      // same-day credits fairly.
      const batchDate = event.date;
      const batch: CapitalChangeEvent[] = [event as CapitalChangeEvent];
      while (
        eventIdx + 1 < events.length &&
        events[eventIdx + 1].kind === "capital" &&
        events[eventIdx + 1].date === batchDate
      ) {
        eventIdx++;
        batch.push(events[eventIdx] as CapitalChangeEvent);
      }

      // Apply every delta in the batch BEFORE filling any PO so pro-rata
      // weights reflect the full credited pool (return + intro + any other
      // same-day credits land together for an investor who introduced
      // someone — they get RM 400 return AND RM 84 intro on the same day,
      // both should weigh into PRX-002's split).
      for (const ev of batch) {
        remaining[ev.investorId] =
          (remaining[ev.investorId] || 0) + ev.delta;
      }

      // Unique investors who received credits in this batch — only they
      // participate in the pro-rata fill. An investor sitting on idle
      // capital who got NO credit today doesn't get their balance pulled
      // in just because someone else's return cleared today (preserves
      // Test 17's deposit-then-alloc semantics: idle capital reserved for
      // its owner's future POs is not redistributed by an unrelated event).
      const batchInvestors = Array.from(new Set(batch.map((e) => e.investorId)))
        .map((id) => investors.find((inv) => inv.id === id))
        .filter(
          (inv): inv is DeploymentInvestor => !!inv && !!inv.dateJoined
        );

      // Pro-rata fill older unfunded POs from the batched pool, oldest-
      // first so the earliest gap fills first. Strictly older: a same-day
      // PO is left for its own alloc event later in this day's timeline
      // (alloc fires after capital), otherwise the batch fills it here AND
      // the alloc event tops it up again, double-funding the PO.
      for (const po of sortedPOs) {
        if ((po.poDate || "") >= batchDate) break;

        const poAmt = po.poAmount || 0;
        if (poAmt <= 0) continue;

        // `fullyPaid` (current state) feeds cycleComplete on emitted rows.
        // Backfill-skip uses a *time-aware* check: at this batch's date,
        // a DO counts as buyer-paid only if its buyerPaid ≤ batchDate,
        // and clearance counts only if commissionsCleared ≤ batchDate.
        // A PO that later gets paid/cleared was still *open* at this
        // moment and is a legitimate backfill target.
        const fullyPaid =
          !!po.dos && po.dos.length > 0 && po.dos.every((d) => d.buyerPaid);
        const fullyPaidAtEventTime =
          !!po.dos &&
          po.dos.length > 0 &&
          po.dos.every((d) => d.buyerPaid && d.buyerPaid <= batchDate);
        const clearedAtEventTime =
          !!po.commissionsCleared && po.commissionsCleared <= batchDate;
        if (fullyPaidAtEventTime || clearedAtEventTime) continue;

        const allocsForPO = (deployedByPO[po.id] ||= []);
        const alreadyDeployed = allocsForPO.reduce(
          (s, a) => s + a.deployed,
          0
        );
        const unfunded = poAmt - alreadyDeployed;
        if (unfunded <= 0) continue;

        // Eligibility mirrors the original interleaved-backfill gate: an
        // investor must have joined on/before the PO date OR on/before the
        // batch date (Pass-2 horizon-style). Drop investors with no idle.
        const eligibleBatch = batchInvestors.filter((inv) => {
          if (
            inv.dateJoined > (po.poDate || "") &&
            inv.dateJoined > batchDate
          ) {
            return false;
          }
          return (remaining[inv.id] || 0) > 0;
        });
        if (eligibleBatch.length === 0) continue;

        const totalAvail = eligibleBatch.reduce(
          (s, inv) => s + (remaining[inv.id] || 0),
          0
        );
        if (totalAvail <= 0) continue;

        const toFund = Math.min(unfunded, totalAvail);
        let allocated = 0;

        for (let idx = 0; idx < eligibleBatch.length; idx++) {
          const inv = eligibleBatch[idx];
          const avail = remaining[inv.id] || 0;
          if (avail <= 0) continue;

          // Last eligible investor absorbs rounding remainder, mirroring
          // Pass 1 / Pass 2.
          const isLast = idx === eligibleBatch.length - 1;
          const share = avail / totalAvail;
          const deployed = isLast
            ? Math.min(avail, toFund - allocated)
            : Math.min(avail, Math.floor(share * toFund));
          if (deployed <= 0) continue;

          allocated += deployed;
          remaining[inv.id] -= deployed;
          allocsForPO.push({ investorId: inv.id, deployed });

          const invTier = getTier(inv.capital, INV_TIERS);
          upsertDeployment({
            investorId: inv.id,
            investorName: inv.name,
            poId: po.id,
            poRef: po.ref,
            poDate: po.poDate,
            poAmount: po.poAmount,
            channel: po.channel,
            description: po.description ?? null,
            deployed,
            returnAmt: deployed * (invTier.rate / 100),
            returnRate: invTier.rate,
            tierName: invTier.name,
            tierEmoji: "",
            cycleComplete: !!(fullyPaid && po.commissionsCleared),
            // Surfaces in the month the capital actually arrived, not the
            // older PO's month.
            deployedAt: batchDate,
          });
        }
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

    // Subtract anything already deployed (e.g. by a same-day capital-batch
    // backfill) so this alloc never doubles up on top of an existing fill.
    const allocsForPO = (deployedByPO[po.id] ||= []);
    const alreadyDeployed = allocsForPO.reduce((s, a) => s + a.deployed, 0);
    const toFund = Math.min(poAmt - alreadyDeployed, totalAvail);
    if (toFund <= 0) continue;
    let allocated = 0;
    const eligible = eligibleInvestors.filter(
      (inv) => (remaining[inv.id] || 0) > 0
    );

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

      upsertDeployment({
        investorId: inv.id,
        investorName: inv.name,
        poId: po.id,
        poRef: po.ref,
        poDate: po.poDate,
        poAmount: po.poAmount,
        channel: po.channel,
        description: po.description ?? null,
        deployed,
        returnAmt: returnAmtTiered,
        returnRate: invReturnRate,
        tierName: invTier.name,
        tierEmoji: "",
        // "cycle complete" fires only when BOTH the deal is cash-collected
        // (all DOs buyer-paid) AND admin has set commissions_cleared on the PO.
        // Until both, the return hasn't flowed to the investor — and neither
        // has any introducer commission (creditIntroducerCommissions in
        // credit.ts also keys off cycleComplete, mirroring creditPOReturns).
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

  // Track each investor's latest in-horizon capital-event date (deposit or
  // reinvest). For Pass-2 backfills, `deployedAt` is `max(dateJoined, lastEvent)`
  // so the deployment row surfaces in the month the fresh capital actually
  // arrived — not the investor's (possibly-older) join month.
  const lastEventByInvestor: Record<string, string> = {};
  for (const ev of inHorizonCapitalEvents) {
    const prev = lastEventByInvestor[ev.investorId];
    if (!prev || (ev.date || "") > prev) {
      lastEventByInvestor[ev.investorId] = ev.date || "";
    }
  }

  for (const po of sortedPOs) {
    const poAmt = po.poAmount || 0;
    if (poAmt <= 0) continue;

    const fullyPaid =
      !!po.dos && po.dos.length > 0 && po.dos.every((d) => d.buyerPaid);
    // fullyPaid-but-not-cleared: cash collected from buyer, nothing for Pass 2
    // to meaningfully attribute. Skip. (Once admin sets commissionsCleared,
    // the PO becomes eligible for during-open-window backfill below.)
    if (fullyPaid && !po.commissionsCleared) continue;

    const allocsForPO = (deployedByPO[po.id] ||= []);
    const alreadyDeployed = allocsForPO.reduce((s, a) => s + a.deployed, 0);
    const unfunded = poAmt - alreadyDeployed;
    if (unfunded <= 0) continue;

    // Capital has already returned if either: all DOs buyer-paid (cash in)
    // or commissions cleared (distributed). In both cases the return event
    // has already fired on the timeline without any Pass-2 allocation in its
    // allocs list, so we refund below to keep `remaining` accurate.
    const capitalReturned = fullyPaid || !!po.commissionsCleared;
    const cycleComplete = !!(fullyPaid && po.commissionsCleared);

    // Eligibility cut-off: cleared POs stop accepting new allocations at
    // their clearance date (late-joiners after clear don't retroactively
    // fund a closed deal). Open POs use horizon.
    const eligibilityEndDate = po.commissionsCleared || horizon || "9999-12-31";
    // Pass 1 already captured investors eligible at po.poDate. Pass 2 is
    // strictly for late-joiners — exclude anyone already in allocsForPO so
    // a return-refunded A doesn't get re-attributed to the same PO.
    const alreadyFunded = new Set(allocsForPO.map((a) => a.investorId));

    const backfillPool = investors.filter(
      (inv) =>
        !alreadyFunded.has(inv.id) &&
        inv.dateJoined &&
        inv.dateJoined <= eligibilityEndDate &&
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
      if (capitalReturned) {
        // The real-world return event already fired without this investor
        // in its allocs. Simulate the return by refunding the deduction so
        // utilisation reflects the fact that capital is back, not stuck.
        remaining[inv.id] += deployed;
      }

      const invTier = getTier(inv.capital, INV_TIERS);
      const invReturnRate = invTier.rate;
      const returnAmtTiered = deployed * (invReturnRate / 100);

      upsertDeployment({
        investorId: inv.id,
        investorName: inv.name,
        poId: po.id,
        poRef: po.ref,
        poDate: po.poDate,
        poAmount: po.poAmount,
        channel: po.channel,
        description: po.description ?? null,
        deployed,
        returnAmt: returnAmtTiered,
        returnRate: invReturnRate,
        tierName: invTier.name,
        tierEmoji: "",
        // Derived from the PO's real state — true for cleared POs so the
        // backfill row is credited via credit_investor_return like Pass 1.
        cycleComplete,
        // Pass-2 backfill — committed when fresh capital actually arrived.
        // For a join-only investor (no deposits/reinvests) that's dateJoined.
        // For an investor whose latest capital event (deposit or reinvest)
        // post-dates their join, it's that event's date — so a late deposit
        // backfilling an older PO surfaces in the month the deposit arrived.
        deployedAt:
          (lastEventByInvestor[inv.id] ?? "") > inv.dateJoined
            ? lastEventByInvestor[inv.id]
            : inv.dateJoined,
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

// ── Frozen-returns overlay ────────────────────────────────────
// When admin sets commissions_cleared, credit_investor_return inserts a row
// into return_credits with the frozen (amount, deployed, tier_rate) for that
// (investor, PO) pair. The row is permanent: the RPC uses ON CONFLICT DO
// NOTHING so the first clear wins. calcSharedDeployments, however, re-derives
// returnAmt/returnRate on every render via getTier(inv.capital) — so any
// later capital change that crosses a tier boundary (withdrawal drops an
// investor below Silver; compound bumps them to Gold) retroactively rewrites
// historical cycle returns in the UI.
//
// This helper patches that: for every allocator row whose (investor, PO)
// pair has a stored credit, returnAmt and returnRate are replaced with the
// frozen DB values, and cycleComplete is forced to true (if we have a credit
// the cycle provably closed).
//
// `deployed` is intentionally NOT overwritten — it's the allocator's
// allocation-truth number (proportional split over remaining), and the
// entity page's spread math uses it as the denominator for the 5% waterfall
// deduction. Overwriting could push per-PO funding totals past po_amount.
// tierName/tierEmoji are display-only and left alone.
//
// TODO: orphan credits (credit row exists but allocator emitted no row for
// that pair — e.g. late-joiner Pass-2 window closed, or investor deleted)
// are not synthesized here. Rare in practice; add phantom-row synthesis if
// it becomes a real support issue.

export interface ReturnCreditRow {
  investor_id: string;
  po_id: string;
  amount: number;
  deployed: number;
  tier_rate: number;
}

export function overlayReturnCredits(
  deployments: Deployment[],
  returnCredits: ReturnCreditRow[]
): Deployment[] {
  if (returnCredits.length === 0) return deployments;
  const byKey = new Map<string, ReturnCreditRow>();
  for (const c of returnCredits) {
    byKey.set(`${c.investor_id}:${c.po_id}`, c);
  }
  return deployments.map((d) => {
    const c = byKey.get(`${d.investorId}:${d.poId}`);
    if (!c) return d;
    return {
      ...d,
      returnAmt: c.amount,
      returnRate: c.tier_rate,
      cycleComplete: true,
    };
  });
}
