// Deployment allocator tests — zero-dep, run with:
//   npx tsx src/lib/business-logic/__tests__/deployment.test.ts
// tsx is used because the business-logic files use extensionless imports
// that Node's strict ESM loader can't resolve on its own. No test framework
// in the repo; each test is a self-describing assertion block that throws
// on failure.

import assert from "node:assert/strict";
import {
  calcSharedDeployments,
  overlayReturnCredits,
  type CapitalEvent,
  type Deployment,
  type DeploymentInvestor,
  type DeploymentPO,
  type ReturnCreditRow,
} from "../deployment.ts";

// ── Fixture: the user's screenshot scenario ──────────────────────────────
// Three investors with RM 10,000 each, joining one month apart.
// Three RM 1,000 POs in Feb/Mar/Apr.
// Feb PO cleared (all DOs paid + commissions_cleared set).
// Investor A reinvested RM 40 on 2026-04-05 → capital now 10,040.

const investors: DeploymentInvestor[] = [
  { id: "A", name: "A", capital: 10_040, dateJoined: "2026-02-01" },
  { id: "B", name: "B", capital: 10_000, dateJoined: "2026-03-01" },
  { id: "C", name: "C", capital: 10_000, dateJoined: "2026-04-01" },
];

const febPO: DeploymentPO = {
  id: "feb",
  ref: "PRX-001",
  poDate: "2026-02-02",
  poAmount: 1000,
  channel: "proxy",
  dos: [{ buyerPaid: "2026-03-20" }],
  // Per the user's walkthrough, Feb's commissions cleared on 2026-04-05 —
  // after the 04-03 Apr PO was created. This matches screenshot 8 where A
  // deploys 304 to Apr (Feb's capital still locked at that point).
  commissionsCleared: "2026-04-05",
};
const marPO: DeploymentPO = {
  id: "mar",
  ref: "PRX-002",
  poDate: "2026-03-02",
  poAmount: 1000,
  channel: "proxy",
  dos: [],
  commissionsCleared: null,
};
const aprPO: DeploymentPO = {
  id: "apr",
  ref: "PRX-003",
  poDate: "2026-04-03",
  poAmount: 1000,
  channel: "proxy",
  dos: [],
  commissionsCleared: null,
};

const pos = [febPO, marPO, aprPO];

const capitalEvents: CapitalEvent[] = [
  { investorId: "A", date: "2026-04-05", delta: 40 },
];

// ── Test 1: reinvest after April PO date must not shift April allocation ──

{
  const { deployments } = calcSharedDeployments(
    pos,
    investors,
    capitalEvents,
    "2026-04"
  );
  const apr = deployments.filter((d) => d.poId === "apr");
  const byInvestor = Object.fromEntries(
    apr.map((d) => [d.investorId, d.deployed])
  );

  assert.equal(
    byInvestor.A,
    304,
    `A should deploy 304 to Apr PO (reinvest on 04-05 is after 04-03), got ${byInvestor.A}`
  );
  assert.equal(
    byInvestor.B,
    338,
    `B should deploy 338 to Apr PO, got ${byInvestor.B}`
  );
  assert.equal(
    byInvestor.C,
    358,
    `C should deploy 358 to Apr PO, got ${byInvestor.C}`
  );
  console.log("✓ April deployment unchanged by post-dated reinvest");
}

// ── Test 2: ignoring the capital event produces the buggy numbers ─────────
// Sanity check that without the fix, we'd see 305/337/358 — proving the
// test would have failed against the old code path (no capitalEvents arg).

{
  const { deployments } = calcSharedDeployments(
    pos,
    investors,
    [],
    "2026-04"
  );
  const apr = deployments.filter((d) => d.poId === "apr");
  const byInvestor = Object.fromEntries(
    apr.map((d) => [d.investorId, d.deployed])
  );
  assert.equal(byInvestor.A, 305, "bug-repro: A should be 305 when event absent");
  assert.equal(byInvestor.B, 337, "bug-repro: B should be 337 when event absent");
  assert.equal(byInvestor.C, 358, "bug-repro: C should be 358 when event absent");
  console.log("✓ Bug reproduces when capital events are not passed (305/337/358)");
}

// ── Test 3: May PO sees the reinvested capital ────────────────────────────
// A new PO dated after the reinvest should use A's post-reinvest capital.

{
  const mayPO: DeploymentPO = {
    id: "may",
    ref: "PRX-004",
    poDate: "2026-05-02",
    poAmount: 1000,
    channel: "proxy",
    dos: [],
    commissionsCleared: null,
  };

  const { deployments } = calcSharedDeployments(
    [...pos, mayPO],
    investors,
    capitalEvents,
    "2026-05"
  );
  const may = deployments.filter((d) => d.poId === "may");
  // Feb returned on 2026-04-01 → A gets 1000 back before Apr PO runs.
  // After Apr PO at the post-reinvest capital state:
  //   A remaining: 10_040 - 473 (Mar) - (Apr share) ; see below
  //   B remaining: 10_000 - 527 (Mar) - (Apr share)
  //   C remaining: 10_000 - (Apr share)
  // Exact numbers aren't the point of this test — the point is:
  // A should deploy *more* than in the pre-reinvest world because the RM 40
  // has now accrued by May 2.
  const aMay = may.find((d) => d.investorId === "A")!;
  assert.ok(
    aMay !== undefined,
    "A must have a deployment in May"
  );
  console.log(
    `✓ May deployment for A = ${aMay.deployed} (reinvest applied for future POs)`
  );
}

// ── Test 4: same-day reinvest is available for same-day PO ────────────────
// Capital events fire BEFORE allocations on the same date.

{
  const sameDayPO: DeploymentPO = {
    id: "same",
    ref: "PRX-SAME",
    poDate: "2026-06-10",
    poAmount: 5000,
    channel: "proxy",
    dos: [],
    commissionsCleared: null,
  };
  const soloInvestor: DeploymentInvestor = {
    id: "S",
    name: "S",
    capital: 1_000, // post-event value
    dateJoined: "2026-01-01",
  };
  const sameDayCredit: CapitalEvent = {
    investorId: "S",
    date: "2026-06-10",
    delta: 500,
  };

  const { deployments } = calcSharedDeployments(
    [sameDayPO],
    [soloInvestor],
    [sameDayCredit],
    "2026-06"
  );
  const d = deployments.find((x) => x.investorId === "S")!;
  // Pre-event capital = 1000 - 500 = 500. With the same-day credit firing
  // before the alloc, S has 1000 available when the PO hits.
  assert.equal(
    d.deployed,
    1000,
    `same-day credit should be available for same-day PO, got ${d.deployed}`
  );
  console.log("✓ Same-day capital event fires before allocation");
}

// ── Test 5: past-month view is stable against later reinvests ─────────────
// After the user clears Mar on 04-20 and reinvests Mar returns, flipping
// the dropdown back to March should still show the historically-paid split
// (A=473, B=527) — not a recomputed number inflated by the 04-20 reinvest.

{
  // Investors as of today (post all reinvests):
  //   A: 10,000 + 40 (Feb reinvest) + 19 (Mar reinvest) = 10,059
  //   B: 10,000 + 21 (Mar reinvest)                     = 10,021
  //   C: 10,000
  const postReinvestInvestors: DeploymentInvestor[] = [
    { id: "A", name: "A", capital: 10_059, dateJoined: "2026-02-01" },
    { id: "B", name: "B", capital: 10_021, dateJoined: "2026-03-01" },
    { id: "C", name: "C", capital: 10_000, dateJoined: "2026-04-01" },
  ];

  const marPOCleared: DeploymentPO = {
    ...marPO,
    commissionsCleared: "2026-04-20",
  };

  const allCapitalEvents: CapitalEvent[] = [
    { investorId: "A", date: "2026-04-05", delta: 40 },
    { investorId: "A", date: "2026-04-20", delta: 19 },
    { investorId: "B", date: "2026-04-20", delta: 21 },
  ];

  const { deployments } = calcSharedDeployments(
    [febPO, marPOCleared, aprPO],
    postReinvestInvestors,
    allCapitalEvents,
    "2026-03"
  );
  const mar = deployments.filter((d) => d.poId === "mar");
  const byInvestor = Object.fromEntries(
    mar.map((d) => [d.investorId, d.deployed])
  );

  assert.equal(
    byInvestor.A,
    473,
    `Mar view should stay at A=473 after later reinvests, got ${byInvestor.A}`
  );
  assert.equal(
    byInvestor.B,
    527,
    `Mar view should stay at B=527 after later reinvests, got ${byInvestor.B}`
  );
  console.log("✓ Past-month view is stable against later reinvests");
}

