// Risk buffer calculations — extracted from master-control-v2.jsx lines 94–105

import { BUFFER_TABLE, URGENCY } from "./constants";
import type { RBPOTier } from "./constants";

export const getRBTierId = (cost: number): RBPOTier["id"] => {
  if (cost < 10000) return "small";
  if (cost < 25000) return "mid1";
  if (cost < 50000) return "mid2";
  return "large";
};

export const getDeliveryIdx = (id: string): number => {
  if (id === "local") return 0;
  if (id === "sea") return 1;
  return 2;
};

// Per-DO risk buffer calculation
export const calcBufferPct = (
  supplierCost: number,
  delivery: string,
  urgency: string
): number => {
  const tierId = getRBTierId(supplierCost);
  const baseBuffer = BUFFER_TABLE[tierId][getDeliveryIdx(delivery)];
  const urg = URGENCY.find((u) => u.id === urgency);
  return baseBuffer + (urg?.extra || 0);
};
