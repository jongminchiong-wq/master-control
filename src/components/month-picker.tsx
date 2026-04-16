"use client";

import { cn } from "@/lib/utils";
import { fmtMonth } from "@/lib/business-logic/formatters";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface MonthPickerProps {
  months: string[];
  value: string;
  onChange: (month: string) => void;
  color?: "brand" | "accent" | "amber";
  className?: string;
}

const borderColorMap = {
  brand: "border-brand-400",
  accent: "border-accent-400",
  amber: "border-amber-400",
} as const;

const textColorMap = {
  brand: "text-brand-600",
  accent: "text-accent-600",
  amber: "text-amber-600",
} as const;

export function MonthPicker({
  months,
  value,
  onChange,
  color = "brand",
  className,
}: MonthPickerProps) {
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <span className="text-[10px] font-medium uppercase tracking-wide text-gray-500">
        Viewing
      </span>
      <Select value={value} onValueChange={(v) => { if (v) onChange(v); }}>
        <SelectTrigger
          className={cn(
            "h-9 rounded-lg border-2 bg-transparent font-sans text-sm font-medium",
            borderColorMap[color],
            textColorMap[color]
          )}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {months.map((m) => (
            <SelectItem key={m} value={m}>
              {fmtMonth(m)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
