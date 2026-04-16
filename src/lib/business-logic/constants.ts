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

export interface UrgencyLevel {
  id: "normal" | "urgent" | "rush";
  label: string;
  extra: number;
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
  { name: "Active", rate: 27, min: 75000, max: 150000 },
  { name: "Performer", rate: 30, min: 150000, max: 250000 },
  { name: "Top", rate: 33, min: 250000, max: Infinity },
];

export const PO_EU_B: Tier[] = [
  { name: "Base", rate: 33, min: 0, max: 75000 },
  { name: "Active", rate: 36, min: 75000, max: 150000 },
  { name: "Performer", rate: 39, min: 150000, max: 250000 },
  { name: "Top", rate: 42, min: 250000, max: Infinity },
];

// ── EU Tiers — GEP SMART channel (fixed, no A/B) ───────────

export const PO_EU_C: Tier[] = [
  { name: "Base", rate: 21, min: 0, max: 75000 },
  { name: "Active", rate: 24, min: 75000, max: 150000 },
  { name: "Performer", rate: 27, min: 150000, max: 250000 },
  { name: "Top", rate: 30, min: 250000, max: Infinity },
];

// ── EU Introducer Tiers — Punchout channel (fixed) ──────────

export const PO_INTRO: Tier[] = [
  { name: "Base", rate: 9, min: 0, max: 100000 },
  { name: "Active", rate: 12, min: 100000, max: 200000 },
  { name: "Pro", rate: 15, min: 200000, max: 400000 },
  { name: "Elite", rate: 18, min: 400000, max: Infinity },
];

// ── EU Introducer Tiers — GEP channel A ─────────────────────

export const PO_INTRO_B: Tier[] = [
  { name: "Base", rate: 12, min: 0, max: 100000 },
  { name: "Active", rate: 15, min: 100000, max: 200000 },
  { name: "Pro", rate: 18, min: 200000, max: 400000 },
  { name: "Elite", rate: 21, min: 400000, max: Infinity },
];

// ── EU Introducer Tiers — GEP channel B ─────────────────────

export const GEP_INTRO_B: Tier[] = [
  { name: "Base", rate: 21, min: 0, max: 100000 },
  { name: "Active", rate: 24, min: 100000, max: 200000 },
  { name: "Pro", rate: 27, min: 200000, max: 400000 },
  { name: "Elite", rate: 30, min: 400000, max: Infinity },
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

export const URGENCY: UrgencyLevel[] = [
  { id: "normal", label: "Normal", extra: 0 },
  { id: "urgent", label: "Urgent", extra: 2 },
  { id: "rush", label: "Rush", extra: 4 },
];

export const RB_PO_TIERS: RBPOTier[] = [
  { id: "small", label: "Under RM10K", max: 10000 },
  { id: "mid1", label: "RM10K – 25K", max: 25000 },
  { id: "mid2", label: "RM25K – 50K", max: 50000 },
  { id: "large", label: "Over RM50K", max: Infinity },
];

export const BUFFER_TABLE: Record<RBPOTier["id"], [number, number, number]> = {
  small: [5.5, 8, 10],
  mid1: [4, 6, 8],
  mid2: [3, 5, 7],
  large: [2.5, 4, 6],
};
