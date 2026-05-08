import { cn } from "@/lib/utils";

export type CycleStatus = "complete" | "active" | "cleared" | "pending";

const cycleStatusConfig: Record<
  CycleStatus,
  { label: string; bg: string; text: string }
> = {
  complete: {
    label: "Complete",
    bg: "bg-success-50",
    text: "text-success-800",
  },
  active: { label: "Active", bg: "bg-amber-50", text: "text-amber-600" },
  cleared: {
    label: "Cleared",
    bg: "bg-success-50",
    text: "text-success-800",
  },
  pending: { label: "Pending", bg: "bg-amber-50", text: "text-amber-600" },
};

export function CycleStatusBadge({ status }: { status: CycleStatus }) {
  const config = cycleStatusConfig[status];
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-medium",
        config.bg,
        config.text
      )}
    >
      {config.label}
    </span>
  );
}