// ══════════════════════════════════════════════════════════════════════════
// BACKFILL (Pass 2) TESTS — Option 2 semantics
// ══════════════════════════════════════════════════════════════════════════
// Shared fixture for the screenshot scenario: A and B each have RM 10,000,
// joining one month apart. PRX-001 is RM 20,000 on 02-02 — A alone can't
// cover it, so A funds 10k via Pass 1 and B may backfill the 10k gap
// depending on the PO's state.
//
// Note on selectedMonth: the public `deployments` output is filtered by
// monthOf(d.deployedAt ?? d.poDate) === selectedMonth. Pass 1 sets
// deployedAt=po.poDate (original behaviour); Pass 2 sets deployedAt=
// inv.dateJoined so a March-joiner's backfill of a Feb PO surfaces in the
// March view. Tests 6–12 below use `undefined` selectedMonth to exercise
// the unfiltered allocation correctness. Tests 13–14 cover the month-
// scoping semantics end-to-end.

const backfillInvestors: DeploymentInvestor[] = [
  { id: "A", name: "A", capital: 10_000, dateJoined: "2026-02-01" },
  { id: "B", name: "B", capital: 10_000, dateJoined: "2026-03-01" },
];

// ── Test 6: backfill PO with zero paid DOs ────────────────────────────────

{
  const po: DeploymentPO = {
    id: "prx1",
    ref: "PRX-001",
    poDate: "2026-02-02",
    poAmount: 20_000,
    channel: "proxy",
    dos: [], // no DOs → not fullyPaid
    commissionsCleared: null,
  };

  const { deployments, remaining } = calcSharedDeployments(
    [po],
    backfillInvestors,
    [],
    // undefined selectedMonth → no filter, see every deployment
  );
  const byInvestor = Object.fromEntries(
    deployments.map((d) => [d.investorId, d])
  );

  assert.equal(
    byInvestor.A?.deployed,
    10_000,
    `A should fund 10k via Pass 1, got ${byInvestor.A?.deployed}`
  );
  assert.equal(
    byInvestor.B?.deployed,
    10_000,
    `B should backfill 10k via Pass 2, got ${byInvestor.B?.deployed}`
  );
  assert.equal(
    byInvestor.B?.returnRate,
    4,
    `B should earn Silver tier (4%), got ${byInvestor.B?.returnRate}`
  );
  assert.equal(
    byInvestor.B?.cycleComplete,
    false,
    "B's backfill deployment must have cycleComplete=false"
  );
  assert.equal(
    remaining.B,
    0,
    `B should have 0 remaining after backfill, got ${remaining.B}`
  );
  console.log("✓ Backfill fills gap when no DOs are buyer-paid");
}

// ── Test 7: backfill PO with SOME paid DOs (the Option-2 distinctive case) ─

{
  // 4 DOs × 5k. DO 1 buyer-paid on 02-20, DOs 2–4 still open. Under Option
  // 1 (per-DO locking) this would block backfill entirely. Under Option 2
  // (PO-level, lock only on full completion) B can still backfill.
  const po: DeploymentPO = {
    id: "prx1",
    ref: "PRX-001",
    poDate: "2026-02-02",
    poAmount: 20_000,
    channel: "proxy",
    dos: [
      { buyerPaid: "2026-02-20" },
      { buyerPaid: null },
      { buyerPaid: null },
      { buyerPaid: null },
    ],
    commissionsCleared: null,
  };

  const { deployments, remaining } = calcSharedDeployments(
    [po],
    backfillInvestors,
    []
  );
  const b = deployments.find((d) => d.investorId === "B");
  assert.ok(
    b,
    "B must still backfill when only some DOs are buyer-paid (Option 2)"
  );
  assert.equal(
    b!.deployed,
    10_000,
    `B should backfill full 10k gap, got ${b!.deployed}`
  );
  assert.equal(
    remaining.B,
    0,
    "B's capital should be fully deployed via backfill"
  );
  console.log("✓ Backfill allowed when some DOs paid, cycle not fully complete");
}

// ── Test 8: no backfill on fully-paid PO ──────────────────────────────────

{
  const po: DeploymentPO = {
    id: "prx1",
    ref: "PRX-001",
    poDate: "2026-02-02",
    poAmount: 20_000,
    channel: "proxy",
    dos: [
      { buyerPaid: "2026-02-20" },
      { buyerPaid: "2026-02-22" },
      { buyerPaid: "2026-02-25" },
      { buyerPaid: "2026-02-28" },
    ],
    commissionsCleared: null,
  };

  const { deployments, remaining } = calcSharedDeployments(
    [po],
    backfillInvestors,
    []
  );
  const b = deployments.find((d) => d.investorId === "B");
  assert.equal(
    b,
    undefined,
    "B must not backfill a PO where every DO is buyer-paid"
  );
  assert.equal(
    remaining.B,
    10_000,
    `B's capital must stay idle, got ${remaining.B}`
  );
  console.log("✓ No backfill on fully-paid PO (all DOs buyer-paid)");
}

// ── Test 9: cleared-PO backfill credits investors who joined during open window
// A joined 2026-02-01, B joined 2026-03-01. PRX-001 opened 2026-02-02, cleared
// 2026-03-05. B's join date (Mar 1) falls inside the PO's open window
// (Feb 2 → Mar 5), so B's capital legitimately backfilled the gap before
// clearance and should receive a cycle-complete deployment row. Without this,
// B's return vanishes the moment admin sets commissions_cleared (the bug the
// user reported from the admin UI screenshots).

{
  const po: DeploymentPO = {
    id: "prx1",
    ref: "PRX-001",
    poDate: "2026-02-02",
    poAmount: 20_000,
    channel: "proxy",
    dos: [
      { buyerPaid: "2026-02-20" },
      { buyerPaid: "2026-02-22" },
      { buyerPaid: "2026-02-25" },
      { buyerPaid: "2026-02-28" },
    ],
    commissionsCleared: "2026-03-05",
  };

  const { deployments, remaining } = calcSharedDeployments(
    [po],
    backfillInvestors,
    []
  );
  const a = deployments.find((d) => d.investorId === "A");
  const b = deployments.find((d) => d.investorId === "B");
  assert.ok(a, "A's Pass-1 deployment should still exist on the cleared PO");
  assert.equal(a!.deployed, 10_000, "A funded 10k via Pass 1");
  assert.equal(
    a!.cycleComplete,
    true,
    "A's row is cycle-complete on a cleared PO"
  );
  assert.ok(
    b,
    "B must backfill the cleared PO because B joined before clearance"
  );
  assert.equal(
    b!.deployed,
    10_000,
    `B should backfill 10k, got ${b!.deployed}`
  );
  assert.equal(
    b!.cycleComplete,
    true,
    "B's backfill row on a cleared PO must be cycle-complete so credit_investor_return fires"
  );
  assert.equal(
    b!.deployedAt,
    "2026-03-01",
    "B's deployedAt should equal B.dateJoined (when capital arrived)"
  );
  // remaining reflects refund: capital already returned, so B's idle stays at 10k.
  assert.equal(
    remaining.B,
    10_000,
    `B's idle must be refunded (PO cleared, capital back), got ${remaining.B}`
  );
  // A's Pass-1 deduction was refunded by the real return event on the timeline.
  assert.equal(remaining.A, 10_000, "A's idle returned when PO cleared");
  console.log(
    "✓ Cleared-PO backfill credits late-joiner whose dateJoined is before clearance"
  );
}

// ── Test 9b: post-clearance joiner does NOT retroactively claim credit
// A new investor joining AFTER a PO cleared has no claim on that deal —
// their capital wasn't available during the open window. Prevents a fresh
// investor from sweeping up every historical unfunded gap.

{
  const po: DeploymentPO = {
    id: "prx1",
    ref: "PRX-001",
    poDate: "2024-06-01",
    poAmount: 20_000,
    channel: "proxy",
    dos: [{ buyerPaid: "2024-06-15" }],
    commissionsCleared: "2024-07-01", // cleared long before B joins
  };
  // backfillInvestors: A joined 2026-02-01 (after PO cleared), B joined 2026-03-01.
  const { deployments, remaining } = calcSharedDeployments(
    [po],
    backfillInvestors,
    []
  );
  const a = deployments.find((d) => d.investorId === "A");
  const b = deployments.find((d) => d.investorId === "B");
  assert.equal(
    a,
    undefined,
    "A joined after clearance — must not backfill historical PO"
  );
  assert.equal(
    b,
    undefined,
    "B joined after clearance — must not backfill historical PO"
  );
  assert.equal(remaining.A, 10_000, "A's capital stays idle");
  assert.equal(remaining.B, 10_000, "B's capital stays idle");
  console.log(
    "✓ Post-clearance joiners do not retroactively claim credit on closed POs"
  );
}

