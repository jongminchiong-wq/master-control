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
  variant?: "bar" | "table";
  volumeLabel?: string;
  showHeader?: boolean;
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

const highlightBgMap = {
  brand: "bg-brand-50",
  purple: "bg-purple-50",
  accent: "bg-accent-50",
  amber: "bg-amber-50",
} as const;

const dotColorMap = {
  brand: "bg-brand-500",
  purple: "bg-purple-500",
  accent: "bg-accent-500",
  amber: "bg-amber-500",
} as const;

function formatVolumeRange(t: Tier): string {
  if (t.max === Infinity) return `${fmt(t.min)}+`;
  return `${fmt(t.min)} – ${fmt(t.max)}`;
}

export function TierCard({
  tier,
  tiers,
  volume,
  color = "brand",
  label = "of pool",
  className,
  variant = "bar",
  volumeLabel = "Volume",
  showHeader = true,
}: TierCardProps) {
  const tierIdx = tiers.findIndex((t) => t.name === tier.name);
  const nextTier = tierIdx < tiers.length - 1 ? tiers[tierIdx + 1] : null;
  const remaining = nextTier ? Math.max(0, nextTier.min - volume) : 0;

  return (
    <div className={cn("space-y-3", className)}>
      {showHeader && (
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
      )}

      {variant === "table" ? (
        <div className="overflow-hidden rounded-lg border border-gray-200">
          <div className="grid grid-cols-[1.1fr_1.6fr_0.6fr] bg-gray-50 px-3 py-2 text-[10px] font-medium uppercase tracking-wide text-gray-500">
            <span>Tier</span>
            <span>{volumeLabel}</span>
            <span className="text-right">Rate</span>
          </div>
          <div className="divide-y divide-gray-100 text-sm">
            {tiers.map((t, i) => {
              const active = i === tierIdx;
              return (
                <div
                  key={t.name}
                  className={cn(
                    "grid grid-cols-[1.1fr_1.6fr_0.6fr] items-center px-3 py-2.5",
                    active ? highlightBgMap[color] : "text-gray-600"
                  )}
                >
                  <span
                    className={cn(
                      "flex items-center gap-2",
                      active && "font-medium",
                      active && textColorMap[color]
                    )}
                  >
                    {active && (
                      <span
                        className={cn(
                          "size-1.5 rounded-full",
                          dotColorMap[color]
                        )}
                      />
                    )}
                    {t.name}
                  </span>
                  <span
                    className={cn(
                      "font-mono text-xs",
                      active ? "text-gray-700" : "text-gray-500"
                    )}
                  >
                    {formatVolumeRange(t)}
                  </span>
                  <span
                    className={cn(
                      "text-right font-mono",
                      active && "font-medium",
                      active && textColorMap[color]
                    )}
                  >
                    {t.rate}%
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <>
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
        </>
      )}

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
