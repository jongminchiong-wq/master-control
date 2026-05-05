// Platform funding status — derives pool-wide demand/supply metrics from the
// deployment allocator's output. Powers the investor dashboard "Platform
// funding status" gauge and the admin Entity page "Unfunded gap" banner.
//
// This module does zero DB or DOM work; pass in the already-computed
// deployments + remaining from calcSharedDeployments.

import type {
  Deployment,
  DeploymentInvestor,
  DeploymentPO,
} from "./deployment";

export interface UnfundedPO {
  poId: string;
  ref: string;
  channel: string;
  poDate: string;
  poAmount: number;
  description?: string | null;
  unfunded: number; // amount of this PO still waiting for pool capital
  ageDays: number; // days between poDate and asOfDate
}

export interface FundingStatus {
  totalDemand: number; // sum of PO amounts in selectedMonth
  poolCapacity: number; // sum of investors[].capital
  deployed: number; // capital currently locked in any in-flight PO
  idleInPool: number; // idle capital across the whole pool
  unfundedTotal: number; // sum per-PO of max(0, poAmount - sum(deployments))
  unfundedCount: number; // number of POs with unfunded > 0
  unfundedPOs: UnfundedPO[]; // per-PO list, oldest first
  oldestUnfundedRef: string | null;
  oldestUnfundedDate: string | null;
  oldestUnfundedDays: number; // days between oldestUnfundedDate and asOfDate
  isFullyFunded: boolean;
  fundedPct: number; // 0–100
}

interface CalcFundingStatusInput {
  // POs whose po_date falls within the selected month. These define the
  // month's demand side of the gauge.
  monthPOs: DeploymentPO[];
  // Deployments already filtered to the selected month (the allocator's
  // default when passed a selectedMonth).
  deployments: Deployment[];
  // All investors in the pool.
  investors: DeploymentInvestor[];
  // Idle-capital map from the allocator, reflecting end-of-selectedMonth.
  remaining: Record<string, number>;
  // Reference date for "oldest unfunded aging" computation (YYYY-MM-DD).
  asOfDate: string;
}

export function calcFundingStatus(input: CalcFundingStatusInput): FundingStatus {
  const { monthPOs, deployments, investors, remaining, asOfDate } = input;

  const totalDemand = monthPOs.reduce((s, po) => s + (po.poAmount || 0), 0);
  const poolCapacity = investors.reduce((s, inv) => s + (inv.capital || 0), 0);
  const idleInPool = investors.reduce(
    (s, inv) => s + Math.max(0, remaining[inv.id] ?? inv.capital),
    0
  );
  const deployed = Math.max(0, poolCapacity - idleInPool);

  // Per-PO deployed totals (this month only).
  const deployedByPO: Record<string, number> = {};
  for (const d of deployments) {
    deployedByPO[d.poId] = (deployedByPO[d.poId] || 0) + d.deployed;
  }

  let unfundedTotal = 0;
  const unfundedPOs: UnfundedPO[] = [];

  for (const po of monthPOs) {
    const poAmt = po.poAmount || 0;
    if (poAmt <= 0) continue;
    const deployedOnThis = deployedByPO[po.id] || 0;
    const unfunded = Math.max(0, poAmt - deployedOnThis);
    if (unfunded <= 0) continue;
    unfundedTotal += unfunded;
    const poDate = po.poDate || "";
    const ageDays =
      poDate && asOfDate ? Math.max(0, daysBetween(poDate, asOfDate)) : 0;
    unfundedPOs.push({
      poId: po.id,
      ref: po.ref,
      channel: po.channel,
      poDate,
      poAmount: poAmt,
      description: po.description ?? null,
      unfunded,
      ageDays,
    });
  }

  // Oldest first — highest urgency surfaces at the top of the UI.
  unfundedPOs.sort((a, b) => (a.poDate || "").localeCompare(b.poDate || ""));

  const unfundedCount = unfundedPOs.length;
  const oldestUnfundedRef = unfundedPOs[0]?.ref ?? null;
  const oldestUnfundedDate = unfundedPOs[0]?.poDate || null;
  const oldestUnfundedDays = unfundedPOs[0]?.ageDays ?? 0;

  const isFullyFunded = unfundedTotal === 0;
  const fundedPct =
    totalDemand > 0
      ? Math.round(((totalDemand - unfundedTotal) / totalDemand) * 100)
      : 100;

  return {
    totalDemand,
    poolCapacity,
    deployed,
    idleInPool,
    unfundedTotal,
    unfundedCount,
    unfundedPOs,
    oldestUnfundedRef,
    oldestUnfundedDate,
    oldestUnfundedDays,
    isFullyFunded,
    fundedPct,
  };
}

// Whole-day count between two YYYY-MM-DD dates (to - from). Uses UTC midnight
// to avoid local-timezone DST shifts.
function daysBetween(from: string, to: string): number {
  const fromMs = new Date(from + "T00:00:00Z").getTime();
  const toMs = new Date(to + "T00:00:00Z").getTime();
  if (Number.isNaN(fromMs) || Number.isNaN(toMs)) return 0;
  return Math.floor((toMs - fromMs) / 86_400_000);
}