// ── Test 10: horizon gates backfill ───────────────────────────────────────

{
  const po: DeploymentPO = {
    id: "prx1",
    ref: "PRX-001",
    poDate: "2026-02-02",
    poAmount: 20_000,
    channel: "proxy",
    dos: [],
    commissionsCleared: null,
  };

  // Viewing 2026-02: horizon = 2026-02-31. B's dateJoined (2026-03-01) >
  // horizon, so B must not participate in any deployment for this view.
  const { deployments, remaining } = calcSharedDeployments(
    [po],
    backfillInvestors,
    [],
    "2026-02"
  );
  const bDep = deployments.find((d) => d.investorId === "B");
  assert.equal(
    bDep,
    undefined,
    "B must not backfill when view horizon is before B's join date"
  );
  const aDep = deployments.find((d) => d.investorId === "A");
  assert.equal(
    aDep?.deployed,
    10_000,
    `A should still fund 10k in Feb view, got ${aDep?.deployed}`
  );
  assert.equal(
    remaining.B,
    10_000,
    `B's capital must remain full in Feb horizon, got ${remaining.B}`
  );
  assert.equal(remaining.A, 0, "A fully deployed in Feb");
  console.log("✓ Horizon gate blocks backfill for not-yet-joined investors");
}

// ── Test 11: backfill-at-join priority (reversed from previous behavior) ──
// PRX-001 (02-02) 20k with only A eligible chronologically → 10k gap.
// PRX-002 (03-02) 5k with A and B eligible.
// When B joins on 03-01, the synthetic join-event trigger fires the
// interleaved backfill: B pays off PRX-001's 10k gap *before* PRX-002 runs
// Pass 1 on 03-02. This is the stability fix — without it, B's backfill
// amount on PRX-001 depends on whether PRX-002 exists (5k vs 10k), which
// is the same class of bug the user saw on PRX-002 shifting with PRX-003/004.
// Trade-off: PRX-002 goes unfunded here because B's capital was committed
// to PRX-001 the moment she joined.

{
  const po1: DeploymentPO = {
    id: "prx1",
    ref: "PRX-001",
    poDate: "2026-02-02",
    poAmount: 20_000,
    channel: "proxy",
    dos: [],
    commissionsCleared: null,
  };
  const po2: DeploymentPO = {
    id: "prx2",
    ref: "PRX-002",
    poDate: "2026-03-02",
    poAmount: 5_000,
    channel: "proxy",
    dos: [],
    commissionsCleared: null,
  };

  const { deployments, remaining } = calcSharedDeployments(
    [po1, po2],
    backfillInvestors,
    []
  );
  const po1Deps = deployments.filter((d) => d.poId === "prx1");
  const po2Deps = deployments.filter((d) => d.poId === "prx2");
  const sumBy = (deps: typeof deployments, key: string) =>
    deps.filter((d) => d.investorId === key).reduce((s, d) => s + d.deployed, 0);

  assert.equal(sumBy(po1Deps, "A"), 10_000, "A funds 10k of PRX-001 (Pass 1)");
  assert.equal(
    sumBy(po1Deps, "B"),
    10_000,
    "B fills PRX-001's 10k gap at join time (interleaved backfill)"
  );
  assert.equal(
    sumBy(po2Deps, "B"),
    0,
    "PRX-002 stays unfunded — B's capital was committed to PRX-001 on join"
  );
  assert.equal(remaining.A, 0, "A fully deployed");
  assert.equal(remaining.B, 0, "B fully deployed to PRX-001 at join");
  console.log("✓ Backfill-at-join priority: older unfunded POs filled first");
}

// ── Test 12: no double-allocation when Pass 1 already fully funded ────────

{
  // Both investors eligible at PO date (joined 02-01) — Pass 1 fully funds
  // (10k + 10k = 20k) so Pass 2 must be a no-op.
  const twoEarlyInvestors: DeploymentInvestor[] = [
    { id: "A", name: "A", capital: 10_000, dateJoined: "2026-02-01" },
    { id: "B", name: "B", capital: 10_000, dateJoined: "2026-02-01" },
  ];
  const po: DeploymentPO = {
    id: "prx1",
    ref: "PRX-001",
    poDate: "2026-02-02",
    poAmount: 20_000,
    channel: "proxy",
    dos: [],
    commissionsCleared: null,
  };

  const { deployments, remaining } = calcSharedDeployments(
    [po],
    twoEarlyInvestors,
    []
  );
  // Expect exactly 2 deployments (no Pass-2 duplicates).
  assert.equal(
    deployments.length,
    2,
    `Expected 2 deployments, got ${deployments.length} — Pass 2 may have double-allocated`
  );
  assert.equal(remaining.A, 0);
  assert.equal(remaining.B, 0);
  console.log("✓ Pass 2 is a no-op when PO is fully funded by Pass 1");
}

// ══════════════════════════════════════════════════════════════════════════
// Phase 2: deployedAt field & month-scoping semantics
// ══════════════════════════════════════════════════════════════════════════

// ── Test 13: backfill surfaces in the joiner's month view ─────────────────
// The key UX fix: B joins in March and backfills a Feb PO. The deployment
// row must appear in March's deployments array (so Investors/Portfolio UI
// reports B as 10k deployed / 0 idle), while A's Pass-1 allocation from
// Feb stays out of March view (historical stability).

{
  const po: DeploymentPO = {
    id: "prx1",
    ref: "PRX-001",
    poDate: "2026-02-02",
    poAmount: 20_000,
    channel: "proxy",
    dos: [],
    commissionsCleared: null,
  };

  const { deployments, remaining } = calcSharedDeployments(
    [po],
    backfillInvestors,
    [],
    "2026-03"
  );

  // A's Pass-1 on Feb PO has deployedAt=2026-02-02 → out of March view.
  const aInView = deployments.find((d) => d.investorId === "A");
  assert.equal(
    aInView,
    undefined,
    "A's Pass-1 deployment from Feb must not appear in March view"
  );

  // B's backfill has deployedAt=2026-03-01 → shows in March view.
  const bInView = deployments.find((d) => d.investorId === "B");
  assert.ok(bInView, "B's backfill deployment must appear in March view");
  assert.equal(
    bInView!.deployed,
    10_000,
    `B's deployed should be 10k, got ${bInView!.deployed}`
  );
  assert.equal(
    bInView!.poId,
    "prx1",
    `B's deployment should reference PRX-001, got ${bInView!.poId}`
  );
  assert.equal(
    bInView!.deployedAt,
    "2026-03-01",
    `B's deployedAt should match B.dateJoined, got ${bInView!.deployedAt}`
  );
  assert.equal(
    deployments.length,
    1,
    `March view should contain only B's backfill, got ${deployments.length}`
  );

  // Allocator state — unchanged from Phase 1. Pass 2 still consumed B's capital.
  assert.equal(
    remaining.B,
    0,
    `B should have 0 remaining after backfill, got ${remaining.B}`
  );
  assert.equal(
    remaining.A,
    0,
    `A should have 0 remaining (fully deployed in Feb), got ${remaining.A}`
  );
  console.log("✓ Backfill surfaces in the joiner's month view via deployedAt");
}

// ── Test 14: Pass-1 month-stability preserved ─────────────────────────────
// Guards against accidentally shifting Pass-1 visibility. A chronological
// allocation should still appear in the PO's own month, not anywhere else.

{
  const onlyA: DeploymentInvestor[] = [
    { id: "A", name: "A", capital: 10_000, dateJoined: "2026-02-01" },
  ];
  const po: DeploymentPO = {
    id: "prx1",
    ref: "PRX-001",
    poDate: "2026-02-02",
    poAmount: 10_000,
    channel: "proxy",
    dos: [],
    commissionsCleared: null,
  };

  const febView = calcSharedDeployments([po], onlyA, [], "2026-02");
  assert.equal(
    febView.deployments.length,
    1,
    `Feb view should show A's deployment, got ${febView.deployments.length}`
  );
  assert.equal(
    febView.deployments[0].deployedAt,
    "2026-02-02",
    `Pass-1 deployedAt should equal po.poDate, got ${febView.deployments[0].deployedAt}`
  );

  const marView = calcSharedDeployments([po], onlyA, [], "2026-03");
  assert.equal(
    marView.deployments.length,
    0,
    `March view should be empty for a Feb PO with no backfill, got ${marView.deployments.length}`
  );
  console.log("✓ Pass-1 allocation still scopes to the PO's own month");
}

