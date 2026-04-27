// Tier preview helpers. Under Option C, cash_balance and the 7-day
// auto-compound window no longer exist — return credits bump capital
// directly, so reinvest flow is gone. What remains is the downgrade
// preview used by the capital withdrawal form to warn the user when
// their request would drop them a tier.

import { INV_TIERS } from "./constants";
import { getTier } from "./tiers";
import type { Tier } from "./constants";

/** Check if a capital withdrawal would cause a tier downgrade */
export function wouldDowngradeTier(
  currentCapital: number,
  withdrawAmount: number
): { downgrades: boolean; from: Tier; to: Tier } {
  const remaining = Math.max(0, currentCapital - withdrawAmount);
  const from = getTier(currentCapital, INV_TIERS);
  const to = getTier(remaining, INV_TIERS);
  return { downgrades: from.name !== to.name, from, to };
}
