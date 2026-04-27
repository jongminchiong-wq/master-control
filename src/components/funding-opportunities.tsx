import { Sparkles, ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { fmt } from "@/lib/business-logic/formatters";
import { Button } from "@/components/ui/button";
import type { FundingStatus } from "@/lib/business-logic/funding-status";

interface FundingOpportunitiesProps {
  status: FundingStatus;
  // Investor's current tier rate (percent, e.g. 4 for Silver).
  investorTierRate: number;
  investorTierName: string;
  // Investor's own idle capital — drives the footer copy.
  idleCapital: number;
  className?: string;
  onFund?: (poId: string) => void;
  onTopUp?: () => void;
}

/**
 * Surfaces unfunded POs as a direct FOMO signal on the investor dashboard.
 * Each row tells the investor the specific return they'd earn at their
 * current tier if the PO is funded. Renders null when there's no unfunded
 * demand — never a dead/empty-state card.
 */
export function FundingOpportunities({
  status,
  investorTierRate,
  investorTierName,
  idleCapital,
  className,
  onFund,
  onTopUp,
}: FundingOpportunitiesProps) {
  const { unfundedPOs, unfundedTotal, unfundedCount } = status;
  if (unfundedCount === 0) return null;

  const idleCoversAll = idleCapital >= unfundedTotal;

  return (
    <div
      className={cn(
        "overflow-hidden rounded-2xl bg-purple-50 shadow-[0_2px_8px_rgba(0,0,0,0.06),0_1px_3px_rgba(0,0,0,0.04)] ring-1 ring-purple-100",
        className
      )}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-4 px-6 py-5">
        <div className="flex items-start gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-white/70 ring-1 ring-purple-100">
            <Sparkles className="size-5 text-purple-600" strokeWidth={1.6} />
          </div>
          <div>
            <p className="text-sm font-semibold text-gray-800">
              Funding Opportunities
            </p>
            <p className="mt-0.5 text-xs text-gray-500">
              POs waiting for pool capital
            </p>
          </div>
        </div>
        <div className="text-right">
          <p className="font-mono text-xl font-medium text-purple-600">
            {fmt(unfundedTotal)}
          </p>
          <p className="text-[10px] font-medium uppercase tracking-wide text-gray-500">
            {unfundedCount} PO{unfundedCount !== 1 ? "s" : ""} unfunded
          </p>
        </div>
      </div>

      {/* Rows */}
      <div className="px-6">
        {unfundedPOs.map((po) => {
          const expectedReturn = po.unfunded * (investorTierRate / 100);
          const ageLabel =
            po.ageDays === 0
              ? "Posted today"
              : `${po.ageDays} day${po.ageDays !== 1 ? "s" : ""} unfunded`;
          return (
            <div
              key={po.poId}
              className="grid grid-cols-[auto_1fr_1fr_auto] items-center gap-5 border-b border-purple-100 py-4 last:border-b-0"
            >
              <span
                className={cn(
                  "font-mono text-sm font-medium",
                  po.channel === "gep" ? "text-brand-600" : "text-purple-600"
                )}
              >
                {po.ref}
              </span>
              <div>
                <p className="font-mono text-sm font-medium text-gray-800">
                  {fmt(po.unfunded)}
                </p>
                <p className="mt-0.5 text-[11px] text-gray-500">{ageLabel}</p>
              </div>
              <div>
                <p className="font-mono text-sm font-medium text-purple-600">
                  + {fmt(expectedReturn)}
                </p>
                <p className="mt-0.5 text-[11px] text-gray-500">
                  at your {investorTierName} {investorTierRate}%
                </p>
              </div>
              <Button
                size="sm"
                className="border-transparent bg-purple-600 text-white shadow-sm hover:bg-purple-400"
                onClick={onFund ? () => onFund(po.poId) : undefined}
              >
                Fund
              </Button>
            </div>
          );
        })}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between gap-3 border-t border-purple-100 px-6 py-4">
        <p className="text-xs text-gray-600">
          Your idle capital{" "}
          <span className="font-mono font-medium text-gray-800">
            {fmt(idleCapital)}
          </span>{" "}
          —{" "}
          {idleCoversAll
            ? "enough to fund every opportunity above."
            : "not enough to cover all opportunities."}
        </p>
        <button
          type="button"
          onClick={onTopUp}
          className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-purple-600 hover:text-purple-800"
        >
          Top up capital
          <ArrowRight className="size-3.5" />
        </button>
      </div>
    </div>
  );
}
