"use client";

import { Check, Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Tables } from "@/lib/supabase/types";

import { fmt, fmtSigned } from "@/lib/business-logic/formatters";
import type {
  Player as WaterfallPlayer,
  PurchaseOrder as WaterfallPO,
} from "@/lib/business-logic/waterfall";

// ── Types ───────────────────────────────────────────────────

export type DBPlayer = Tables<"players">;
export type DBPO = Tables<"purchase_orders"> & {
  delivery_orders: Tables<"delivery_orders">[];
};
export type DBLossDebit = Tables<"player_loss_debits">;
export type DBCommission = Tables<"player_commissions">;

// ── DB → Business-logic mappers ─────────────────────────────

export function toWaterfallPlayer(p: DBPlayer): WaterfallPlayer {
  return {
    id: p.id,
    euTierModeProxy: p.eu_tier_mode_proxy,
    euTierModeGrid: p.eu_tier_mode_grid,
    introTierModeProxy: p.intro_tier_mode_proxy,
    introTierModeGrid: p.intro_tier_mode_grid,
    introducedBy: p.introduced_by,
  };
}

export function toWaterfallPO(po: DBPO): WaterfallPO {
  return {
    id: po.id,
    endUserId: po.end_user_id,
    poAmount: po.po_amount,
    poDate: po.po_date,
    channel: po.channel,
    dos: (po.delivery_orders ?? []).map((d) => ({
      amount: d.amount,
      delivery: d.delivery ?? "local",
    })),
    otherCost: po.other_cost,
  };
}

// ── PO status helper ────────────────────────────────────────

import type { POStatus } from "@/components/status-badge";

export function getPOStatus(po: DBPO): POStatus {
  const dos = po.delivery_orders ?? [];
  if (po.commissions_cleared) return "cleared";
  if (dos.length === 0) return "no-dos";
  const allPaid = dos.every((d) => d.buyer_paid);
  if (allPaid) return "fully-paid";
  const anyOverdue = dos.some((d) => {
    if (d.buyer_paid) return false;
    if (d.invoiced) {
      const due = new Date(new Date(d.invoiced).getTime() + 60 * 86400000);
      return new Date() > due;
    }
    return false;
  });
  if (anyOverdue) return "overdue";
  const somePaid = dos.some((d) => d.buyer_paid);
  if (somePaid) return "partial";
  const someInvoiced = dos.some((d) => d.invoiced);
  if (someInvoiced) return "invoiced";
  const someDelivered = dos.some((d) => d.delivered);
  if (someDelivered) return "delivered";
  const someSupplierPaid = dos.some((d) => d.supplier_paid);
  if (someSupplierPaid) return "supplier-paid";
  return "active";
}

// ── DO status helper (player-facing — no supplier cost info) ──

export type DOStatus =
  | "paid"
  | "invoiced"
  | "delivered"
  | "supplier-paid"
  | "pending"
  | "overdue";

export function getDOStatus(d: Tables<"delivery_orders">): DOStatus {
  if (d.buyer_paid) return "paid";
  if (d.invoiced) {
    const due = new Date(new Date(d.invoiced).getTime() + 60 * 86400000);
    if (new Date() > due) return "overdue";
    return "invoiced";
  }
  if (d.delivered) return "delivered";
  if (d.supplier_paid) return "supplier-paid";
  return "pending";
}

const doStatusConfig: Record<
  DOStatus,
  { label: string; bg: string; text: string }
> = {
  paid: { label: "Paid", bg: "bg-success-50", text: "text-success-800" },
  invoiced: { label: "Invoiced", bg: "bg-amber-50", text: "text-amber-600" },
  delivered: { label: "Delivered", bg: "bg-purple-50", text: "text-purple-800" },
  "supplier-paid": {
    label: "Processing",
    bg: "bg-amber-50",
    text: "text-amber-600",
  },
  pending: { label: "Pending", bg: "bg-gray-100", text: "text-gray-500" },
  overdue: { label: "Overdue", bg: "bg-danger-50", text: "text-danger-800" },
};

