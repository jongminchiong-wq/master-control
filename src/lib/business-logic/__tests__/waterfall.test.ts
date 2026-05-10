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

// Default player (EU-A on both channels, intro A on both)
const playerA: Player = {
  id: "P-A",
  euTierModeProxy: "A",
  euTierModeGrid: "A",
  introTierModeProxy: "A",
  introTierModeGrid: "A",
  introducedBy: null,
};

// EU-B Proxy player for Test 7 (Punchout uses Proxy mode)
const playerB: Player = {
  id: "P-B",
  euTierModeProxy: "B",
  euTierModeGrid: "A",
  introTierModeProxy: "A",
  introTierModeGrid: "A",
  introducedBy: null,
};

// Recruit & introducer for Test 5
const introducer: Player = {
  id: "INT",
  euTierModeProxy: "A",
  euTierModeGrid: "A",
  introTierModeProxy: "A",
  introTierModeGrid: "A",
  introducedBy: null,
};
const recruit: Player = {
  id: "REC",
  euTierModeProxy: "A",
  euTierModeGrid: "A",
  introTierModeProxy: "A",
  introTierModeGrid: "A",
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
    dos: [{ amount: 30000, delivery: "local" }],
  };
  const w = calcPOWaterfall(po, [playerA], [po], 50000);

  // monthlyCumulative=50,000 → EU-A Base (24%)
  // risk: 30k mid2 + local → 1.5% → cogs 30,450
  // gross = 50,000 - 30,450 = 19,550
  // platformFee = 1,500; investorFee = 2,500; pool = 15,550
  // euAmt = 15,550 × 0.24 = 3,732; entityGross = 11,818
  close(w.riskAdjustedCogs, 30450, "T1 cogs");
  close(w.gross, 19550, "T1 gross");
  close(w.platformFee, 1500, "T1 platformFee");
  close(w.investorFee, 2500, "T1 investorFee");
  close(w.pool, 15550, "T1 pool");
  close(w.euAmt, 3732, "T1 euAmt");
  close(w.entityGross, 11818, "T1 entityGross");
  close(w.entityShare, 11818, "T1 entityShare");
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
    dos: [{ amount: 50000, delivery: "sea" }],
  };
  const w = calcPOWaterfall(po, [playerA], [po], 80000);

  // monthlyCumulative=80,000 → EU-C Active (24%)
  // risk: 50k → large (50000<50000 false), sea idx=1 → 2% → cogs 51,000
  // gross = 29,000; platformFee = 0 (gep); investorFee = 4,000; pool = 25,000
  // euAmt = 25,000 × 0.24 = 6,000; entityGross = 19,000
  close(w.riskAdjustedCogs, 51000, "T2 cogs");
  close(w.platformFee, 0, "T2 platformFee (GEP has none)");
  close(w.investorFee, 4000, "T2 investorFee");
  close(w.pool, 25000, "T2 pool");
  close(w.euAmt, 6000, "T2 euAmt");
  close(w.entityShare, 19000, "T2 entityShare");
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
    dos: [{ amount: 60000, delivery: "local" }],
  };
  // Pool only funded RM 60,000 of the RM 100,000 PO (40% short).
  const w = calcPOWaterfall(po, [playerA], [po], 60000);

  // monthlyCumulative=100,000 → EU-A Active (75k-150k, 27%)
  // risk: 60k → large, local → 1% → cogs 60,600
  // gross = 100,000 - 60,600 = 39,400
  // platformFee = 100,000 × 0.03 = 3,000 (still on poAmount)
  // investorFee = 60,000 × 0.05 = 3,000  ← B1 FIX: scales with deployed
  // pool = 39,400 - 3,000 - 3,000 = 33,400
  // euAmt = 33,400 × 0.27 = 9,018; entityGross = 24,382
  close(w.totalDeployed, 60000, "T3 totalDeployed");
  close(w.platformFee, 3000, "T3 platformFee (on full poAmount)");
  close(w.investorFee, 3000, "T3 investorFee (on deployed, NOT poAmount)");
  close(w.pool, 33400, "T3 pool");
  close(w.euAmt, 9018, "T3 euAmt");
  close(w.entityShare, 24382, "T3 entityShare");

  // And confirm: if the bug existed, investorFee would be 5,000 and pool 30,500.
  // We assert it's NOT that value.
  assert.notEqual(
    w.investorFee,
    5000,
    "T3: investorFee should NOT be 5,000 (would mean B1 regressed)"
  );
  console.log("✓ T3: Under-funded PO scales investor fee with deployed (B1 fix)");
}

