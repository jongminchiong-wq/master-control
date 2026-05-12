// Live-data reconciliation script for cleared POs.
//
// Walks every PO with commissions_cleared set, recomputes the allocator and
// waterfall locally, and asserts that what the admin entity page shows
// (waterfallDeducted, spread, paid-to-investors) matches the frozen
// return_credits stored in Postgres.
//
// Reads only — never writes. Safe to run against production.
//
// Run:
//   npx tsx --env-file=.env.local src/lib/business-logic/__tests__/reconciliation.ts
//
// Env vars required:
//   NEXT_PUBLIC_SUPABASE_URL
//   NEXT_PUBLIC_SUPABASE_ANON_KEY  (or SUPABASE_SERVICE_ROLE_KEY for full visibility)
//
// Exit code 0 if every cleared PO reconciles, 1 if any drift detected.

import { createClient } from "@supabase/supabase-js";
import type { Database } from "../../supabase/types";
import { calcPOWaterfall, type Player, type PurchaseOrder } from "../waterfall";
import {
  calcSharedDeployments,
  overlayReturnCredits,
  type DeploymentPO,
  type DeploymentInvestor,
} from "../deployment";
import { buildCapitalEvents } from "../capital-events";
import { INV_RATE } from "../constants";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ??
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error(
    "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE key in env. " +
      "Run with: npx tsx --env-file=.env.local <script>"
  );
  process.exit(1);
}

const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_KEY);

// Tolerance for floating-point comparison. RM 0.01 is well below display
// precision (`fmt()` rounds to whole RM).
const EPSILON = 0.01;
const close = (a: number, b: number) => Math.abs(a - b) <= EPSILON;

// ANSI colours — fall back to plain text if not a TTY.
const isTTY = process.stdout.isTTY;
const c = {
  green: (s: string) => (isTTY ? `\x1b[32m${s}\x1b[0m` : s),
  red: (s: string) => (isTTY ? `\x1b[31m${s}\x1b[0m` : s),
  yellow: (s: string) => (isTTY ? `\x1b[33m${s}\x1b[0m` : s),
  dim: (s: string) => (isTTY ? `\x1b[2m${s}\x1b[0m` : s),
};