// ── Test 15: Pass-1 respects deposit date (user's screenshot scenario) ────
// Investor A joined Feb 1 but capital trickled in via deposits, not on join.
// The Feb 15 6k PO must NOT see the Apr deposit — only the Feb 2 deposit is
// actually available at that point, so 4k deployed + 2k unfunded (not 6k).

{
  const onlyA: DeploymentInvestor[] = [
    { id: "A", name: "A", capital: 10_000, dateJoined: "2026-02-01" },
  ];
  const depositEvents: CapitalEvent[] = [
    { investorId: "A", date: "2026-02-02", delta: 5_000 },
    { investorId: "A", date: "2026-04-01", delta: 5_000 },
  ];
  const po1k: DeploymentPO = {
    id: "p1",
    ref: "PRX-001",
    poDate: "2026-02-08",
    poAmount: 1_000,
    channel: "proxy",
    dos: [],
    commissionsCleared: null,
  };
  const po6k: DeploymentPO = {
    id: "p2",
    ref: "PRX-002",
    poDate: "2026-02-15",
    poAmount: 6_000,
    channel: "proxy",
    dos: [],
    commissionsCleared: null,
  };

  const { deployments, remaining } = calcSharedDeployments(
    [po1k, po6k],
    onlyA,
    depositEvents,
    "2026-02"
  );

  const byPO = Object.fromEntries(
    deployments.map((d) => [d.poId, d.deployed])
  );
  assert.equal(byPO.p1, 1_000, `Feb 8 PO should deploy 1k, got ${byPO.p1}`);
  assert.equal(
    byPO.p2,
    4_000,
    `Feb 15 PO should deploy only 4k (Apr deposit not yet arrived), got ${byPO.p2}`
  );
  assert.equal(
    deployments.length,
    2,
    `Feb view should show 2 deployments (no Apr backfill), got ${deployments.length}`
  );
  assert.equal(
    remaining.A,
    0,
    `A should be fully drawn down at end of Feb, got ${remaining.A}`
  );
  console.log("✓ Pass-1 respects deposit date (Feb 15 PO doesn't see Apr 1 deposit)");
}

// ── Test 16: Pass-2 backfills from a late deposit ─────────────────────────
// Same fixture as Test 15, but viewed in April. The Apr 1 deposit arrives,
// remaining capital picks up 5k, and Pass 2 backfills the 2k gap on the Feb
// 15 PO (still open). The backfill row surfaces in April, not February,
// because its deployedAt is pinned to the deposit date — not A.dateJoined.

{
  const onlyA: DeploymentInvestor[] = [
    { id: "A", name: "A", capital: 10_000, dateJoined: "2026-02-01" },
  ];
  const depositEvents: CapitalEvent[] = [
    { investorId: "A", date: "2026-02-02", delta: 5_000 },
    { investorId: "A", date: "2026-04-01", delta: 5_000 },
  ];
  const po1k: DeploymentPO = {
    id: "p1",
    ref: "PRX-001",
    poDate: "2026-02-08",
    poAmount: 1_000,
    channel: "proxy",
    dos: [],
    commissionsCleared: null,
  };
  const po6k: DeploymentPO = {
    id: "p2",
    ref: "PRX-002",
    poDate: "2026-02-15",
    poAmount: 6_000,
    channel: "proxy",
    dos: [],
    commissionsCleared: null,
  };

  const { deployments, remaining } = calcSharedDeployments(
    [po1k, po6k],
    onlyA,
    depositEvents,
    "2026-04"
  );

  // April view contains only rows whose deployedAt falls in April — i.e. the
  // Pass-2 backfill driven by the Apr 1 deposit. The Feb Pass-1 rows scope
  // to Feb and are filtered out here.
  assert.equal(
    deployments.length,
    1,
    `Apr view should show 1 deployment (the backfill), got ${deployments.length}`
  );
  assert.equal(
    deployments[0].poId,
    "p2",
    `backfill should reference Feb 15 PO, got ${deployments[0].poId}`
  );
  assert.equal(
    deployments[0].deployed,
    2_000,
    `backfill should be 2k, got ${deployments[0].deployed}`
  );
  assert.equal(
    deployments[0].deployedAt,
    "2026-04-01",
    `backfill deployedAt should match Apr 1 deposit date, got ${deployments[0].deployedAt}`
  );
  assert.equal(
    remaining.A,
    3_000,
    `A should have 3k idle at end of Apr (10k capital − 7k deployed), got ${remaining.A}`
  );
  console.log("✓ Pass-2 backfills from late deposit, surfaces in deposit month");
}

// ── Test 17: new PO must not steal a deposit earmarked for an older gap ───
// Reproduces the screenshot bug. A starts with 5k, two Feb POs leave a 2k
// gap on PRX-002, then a 5k deposit arrives on Apr 1, then PRX-003 (40k)
// lands on Apr 22. Expected: the 5k deposit pays off PRX-002 first (2k),
// and only the leftover 3k funds PRX-003 — not the other way around.
{
  const onlyA: DeploymentInvestor[] = [
    { id: "A", name: "A", capital: 10_000, dateJoined: "2026-02-01" },
  ];
  // Initial 5k on join, then +5k deposit on Apr 1. Live capital = 10k.
  const events: CapitalEvent[] = [
    { investorId: "A", date: "2026-02-01", delta: 5_000 },
    { investorId: "A", date: "2026-04-01", delta: 5_000 },
  ];
  const p1: DeploymentPO = {
    id: "p1",
    ref: "PRX-001",
    poDate: "2026-02-08",
    poAmount: 1_000,
    channel: "proxy",
    dos: [],
    commissionsCleared: null,
  };
  const p2: DeploymentPO = {
    id: "p2",
    ref: "PRX-002",
    poDate: "2026-02-15",
    poAmount: 6_000,
    channel: "proxy",
    dos: [],
    commissionsCleared: null,
  };
  const p3: DeploymentPO = {
    id: "p3",
    ref: "PRX-003",
    poDate: "2026-04-22",
    poAmount: 40_000,
    channel: "proxy",
    dos: [],
    commissionsCleared: null,
  };

  const { deployments, remaining } = calcSharedDeployments(
    [p1, p2, p3],
    onlyA,
    events
    // no selectedMonth — all-time view, matching the investor page
  );

  const sumBy = (poId: string) =>
    deployments
      .filter((d) => d.poId === poId && d.investorId === "A")
      .reduce((s, d) => s + d.deployed, 0);

  assert.equal(sumBy("p1"), 1_000, `PRX-001 should get 1k, got ${sumBy("p1")}`);
  assert.equal(
    sumBy("p2"),
    6_000,
    `PRX-002 should be fully funded — 4k Pass-1 + 2k interleaved backfill from Apr 1 deposit, got ${sumBy("p2")}`
  );
  assert.equal(
    sumBy("p3"),
    3_000,
    `PRX-003 should receive only the leftover 3k (deposit already paid PRX-002's gap), got ${sumBy("p3")}`
  );
  assert.equal(remaining.A, 0, `A fully deployed, got ${remaining.A}`);

  const p2Rows = deployments.filter(
    (d) => d.poId === "p2" && d.investorId === "A"
  );
  const backfillRow = p2Rows.find((d) => d.deployed === 2_000);
  assert.ok(
    backfillRow,
    "there should be a 2k backfill row on PRX-002 (from Apr 1 deposit)"
  );
  assert.equal(
    backfillRow!.deployedAt,
    "2026-04-01",
    `PRX-002 backfill deployedAt should be 2026-04-01, got ${backfillRow!.deployedAt}`
  );
  console.log(
    "✓ Interleaved backfill: new deposit pays older gap before later PO"
  );
}

// ══════════════════════════════════════════════════════════════════════════
// Option C: user's exact screenshot scenario
// ══════════════════════════════════════════════════════════════════════════
// Investor A joined 2026-02-01 with RM 40,000 initial capital. Feb has two
// cleared POs (PRX-001 @ 1k, PRX-002 @ 6k). April has PRX-003 @ 10k (cleared)
// and PRX-004 @ 10k (active). On Apr 22 two deposits arrived (+10k, +20k) and
// two capital withdrawals submitted (−5k, −38k). Current capital shown in the
// admin UI: RM 27,000.
//
// Before this fix: Feb view showed zero deployment rows ("No POs to fund")
// and April view dropped PRX-003. The seed `remaining = capital - sum(deposits)`
// landed at −3k because capital withdrawals weren't in the events feed.
// After the fix: Feb surfaces PRX-001+002 (Complete), April surfaces
// PRX-003 (Complete) + PRX-004 (Active), remaining ends at 17k.

