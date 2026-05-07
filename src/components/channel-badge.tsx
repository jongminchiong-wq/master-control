import { cn } from "@/lib/utils";

interface ChannelBadgeProps {
  channel: "punchout" | "gep";
  className?: string;
}

export function ChannelBadge({ channel, className }: ChannelBadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-medium",
        channel === "gep"
          ? "bg-brand-50 text-brand-800"
          : "bg-accent-50 text-accent-800",
        className
      )}
    >
      {channel === "gep" ? "G" : "P"}
    </span>
  );
}
