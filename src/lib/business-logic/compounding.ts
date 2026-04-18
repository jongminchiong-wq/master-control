// Compounding & withdrawal logic for investor returns

import { INV_TIERS } from "./constants";
import { getTier } from "./tiers";
import type { Tier } from "./constants";

// ── Constants ──────────────────────────────────────────────

/** Days before cash balance auto-compounds into capital */
export const COMPOUND_WINDOW_DAYS = 7;

// ── Types ──────────────────────────────────────────────────

export interface CompoundResult {
  investorId: string;
  amount: number;
  capitalBefore: number;
  capitalAfter: number;
  tierBefore: string;
  tierAfter: string;
}

export interface CreditResult {
  investorId: string;
  investorName: string;
  poId: string;
  poRef: string;
  deployed: number;
  tierRate: number;
  returnAmount: number;
}

// ── Helpers ────────────────────────────────────────────────

/** Check if auto-compound window has elapsed */
export function shouldAutoCompound(compoundAt: string | null): boolean {
  if (!compoundAt) return false;
  return new Date() >= new Date(compoundAt);
}

/** Calculate the compound_at timestamp (7 days from now) */
export function getCompoundDeadline(): string {
  const deadline = new Date();
  deadline.setDate(deadline.getDate() + COMPOUND_WINDOW_DAYS);
  return deadline.toISOString();
}

/** Build a CompoundResult for moving cash_balance → capital */
export function buildCompoundResult(
  investorId: string,
  cashBalance: number,
  currentCapital: number
): CompoundResult {
  const tierBefore = getTier(currentCapital, INV_TIERS);
  const newCapital = currentCapital + cashBalance;
  const tierAfter = getTier(newCapital, INV_TIERS);

  return {
    investorId,
    amount: cashBalance,
    capitalBefore: currentCapital,
    capitalAfter: newCapital,
    tierBefore: tierBefore.name,
    tierAfter: tierAfter.name,
  };
}

/** Check if compounding would cause a tier upgrade */
export function wouldUpgradeTier(
  currentCapital: number,
  cashBalance: number
): { upgrades: boolean; from: Tier; to: Tier } {
  const from = getTier(currentCapital, INV_TIERS);
  const to = getTier(currentCapital + cashBalance, INV_TIERS);
  return { upgrades: from.name !== to.name, from, to };
}

/** Calculate days remaining until auto-compound */
export function daysUntilCompound(compoundAt: string | null): number | null {
  if (!compoundAt) return null;
  const deadline = new Date(compoundAt);
  const now = new Date();
  const diff = deadline.getTime() - now.getTime();
  if (diff <= 0) return 0;
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

/** Estimate annual return with compounding */
export function estimateAnnualCompound(
  capital: number,
  cycleDays: number = 60
): { annualReturn: number; annualPct: number; finalCapital: number } {
  const cyclesPerYear = 365 / cycleDays;
  let current = capital;
  for (let i = 0; i < Math.floor(cyclesPerYear); i++) {
    const tier = getTier(current, INV_TIERS);
    current += current * (tier.rate / 100);
  }
  const annualReturn = current - capital;
  const annualPct = (annualReturn / capital) * 100;
  return { annualReturn, annualPct, finalCapital: current };
}