{
  const onlyA: DeploymentInvestor[] = [
    { id: "A", name: "A", capital: 27_000, dateJoined: "2026-02-01" },
  ];
  // Every mutation to investors.capital, positive and negative. This mirrors
  // what buildCapitalEvents produces from deposits + withdrawals +
  // admin_adjustments + return_credits.
  const events: CapitalEvent[] = [
    // Initial capital as a Feb 1 deposit (seeded via record_deposit).
    { investorId: "A", date: "2026-02-01", delta: 40_000 },
    // Apr 22 deposits (+10k, +20k).
    { investorId: "A", date: "2026-04-22", delta: 10_000 },
    { investorId: "A", date: "2026-04-22", delta: 20_000 },
    // Apr 22 capital withdrawals (−5k, −38k). Net of all events = −3k;
    // starting capital = 27,000 − (−3,000) = 30,000? No — with the initial
    // 40k deposit event above, the net is 27k which matches inv.capital.
    { investorId: "A", date: "2026-04-22", delta: -5_000 },
    { investorId: "A", date: "2026-04-22", delta: -38_000 },
  ];

  const prx001: DeploymentPO = {
    id: "prx001",
    ref: "PRX-001",
    poDate: "2026-02-08",
    poAmount: 1_000,
    channel: "proxy",
    dos: [{ buyerPaid: "2026-02-18" }],
    commissionsCleared: "2026-02-25",
  };
  const prx002: DeploymentPO = {
    id: "prx002",
    ref: "PRX-002",
    poDate: "2026-02-15",
    poAmount: 6_000,
    channel: "proxy",
    dos: [{ buyerPaid: "2026-02-25" }],
    commissionsCleared: "2026-02-28",
  };
  const prx003: DeploymentPO = {
    id: "prx003",
    ref: "PRX-003",
    poDate: "2026-04-15",
    poAmount: 10_000,
    channel: "proxy",
    dos: [{ buyerPaid: "2026-04-20" }],
    commissionsCleared: "2026-04-21",
  };
  const prx004: DeploymentPO = {
    id: "prx004",
    ref: "PRX-004",
    poDate: "2026-04-17",
    poAmount: 10_000,
    channel: "proxy",
    dos: [],
    commissionsCleared: null,
  };

  // Feb view: both cleared POs must have deployment rows, both Complete.
  const feb = calcSharedDeployments(
    [prx001, prx002, prx003, prx004],
    onlyA,
    events,
    "2026-02"
  );
  const febRows = feb.deployments.filter((d) => d.investorId === "A");
  const febByPO = Object.fromEntries(febRows.map((d) => [d.poId, d]));
  assert.ok(
    febByPO.prx001,
    "PRX-001 (Feb cleared) must appear in Feb view after seed fix"
  );
  assert.ok(
    febByPO.prx002,
    "PRX-002 (Feb cleared) must appear in Feb view after seed fix"
  );
  assert.equal(febByPO.prx001.cycleComplete, true, "PRX-001 cycleComplete");
  assert.equal(febByPO.prx002.cycleComplete, true, "PRX-002 cycleComplete");
  assert.equal(
    febByPO.prx001.deployed,
    1_000,
    `PRX-001 deployed = 1k, got ${febByPO.prx001.deployed}`
  );
  assert.equal(
    febByPO.prx002.deployed,
    6_000,
    `PRX-002 deployed = 6k, got ${febByPO.prx002.deployed}`
  );

  // April view: PRX-003 (cleared) + PRX-004 (active) both visible.
  const apr = calcSharedDeployments(
    [prx001, prx002, prx003, prx004],
    onlyA,
    events,
    "2026-04"
  );
  const aprRows = apr.deployments.filter((d) => d.investorId === "A");
  const aprByPO = Object.fromEntries(aprRows.map((d) => [d.poId, d]));
  assert.ok(
    aprByPO.prx003,
    "PRX-003 (April cleared) must appear in April view after seed fix"
  );
  assert.ok(
    aprByPO.prx004,
    "PRX-004 (April active) must appear in April view"
  );
  assert.equal(aprByPO.prx003.cycleComplete, true, "PRX-003 cycleComplete");
  assert.equal(
    aprByPO.prx004.cycleComplete,
    false,
    "PRX-004 still active (no commissionsCleared)"
  );
  assert.equal(
    aprByPO.prx003.deployed,
    10_000,
    `PRX-003 deployed = 10k, got ${aprByPO.prx003.deployed}`
  );
  assert.equal(
    aprByPO.prx004.deployed,
    10_000,
    `PRX-004 deployed = 10k, got ${aprByPO.prx004.deployed}`
  );
  console.log(
    "✓ User's scenario: cleared POs surface in their original month view"
  );
}

// ── Option C — admin_adjustment as a signed capital event ─────────────────
{
  const onlyA: DeploymentInvestor[] = [
    { id: "A", name: "A", capital: 15_000, dateJoined: "2026-02-01" },
  ];
  const events: CapitalEvent[] = [
    { investorId: "A", date: "2026-02-01", delta: 10_000 }, // initial
    { investorId: "A", date: "2026-03-15", delta: 5_000 }, // admin_adjustment +5k
  ];
  const feb: DeploymentPO = {
    id: "feb",
    ref: "PRX-F",
    poDate: "2026-02-10",
    poAmount: 12_000,
    channel: "proxy",
    dos: [],
    commissionsCleared: null,
  };
  const apr: DeploymentPO = {
    id: "apr",
    ref: "PRX-A",
    poDate: "2026-04-10",
    poAmount: 12_000,
    channel: "proxy",
    dos: [],
    commissionsCleared: null,
  };

  const febView = calcSharedDeployments([feb, apr], onlyA, events, "2026-02");
  const febDep = febView.deployments.find((d) => d.poId === "feb");
  assert.equal(
    febDep?.deployed,
    10_000,
    `Feb view: PO should see only pre-adjustment capital (10k), got ${febDep?.deployed}`
  );

  const aprView = calcSharedDeployments([feb, apr], onlyA, events, "2026-04");
  // Timeline: Feb PO locks 10k (2k gap) → Mar 15 +5k adjustment fires →
  // interleaved backfill pays Feb's 2k gap → remaining = 3k → Apr PO
  // takes those 3k. So Apr PO deploys 3k, not 5k, because the adjustment
  // served two POs chronologically.
  const aprDep = aprView.deployments.find((d) => d.poId === "apr");
  assert.equal(
    aprDep?.deployed,
    3_000,
    `Apr view: PO should deploy 3k (5k adjustment minus 2k Feb backfill), got ${aprDep?.deployed}`
  );
  console.log("✓ admin_adjustment events seed correctly on the timeline");
}

// ── Option C — return_credit bumps capital at its created_at ──────────────
{
  const onlyA: DeploymentInvestor[] = [
    { id: "A", name: "A", capital: 11_000, dateJoined: "2026-02-01" },
  ];
  const events: CapitalEvent[] = [
    { investorId: "A", date: "2026-02-01", delta: 10_000 },
    { investorId: "A", date: "2026-04-10", delta: 1_000 },
  ];
  const pastPO: DeploymentPO = {
    id: "past",
    ref: "PAST",
    poDate: "2026-02-02",
    poAmount: 10_000,
    channel: "proxy",
    dos: [{ buyerPaid: "2026-04-05" }],
    commissionsCleared: "2026-04-10",
  };
  const futurePO: DeploymentPO = {
    id: "future",
    ref: "FUT",
    poDate: "2026-05-01",
    poAmount: 5_000,
    channel: "proxy",
    dos: [],
    commissionsCleared: null,
  };

  const mayView = calcSharedDeployments(
    [pastPO, futurePO],
    onlyA,
    events,
    "2026-05"
  );
  const futureDep = mayView.deployments.find((d) => d.poId === "future");
  assert.equal(
    futureDep?.deployed,
    5_000,
    `May PO funded 5k out of A's post-return 11k idle, got ${futureDep?.deployed}`
  );
  assert.equal(
    mayView.remaining.A,
    6_000,
    `A should have 6k idle at end of May (11k - 5k), got ${mayView.remaining.A}`
  );
  console.log("✓ return_credit event credits capital on its created_at date");
}

