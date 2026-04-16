import { cn } from "@/lib/utils";

type POStatus =
  | "active"
  | "pending"
  | "supplier-paid"
  | "delivered"
  | "invoiced"
  | "partial"
  | "fully-paid"
  | "cleared"
  | "overdue"
  | "no-dos";

interface StatusBadgeProps {
  status: POStatus;
  className?: string;
}

const statusConfig: Record<
  POStatus,
  { label: string; bg: string; text: string }
> = {
  active: {
    label: "Active",
    bg: "bg-brand-50",
    text: "text-brand-800",
  },
  pending: {
    label: "Pending",
    bg: "bg-amber-50",
    text: "text-amber-600",
  },
  "supplier-paid": {
    label: "Supplier Paid",
    bg: "bg-amber-50",
    text: "text-amber-600",
  },
  delivered: {
    label: "Delivered",
    bg: "bg-purple-50",
    text: "text-purple-800",
  },
  invoiced: {
    label: "Invoiced",
    bg: "bg-amber-50",
    text: "text-amber-600",
  },
  partial: {
    label: "Partial",
    bg: "bg-amber-50",
    text: "text-amber-600",
  },
  "fully-paid": {
    label: "Fully Paid",
    bg: "bg-accent-50",
    text: "text-accent-800",
  },
  cleared: {
    label: "Cleared",
    bg: "bg-success-50",
    text: "text-success-800",
  },
  overdue: {
    label: "Overdue",
    bg: "bg-danger-50",
    text: "text-danger-800",
  },
  "no-dos": {
    label: "No DOs",
    bg: "bg-gray-100",
    text: "text-gray-500",
  },
};

export function StatusBadge({ status, className }: StatusBadgeProps) {
  const config = statusConfig[status];

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-medium",
        config.bg,
        config.text,
        className
      )}
    >
      {config.label}
    </span>
  );
}

export type { POStatus };
