import { AlertTriangle, CheckCircle, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import { fmt } from "@/lib/business-logic/formatters";

interface HealthCheckProps {
  entityNet: number;
  className?: string;
}

export function HealthCheck({ entityNet, className }: HealthCheckProps) {
  if (entityNet <= 0) {
    return (
      <div
        className={cn(
          "flex items-start gap-2 rounded-lg border border-danger-100 bg-danger-50 px-4 py-3 text-xs text-danger-600",
          className
        )}
      >
        <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
        <span>
          Entity is in the red at {fmt(entityNet)}/month. Reduce costs or
          increase volume.
        </span>
      </div>
    );
  }

  if (entityNet < 2000) {
    return (
      <div
        className={cn(
          "flex items-start gap-2 rounded-lg border border-amber-100 bg-amber-50 px-4 py-3 text-xs text-amber-600",
          className
        )}
      >
        <Zap className="mt-0.5 size-3.5 shrink-0" />
        <span>
          Entity nets {fmt(entityNet)}/month — tight. Watch the margins.
        </span>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex items-start gap-2 rounded-lg border border-success-100 bg-success-50 px-4 py-3 text-xs text-success-600",
        className
      )}
    >
      <CheckCircle className="mt-0.5 size-3.5 shrink-0" />
      <span>Entity nets {fmt(entityNet)}/month — healthy.</span>
    </div>
  );
}
