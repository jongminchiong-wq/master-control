import { cn } from "@/lib/utils";

interface MetricCardProps {
  label: string;
  value: string;
  subtitle?: string;
  color?: "brand" | "purple" | "accent" | "amber" | "danger" | "success" | "default";
  className?: string;
  children?: React.ReactNode;
}

const colorMap = {
  brand: "text-brand-600",
  purple: "text-purple-600",
  accent: "text-accent-600",
  amber: "text-amber-600",
  danger: "text-danger-600",
  success: "text-success-600",
  default: "text-gray-800",
} as const;

export function MetricCard({
  label,
  value,
  subtitle,
  color = "default",
  className,
  children,
}: MetricCardProps) {
  return (
    <div
      className={cn(
        "rounded-2xl bg-white px-5 py-5 shadow-[0_2px_8px_rgba(0,0,0,0.06),0_1px_3px_rgba(0,0,0,0.04)]",
        className
      )}
    >
      <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
        {label}
      </p>
      <p
        className={cn(
          "mt-1 font-mono text-xl font-medium",
          colorMap[color]
        )}
      >
        {value}
      </p>
      {subtitle && (
        <p className="mt-0.5 text-xs text-gray-500">{subtitle}</p>
      )}
      {children}
    </div>
  );
}
