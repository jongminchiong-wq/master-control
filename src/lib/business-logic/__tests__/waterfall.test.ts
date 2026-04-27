// Waterfall golden tests — zero-dep, run with:
//   npx tsx src/lib/business-logic/__tests__/waterfall.test.ts
//
// Pins the locked formula in calcPOWaterfall against typo-class regressions.
// Numbers are hand-computed from the constants in constants.ts and cross-
// checked against the rules in CLAUDE.md (5% investor fee, 3% Punchout
// platform fee, 0% GEP SMART platform fee, channel-specific tier tables).
//
// Test 3 specifically pins the B1 fix: under-funded POs deduct investor fee
// on Σ deployed, not on poAmount.

import assert from "node:assert/strict";
import { calcPOWaterfall, type Player, type PurchaseOrder } from "../waterfall.ts";

const EPS = 0.001;
const close = (a: number, b: number, label: string) => {
  if (Math.abs(a - b) > EPS) {
    throw new Error(`${label}: got ${a}, want ${b} (diff ${a - b})`);
  }
};

// Default player (EU-A, no introducer)
const playerA: Player = {
  id: "P-A",
  euTierMode: "A",
  introTierMode: "A",
  introducedBy: null,
};

// EU-B player for Test 7
const playerB: Player = {
  id: "P-B",
  euTierMode: "B",
  introTierMode: "A",
  introducedBy: null,
};

// Recruit & introducer for Test 5
const introducer: Player = {
  id: "INT",
  euTierMode: "A",
  introTierMode: "A",
  introducedBy: null,
};
const recruit: Player = {
  id: "REC",
  euTierMode: "A",
  introTierMode: "A",
  introducedBy: "INT",
};

// ── Test 1: Fully-funded Punchout, EU-A Base, no introducer ────
{
  const po: PurchaseOrder = {
    id: "PO1",
    endUserId: "P-A",
    poAmount: 50000,
    poDate: "2026-03-15",
    channel: "punchout",
    dos: [{ amount: 30000, delivery: "local", urgency: "normal" }],
  };
  const w = calcPOWaterfall(po, [playerA], [po], 50000);

  // monthlyCumulative=50,000 → EU-A Base (24%)
  // risk: 30k mid2 + local + normal → 3% → cogs 30,900
  // gross = 50,000 - 30,900 = 19,100
  // platformFee = 1,500; investorFee = 2,500; pool = 15,100
  // euAmt = 15,100 × 0.24 = 3,624; entityGross = 11,476
  close(w.riskAdjustedCogs, 30900, "T1 cogs");
  close(w.gross, 19100, "T1 gross");
  close(w.platformFee, 1500, "T1 platformFee");
  close(w.investorFee, 2500, "T1 investorFee");
  close(w.pool, 15100, "T1 pool");
  close(w.euAmt, 3624, "T1 euAmt");
  close(w.entityGross, 11476, "T1 entityGross");
  close(w.entityShare, 11476, "T1 entityShare");
  assert.equal(w.euTier.name, "Base");
  assert.equal(w.euTier.rate, 24);
  assert.equal(w.intro, null);
  assert.equal(w.introAmt, 0);
  console.log("✓ T1: Fully-funded Punchout EU-A Base, no introducer");
}

// ── Test 2: Fully-funded GEP SMART, EU-C Active ────────────────
{
  const po: PurchaseOrder = {
    id: "PO2",
    endUserId: "P-A",
    poAmount: 80000,
    poDate: "2026-03-15",
    channel: "gep",
    dos: [{ amount: 50000, delivery: "sea", urgency: "urgent" }],
  };
  const w = calcPOWaterfall(po, [playerA], [po], 80000);

  // monthlyCumulative=80,000 → EU-C Active (24%)
  // risk: 50k → large (50000<50000 false), sea idx=1 → 4 + urgent 2 = 6% → cogs 53,000
  // gross = 27,000; platformFee = 0 (gep); investorFee = 4,000; pool = 23,000
  // euAmt = 23,000 × 0.24 = 5,520; entityGross = 17,480
  close(w.riskAdjustedCogs, 53000, "T2 cogs");
  close(w.platformFee, 0, "T2 platformFee (GEP has none)");
  close(w.investorFee, 4000, "T2 investorFee");
  close(w.pool, 23000, "T2 pool");
  close(w.euAmt, 5520, "T2 euAmt");
  close(w.entityShare, 17480, "T2 entityShare");
  assert.equal(w.euTier.name, "Active");
  assert.equal(w.euTier.rate, 24);
  console.log("✓ T2: Fully-funded GEP SMART EU-C Active");
}

