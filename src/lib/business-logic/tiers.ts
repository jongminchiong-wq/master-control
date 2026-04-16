// Tier calculation functions — extracted from master-control-v2.jsx lines 91, 64, 112–121

import {
  type Tier,
  PO_EU_A,
  PO_EU_B,
  PO_EU_C,
  PO_INTRO,
  PO_INTRO_B,
  GEP_INTRO_B,
  INV_INTRO_TIERS,
} from "./constants";

// Types for player/introducer objects used by tier functions
export interface PlayerForTier {
  euTierMode: string;
  introTierMode: string;
}

// Generic tier lookup — find highest tier the volume qualifies for
export const getTier = (vol: number, tiers: Tier[]): Tier =>
  [...tiers].reverse().find((t) => vol >= t.min) || tiers[0];

// Get EU tiers for a player + channel combo
export const getEUTiers = (
  player: PlayerForTier,
  channel: string
): Tier[] => {
  if (channel === "gep") return PO_EU_C; // GEP = fixed C tiers
  return player.euTierMode === "B" ? PO_EU_B : PO_EU_A; // Punchout = A or B
};

// Get Intro tiers for an introducer + channel combo
export const getIntroTiers = (
  introducer: PlayerForTier,
  channel: string
): Tier[] => {
  if (channel === "punchout") return PO_INTRO; // Punchout = fixed
  return introducer.introTierMode === "B" ? GEP_INTRO_B : PO_INTRO_B; // GEP = A or B
};

// Investor introducer tier lookup
export const getInvIntroTier = (cap: number): Tier =>
  [...INV_INTRO_TIERS].reverse().find((t) => cap >= t.min) ||
  INV_INTRO_TIERS[0];
