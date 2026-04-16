import { cn } from "@/lib/utils";
import { type Tier } from "@/lib/business-logic/constants";
import { fmt } from "@/lib/business-logic/formatters";

interface TierCardProps {
  tier: Tier;
  tiers: Tier[];
  volume: number;
  color?: "brand" | "purple" | "accent" | "amber";
  label?: string;
  className?: string;
}

const activeColorMap = {
  brand: "bg-brand-400",
  purple: "bg-purple-400",
  accent: "bg-accent-400",
  amber: "bg-amber-400",
} as const;

const textColorMap = {
  brand: "text-brand-600",
  purple: "text-purple-600",
  accent: "text-accent-600",
  amber: "text-amber-600",
} as const;

export function TierCard({
  tier,
  tiers,
  volume,
  color = "brand",
  label = "of pool",
  className,
}: TierCardProps) {
  const tierIdx = tiers.findIndex((t) => t.name === tier.name);
  const nextTier = tierIdx < tiers.length - 1 ? tiers[tierIdx + 1] : null;
  const remaining = nextTier ? Math.max(0, nextTier.min - volume) : 0;

  return (
    <div className={cn("space-y-3", className)}>
      {/* Tier name and rate */}
      <div className="flex items-center gap-3">
        <div>
          <p className={cn("text-base font-medium", textColorMap[color])}>
            {tier.name}
          </p>
          <p className="font-mono text-xs text-gray-500">
            {tier.rate}% {label}
          </p>
        </div>
      </div>

      {/* Progress bar segments */}
      <div className="flex gap-1">
        {tiers.map((t, i) => (
          <div
            key={t.name}
            className={cn(
              "h-1.5 flex-1 rounded-full transition-colors",
              i <= tierIdx ? activeColorMap[color] : "bg-gray-200"
            )}
          />
        ))}
      </div>

      {/* Tier labels row */}
      <div className="flex justify-between text-[10px] text-gray-500">
        {tiers.map((t) => (
          <span key={t.name}>{t.rate}%</span>
        ))}
      </div>

      {/* Next tier info */}
      {nextTier ? (
        <p className="text-center text-xs text-gray-500">
          <span className={cn("font-mono font-medium", textColorMap[color])}>
            {fmt(remaining)}
          </span>{" "}
          more to reach {nextTier.name} ({nextTier.rate}%)
        </p>
      ) : (
        <p
          className={cn(
            "text-center text-xs font-medium",
            textColorMap[color]
          )}
        >
          Max tier reached
        </p>
      )}
    </div>
  );
}
