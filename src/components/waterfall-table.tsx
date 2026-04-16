import { cn } from "@/lib/utils";
import { fmt } from "@/lib/business-logic/formatters";

interface WaterfallRow {
  label: string;
  val: number;
  color?: "brand" | "purple" | "accent" | "amber" | "danger" | "success" | "default";
  bold?: boolean;
}

interface WaterfallTableProps {
  title?: string;
  rows: WaterfallRow[];
  className?: string;
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

export function WaterfallTable({ title, rows, className }: WaterfallTableProps) {
  return (
    <div className={cn("rounded-xl bg-white p-5 shadow-sm ring-1 ring-gray-200", className)}>
      {title && (
        <p className="mb-3 text-[10px] font-medium uppercase tracking-wide text-gray-500">
          {title}
        </p>
      )}
      <table className="w-full border-collapse text-xs">
        <tbody>
          {rows.map((row, i) => (
            <tr
              key={i}
              className={cn(
                row.bold
                  ? "border-b-2 border-gray-200"
                  : "border-b border-gray-100"
              )}
            >
              <td
                className={cn(
                  "py-2 pr-2",
                  row.bold
                    ? "font-medium text-gray-800"
                    : "text-gray-600"
                )}
              >
                {row.label}
              </td>
              <td
                className={cn(
                  "py-2 text-right font-mono",
                  row.bold ? "font-medium" : "font-normal",
                  colorMap[row.color ?? "default"]
                )}
              >
                {row.val < 0
                  ? `(${fmt(Math.abs(row.val))})`
                  : fmt(row.val)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export type { WaterfallRow };