const fmt = (n: number) =>
  n.toLocaleString("en-MY", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

async function main() {
  console.log(c.dim("Fetching data from Supabase..."));

  const [
    posRes,
    playersRes,
    investorsRes,
    depositsRes,
    withdrawalsRes,
    adjustmentsRes,
    returnCreditsRes,
    introCreditsRes,
  ] = await Promise.all([
    supabase
      .from("purchase_orders")
      .select("*, delivery_orders(*)")
      .order("po_date", { ascending: true }),
    supabase.from("players").select("*"),
    supabase.from("investors").select("*"),
    supabase.from("deposits").select("*"),
    supabase.from("withdrawals").select("*"),
    supabase.from("admin_adjustments").select("*"),
    supabase.from("return_credits").select("*"),
    supabase.from("introducer_credits").select("*"),
  ]);

  for (const r of [
    posRes,
    playersRes,
    investorsRes,
    depositsRes,
    withdrawalsRes,
    adjustmentsRes,
    returnCreditsRes,
    introCreditsRes,
  ]) {
    if (r.error) {
      console.error(c.red(`Supabase error: ${r.error.message}`));
      process.exit(1);
    }
  }

  const allPOs = posRes.data ?? [];
  const players = playersRes.data ?? [];
  const investors = investorsRes.data ?? [];
  const deposits = depositsRes.data ?? [];
  const withdrawals = withdrawalsRes.data ?? [];
  const adjustments = adjustmentsRes.data ?? [];
  const returnCredits = returnCreditsRes.data ?? [];
  const introCredits = introCreditsRes.data ?? [];

  // Mappers — match entity/page.tsx exactly.
  const wPlayers: Player[] = players.map((p) => ({
    id: p.id,
    euTierModeProxy: p.eu_tier_mode_proxy,
    euTierModeGrid: p.eu_tier_mode_grid,
    introTierModeProxy: p.intro_tier_mode_proxy,
    introTierModeGrid: p.intro_tier_mode_grid,
    introducedBy: p.introduced_by,
    uplineId: p.upline_id,
  }));

  const wAllPOs: PurchaseOrder[] = allPOs.map((po) => ({
    id: po.id,
    endUserId: po.end_user_id,
    poAmount: po.po_amount,
    poDate: po.po_date,
    channel: po.channel,
    dos: (po.delivery_orders ?? []).map((d) => ({
      amount: d.amount,
      delivery: d.delivery ?? "local",
    })),
  }));

  const dPoolPOs: DeploymentPO[] = allPOs.map((po) => ({
    id: po.id,
    ref: po.ref,
    poDate: po.po_date,
    poAmount: po.po_amount,
    channel: po.channel,
    dos: (po.delivery_orders ?? []).map((d) => ({
      buyerPaid: d.buyer_paid,
    })),
    commissionsCleared: po.commissions_cleared,
  }));

  const dInvestors: DeploymentInvestor[] = investors.map((inv) => ({
    id: inv.id,
    name: inv.name,
    capital: inv.capital,
    dateJoined: inv.date_joined ?? "",
  }));

  const capitalEvents = buildCapitalEvents({
    deposits,
    withdrawals,
    adminAdjustments: adjustments,
    returnCredits,
    introducerCredits: introCredits,
    pos: allPOs,
  });

  // Pool-wide allocator — no selectedMonth so every capital event applies.
  const { deployments: rawDeployments } = calcSharedDeployments(
    dPoolPOs,
    dInvestors,
    capitalEvents
  );
  const deployments = overlayReturnCredits(rawDeployments, returnCredits);

  // Walk cleared POs only.
  const clearedPOs = allPOs.filter((po) => po.commissions_cleared);

  if (clearedPOs.length === 0) {
    console.log(c.yellow("No cleared POs found. Nothing to reconcile."));
    return;
  }

  console.log(
    c.dim(`Reconciling ${clearedPOs.length} cleared PO(s)...\n`)
  );

  let passed = 0;
  let failed = 0;
  const failures: string[] = [];

  for (const dbPO of clearedPOs) {
    const wPO = wAllPOs.find((p) => p.id === dbPO.id)!;
    const poDeps = deployments.filter((d) => d.poId === dbPO.id);
    const totalDeployed = poDeps.reduce((s, d) => s + d.deployed, 0);

    const w = calcPOWaterfall(wPO, wPlayers, wAllPOs, totalDeployed);

    // Sum of frozen return_credits for this PO
    const poReturnCredits = returnCredits.filter((rc) => rc.po_id === dbPO.id);
    const sumReturnCredits = poReturnCredits.reduce(
      (s, rc) => s + Number(rc.amount),
      0
    );

    // Per-deployment expected return = deployed × tier_rate / 100 (post-overlay).
    const sumDeploymentReturns = poDeps.reduce((s, d) => s + d.returnAmt, 0);

    // Spread shown by the admin entity page (after Commit 1):
    //   waterfallDeducted = funded × INV_RATE / 100
    //   spread = waterfallDeducted − Σ returnAmt
    const waterfallDeducted = totalDeployed * (INV_RATE / 100);
    const expectedSpread = waterfallDeducted - sumReturnCredits;

    const checks: { label: string; ok: boolean; got: number; want: number }[] = [
      {
        label: "waterfall.investorFee == totalDeployed × 5%",
        ok: close(w.investorFee, totalDeployed * (INV_RATE / 100)),
        got: w.investorFee,
        want: totalDeployed * (INV_RATE / 100),
      },
      {
        label: "Σ deployment.returnAmt == Σ return_credits.amount",
        ok: close(sumDeploymentReturns, sumReturnCredits),
        got: sumDeploymentReturns,
        want: sumReturnCredits,
      },
      {
        label: "entity spread == waterfallDeducted − Σ return_credits",
        ok: close(waterfallDeducted - sumReturnCredits, expectedSpread),
        got: waterfallDeducted - sumReturnCredits,
        want: expectedSpread,
      },
    ];

    const allOk = checks.every((ch) => ch.ok);
    const ref = dbPO.ref ?? dbPO.id.slice(0, 8);
    const summary = `funded ${fmt(totalDeployed)}  fee ${fmt(
      w.investorFee
    )}  paid ${fmt(sumReturnCredits)}  spread ${fmt(expectedSpread)}`;

    if (allOk) {
      console.log(`${c.green("✓")} ${ref.padEnd(20)} ${c.dim(summary)}`);
      passed += 1;
    } else {
      console.log(`${c.red("✗")} ${ref.padEnd(20)} ${summary}`);
      for (const ch of checks) {
        if (!ch.ok) {
          const diff = ch.got - ch.want;
          console.log(
            `    ${c.red("·")} ${ch.label}\n` +
              `        got  ${fmt(ch.got)}\n` +
              `        want ${fmt(ch.want)}\n` +
              `        diff ${diff >= 0 ? "+" : ""}${fmt(diff)}`
          );
        }
      }
      failures.push(ref);
      failed += 1;
    }
  }

  console.log("");
  console.log(
    `${passed} passed${failed > 0 ? `, ${c.red(`${failed} failed`)}` : ""}`
  );
  if (failed > 0) {
    console.log(c.red(`Failures: ${failures.join(", ")}`));
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(c.red(`Unhandled error: ${err.message}`));
  console.error(err.stack);
  process.exit(1);
});