// ── Test 4: Multi-DO mixed delivery ────────────────────────────
{
  const po: PurchaseOrder = {
    id: "PO4",
    endUserId: "P-A",
    poAmount: 30000,
    poDate: "2026-03-15",
    channel: "punchout",
    dos: [
      { amount: 5000, delivery: "local" }, // small local: 3%
      { amount: 8000, delivery: "sea" }, // small sea: 5%
      { amount: 12000, delivery: "international" }, // mid1 intl: 5.5%
    ],
  };
  const w = calcPOWaterfall(po, [playerA], [po], 30000);

  // cogs = 5000×1.03 + 8000×1.05 + 12000×1.055 = 5150 + 8400 + 12660 = 26,210
  // gross = 30,000 - 26,210 = 3,790
  // platformFee = 900; investorFee = 1,500; pool = 1,390
  // euAmt = 1,390 × 0.24 = 333.6; entityGross = 1,056.4
  close(w.supplierTotal, 25000, "T4 supplierTotal");
  close(w.riskAdjustedCogs, 26210, "T4 cogs (mixed)");
  close(w.pool, 1390, "T4 pool");
  close(w.euAmt, 333.6, "T4 euAmt");
  close(w.entityShare, 1056.4, "T4 entityShare");
  console.log("✓ T4: Multi-DO mixed delivery");
}

