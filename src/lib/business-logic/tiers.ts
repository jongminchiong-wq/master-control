// Tier calculation functions — extracted from master-control-v2.jsx lines 91, 64, 112–121

import {
  type Tier,
  PO_EU_A,
  PO_EU_A_PLUS,
  PO_EU_B,
  PO_EU_C,
  PO_EU_C_EXCLUSIVE,
  PO_INTRO,
  PO_INTRO_EXCLUSIVE,
  PO_INTRO_B,
  GEP_INTRO_B,
  INV_INTRO_TIERS,
} from "./constants";

// Per-channel tier modes. Each channel reads its own mode independently.
export interface PlayerForTier {
  euTierModeProxy: string;
  euTierModeGrid: string;
  introTierModeProxy: string;
  introTierModeGrid: string;
}

// Generic tier lookup — find highest tier the volume qualifies for
export const getTier = (vol: number, tiers: Tier[]): Tier =>
  [...tiers].reverse().find((t) => vol >= t.min) || tiers[0];

// Punchout EU tier tables keyed by mode. Unknown values fall back to A.
const PUNCHOUT_EU_TIERS: Record<string, Tier[]> = {
  A: PO_EU_A,
  A_PLUS: PO_EU_A_PLUS,
  B: PO_EU_B,
};

// GEP EU tier tables keyed by mode. Grid has no Premium variant.
const GEP_EU_TIERS: Record<string, Tier[]> = {
  A: PO_EU_C,
  B: PO_EU_C_EXCLUSIVE,
};

// Get EU tiers for a player + channel combo
export const getEUTiers = (
  player: PlayerForTier,
  channel: string
): Tier[] => {
  if (channel === "gep") return GEP_EU_TIERS[player.euTierModeGrid] ?? PO_EU_C;
  return PUNCHOUT_EU_TIERS[player.euTierModeProxy] ?? PO_EU_A;
};

// Punchout introducer tables keyed by mode.
const PUNCHOUT_INTRO_TIERS: Record<string, Tier[]> = {
  A: PO_INTRO,
  B: PO_INTRO_EXCLUSIVE,
};

// GEP introducer tables keyed by mode.
const GEP_INTRO_TIERS: Record<string, Tier[]> = {
  A: PO_INTRO_B,
  B: GEP_INTRO_B,
};

// Get Intro tiers for an introducer + channel combo
export const getIntroTiers = (
  introducer: PlayerForTier,
  channel: string
): Tier[] => {
  if (channel === "punchout") {
    return PUNCHOUT_INTRO_TIERS[introducer.introTierModeProxy] ?? PO_INTRO;
  }
  return GEP_INTRO_TIERS[introducer.introTierModeGrid] ?? PO_INTRO_B;
};

// Investor introducer tier lookup
export const getInvIntroTier = (cap: number): Tier =>
  [...INV_INTRO_TIERS].reverse().find((t) => cap >= t.min) ||
  INV_INTRO_TIERS[0];