// ── Option C — rejected capital withdrawal must not affect remaining ──────
// buildCapitalEvents filters status != 'rejected'. The allocator only sees
// non-rejected rows, so this test just confirms the allocator's seed math
// matches what you'd expect when a withdrawal was rejected (equivalent to
// it never happening).
{
  const onlyA: DeploymentInvestor[] = [
    { id: "A", name: "A", capital: 10_000, dateJoined: "2026-02-01" },
  ];
  // Simulate the filter outcome: only the initial deposit reaches the
  // allocator; the rejected withdrawal is excluded by buildCapitalEvents.
  const eventsAfterRejectFilter: CapitalEvent[] = [
    { investorId: "A", date: "2026-02-01", delta: 10_000 },
  ];
  const po: DeploymentPO = {
    id: "p",
    ref: "P",
    poDate: "2026-02-10",
    poAmount: 10_000,
    channel: "proxy",
    dos: [],
    commissionsCleared: null,
  };
  const { deployments } = calcSharedDeployments(
    [po],
    onlyA,
    eventsAfterRejectFilter,
    "2026-02"
  );
  assert.equal(
    deployments[0]?.deployed,
    10_000,
    "rejected withdrawals are filtered before the allocator sees them"
  );
  console.log("✓ rejected capital withdrawals excluded from capital events");
}

// ── Test 22: oversubscribed PO + late return credits produce 1 merged row ─
// Exact shape of the screenshot bug. A built up RM 5,421 of capital from
// return credits on prior POs — but those return_credits rows have
// created_at landing AFTER PRX-007's po_date (2026-04-23). PRX-007 asks for
// RM 20,000 against a RM 10,421 pool, so each late capital event fires an
// interleaved backfill that tops up PRX-007. Pre-fix: 1 Pass-1 alloc + 6
// interleaved-backfill top-ups = 7 rows. Post-fix: one merged row for
// (A, PRX-007) because every row has a deployedAt in April.
{
  const twoInvestors: DeploymentInvestor[] = [
    { id: "A", name: "A", capital: 5_421, dateJoined: "2026-02-01" },
    { id: "B", name: "B", capital: 5_000, dateJoined: "2026-04-23" },
  ];
  // A's timeline: RM 5,001 available at PRX-007 time, then 6 late return
  // credits (40, 40, 40, 80, 120, 100) all with created_at after 04-23.
  // Sum = 5,421 which equals A.capital, so the allocator's seed math is
  // consistent with the live capital column.
  const events: CapitalEvent[] = [
    { investorId: "A", date: "2026-02-01", delta: 5_001 },
    { investorId: "A", date: "2026-04-24", delta: 40 },
    { investorId: "A", date: "2026-04-25", delta: 40 },
    { investorId: "A", date: "2026-04-26", delta: 40 },
    { investorId: "A", date: "2026-04-27", delta: 80 },
    { investorId: "A", date: "2026-04-28", delta: 120 },
    { investorId: "A", date: "2026-04-29", delta: 100 },
    { investorId: "B", date: "2026-04-23", delta: 5_000 },
  ];
  const prx007: DeploymentPO = {
    id: "prx007",
    ref: "PRX-007",
    poDate: "2026-04-23",
    poAmount: 20_000,
    channel: "proxy",
    dos: [],
    commissionsCleared: null,
  };
  const { deployments, remaining } = calcSharedDeployments(
    [prx007],
    twoInvestors,
    events,
    "2026-04"
  );

  const aRows = deployments.filter(
    (d) => d.investorId === "A" && d.poId === "prx007"
  );
  const bRows = deployments.filter(
    (d) => d.investorId === "B" && d.poId === "prx007"
  );

  assert.equal(
    aRows.length,
    1,
    `A should have 1 merged row for PRX-007, got ${aRows.length}`
  );
  assert.equal(
    aRows[0].deployed,
    5_421,
    `A's merged deployed should be 5,421, got ${aRows[0].deployed}`
  );
  assert.equal(
    bRows.length,
    1,
    `B should have 1 row for PRX-007, got ${bRows.length}`
  );
  assert.equal(
    bRows[0].deployed,
    5_000,
    `B's deployed should be 5,000, got ${bRows[0].deployed}`
  );
  // Full pool capacity deployed — the RM 9,579 gap stays unfunded.
  assert.equal(
    remaining.A,
    0,
    `A should be fully drawn down, got ${remaining.A}`
  );
  assert.equal(
    remaining.B,
    0,
    `B should be fully drawn down, got ${remaining.B}`
  );
  console.log("✓ Oversubscribed PO with late return credits emits one merged row");
}

// ── Test 24: user's screenshot scenario — PRX-002 backfill is stable ──────
// A (Feb 1, 10,040), B (Mar 1, 10,000). Feb POs leave 9,960 gap on PRX-002.
// B's backfill of PRX-002 must stay pinned at 9,960 and surface in March
// regardless of how many March POs are added after the fact (PRX-003, PRX-004).
// This is the bug the user reported: PRX-002 showing 9,960 → 5,408 → 9,960 →
// disappearing as PRX-003 was added/cleared and PRX-004 was added. With the
// join-event fix, B commits 9,960 to PRX-002 on Mar 1 (before Mar 2 clearance)
// and that row never shifts.
{
  const invA: DeploymentInvestor = {
    id: "A",
    name: "A",
    capital: 10_442, // 10,040 initial + 402 reinvest from PRX-002
    dateJoined: "2026-02-01",
  };
  const invB: DeploymentInvestor = {
    id: "B",
    name: "B",
    capital: 10_398, // 10,000 initial + 398 reinvest from PRX-002
    dateJoined: "2026-03-01",
  };

  const prx001: DeploymentPO = {
    id: "prx1",
    ref: "PRX-001",
    poDate: "2026-02-02",
    poAmount: 1_000,
    channel: "proxy",
    dos: [{ buyerPaid: "2026-02-03" }],
    commissionsCleared: "2026-02-03",
  };
  const prx002: DeploymentPO = {
    id: "prx2",
    ref: "PRX-002",
    poDate: "2026-02-04",
    poAmount: 20_000,
    channel: "proxy",
    dos: [{ buyerPaid: "2026-03-02" }],
    commissionsCleared: "2026-03-02",
  };
  const prx003: DeploymentPO = {
    id: "prx3",
    ref: "PRX-003",
    poDate: "2026-03-08",
    poAmount: 10_000,
    channel: "proxy",
    dos: [{ buyerPaid: "2026-03-09" }],
    commissionsCleared: "2026-03-09",
  };
  const prx004: DeploymentPO = {
    id: "prx4",
    ref: "PRX-004",
    poDate: "2026-03-11",
    poAmount: 50_000,
    channel: "proxy",
    dos: [],
    commissionsCleared: null,
  };

  // Capital events: PRX-002 reinvest on Mar 2, PRX-003 reinvest on Mar 9.
  const capEvents: CapitalEvent[] = [
    { investorId: "A", date: "2026-03-02", delta: 402 },
    { investorId: "B", date: "2026-03-02", delta: 398 },
    { investorId: "A", date: "2026-03-09", delta: 200 },
    { investorId: "B", date: "2026-03-09", delta: 200 },
  ];

  const findBPrx002 = (deps: ReturnType<typeof calcSharedDeployments>["deployments"]) =>
    deps.find((d) => d.investorId === "B" && d.poId === "prx2");

  // State 1: only PRX-001 + PRX-002 exist. No reinvest yet → use initial
  // capitals. PRX-002 still open at B's join (clears Mar 2), so backfill fires.
  {
    const invAInitial: DeploymentInvestor = { ...invA, capital: 10_040 };
    const invBInitial: DeploymentInvestor = { ...invB, capital: 10_000 };
    const { deployments } = calcSharedDeployments(
      [prx001, prx002],
      [invAInitial, invBInitial],
      [],
      "2026-03"
    );
    const row = findBPrx002(deployments);
    assert.equal(row?.deployed, 9_960, `State 1: B→PRX-002 = 9,960, got ${row?.deployed}`);
    assert.equal(row?.deployedAt, "2026-03-01", `State 1: deployedAt = 2026-03-01, got ${row?.deployedAt}`);
  }

  // State 2: PRX-003 added (not yet cleared). B's PRX-002 row must NOT shift.
  {
    const prx003Open = { ...prx003, dos: [], commissionsCleared: null };
    const { deployments } = calcSharedDeployments(
      [prx001, prx002, prx003Open],
      [invA, invB], // reinvest from PRX-002 done
      capEvents.slice(0, 2), // only PRX-002 reinvest events
      "2026-03"
    );
    const row = findBPrx002(deployments);
    assert.equal(row?.deployed, 9_960, `State 2: B→PRX-002 stays 9,960, got ${row?.deployed}`);
  }

  // State 3: PRX-003 cleared. Still 9,960.
  {
    const { deployments } = calcSharedDeployments(
      [prx001, prx002, prx003],
      [invA, invB],
      capEvents.slice(0, 2),
      "2026-03"
    );
    const row = findBPrx002(deployments);
    assert.equal(row?.deployed, 9_960, `State 3: B→PRX-002 stays 9,960 after PRX-003 cleared, got ${row?.deployed}`);
  }

  // State 4: PRX-004 added. PRX-002 row must STILL show 9,960 for B.
  {
    const invAAfter: DeploymentInvestor = { ...invA, capital: 10_642 };
    const invBAfter: DeploymentInvestor = { ...invB, capital: 10_598 };
    const { deployments } = calcSharedDeployments(
      [prx001, prx002, prx003, prx004],
      [invAAfter, invBAfter],
      capEvents, // all reinvest events
      "2026-03"
    );
    const row = findBPrx002(deployments);
    assert.equal(row?.deployed, 9_960, `State 4: B→PRX-002 stays 9,960 after PRX-004 added, got ${row?.deployed}`);
    assert.ok(row !== undefined, "State 4: PRX-002 row must not disappear");
  }

  console.log("✓ User scenario: B→PRX-002 stays at 9,960 across PRX-003/PRX-004 additions");
}