// ── Test 5: With introducer, recruits across multiple POs ──────
{
  const poA: PurchaseOrder = {
    id: "PO5a",
    endUserId: "REC",
    poAmount: 60000,
    poDate: "2026-03-10",
    channel: "punchout",
    dos: [{ amount: 40000, delivery: "local" }],
  };
  const poB: PurchaseOrder = {
    id: "PO5b",
    endUserId: "REC",
    poAmount: 60000,
    poDate: "2026-03-20",
    channel: "punchout",
    dos: [{ amount: 40000, delivery: "local" }],
  };

  // Compute waterfall on poB. Both POs are in March, both belong to REC.
  // monthlyCumulative for REC = 120,000 → EU-A Active (75k-150k, 27%)
  // recruitTotalPO for INT (recruits = [REC]) in March = 120,000
  //   → PO_INTRO Active (100k-200k, 27%)
  const w = calcPOWaterfall(poB, [introducer, recruit], [poA, poB], 60000);

  // risk on poB: 40k → mid2, local → 1.5% → cogs 40,600
  // gross = 60,000 - 40,600 = 19,400
  // platformFee = 1,800; investorFee = 3,000; pool = 14,600
  // euAmt = 14,600 × 0.27 = 3,942; entityGross = 10,658
  // introAmt = 10,658 × 0.27 = 2,877.66; entityShare = 7,780.34
  close(w.riskAdjustedCogs, 40600, "T5 cogs");
  close(w.pool, 14600, "T5 pool");
  close(w.euAmt, 3942, "T5 euAmt");
  close(w.entityGross, 10658, "T5 entityGross");
  close(w.introAmt, 2877.66, "T5 introAmt");
  close(w.entityShare, 7780.34, "T5 entityShare");
  assert.equal(w.euTier.name, "Active", "T5 euTier");
  assert.equal(w.introTier?.name, "Active", "T5 introTier");
  assert.equal(w.introRate, 27);
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

// ── Test 7: EU-B Top tier, large international ────────────────
{
  const po: PurchaseOrder = {
    id: "PO7",
    endUserId: "P-B",
    poAmount: 300000,
    poDate: "2026-03-15",
    channel: "punchout",
    dos: [{ amount: 200000, delivery: "international" }],
  };
  const w = calcPOWaterfall(po, [playerB], [po], 300000);

  // monthlyCumulative=300,000 → EU-B Top (>=250k, 42%)
  // risk: 200k → large, intl idx=2 → 3.5% → cogs 207,000
  // gross = 93,000; platformFee = 9,000; investorFee = 15,000; pool = 69,000
  // euAmt = 69,000 × 0.42 = 28,980; entityGross = 40,020
  close(w.riskAdjustedCogs, 207000, "T7 cogs");
  close(w.gross, 93000, "T7 gross");
  close(w.platformFee, 9000, "T7 platformFee");
  close(w.investorFee, 15000, "T7 investorFee");
  close(w.pool, 69000, "T7 pool");
  close(w.euAmt, 28980, "T7 euAmt");
  close(w.entityShare, 40020, "T7 entityShare");
  assert.equal(w.euTier.name, "Top");
  assert.equal(w.euTier.rate, 42);
  console.log("✓ T7: EU-B Top tier, large international");
}

// ── Test 8: Per-channel tiering — DEF case ─────────────────────
// Pins the rule that monthlyCumulative is scoped to the PO's own channel.
// Player has 50k Proxy + 50k Grid in the same month. Each channel ladders
// independently, so both POs sit at Base (not Active). A combined-monthly
// regression would push them to Active (27% / 24%) — we assert against that.
{
  const prx: PurchaseOrder = {
    id: "PRX-001",
    endUserId: "P-A",
    poAmount: 50000,
    poDate: "2026-02-02",
    channel: "punchout",
    dos: [{ amount: 30000, delivery: "local" }],
  };
  const grid: PurchaseOrder = {
    id: "GRID-002",
    endUserId: "P-A",
    poAmount: 50000,
    poDate: "2026-02-03",
    channel: "gep",
    dos: [{ amount: 30000, delivery: "local" }],
  };
  const allPos = [prx, grid];

  const wPrx = calcPOWaterfall(prx, [playerA], allPos, 50000);
  const wGrid = calcPOWaterfall(grid, [playerA], allPos, 50000);

  // Per-channel monthlyCumulative — each is 50k, not the 100k combined total.
  assert.equal(wPrx.monthlyCumulative, 50000, "T8 PRX monthlyCumulative");
  assert.equal(wGrid.monthlyCumulative, 50000, "T8 GRID monthlyCumulative");

  // Both at Base — Proxy A Base 24%, Grid C Base 21%.
  assert.equal(wPrx.euTier.name, "Base", "T8 PRX tier name");
  assert.equal(wPrx.euTier.rate, 24, "T8 PRX tier rate");
  assert.equal(wGrid.euTier.name, "Base", "T8 GRID tier name");
  assert.equal(wGrid.euTier.rate, 21, "T8 GRID tier rate");

  // Regression guard: with combined-monthly the rates would be 27% / 24%.
  assert.notEqual(
    wPrx.euTier.rate,
    27,
    "T8 PRX rate must not be 27 (combined-monthly regression)"
  );
  assert.notEqual(
    wGrid.euTier.rate,
    24,
    "T8 GRID rate must not be 24 (combined-monthly regression)"
  );

  // Numbers backing the screenshot (cogs 30k local mid2 = 1.5% → 30,450):
  // PRX: gross 19,550; platformFee 1,500; invFee 2,500; pool 15,550; euAmt = 15,550 × 0.24 = 3,732
  // GRID: gross 19,550; platformFee 0;     invFee 2,500; pool 17,050; euAmt = 17,050 × 0.21 = 3,580.50
  close(wPrx.euAmt, 3732, "T8 PRX euAmt");
  close(wGrid.euAmt, 3580.5, "T8 GRID euAmt");
  console.log("✓ T8: Per-channel tiering (DEF mixed-channel case)");
}

// ── Test 9: Negative pool, no introducer ──────────────────────
// PO 50k, supplier 55k local → "large" RB tier 1% buffer →
// risk-adj cogs 55,550; gross -5,550; platformFee 1,500; invFee 2,500
// → pool -9,550. rawLoss = -pool. EU-A Base 24% → player absorbs
// 2,292; entity absorbs 7,258.
{
  const po: PurchaseOrder = {
    id: "PO9",
    endUserId: "P-A",
    poAmount: 50000,
    poDate: "2026-04-15",
    channel: "punchout",
    dos: [{ amount: 55000, delivery: "local" }],
  };
  const w = calcPOWaterfall(po, [playerA], [po], 50000);

  close(w.rawLoss, 9550, "T9 rawLoss (= -pool)");
  close(w.playerLossShare, 2292, "T9 playerLossShare (24% mirror)");
  close(w.introducerLossShare, 0, "T9 introducerLossShare (no intro)");
  close(w.entityLossShare, 7258, "T9 entityLossShare");
  // Sum invariant: shares add back to raw loss
  close(
    w.playerLossShare + w.introducerLossShare + w.entityLossShare,
    w.rawLoss,
    "T9 shares sum to rawLoss"
  );
  // Existing commission floors stay at zero on a loss PO
  close(w.euAmt, 0, "T9 euAmt floored at 0");
  close(w.entityShare, 0, "T9 entityShare floored at 0");
  console.log("✓ T9: Negative pool, no introducer");
}

// ── Test 10: Negative pool WITH introducer ─────────────────────
// Same PO/cost as T9 but recruit→introducer chain. rawLoss = 9,550.
// EU-A Base 24%, PO_INTRO Base 24% → player 2,292; intro 7,258 × 24% =
// 1,741.92; entity 5,516.08.
{
  const po: PurchaseOrder = {
    id: "PO10",
    endUserId: "REC",
    poAmount: 50000,
    poDate: "2026-04-15",
    channel: "punchout",
    dos: [{ amount: 55000, delivery: "local" }],
  };
  const w = calcPOWaterfall(po, [introducer, recruit], [po], 50000);

  close(w.rawLoss, 9550, "T10 rawLoss (= -pool)");
  close(w.playerLossShare, 2292, "T10 playerLossShare (24% mirror)");
  close(w.introducerLossShare, 1741.92, "T10 introducerLossShare (24% of side)");
  close(w.entityLossShare, 5516.08, "T10 entityLossShare");
  close(
    w.playerLossShare + w.introducerLossShare + w.entityLossShare,
    w.rawLoss,
    "T10 shares sum to rawLoss"
  );
  assert.equal(w.intro?.id, "INT", "T10 intro present");
  assert.equal(w.introRate, 24, "T10 intro rate Base 24%");
  console.log("✓ T10: Negative pool with introducer (mirror split)");
}

// ── Test 11: Buffer-only negative pool — split deficit ────────
// Supplier cost 49,000 (below PO 50,000) but international buffer
// (mid2 4.5%) pushes risk-adj cogs to 51,205 → gross -1,205 → pool
// -5,205. Even though raw cost ≤ PO, the negative pool must be
// distributed: EU-A Base 24% → player 1,249.20; entity 3,955.80.
{
  const po: PurchaseOrder = {
    id: "PO11",
    endUserId: "P-A",
    poAmount: 50000,
    poDate: "2026-04-15",
    channel: "punchout",
    dos: [{ amount: 49000, delivery: "international" }],
  };
  const w = calcPOWaterfall(po, [playerA], [po], 50000);

  close(w.rawLoss, 5205, "T11 rawLoss (= -pool, buffer-only deficit)");
  close(w.playerLossShare, 1249.2, "T11 playerLossShare (24% mirror)");
  close(w.introducerLossShare, 0, "T11 introducerLossShare zero");
  close(w.entityLossShare, 3955.8, "T11 entityLossShare");
  close(
    w.playerLossShare + w.introducerLossShare + w.entityLossShare,
    w.rawLoss,
    "T11 shares sum to rawLoss"
  );
  console.log("✓ T11: Buffer-only negative pool — deficit split by tier");
}

// ── Test 12: Profit case has zero loss fields (additive invariant) ─
// Re-run T1's PO and assert all four loss fields are exactly zero.
// Pins that the loss math is purely additive and never affects profit POs.
{
  const po: PurchaseOrder = {
    id: "PO12",
    endUserId: "P-A",
    poAmount: 50000,
    poDate: "2026-03-15",
    channel: "punchout",
    dos: [{ amount: 30000, delivery: "local" }],
  };
  const w = calcPOWaterfall(po, [playerA], [po], 50000);

  close(w.rawLoss, 0, "T12 rawLoss zero on profit PO");
  close(w.playerLossShare, 0, "T12 playerLossShare zero on profit PO");
  close(w.introducerLossShare, 0, "T12 introducerLossShare zero on profit PO");
  close(w.entityLossShare, 0, "T12 entityLossShare zero on profit PO");
  console.log("✓ T12: Profit case has zero loss fields");
}

// ── Test 13: Other Cost reduces gross/pool by exactly otherCost ───
// Reuses T1's setup (Punchout, EU-A Base, 30k local DO on 50k PO) and
// adds otherCost = 1,000. The new field must subtract straight from
// gross with no risk-buffer treatment, so every downstream number
// shifts by exactly 1,000.
{
  const po: PurchaseOrder = {
    id: "PO13",
    endUserId: "P-A",
    poAmount: 50000,
    poDate: "2026-03-15",
    channel: "punchout",
    dos: [{ amount: 30000, delivery: "local" }],
    otherCost: 1000,
  };
  const w = calcPOWaterfall(po, [playerA], [po], 50000);

  // T1 baseline: gross 19,550, pool 15,550, euAmt 3,732, entityGross 11,818.
  // With otherCost 1,000: gross 18,550, pool 14,550, euAmt 3,492, entityGross 11,058.
  close(w.otherCost, 1000, "T13 otherCost echoed in result");
  close(w.riskAdjustedCogs, 30450, "T13 cogs unchanged (no buffer on other)");
  close(w.gross, 18550, "T13 gross drops by exactly otherCost");
  close(w.pool, 14550, "T13 pool drops by exactly otherCost");
  close(w.euAmt, 3492, "T13 euAmt = 14,550 × 24%");
  close(w.entityGross, 11058, "T13 entityGross = pool − euAmt");
  close(w.rawLoss, 0, "T13 still profit, no loss split");
  console.log("✓ T13: Other Cost subtracts straight from gross, no buffer");
}

// ── Test 14: Other Cost can push pool negative → loss split fires ─
// Same PO but otherCost = 20,000 makes pool −4,450 (450 buffer + 1,500
// platform + 2,500 investor + 20,000 other ≫ 19,550 profit room). Loss
// distribution must mirror profit split exactly: EU-A Base 24% → player
// 1,068; entity 3,382.
{
  const po: PurchaseOrder = {
    id: "PO14",
    endUserId: "P-A",
    poAmount: 50000,
    poDate: "2026-03-15",
    channel: "punchout",
    dos: [{ amount: 30000, delivery: "local" }],
    otherCost: 20000,
  };
  const w = calcPOWaterfall(po, [playerA], [po], 50000);

  // gross = 50,000 − 30,450 − 20,000 = −450
  // pool  = −450 − 1,500 − 2,500 = −4,450
  close(w.gross, -450, "T14 gross negative once other > profit");
  close(w.pool, -4450, "T14 pool absorbs platform + investor on top");
  close(w.rawLoss, 4450, "T14 rawLoss = -pool");
  close(w.playerLossShare, 1068, "T14 playerLossShare (24% of 4,450)");
  close(w.entityLossShare, 3382, "T14 entityLossShare (76% of 4,450)");
  close(
    w.playerLossShare + w.introducerLossShare + w.entityLossShare,
    w.rawLoss,
    "T14 shares sum to rawLoss"
  );
  console.log("✓ T14: Other Cost overrun feeds existing loss-split path");
}

console.log("\nAll waterfall tests passed.");
