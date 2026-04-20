import { AlertTriangle } from "lucide-react";
import { fmt } from "@/lib/business-logic/formatters";
import type { FundingStatus } from "@/lib/business-logic/funding-status";

interface UnfundedBannerProps {
  status: FundingStatus;
}

/**
 * Admin-side banner: awareness-only signal that unfunded POs exist in the
 * selected month. Renders null when the pool fully covers current demand,
 * so the card is never a dead/empty-state element.
 */
export function UnfundedBanner({ status }: UnfundedBannerProps) {
  const {
    unfundedTotal,
    unfundedCount,
    poolCapacity,
    totalDemand,
    fundedPct,
    oldestUnfundedRef,
    oldestUnfundedDays,
    isFullyFunded,
  } = status;

  if (isFullyFunded || unfundedTotal <= 0) return null;

  return (
    <div className="flex items-start gap-3 rounded-xl bg-amber-50 px-5 py-4 ring-1 ring-amber-200">
      <div className="mt-0.5 flex size-9 flex-shrink-0 items-center justify-center rounded-lg bg-amber-100">
        <AlertTriangle
          className="size-5 text-amber-800"
          strokeWidth={1.6}
        />
      </div>
      <div className="flex-1">
        <p className="text-sm font-medium text-gray-800">
          Unfunded gap{" "}
          <span className="font-mono font-medium text-amber-800">
            {fmt(unfundedTotal)}
          </span>{" "}
          across {unfundedCount} PO{unfundedCount !== 1 ? "s" : ""}
        </p>
        <p className="mt-1 text-xs text-amber-800">
          Pool capacity{" "}
          <span className="font-mono font-medium">{fmt(poolCapacity)}</span> of{" "}
          <span className="font-mono font-medium">{fmt(totalDemand)}</span>{" "}
          demand ({fundedPct}% funded)
          {oldestUnfundedRef && oldestUnfundedDays > 0 && (
            <>
              {" "}&middot; Oldest:{" "}
              <span className="font-mono font-medium">{oldestUnfundedRef}</span>{" "}
              aging {oldestUnfundedDays} day
              {oldestUnfundedDays !== 1 ? "s" : ""}
            </>
          )}
        </p>
      </div>
    </div>
  );
}
