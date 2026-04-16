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
}

export interface DeploymentInvestor {
  id: string;
  name: string;
  capital: number;
  dateJoined: string;
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
// Sort POs by date (oldest first), split each PO across investors proportionally.

export const calcSharedDeployments = (
  monthPOs: DeploymentPO[],
  investors: DeploymentInvestor[]
): { deployments: Deployment[]; remaining: Record<string, number> } => {
  const activePOs = [...monthPOs].sort(
    (a, b) =>
      (a.poDate || "").localeCompare(b.poDate || "") ||
      (a.ref || "").localeCompare(b.ref || "")
  );

  const remaining: Record<string, number> = {};
  investors.forEach((inv) => {
    remaining[inv.id] = inv.capital;
  });

  const deployments: Deployment[] = [];

  for (const po of activePOs) {
    const poAmt = po.poAmount || 0;
    if (poAmt <= 0) continue;

    const fullyPaid =
      po.dos &&
      po.dos.length > 0 &&
      po.dos.every((d) => d.buyerPaid);

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

      const invTier = getTier(inv.capital, INV_TIERS);
      const invReturnRate = invTier.rate;
      const returnAmtTiered = deployed * (invReturnRate / 100);

      deployments.push({
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
        cycleComplete: !!fullyPaid,
      });
    }
  }

  return { deployments, remaining };
};