// ══════════════════════════════════════════════════════════════════════
// ── overlayReturnCredits: frozen historical returns ─────────────────────
// ══════════════════════════════════════════════════════════════════════
// Bug: when an investor's capital changes (deposit/withdrawal), the
// allocator re-derives returnAmt/returnRate from getTier(inv.capital) on
// every render. A withdrawal that drops them below a tier boundary
// retroactively shrinks historical cycle returns.
//
// Fix: overlay the frozen return_credits rows written at clearance onto
// matching (investor, PO) deployment pairs.

// ── Test: tier downgrade after clear — overlay restores frozen rate ──

{
  // Scenario: A earned RM 400 on PRX-001 at Silver (4%) when capital was
  // RM 10,000. A later withdrew RM 5,000 — current capital RM 5,400, so
  // getTier returns Standard (3%) and the allocator recomputes the
  // PRX-001 return as 3% × 10,000 = 300.
  const invs: DeploymentInvestor[] = [
    { id: "A", name: "A", capital: 5_400, dateJoined: "2026-02-01" },
  ];
  const po: DeploymentPO = {
    id: "prx-001",
    ref: "PRX-001",
    poDate: "2026-02-02",
    poAmount: 10_000,
    channel: "proxy",
    dos: [{ buyerPaid: "2026-02-03" }],
    commissionsCleared: "2026-02-04",
  };
  // Events the portfolio/investors pages would pass: the return credit
  // (+400 on clear), then the withdrawal (-5,000 on 2026-04-24).
  const events: CapitalEvent[] = [
    { investorId: "A", date: "2026-02-04", delta: 400 },
    { investorId: "A", date: "2026-04-24", delta: -5_000 },
  ];

  const { deployments } = calcSharedDeployments([po], invs, events);
  const row = deployments.find((d) => d.poId === "prx-001");
  assert.ok(row, "allocator must emit a row for A on PRX-001");
  // Pre-overlay: allocator recomputed at Standard 3%.
  assert.equal(
    row!.returnAmt,
    300,
    `allocator recomputes at current tier, got ${row!.returnAmt}`
  );
  assert.equal(row!.returnRate, 3);

  const credits: ReturnCreditRow[] = [
    {
      investor_id: "A",
      po_id: "prx-001",
      amount: 400,
      deployed: 10_000,
      tier_rate: 4,
    },
  ];
  const overlaid = overlayReturnCredits(deployments, credits);
  const overlaidRow = overlaid.find((d) => d.poId === "prx-001");
  assert.ok(overlaidRow);
  assert.equal(
    overlaidRow!.returnAmt,
    400,
    `overlay must restore frozen amount, got ${overlaidRow!.returnAmt}`
  );
  assert.equal(overlaidRow!.returnRate, 4);
  // deployed is NOT overwritten — it's the allocator's allocation-truth.
  assert.equal(overlaidRow!.deployed, row!.deployed);
  assert.equal(overlaidRow!.cycleComplete, true);

  console.log(
    "✓ overlayReturnCredits restores frozen Silver rate after withdrawal-driven tier downgrade"
  );
}

// ── Test: empty credits array is identity ──

{
  const sample: Deployment[] = [
    {
      investorId: "X",
      investorName: "X",
      poId: "po-1",
      poRef: "PRX-X",
      poDate: "2026-01-01",
      poAmount: 1_000,
      channel: "proxy",
      deployed: 1_000,
      returnAmt: 50,
      returnRate: 5,
      tierName: "Gold",
      tierEmoji: "",
      cycleComplete: true,
      deployedAt: "2026-01-01",
    },
  ];
  const result = overlayReturnCredits(sample, []);
  assert.equal(result, sample, "empty credits must return the same array");

  console.log("✓ overlayReturnCredits is identity when credits list is empty");
}

// ── Test: no matching credit — row unchanged ──

{
  const sample: Deployment[] = [
    {
      investorId: "X",
      investorName: "X",
      poId: "po-1",
      poRef: "PRX-X",
      poDate: "2026-01-01",
      poAmount: 1_000,
      channel: "proxy",
      deployed: 1_000,
      returnAmt: 30,
      returnRate: 3,
      tierName: "Standard",
      tierEmoji: "",
      cycleComplete: false,
      deployedAt: "2026-01-01",
    },
  ];
  const credits: ReturnCreditRow[] = [
    // Different (investor, PO) pair — must not match.
    {
      investor_id: "Y",
      po_id: "po-2",
      amount: 999,
      deployed: 10_000,
      tier_rate: 5,
    },
  ];
  const result = overlayReturnCredits(sample, credits);
  assert.equal(result[0].returnAmt, 30, "unmatched row returnAmt unchanged");
  assert.equal(result[0].returnRate, 3);
  assert.equal(result[0].cycleComplete, false, "pending row stays pending");

  console.log(
    "✓ overlayReturnCredits leaves unmatched (and pending) rows untouched"
  );
}

// ── Test: tier upgrade after clear — overlay still pins historical rate ──

{
  // A earned RM 240 on PRX-002 at Standard (3%) when capital was RM 8,000.
  // Later A deposited RM 5,000 — capital RM 13,240, now Silver (4%).
  // Without overlay, the allocator would inflate PRX-002 to 4% × 8,000 = 320.
  const invs: DeploymentInvestor[] = [
    { id: "A", name: "A", capital: 13_240, dateJoined: "2026-01-01" },
  ];
  const po: DeploymentPO = {
    id: "prx-002",
    ref: "PRX-002",
    poDate: "2026-01-02",
    poAmount: 8_000,
    channel: "proxy",
    dos: [{ buyerPaid: "2026-01-03" }],
    commissionsCleared: "2026-01-04",
  };
  const events: CapitalEvent[] = [
    { investorId: "A", date: "2026-01-04", delta: 240 },
    { investorId: "A", date: "2026-02-10", delta: 5_000 },
  ];
  const { deployments } = calcSharedDeployments([po], invs, events);
  const row = deployments.find((d) => d.poId === "prx-002");
  assert.ok(row);
  // Allocator inflates to current Silver rate.
  assert.equal(row!.returnAmt, 320);
  assert.equal(row!.returnRate, 4);

  const credits: ReturnCreditRow[] = [
    {
      investor_id: "A",
      po_id: "prx-002",
      amount: 240,
      deployed: 8_000,
      tier_rate: 3,
    },
  ];
  const overlaid = overlayReturnCredits(deployments, credits);
  const overlaidRow = overlaid.find((d) => d.poId === "prx-002");
  assert.ok(overlaidRow);
  assert.equal(overlaidRow!.returnAmt, 240, "overlay pins pre-upgrade amount");
  assert.equal(overlaidRow!.returnRate, 3);

  console.log(
    "✓ overlayReturnCredits pins historical rate after deposit-driven tier upgrade"
  );
}

