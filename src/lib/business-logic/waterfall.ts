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
  // Upline introducer. When set:
  //   - chunk size uses the upline's intro tier rate, with the upline's
  //     band determined by their whole-subtree monthly PO volume
  //     (every PO from any descendant at any depth).
  //   - the chunk is split using the direct introducer's tier rate:
  //     direct keeps `introRate%`, upline gets the remaining
  //     `1 − introRate%`. Same fractions apply to the loss leg.
  uplineId?: string | null;
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
  // Dual-introducer split. `upline` is the introducer's own introducer
  // (set on the players row as upline_id). When present, the
  // introducer's chunk is split: direct introducer keeps introRate%,
  // upline gets (1 − introRate%). Same fractions applied to the loss
  // leg. When no upline exists, upline is null and uplineAmt /
  // uplineLossShare are zero — no behaviour change vs single-intro.
  upline: Player | null;
  uplineAmt: number;
  uplineLossShare: number;
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

// Collects every descendant id of `rootId` in the player tree.
// A player is a descendant if either edge type points up at the
// current node: `introducedBy` (recruit) or `uplineId` (upline).
// Both are needed because top-level recruits often have
// `introducedBy = null` and only carry the upline via `uplineId`
// (e.g. screenshot setup where B has no introducedBy but uplineId = A).
// BFS so depth is bounded by the tree, not the JS call stack.
const collectSubtreeIds = (rootId: string, players: Player[]): Set<string> => {
  const out = new Set<string>();
  const queue: string[] = [rootId];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    for (const p of players) {
      if (
        (p.introducedBy === cur || p.uplineId === cur) &&
        !out.has(p.id)
      ) {
        out.add(p.id);
        queue.push(p.id);
      }
    }
  }
  return out;
};

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
  // Split trigger is the introducer's own `uplineId` field — not whether the
  // upline player row is visible in `players`. Client-side callers run under
  // RLS that may hide the upline (Player B shouldn't see Player A), but B can
  // still read `upline_id` on their own row, so the split applies correctly.
  const hasUpline = !!intro?.uplineId;
  const upline = hasUpline
    ? players.find((p) => p.id === intro!.uplineId) ?? null
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
  let introRate = 0;   // direct introducer (B) rate — drives the chunk split
  let chunkRate = 0;   // rate that SIZES the chunk: upline's rate when present, else B's
  let introTier: Tier | null = null;
  if (intro) {
    // Direct introducer tier — band by B's direct recruits' POs this month.
    const introTiers = getIntroTiers(intro, channel);
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
    chunkRate = introRate;

    // Upline tier — chunk is sized by the upline's tier rate when an upline
    // exists. Upline's tier band uses whole-subtree monthly PO volume: every
    // PO placed by anyone below the upline at any depth. The upline's own
    // POs are excluded by construction (the upline is not in its own subtree).
    if (upline) {
      const uplineTiers = getIntroTiers(upline, channel);
      const subtreeIds = collectSubtreeIds(upline.id, players);
      const subtreeTotalPO = allPos
        .filter(
          (p) => subtreeIds.has(p.endUserId) && getMonth(p.poDate) === poMonth
        )
        .reduce((s, p) => s + (p.poAmount || 0), 0);
      const uplineTier = getTier(subtreeTotalPO || poAmount, uplineTiers);
      chunkRate = uplineTier.rate;
    }

    introAmt = Math.max(0, entityGross * (chunkRate / 100));
  }

  // Dual-introducer split. Direct introducer keeps `introRate%` of the chunk;
  // upline gets `1 − introRate%`. Split fractions are unchanged by the
  // upline-sized chunk above — only the chunk total grew. When upline is
  // null, fractions collapse to (1, 0).
  const uplineShareFrac = hasUpline ? 1 - introRate / 100 : 0;
  const bobShareFrac = hasUpline ? introRate / 100 : 1;
  const uplineAmt = introAmt * uplineShareFrac;
  introAmt = introAmt * bobShareFrac;

  const entityShare = Math.max(0, entityGross - introAmt - uplineAmt);

  // Loss split — full pool deficit, mirroring the profit split.
  // Side total uses `chunkRate` so the loss footprint matches the chunk size.
  const rawLoss = Math.max(0, -pool);
  const playerLossShare = rawLoss * (euTier.rate / 100);
  const sideLoss = rawLoss - playerLossShare;
  const introducerLossSharePre = intro ? sideLoss * (chunkRate / 100) : 0;
  const uplineLossShare = introducerLossSharePre * uplineShareFrac;
  const introducerLossShare = introducerLossSharePre * bobShareFrac;
  const entityLossShare = sideLoss - introducerLossSharePre;

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
    upline,
    uplineAmt,
    uplineLossShare,
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
