// Business logic constants — extracted from master-control-v2.jsx lines 7–88

// ── Types ───────────────────────────────────────────────────

export interface Tier {
  name: string;
  rate: number;
  min: number;
  max: number;
}

export interface DeliveryMode {
  id: "local" | "sea" | "international";
  label: string;
}

export interface RBPOTier {
  id: "small" | "mid1" | "mid2" | "large";
  label: string;
  max: number;
}

// ── Investor Rate ───────────────────────────────────────────

export const INV_RATE = 5; // Fixed 5% for PO Cycle

// ── Investor Tiers ──────────────────────────────────────────

export const INV_TIERS: Tier[] = [
  { name: "Standard", rate: 3, min: 0, max: 10000 },
  { name: "Silver", rate: 4, min: 10000, max: 50000 },
  { name: "Gold", rate: 5, min: 50000, max: Infinity },
];

// ── EU Tiers — Punchout channel ─────────────────────────────

export const PO_EU_A: Tier[] = [
  { name: "Base", rate: 24, min: 0, max: 75000 },
  { name: "Active", rate: 27, min: 75001, max: 150000 },
  { name: "Performer", rate: 30, min: 150001, max: 250000 },
  { name: "Top", rate: 33, min: 250001, max: Infinity },
];

export const PO_EU_B: Tier[] = [
  { name: "Base", rate: 33, min: 0, max: 75000 },
  { name: "Active", rate: 36, min: 75001, max: 150000 },
  { name: "Performer", rate: 39, min: 150001, max: 250000 },
  { name: "Top", rate: 42, min: 250001, max: Infinity },
];

// Premium variant of Punchout — sits between A (Default) and B (Exclusive).
export const PO_EU_A_PLUS: Tier[] = [
  { name: "Base", rate: 30, min: 0, max: 75000 },
  { name: "Active", rate: 33, min: 75001, max: 150000 },
  { name: "Performer", rate: 36, min: 150001, max: 250000 },
  { name: "Top", rate: 39, min: 250001, max: Infinity },
];

// ── EU Tiers — GEP SMART channel (Default) ─────────────────

export const PO_EU_C: Tier[] = [
  { name: "Base", rate: 21, min: 0, max: 75000 },
  { name: "Active", rate: 24, min: 75001, max: 150000 },
  { name: "Performer", rate: 27, min: 150001, max: 250000 },
  { name: "Top", rate: 30, min: 250001, max: Infinity },
];

// ── EU Tiers — GEP SMART channel (Exclusive) ───────────────

export const PO_EU_C_EXCLUSIVE: Tier[] = [
  { name: "Base", rate: 24, min: 0, max: 75000 },
  { name: "Active", rate: 27, min: 75001, max: 150000 },
  { name: "Performer", rate: 30, min: 150001, max: 250000 },
  { name: "Top", rate: 33, min: 250001, max: Infinity },
];

// ── EU Introducer Tiers — Punchout channel (Default) ────────

export const PO_INTRO: Tier[] = [
  { name: "Base", rate: 24, min: 0, max: 100000 },
  { name: "Active", rate: 27, min: 100001, max: 200000 },
  { name: "Pro", rate: 30, min: 200001, max: 400000 },
  { name: "Elite", rate: 33, min: 400001, max: Infinity },
];

// ── EU Introducer Tiers — Punchout channel (Exclusive) ──────

export const PO_INTRO_EXCLUSIVE: Tier[] = [
  { name: "Base", rate: 27, min: 0, max: 100000 },
  { name: "Active", rate: 30, min: 100001, max: 200000 },
  { name: "Pro", rate: 33, min: 200001, max: 400000 },
  { name: "Elite", rate: 36, min: 400001, max: Infinity },
];

// ── EU Introducer Tiers — Punchout channel (Premium) ────────

export const PO_INTRO_A_PLUS: Tier[] = [
  { name: "Base", rate: 30, min: 0, max: 100000 },
  { name: "Active", rate: 33, min: 100001, max: 200000 },
  { name: "Pro", rate: 36, min: 200001, max: 400000 },
  { name: "Elite", rate: 39, min: 400001, max: Infinity },
];

// ── EU Introducer Tiers — GEP channel A ─────────────────────

export const PO_INTRO_B: Tier[] = [
  { name: "Base", rate: 24, min: 0, max: 100000 },
  { name: "Active", rate: 27, min: 100001, max: 200000 },
  { name: "Pro", rate: 30, min: 200001, max: 400000 },
  { name: "Elite", rate: 33, min: 400001, max: Infinity },
];

// ── EU Introducer Tiers — GEP channel B ─────────────────────

export const GEP_INTRO_B: Tier[] = [
  { name: "Base", rate: 27, min: 0, max: 100000 },
  { name: "Active", rate: 30, min: 100001, max: 200000 },
  { name: "Pro", rate: 33, min: 200001, max: 400000 },
  { name: "Elite", rate: 36, min: 400001, max: Infinity },
];

// ── EU Introducer Tiers — GEP channel (Premium) ─────────────

export const GEP_INTRO_A_PLUS: Tier[] = [
  { name: "Base", rate: 30, min: 0, max: 100000 },
  { name: "Active", rate: 33, min: 100001, max: 200000 },
  { name: "Pro", rate: 36, min: 200001, max: 400000 },
  { name: "Elite", rate: 39, min: 400001, max: Infinity },
];

// ── Investor Introducer Tiers (Combine tab only) ────────────

export const INV_INTRO_TIERS: Tier[] = [
  { name: "Starter", rate: 21, min: 0, max: 50000 },
  { name: "Builder", rate: 24, min: 50000, max: 150000 },
  { name: "Connector", rate: 27, min: 150000, max: 300000 },
  { name: "Rainmaker", rate: 30, min: 300000, max: Infinity },
];

// ── Risk Buffer constants ───────────────────────────────────

export const DELIVERY_MODES: DeliveryMode[] = [
  { id: "local", label: "Sarawak" },
  { id: "sea", label: "Peninsular" },
  { id: "international", label: "International" },
];

export const RB_PO_TIERS: RBPOTier[] = [
  { id: "small", label: "Under RM10K", max: 10000 },
  { id: "mid1", label: "RM10K – 25K", max: 25000 },
  { id: "mid2", label: "RM25K – 50K", max: 50000 },
  { id: "large", label: "Over RM50K", max: Infinity },
];

export const BUFFER_TABLE: Record<RBPOTier["id"], [number, number, number]> = {
  small: [3, 5, 7],
  mid1: [2, 3.5, 5.5],
  mid2: [1.5, 3, 4.5],
  large: [1, 2, 3.5],
};