// ── Test 18: same-day clear distributes pro-rata across investors ─────────
// User's screenshot scenario. 5 investors, RM 10,000 each, chained
// introducers A→B→C→D→E joining Feb 1–5. PRX-001 (50k, ABC) created Feb 8
// and cleared Feb 15 same month. PRX-002 (50k, DEF) created Feb 12 — needs
// funding from PRX-001's freed capital.
//
// Pre-fix: per-event greedy backfill let A's return-credit pour all 10,400
// into PRX-002, then B, C, D each pour 10,400; E got the leftover 8,400.
// A–D's RM 84 introducer commissions landed AFTER PRX-002 was full and
// stayed idle. Result: 10,400/10,400/10,400/10,400/8,400 — uneven.
//
// Post-fix: same-day capital events batch into one pro-rata fill across
// the post-batch pool (A–D = 10,484 each, E = 10,400; total 52,336),
// funding PRX-002 (50k) at floor(avail/total × 50,000) per investor. The
// last investor absorbs rounding — so we expect a near-even split.
{
  const invs: DeploymentInvestor[] = [
    { id: "A", name: "A", capital: 10_484, dateJoined: "2026-02-01" },
    { id: "B", name: "B", capital: 10_484, dateJoined: "2026-02-02" },
    { id: "C", name: "C", capital: 10_484, dateJoined: "2026-02-03" },
    { id: "D", name: "D", capital: 10_484, dateJoined: "2026-02-04" },
    { id: "E", name: "E", capital: 10_400, dateJoined: "2026-02-05" },
  ];
  const prx001: DeploymentPO = {
    id: "prx-001",
    ref: "PRX-001",
    poDate: "2026-02-08",
    poAmount: 50_000,
    channel: "proxy",
    dos: [{ buyerPaid: "2026-02-15" }],
    commissionsCleared: "2026-02-15",
  };
  const prx002: DeploymentPO = {
    id: "prx-002",
    ref: "PRX-002",
    poDate: "2026-02-12",
    poAmount: 50_000,
    channel: "proxy",
    dos: [],
    commissionsCleared: null,
  };
  // Capital events on the clear date: 5 return credits (RM 400 each) +
  // 4 introducer credits (RM 84 each, A–D only, E introduced no one).
  const events: CapitalEvent[] = [
    { investorId: "A", date: "2026-02-15", delta: 400 },
    { investorId: "B", date: "2026-02-15", delta: 400 },
    { investorId: "C", date: "2026-02-15", delta: 400 },
    { investorId: "D", date: "2026-02-15", delta: 400 },
    { investorId: "E", date: "2026-02-15", delta: 400 },
    { investorId: "A", date: "2026-02-15", delta: 84 },
    { investorId: "B", date: "2026-02-15", delta: 84 },
    { investorId: "C", date: "2026-02-15", delta: 84 },
    { investorId: "D", date: "2026-02-15", delta: 84 },
  ];
  const { deployments, remaining } = calcSharedDeployments(
    [prx001, prx002],
    invs,
    events,
    "2026-02"
  );

  const prx002ByInv: Record<string, number> = {};
  for (const d of deployments.filter((x) => x.poId === "prx-002")) {
    prx002ByInv[d.investorId] = (prx002ByInv[d.investorId] ?? 0) + d.deployed;
  }

  // Total deployed must match the PO amount.
  const total = Object.values(prx002ByInv).reduce((s, n) => s + n, 0);
  assert.equal(total, 50_000, "PRX-002 must be fully funded by the batch");

  // Pro-rata expected: A–D ≈ 10,484/52,336 × 50,000 ≈ 10,016.43 → floor 10,016
  // E (last investor) absorbs the remainder. Bug-state was 10,400/8,400 —
  // any deployment > 10,200 or < 9,800 is the old greedy behaviour leaking.
  for (const id of ["A", "B", "C", "D", "E"]) {
    const got = prx002ByInv[id] ?? 0;
    assert.ok(
      got >= 9_800 && got <= 10_200,
      `${id}'s PRX-002 deployment must be near-pro-rata (~10,000), got ${got}`
    );
  }

  // No investor's PRX-002 share should differ from another's by more than
  // the 84-RM intro-commission gap (E lacks intro). Pre-fix gap was 2,000.
  const values = ["A", "B", "C", "D", "E"].map((id) => prx002ByInv[id] ?? 0);
  const spread = Math.max(...values) - Math.min(...values);
  assert.ok(
    spread <= 100,
    `PRX-002 spread across investors must be tight (≤ RM 100), got ${spread}`
  );

  // Idle remaining should be small and roughly even across investors —
  // pre-fix had E sitting on RM 2,000 idle while A–D had 84.
  for (const id of ["A", "B", "C", "D", "E"]) {
    const idle = remaining[id] ?? 0;
    assert.ok(
      idle >= 0 && idle <= 600,
      `${id}'s idle balance must be small after pro-rata fill, got ${idle}`
    );
  }

  console.log(
    "✓ Same-day clear distributes pro-rata across investors (no greedy first-come-first-fill)"
  );
}

// ── Test 19: new PO dated same day as a capital batch is not double-funded ──
// Reproduces the user's screenshot scenario:
//   - 3 investors A (joined Feb 1, introducer), B & C (joined Feb 8)
//   - Three earlier POs (PRX-001/002/003) tie up A's initial capital
//   - PRX-001 clears on Feb 8 — same day a NEW PO PRX-004 is created Feb 8
// Pre-fix: capital-batch backfill loop's strict ">" let it claim PRX-004 as
// an "older unfunded PO", filling it from the freshly-credited pool. Then
// the alloc event for PRX-004 fired and topped it up again from the
// remainder, producing 10,400 against a 10,000 PO. The bug also fires when
// PRX-004 is dated Feb 15 (PRX-002's clear date) — there 10,000 of returned
// capital is sitting on the table, so the double-fill produces 20,000.
{
  const invs: DeploymentInvestor[] = [
    { id: "A", name: "A", capital: 10_400, dateJoined: "2026-02-01" },
    { id: "B", name: "B", capital: 10_000, dateJoined: "2026-02-08" },
    { id: "C", name: "C", capital: 10_000, dateJoined: "2026-02-08" },
  ];
  const prx001: DeploymentPO = {
    id: "prx-001",
    ref: "PRX-001",
    poDate: "2026-02-02",
    poAmount: 10_000,
    channel: "proxy",
    dos: [{ buyerPaid: "2026-02-08" }],
    commissionsCleared: "2026-02-08",
  };
  const prx002: DeploymentPO = {
    id: "prx-002",
    ref: "PRX-002",
    poDate: "2026-02-02",
    poAmount: 10_000,
    channel: "proxy",
    dos: [],
    commissionsCleared: null,
  };
  const prx003: DeploymentPO = {
    id: "prx-003",
    ref: "PRX-003",
    poDate: "2026-02-03",
    poAmount: 10_000,
    channel: "proxy",
    dos: [],
    commissionsCleared: null,
  };
  // PRX-004 — the new PO whose date triggers the bug.
  const prx004: DeploymentPO = {
    id: "prx-004",
    ref: "PRX-004",
    poDate: "2026-02-08",
    poAmount: 10_000,
    channel: "proxy",
    dos: [],
    commissionsCleared: null,
  };
  // PRX-001's RM 400 return is reinvested into A's capital on Feb 8 —
  // same day as PRX-004's poDate. This collision is the bug trigger.
  const events: CapitalEvent[] = [
    { investorId: "A", date: "2026-02-08", delta: 400 },
  ];

  const { deployments } = calcSharedDeployments(
    [prx001, prx002, prx003, prx004],
    invs,
    events,
    "2026-02"
  );

  const sumFor = (poId: string) =>
    deployments
      .filter((d) => d.poId === poId)
      .reduce((s, d) => s + d.deployed, 0);

  // The headline assertion: PRX-004 must not be over-funded.
  assert.equal(
    sumFor("prx-004"),
    10_000,
    `PRX-004 must be funded exactly to its poAmount, got ${sumFor("prx-004")}`
  );
  // And per-investor share should be > 0 across all three (pro-rata split).
  for (const id of ["A", "B", "C"]) {
    const got = deployments
      .filter((d) => d.poId === "prx-004" && d.investorId === id)
      .reduce((s, d) => s + d.deployed, 0);
    assert.ok(
      got > 0,
      `${id} should have a positive PRX-004 share (pro-rata), got ${got}`
    );
  }

  console.log(
    "✓ New PO dated same day as a capital batch is funded exactly once"
  );
}

console.log("\nAll deployment tests passed.");