// ── Test 3: UNDER-FUNDED Punchout — pins B1 fix ────────────────
{
  const po: PurchaseOrder = {
    id: "PO3",
    endUserId: "P-A",
    poAmount: 100000,
    poDate: "2026-03-15",
    channel: "punchout",
    dos: [{ amount: 60000, delivery: "local", urgency: "normal" }],
  };
  // Pool only funded RM 60,000 of the RM 100,000 PO (40% short).
  const w = calcPOWaterfall(po, [playerA], [po], 60000);

  // monthlyCumulative=100,000 → EU-A Active (75k-150k, 27%)
  // risk: 60k → large, local → 2.5% + 0 = 2.5% → cogs 61,500
  // gross = 100,000 - 61,500 = 38,500
  // platformFee = 100,000 × 0.03 = 3,000 (still on poAmount)
  // investorFee = 60,000 × 0.05 = 3,000  ← B1 FIX: scales with deployed
  // pool = 38,500 - 3,000 - 3,000 = 32,500
  // euAmt = 32,500 × 0.27 = 8,775; entityGross = 23,725
  close(w.totalDeployed, 60000, "T3 totalDeployed");
  close(w.platformFee, 3000, "T3 platformFee (on full poAmount)");
  close(w.investorFee, 3000, "T3 investorFee (on deployed, NOT poAmount)");
  close(w.pool, 32500, "T3 pool");
  close(w.euAmt, 8775, "T3 euAmt");
  close(w.entityShare, 23725, "T3 entityShare");

  // And confirm: if the bug existed, investorFee would be 5,000 and pool 30,500.
  // We assert it's NOT that value.
  assert.notEqual(
    w.investorFee,
    5000,
    "T3: investorFee should NOT be 5,000 (would mean B1 regressed)"
  );
  console.log("✓ T3: Under-funded PO scales investor fee with deployed (B1 fix)");
}

// ── Test 4: Multi-DO mixed delivery/urgency ───────────────────
{
  const po: PurchaseOrder = {
    id: "PO4",
    endUserId: "P-A",
    poAmount: 30000,
    poDate: "2026-03-15",
    channel: "punchout",
    dos: [
      { amount: 5000, delivery: "local", urgency: "normal" }, // small local normal: 5.5%
      { amount: 8000, delivery: "sea", urgency: "urgent" }, // small sea urgent: 8+2=10%
      { amount: 12000, delivery: "international", urgency: "rush" }, // mid1 intl rush: 8+4=12%
    ],
  };
  const w = calcPOWaterfall(po, [playerA], [po], 30000);

  // cogs = 5000×1.055 + 8000×1.10 + 12000×1.12 = 5275 + 8800 + 13440 = 27,515
  // gross = 30,000 - 27,515 = 2,485
  // platformFee = 900; investorFee = 1,500; pool = 85
  // euAmt = 85 × 0.24 = 20.4; entityGross = 64.6
  close(w.supplierTotal, 25000, "T4 supplierTotal");
  close(w.riskAdjustedCogs, 27515, "T4 cogs (mixed)");
  close(w.pool, 85, "T4 thin pool");
  close(w.euAmt, 20.4, "T4 euAmt");
  close(w.entityShare, 64.6, "T4 entityShare");
  console.log("✓ T4: Multi-DO mixed delivery/urgency");
}