export function DOStatusBadge({ status }: { status: DOStatus }) {
  const config = doStatusConfig[status];
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

// ── Delivery mode label ─────────────────────────────────────

export const deliveryLabel: Record<string, string> = {
  local: "Sarawak",
  sea: "Peninsular",
  international: "International",
};

// ── Payout timeline ─────────────────────────────────────────

type TimelineStepState = "done" | "current" | "future";

function TimelineStep({
  label,
  state,
}: {
  label: string;
  state: TimelineStepState;
}) {
  return (
    <div className="flex flex-1 flex-col items-center gap-1 text-center">
      <div
        className={cn(
          "flex size-6 items-center justify-center rounded-full border-[1.5px] text-[11px] font-medium",
          state === "done" && "border-success-100 bg-success-50 text-success-600",
          state === "current" && "border-amber-100 bg-amber-50 text-amber-600",
          state === "future" && "border-gray-200 bg-gray-100 text-gray-400"
        )}
      >
        {state === "done" ? (
          <Check className="size-3" strokeWidth={2.5} />
        ) : state === "current" ? (
          <Clock className="size-3" strokeWidth={2.5} />
        ) : null}
      </div>
      <span
        className={cn(
          "text-[9px] font-medium",
          state === "done" && "text-success-600",
          state === "current" && "text-amber-600",
          state === "future" && "text-gray-500"
        )}
      >
        {label}
      </span>
    </div>
  );
}

function TimelineLine({ done }: { done: boolean }) {
  return (
    <div
      className={cn(
        "mb-4 h-[1.5px] w-8",
        done ? "bg-success-200" : "bg-gray-200"
      )}
    />
  );
}

export function PayoutTimeline({ po }: { po: DBPO }) {
  const dos = po.delivery_orders ?? [];
  const hasDOs = dos.length > 0;
  const allDelivered = hasDOs && dos.every((d) => d.delivered);
  const allPaid = hasDOs && dos.every((d) => d.buyer_paid);
  const isCleared = !!po.commissions_cleared;

  let currentStep = 0;
  if (hasDOs && !allDelivered) currentStep = 1;
  else if (allDelivered && !allPaid) currentStep = 2;
  else if (allPaid && !isCleared) currentStep = 3;
  else if (isCleared) currentStep = 5;

  function state(step: number): TimelineStepState {
    if (step < currentStep) return "done";
    if (step === currentStep) return hasDOs || step === 0 ? "current" : "future";
    return "future";
  }

  const s = hasDOs
    ? state
    : (step: number): TimelineStepState => (step === 0 ? "done" : "future");

  return (
    <div className="mt-4 flex items-center rounded-lg bg-gray-50 px-4 py-3">
      <TimelineStep label="PO Received" state={s(0)} />
      <TimelineLine done={s(1) === "done" || s(1) === "current"} />
      <TimelineStep label="All Delivered" state={s(1)} />
      <TimelineLine done={s(2) === "done" || s(2) === "current"} />
      <TimelineStep label="All Paid" state={s(2)} />
      <TimelineLine done={s(3) === "done" || s(3) === "current"} />
      <TimelineStep label="Payable" state={s(3)} />
      <TimelineLine done={s(4) === "done"} />
      <TimelineStep label="Cleared" state={s(4)} />
    </div>
  );
}

// ── DO Progress bar ─────────────────────────────────────────

export function DOProgressBar({
  dos,
}: {
  dos: Tables<"delivery_orders">[];
}) {
  if (dos.length === 0) return null;
  const paidCount = dos.filter((d) => d.buyer_paid).length;
  return (
    <div className="mb-4 flex items-center gap-1.5 rounded-lg bg-gray-50 px-3.5 py-2.5 text-xs font-medium text-gray-600">
      <span className="font-mono font-semibold text-success-600">
        {paidCount}
      </span>
      <span>of</span>
      <span className="font-mono font-semibold">{dos.length}</span>
      <span>deliveries paid</span>
      <div className="ml-2 flex flex-1 gap-0.5">
        {dos.map((d) => {
          const st = getDOStatus(d);
          return (
            <div
              key={d.id}
              className={cn(
                "h-1.5 flex-1 rounded-full",
                st === "paid" && "bg-success-400",
                st === "invoiced" && "bg-amber-100",
                st === "overdue" && "bg-danger-200",
                st === "delivered" && "bg-purple-100",
                (st === "pending" || st === "supplier-paid") && "bg-gray-200"
              )}
            />
          );
        })}
      </div>
    </div>
  );
}

// ── Simplified commission breakdown (player) ────────────────

export function SimplifiedCommission({
  poAmount,
  pool,
  commission,
  tierName,
  tierRate,
}: {
  poAmount: number;
  pool: number;
  // Net player commission: euAmt - playerLossShare. When the PO is profitable
  // playerLossShare is 0 and this equals the unclamped euAmt; when the PO is
  // a loss euAmt is clamped to 0 and this equals -playerLossShare, so the
  // line at the bottom mirrors pool × tierRate.
  commission: number;
  tierName: string;
  tierRate: number;
}) {
  const costsDeducted = poAmount - pool;
  const isLoss = commission < 0;
  return (
    <div className="rounded-lg border border-brand-100 bg-brand-50/40 px-5 py-4">
      <p className="mb-3 text-[10px] font-medium uppercase tracking-wide text-gray-500">
        How your commission is calculated
      </p>
      <div className="flex items-baseline justify-between border-b border-gray-200 py-1.5">
        <span className="text-xs font-medium text-gray-800">PO Amount</span>
        <span className="font-mono text-xs font-medium text-gray-800">
          {fmt(poAmount)}
        </span>
      </div>
      <div className="flex items-baseline justify-between border-b border-gray-200 py-1.5">
        <span className="text-xs text-gray-600">
          Total cost — supplier COGS, risk buffer, transport, etc.
        </span>
        <span className="font-mono text-xs font-medium text-danger-600">
          ({fmt(costsDeducted)})
        </span>
      </div>
      <div className="flex items-baseline justify-between border-b border-gray-200 py-1.5">
        <span className="text-xs font-medium text-gray-800">Pool</span>
        <span className="font-mono text-xs font-medium text-accent-600">
          {fmt(pool)}
        </span>
      </div>
      <div className="mt-1 flex items-baseline justify-between border-t-2 border-gray-300 pt-2.5">
        <span
          className={cn(
            "text-xs font-medium",
            isLoss ? "text-danger-600" : "text-brand-600"
          )}
        >
          Your {isLoss ? "loss share" : "commission"} — {tierName} tier (
          {tierRate}%)
        </span>
        <span
          className={cn(
            "font-mono text-sm font-semibold",
            isLoss ? "text-danger-600" : "text-brand-600"
          )}
        >
          {fmtSigned(commission)}
        </span>
      </div>
    </div>
  );
}

// ── Simplified intro commission breakdown ───────────────────

export function SimplifiedIntroCommission({
  poAmount,
  pool,
  commission,
  tierName,
  tierRate,
}: {
  poAmount: number;
  pool: number;
  // Net intro commission: introAmt - introducerLossShare. When the PO is
  // profitable introducerLossShare is 0 and this equals the unclamped
  // introAmt; when the PO is a loss introAmt is clamped to 0 and this
  // equals -introducerLossShare, so the bottom line surfaces the loss
  // instead of hiding it as RM 0.
  commission: number;
  tierName: string;
  tierRate: number;
}) {
  const costsDeducted = poAmount - pool;
  const isLoss = commission < 0;
  return (
    <div className="rounded-lg border border-purple-100 bg-purple-50/30 px-5 py-4">
      <p className="mb-3 text-[10px] font-medium uppercase tracking-wide text-gray-500">
        How your intro commission is calculated
      </p>
      <div className="flex items-baseline justify-between border-b border-gray-200 py-1.5">
        <span className="text-xs font-medium text-gray-800">PO Amount</span>
        <span className="font-mono text-xs font-medium text-gray-800">
          {fmt(poAmount)}
        </span>
      </div>
      <div className="flex items-baseline justify-between border-b border-gray-200 py-1.5">
        <span className="text-xs text-gray-600">
          Total cost — supplier COGS, risk buffer, transport, etc.
        </span>
        <span className="font-mono text-xs font-medium text-danger-600">
          ({fmt(costsDeducted)})
        </span>
      </div>
      <div className="flex items-baseline justify-between border-b border-gray-200 py-1.5">
        <span className="text-xs font-medium text-gray-800">Pool</span>
        <span className="font-mono text-xs font-medium text-accent-600">
          {fmt(pool)}
        </span>
      </div>
      <div className="mt-1 flex items-baseline justify-between border-t-2 border-gray-300 pt-2.5">
        <span
          className={cn(
            "text-xs font-medium",
            isLoss ? "text-danger-600" : "text-purple-600"
          )}
        >
          Your {isLoss ? "loss share" : "intro commission"} — {tierName} tier (
          {tierRate}%)
        </span>
        <span
          className={cn(
            "font-mono text-sm font-semibold",
            isLoss ? "text-danger-600" : "text-purple-600"
          )}
        >
          {fmtSigned(commission)}
        </span>
      </div>
    </div>
  );
}
