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
}

export interface PurchaseOrder {
  id: string;
  endUserId: string;
  poAmount: number;
  poDate: string;
  channel: string;
  dos?: DeliveryOrder[];
  otherCost?: number;
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
  otherCost: number;
  monthlyCumulative: number;
  // Loss distribution — nonzero when the pool is negative. Covers raw cost
  // overrun, risk buffer overflow, and unfunded fees alike. Mirrors the
  // profit split using the same EU + intro tier rates.
  rawLoss: number;
  playerLossShare: number;
  introducerLossShare: number;
  entityLossShare: number;
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

  // Per-channel monthly cumulative PO for this EU (drives the tier band).
  // Each channel ladders independently: 75k of Proxy POs lifts only the Proxy
  // tier; 75k of Grid POs lifts only the Grid tier. Cross-channel volume
  // does not boost the other channel's rate.
  const monthlyCumulative = allPos
    .filter(
      (p) =>
        p.endUserId === po.endUserId &&
        getMonth(p.poDate) === poMonth &&
        (p.channel || "punchout") === channel
    )
    .reduce((s, p) => s + (p.poAmount || 0), 0);

  // EU tier
  const euTiers = eu
    ? getEUTiers(eu, channel)
    : getEUTiers(
        {
          euTierModeProxy: "A",
          euTierModeGrid: "A",
          introTierModeProxy: "A",
          introTierModeGrid: "A",
        },
        "gep"
      );
  const euTier = getTier(monthlyCumulative, euTiers);

  // Risk-adjusted COGS from DOs
  const supplierTotal = po.dos
    ? po.dos.reduce((s, d) => s + d.amount, 0)
    : 0;
  const riskAdjustedCogs = po.dos
    ? po.dos.reduce((s, d) => {
        const bp = calcBufferPct(d.amount, d.delivery || "local");
        return s + d.amount * (1 + bp / 100);
      }, 0)
    : 0;
  const effectiveCogsPct =
    poAmount > 0 ? (riskAdjustedCogs / poAmount) * 100 : 0;

  const otherCost = po.otherCost ?? 0;
  const gross = poAmount - riskAdjustedCogs - otherCost;
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

  // Loss split — full pool deficit, mirroring the profit split.
  const rawLoss = Math.max(0, -pool);
  const playerLossShare = rawLoss * (euTier.rate / 100);
  const sideLoss = rawLoss - playerLossShare;
  const introducerLossShare = intro ? sideLoss * (introRate / 100) : 0;
  const entityLossShare = sideLoss - introducerLossShare;

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
    otherCost,
    monthlyCumulative,
    rawLoss,
    playerLossShare,
    introducerLossShare,
    entityLossShare,
  };
};
