// Funding status helper tests — zero-dep, run with:
//   node --experimental-strip-types src/lib/business-logic/__tests__/funding-status.test.ts

import assert from "node:assert/strict";
import { calcFundingStatus } from "../funding-status.ts";
import type {
  Deployment,
  DeploymentInvestor,
  DeploymentPO,
} from "../deployment.ts";

// ── Fixture ─────────────────────────────────────────────────────────────────

const investors: DeploymentInvestor[] = [
  { id: "A", name: "A", capital: 10_000, dateJoined: "2026-01-01" },
  { id: "B", name: "B", capital: 5_000, dateJoined: "2026-01-01" },
];

const po1: DeploymentPO = {
  id: "p1",
  ref: "PRX-001",
  poDate: "2026-04-03",
  poAmount: 15_000,
  channel: "proxy",
  dos: [],
  commissionsCleared: null,
};
const po2: DeploymentPO = {
  id: "p2",
  ref: "PRX-002",
  poDate: "2026-04-05",
  poAmount: 8_500,
  channel: "proxy",
  dos: [],
  commissionsCleared: null,
};

// ── Test 1: unfunded gap when demand exceeds pool ───────────────────────────

{
  const monthPOs = [po1, po2];
  // Simulate: pool fully deployed (15k split proportionally across A+B), p2 unfunded
  const deployments: Deployment[] = [
    {
      investorId: "A",
      investorName: "A",
      poId: "p1",
      poRef: "PRX-001",
      poDate: "2026-04-03",
      poAmount: 15_000,
      channel: "proxy",
      deployed: 10_000,
      returnAmt: 400,
      returnRate: 4,
      tierName: "Silver",
      tierEmoji: "",
      cycleComplete: false,
    },
    {
      investorId: "B",
      investorName: "B",
      poId: "p1",
      poRef: "PRX-001",
      poDate: "2026-04-03",
      poAmount: 15_000,
      channel: "proxy",
      deployed: 5_000,
      returnAmt: 150,
      returnRate: 3,
      tierName: "Standard",
      tierEmoji: "",
      cycleComplete: false,
    },
  ];
  const remaining = { A: 0, B: 0 };
  const status = calcFundingStatus({
    monthPOs,
    deployments,
    investors,
    remaining,
    asOfDate: "2026-04-10",
  });

  assert.equal(status.totalDemand, 23_500, "totalDemand sums monthPOs");
  assert.equal(status.poolCapacity, 15_000, "poolCapacity sums investors");
  assert.equal(status.idleInPool, 0, "idleInPool sums remaining");
  assert.equal(status.deployed, 15_000, "deployed = capacity - idle");
  assert.equal(status.unfundedTotal, 8_500, "unfunded = p2's full amount");
  assert.equal(status.unfundedCount, 1, "only p2 is unfunded");
  assert.equal(status.unfundedPOs.length, 1, "one unfunded PO in list");
  assert.equal(status.unfundedPOs[0].ref, "PRX-002");
  assert.equal(status.unfundedPOs[0].unfunded, 8_500);
  assert.equal(status.unfundedPOs[0].ageDays, 5);
  assert.equal(status.unfundedPOs[0].channel, "proxy");
  assert.equal(status.oldestUnfundedRef, "PRX-002");
  assert.equal(status.oldestUnfundedDate, "2026-04-05");
  assert.equal(status.oldestUnfundedDays, 5, "04-10 minus 04-05");
  assert.equal(status.isFullyFunded, false);
  assert.equal(status.fundedPct, 64, "round((23500-8500)/23500*100)");
  console.log("✓ test 1: unfunded gap computed correctly");
}

// ── Test 2: fully funded (no unfunded POs) ──────────────────────────────────

{
  const bigInvestors: DeploymentInvestor[] = [
    { id: "A", name: "A", capital: 50_000, dateJoined: "2026-01-01" },
  ];
  const deployments: Deployment[] = [
    {
      investorId: "A",
      investorName: "A",
      poId: "p1",
      poRef: "PRX-001",
      poDate: "2026-04-03",
      poAmount: 15_000,
      channel: "proxy",
      deployed: 15_000,
      returnAmt: 600,
      returnRate: 4,
      tierName: "Silver",
      tierEmoji: "",
      cycleComplete: false,
    },
    {
      investorId: "A",
      investorName: "A",
      poId: "p2",
      poRef: "PRX-002",
      poDate: "2026-04-05",
      poAmount: 8_500,
      channel: "proxy",
      deployed: 8_500,
      returnAmt: 340,
      returnRate: 4,
      tierName: "Silver",
      tierEmoji: "",
      cycleComplete: false,
    },
  ];
  const remaining = { A: 26_500 };
  const status = calcFundingStatus({
    monthPOs: [po1, po2],
    deployments,
    investors: bigInvestors,
    remaining,
    asOfDate: "2026-04-10",
  });

  assert.equal(status.unfundedTotal, 0);
  assert.equal(status.unfundedCount, 0);
  assert.equal(status.unfundedPOs.length, 0, "empty list when fully funded");
  assert.equal(status.oldestUnfundedRef, null);
  assert.equal(status.isFullyFunded, true);
  assert.equal(status.fundedPct, 100);
  assert.equal(status.idleInPool, 26_500);
  assert.equal(status.deployed, 23_500);
  console.log("✓ test 2: fully funded detected");
}

// ── Test 3: no POs (empty month) ────────────────────────────────────────────

{
  const status = calcFundingStatus({
    monthPOs: [],
    deployments: [],
    investors,
    remaining: { A: 10_000, B: 5_000 },
    asOfDate: "2026-04-10",
  });
  assert.equal(status.totalDemand, 0);
  assert.equal(status.isFullyFunded, true, "empty month counts as fully funded");
  assert.equal(status.fundedPct, 100);
  assert.equal(status.deployed, 0);
  assert.equal(status.idleInPool, 15_000);
  console.log("✓ test 3: empty month handled");
}

// ── Test 4: oldest-unfunded picks earliest poDate ───────────────────────────

{
  const laterPO: DeploymentPO = {
    ...po1,
    id: "later",
    ref: "PRX-LATE",
    poDate: "2026-04-20",
    poAmount: 5_000,
  };
  const earlierPO: DeploymentPO = {
    ...po1,
    id: "earlier",
    ref: "PRX-EARLY",
    poDate: "2026-04-02",
    poAmount: 5_000,
  };
  const status = calcFundingStatus({
    monthPOs: [laterPO, earlierPO], // input order shouldn't matter
    deployments: [],
    investors: [],
    remaining: {},
    asOfDate: "2026-04-25",
  });
  assert.equal(status.oldestUnfundedRef, "PRX-EARLY");
  assert.equal(status.oldestUnfundedDate, "2026-04-02");
  assert.equal(status.oldestUnfundedDays, 23);
  // List must be sorted oldest-first.
  assert.equal(status.unfundedPOs[0].ref, "PRX-EARLY", "oldest on top");
  assert.equal(status.unfundedPOs[1].ref, "PRX-LATE");
  console.log("✓ test 4: oldest-unfunded picks earliest poDate regardless of input order");
}

console.log("\nAll funding-status tests passed.");
