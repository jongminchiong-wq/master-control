import { cn } from "@/lib/utils";
import type { CommStatus } from "@/lib/business-logic/commission-status";

const commStatusConfig: Record<
  CommStatus,
  { label: string; bg: string; text: string }
> = {
  cleared: { label: "Cleared", bg: "bg-success-50", text: "text-success-800" },
  payable: { label: "Payable", bg: "bg-amber-50", text: "text-amber-600" },
  pending: { label: "Pending", bg: "bg-gray-100", text: "text-gray-500" },
};

export function CommissionStatusBadge({ status }: { status: CommStatus }) {
  const config = commStatusConfig[status];
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-medium",
        config.bg,
        config.text
      )}
    >
      {config.label}
    </span>
  );
}