// ── Test 5: With introducer, recruits across multiple POs ──────
{
  const poA: PurchaseOrder = {
    id: "PO5a",
    endUserId: "REC",
    poAmount: 60000,
    poDate: "2026-03-10",
    channel: "punchout",
    dos: [{ amount: 40000, delivery: "local", urgency: "normal" }],
  };
  const poB: PurchaseOrder = {
    id: "PO5b",
    endUserId: "REC",
    poAmount: 60000,
    poDate: "2026-03-20",
    channel: "punchout",
    dos: [{ amount: 40000, delivery: "local", urgency: "normal" }],
  };

  // Compute waterfall on poB. Both POs are in March, both belong to REC.
  // monthlyCumulative for REC = 120,000 → EU-A Active (75k-150k, 27%)
  // recruitTotalPO for INT (recruits = [REC]) in March = 120,000
  //   → PO_INTRO Active (100k-200k, 12%)
  const w = calcPOWaterfall(poB, [introducer, recruit], [poA, poB], 60000);

  // risk on poB: 40k → mid2, local + normal → 3% → cogs 41,200
  // gross = 60,000 - 41,200 = 18,800
  // platformFee = 1,800; investorFee = 3,000; pool = 14,000
  // euAmt = 14,000 × 0.27 = 3,780; entityGross = 10,220
  // introAmt = 10,220 × 0.12 = 1,226.4; entityShare = 8,993.6
  close(w.riskAdjustedCogs, 41200, "T5 cogs");
  close(w.pool, 14000, "T5 pool");
  close(w.euAmt, 3780, "T5 euAmt");
  close(w.entityGross, 10220, "T5 entityGross");
  close(w.introAmt, 1226.4, "T5 introAmt");
  close(w.entityShare, 8993.6, "T5 entityShare");
  assert.equal(w.euTier.name, "Active", "T5 euTier");
  assert.equal(w.introTier?.name, "Active", "T5 introTier");
  assert.equal(w.introRate, 12);
  assert.equal(w.intro?.id, "INT");
  assert.equal(w.monthlyCumulative, 120000);
  console.log("✓ T5: Introducer cohort across multiple recruits' POs");
}

// ── Test 6: Zero amount / empty DOs (degenerate) ──────────────
{
  const po: PurchaseOrder = {
    id: "PO6",
    endUserId: "P-A",
    poAmount: 0,
    poDate: "2026-03-15",
    channel: "punchout",
    dos: [],
  };
  const w = calcPOWaterfall(po, [playerA], [po], 0);

  close(w.riskAdjustedCogs, 0, "T6 cogs");
  close(w.gross, 0, "T6 gross");
  close(w.platformFee, 0, "T6 platformFee");
  close(w.investorFee, 0, "T6 investorFee");
  close(w.pool, 0, "T6 pool");
  close(w.euAmt, 0, "T6 euAmt");
  close(w.entityShare, 0, "T6 entityShare");
  close(w.effectiveCogsPct, 0, "T6 effectiveCogsPct (no div by zero)");
  console.log("✓ T6: Zero amount / empty DOs degenerate input");
}

// ── Test 7: EU-B Top tier, large international rush ───────────
{
  const po: PurchaseOrder = {
    id: "PO7",
    endUserId: "P-B",
    poAmount: 300000,
    poDate: "2026-03-15",
    channel: "punchout",
    dos: [{ amount: 200000, delivery: "international", urgency: "rush" }],
  };
  const w = calcPOWaterfall(po, [playerB], [po], 300000);

  // monthlyCumulative=300,000 → EU-B Top (>=250k, 42%)
  // risk: 200k → large, intl idx=2 → 6 + rush 4 = 10% → cogs 220,000
  // gross = 80,000; platformFee = 9,000; investorFee = 15,000; pool = 56,000
  // euAmt = 56,000 × 0.42 = 23,520; entityGross = 32,480
  close(w.riskAdjustedCogs, 220000, "T7 cogs");
  close(w.gross, 80000, "T7 gross");
  close(w.platformFee, 9000, "T7 platformFee");
  close(w.investorFee, 15000, "T7 investorFee");
  close(w.pool, 56000, "T7 pool");
  close(w.euAmt, 23520, "T7 euAmt");
  close(w.entityShare, 32480, "T7 entityShare");
  assert.equal(w.euTier.name, "Top");
  assert.equal(w.euTier.rate, 42);
  console.log("✓ T7: EU-B Top tier, large international rush");
}

console.log("\nAll waterfall tests passed.");
