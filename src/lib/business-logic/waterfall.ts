// Core waterfall formula — extracted from master-control-v2.jsx lines 124–177
// DO NOT CHANGE THIS FORMULA unless specifically asked.

import { type Tier, INV_RATE } from "./constants";
import { getTier, getEUTiers, getIntroTiers, type PlayerForTier } from "./tiers";
import { calcBufferPct } from "./risk-buffer";
import { getMonth } from "./formatters";

// ── Input types ─────────────────────────────────────────────

export interface DeliveryOrder {
  amount: number;
  delivery?: string;
  urgency?: string;
}

export interface PurchaseOrder {
  id: string;
  endUserId: string;
  poAmount: number;
  poDate: string;
  channel: string;
  dos?: DeliveryOrder[];
}

export interface Player extends PlayerForTier {
  id: string;
  introducedBy?: string | null;
}

// ── Output type ─────────────────────────────────────────────

export interface WaterfallResult {
  channel: string;
  poAmount: number;
  totalDeployed: number;
  euTier: Tier;
  euAmt: number;
  gross: number;
  platformFee: number;
  investorFee: number;
  pool: number;
  entityGross: number;
  intro: Player | null;
  introAmt: number;
  introRate: number;
  introTier: Tier | null;
  entityShare: number;
  supplierTotal: number;
  riskAdjustedCogs: number;
  effectiveCogsPct: number;
  monthlyCumulative: number;
}

// ── The waterfall ───────────────────────────────────────────

export const calcPOWaterfall = (
  po: PurchaseOrder,
  players: Player[],
  allPos: PurchaseOrder[],
  totalDeployed: number
): WaterfallResult => {
  const eu = players.find((p) => p.id === po.endUserId);
  const intro =
    eu?.introducedBy
      ? players.find((p) => p.id === eu.introducedBy) ?? null
      : null;
  const poAmount = po.poAmount || 0;
  const deployed = Math.max(0, Math.min(totalDeployed || 0, poAmount));
  const channel = po.channel || "punchout";
  const poMonth = getMonth(po.poDate);

  // Monthly cumulative PO for this EU (for tier)
  const monthlyCumulative = allPos
    .filter(
      (p) => p.endUserId === po.endUserId && getMonth(p.poDate) === poMonth
    )
    .reduce((s, p) => s + (p.poAmount || 0), 0);

  // EU tier
  const euTiers = eu ? getEUTiers(eu, channel) : getEUTiers({ euTierMode: "A", introTierMode: "A" }, "gep");
  const euTier = getTier(monthlyCumulative, euTiers);

  // Risk-adjusted COGS from DOs
  const supplierTotal = po.dos
    ? po.dos.reduce((s, d) => s + d.amount, 0)
    : 0;
  const riskAdjustedCogs = po.dos
    ? po.dos.reduce((s, d) => {
        const bp = calcBufferPct(
          d.amount,
          d.delivery || "local",
          d.urgency || "normal"
        );
        return s + d.amount * (1 + bp / 100);
      }, 0)
    : 0;
  const effectiveCogsPct =
    poAmount > 0 ? (riskAdjustedCogs / poAmount) * 100 : 0;

  const gross = poAmount - riskAdjustedCogs;
  const platformFee = channel === "punchout" ? poAmount * 0.03 : 0;
  const investorFee = deployed * (INV_RATE / 100);
  const pool = gross - platformFee - investorFee;
  const euAmt = Math.max(0, pool * (euTier.rate / 100));
  const entityGross = Math.max(0, pool - euAmt);

  // EU Introducer
  let introAmt = 0;
  let introRate = 0;
  let introTier: Tier | null = null;
  if (intro) {
    const introTiers = getIntroTiers(intro, channel);
    // Intro tier based on all recruits' total PO this month
    const recruits = players.filter((p) => p.introducedBy === intro.id);
    const recruitIds = recruits.map((r) => r.id);
    const recruitTotalPO = allPos
      .filter(
        (p) =>
          recruitIds.includes(p.endUserId) && getMonth(p.poDate) === poMonth
      )
      .reduce((s, p) => s + (p.poAmount || 0), 0);
    introTier = getTier(recruitTotalPO || poAmount, introTiers);
    introRate = introTier.rate;
    introAmt = Math.max(0, entityGross * (introRate / 100));
  }

  const entityShare = Math.max(0, entityGross - introAmt);

  return {
    channel,
    poAmount,
    totalDeployed: deployed,
    euTier,
    euAmt,
    gross,
    platformFee,
    investorFee,
    pool,
    entityGross,
    intro,
    introAmt,
    introRate,
    introTier,
    entityShare,
    supplierTotal,
    riskAdjustedCogs,
    effectiveCogsPct,
    monthlyCumulative,
  };
};
