"use client";

import { ChevronRight, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

interface SectionHeaderBadge {
  label: string;
  color?: "brand" | "purple" | "accent" | "amber" | "danger" | "success";
}

interface SectionHeaderProps {
  title: string;
  open: boolean;
  onToggle: () => void;
  badge?: SectionHeaderBadge;
  className?: string;
}

const badgeColorMap = {
  brand: "bg-brand-50 text-brand-600",
  purple: "bg-purple-50 text-purple-600",
  accent: "bg-accent-50 text-accent-600",
  amber: "bg-amber-50 text-amber-600",
  danger: "bg-danger-50 text-danger-600",
  success: "bg-success-50 text-success-600",
} as const;

export function SectionHeader({
  title,
  open,
  onToggle,
  badge,
  className,
}: SectionHeaderProps) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className={cn(
        "flex w-full items-center justify-between py-3",
        className
      )}
    >
      <div className="flex items-center gap-2">
        {open ? (
          <ChevronDown className="size-3.5 text-gray-500" strokeWidth={2} />
        ) : (
          <ChevronRight className="size-3.5 text-gray-500" strokeWidth={2} />
        )}
        <span className="text-sm font-medium text-gray-800">{title}</span>
      </div>
      {badge && (
        <span
          className={cn(
            "rounded-md px-2.5 py-1 font-mono text-xs font-medium",
            badgeColorMap[badge.color ?? "brand"]
          )}
        >
          {badge.label}
        </span>
      )}
    </button>
  );
}
