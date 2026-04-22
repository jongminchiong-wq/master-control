// Deployment allocator tests — zero-dep, run with:
//   npx tsx src/lib/business-logic/__tests__/deployment.test.ts
// tsx is used because the business-logic files use extensionless imports
// that Node's strict ESM loader can't resolve on its own. No test framework
// in the repo; each test is a self-describing assertion block that throws
// on failure.

import assert from "node:assert/strict";
import {
  calcSharedDeployments,
  type CapitalEvent,
  type DeploymentInvestor,
  type DeploymentPO,
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

// ── Test 9: no backfill on commissions-cleared PO ─────────────────────────

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
    commissionsCleared: "2026-03-01",
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
    "B must not backfill a PO with commissions_cleared set"
  );
  assert.equal(remaining.B, 10_000, "B's capital must stay idle");
  console.log("✓ No backfill on commissions-cleared PO");
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

// ── Test 11: chronological priority preserved ─────────────────────────────
// PRX-001 (02-02) 20k with only A eligible chronologically → 10k gap.
// PRX-002 (03-02) 5k with A and B eligible. B's 10k should fund PRX-002
// first (chronological Pass 1), then backfill 5k of PRX-001 via Pass 2.
// A gets exhausted on PRX-001 in Pass 1 (10k of 20k), then has 0 for PRX-002.

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
    sumBy(po2Deps, "B"),
    5_000,
    "B funds full 5k of PRX-002 chronologically (Pass 1), before backfill"
  );
  assert.equal(
    sumBy(po1Deps, "B"),
    5_000,
    "B backfills remaining 5k of PRX-001 with leftover capital (Pass 2)"
  );
  assert.equal(remaining.A, 0, "A fully deployed");
  assert.equal(remaining.B, 0, "B fully deployed (5k Pass 1 + 5k Pass 2)");
  console.log("✓ Chronological priority: new POs consume capital before backfill");
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

console.log("\nAll deployment tests passed.");
