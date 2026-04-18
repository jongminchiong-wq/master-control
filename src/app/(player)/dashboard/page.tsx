"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Tables } from "@/lib/supabase/types";
import { cn } from "@/lib/utils";
import { Check, Clock, ChevronDown, ChevronRight } from "lucide-react";

// Business logic
import { calcPOWaterfall } from "@/lib/business-logic/waterfall";
import type {
  Player as WaterfallPlayer,
  PurchaseOrder as WaterfallPO,
} from "@/lib/business-logic/waterfall";
import { getTier, getEUTiers } from "@/lib/business-logic/tiers";
import { PO_EU_C } from "@/lib/business-logic/constants";
import { fmt, getMonth, fmtMonth } from "@/lib/business-logic/formatters";

// Shared components
import { MetricCard } from "@/components/metric-card";
import { TierCard } from "@/components/tier-card";
import { ChannelBadge } from "@/components/channel-badge";
import { StatusBadge, type POStatus } from "@/components/status-badge";
import { SectionHeader } from "@/components/section-header";
import { MonthPicker } from "@/components/month-picker";

// UI components
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";

// ── Types ───────────────────────────────────────────────────

type DBPlayer = Tables<"players">;
type DBPO = Tables<"purchase_orders"> & {
  delivery_orders: Tables<"delivery_orders">[];
};

// ── DB → Business-logic mappers ─────────────────────────────

function toWaterfallPlayer(p: DBPlayer): WaterfallPlayer {
  return {
    id: p.id,
    euTierMode: p.eu_tier_mode ?? "A",
    introTierMode: p.intro_tier_mode ?? "A",
    introducedBy: p.introduced_by,
  };
}

function toWaterfallPO(po: DBPO): WaterfallPO {
  return {
    id: po.id,
    endUserId: po.end_user_id,
    poAmount: po.po_amount,
    poDate: po.po_date,
    channel: po.channel,
    dos: (po.delivery_orders ?? []).map((d) => ({
      amount: d.amount,
      delivery: d.delivery ?? "local",
      urgency: d.urgency ?? "normal",
    })),
  };
}

// ── PO status helper ────────────────────────────────────────

function getPOStatus(po: DBPO): POStatus {
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

// ── Commission status helper ────────────────────────────────

type CommStatus = "cleared" | "payable" | "pending";

function getCommissionStatus(po: DBPO): CommStatus {
  if (po.commissions_cleared) return "cleared";
  const dos = po.delivery_orders ?? [];
  const fullyPaid =
    dos.length > 0 && dos.every((d) => d.buyer_paid);
  if (fullyPaid) return "payable";
  return "pending";
}

const commStatusConfig: Record<
  CommStatus,
  { label: string; bg: string; text: string }
> = {
  cleared: { label: "Cleared", bg: "bg-success-50", text: "text-success-800" },
  payable: { label: "Payable", bg: "bg-amber-50", text: "text-amber-600" },
  pending: { label: "Pending", bg: "bg-gray-100", text: "text-gray-500" },
};

function CommissionStatusBadge({ status }: { status: CommStatus }) {
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

// ── DO status helper (player-facing — no supplier cost info) ──

type DOStatus = "paid" | "invoiced" | "delivered" | "supplier-paid" | "pending" | "overdue";

function getDOStatus(d: Tables<"delivery_orders">): DOStatus {
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

const doStatusConfig: Record<DOStatus, { label: string; bg: string; text: string }> = {
  paid:            { label: "Paid",          bg: "bg-success-50",  text: "text-success-800" },
  invoiced:        { label: "Invoiced",      bg: "bg-amber-50",    text: "text-amber-600" },
  delivered:       { label: "Delivered",     bg: "bg-purple-50",   text: "text-purple-800" },
  "supplier-paid": { label: "Processing",    bg: "bg-amber-50",    text: "text-amber-600" },
  pending:         { label: "Pending",       bg: "bg-gray-100",    text: "text-gray-500" },
  overdue:         { label: "Overdue",       bg: "bg-danger-50",   text: "text-danger-800" },
};

function DOStatusBadge({ status }: { status: DOStatus }) {
  const config = doStatusConfig[status];
  return (
    <span className={cn("inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-medium", config.bg, config.text)}>
      {config.label}
    </span>
  );
}

// ── Delivery mode label ─────────────────────────────────────

const deliveryLabel: Record<string, string> = {
  local: "Sarawak",
  sea: "Peninsular",
  international: "International",
};

// ── Payout timeline step component ──────────────────────────

type TimelineStepState = "done" | "current" | "future";

function TimelineStep({ label, state }: { label: string; state: TimelineStepState }) {
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
        {state === "done" ? <Check className="size-3" strokeWidth={2.5} /> : state === "current" ? <Clock className="size-3" strokeWidth={2.5} /> : null}
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
  return <div className={cn("mb-4 h-[1.5px] w-8", done ? "bg-success-200" : "bg-gray-200")} />;
}

function PayoutTimeline({ po }: { po: DBPO }) {
  const dos = po.delivery_orders ?? [];
  const hasDOs = dos.length > 0;
  const allDelivered = hasDOs && dos.every((d) => d.delivered);
  const allPaid = hasDOs && dos.every((d) => d.buyer_paid);
  const isCleared = !!po.commissions_cleared;

  // Determine which step is "current"
  let currentStep = 0; // 0 = PO Received
  if (hasDOs && !allDelivered) currentStep = 1;
  else if (allDelivered && !allPaid) currentStep = 2;
  else if (allPaid && !isCleared) currentStep = 3;
  else if (isCleared) currentStep = 4;

  function state(step: number): TimelineStepState {
    if (step < currentStep) return "done";
    if (step === currentStep) return hasDOs || step === 0 ? "current" : "future";
    return "future";
  }

  // If no DOs, PO Received is done, rest is future
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

function DOProgressBar({ dos }: { dos: Tables<"delivery_orders">[] }) {
  if (dos.length === 0) return null;
  const paidCount = dos.filter((d) => d.buyer_paid).length;
  return (
    <div className="mb-4 flex items-center gap-1.5 rounded-lg bg-gray-50 px-3.5 py-2.5 text-xs font-medium text-gray-600">
      <span className="font-mono font-semibold text-success-600">{paidCount}</span>
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

// ── Simplified commission breakdown ─────────────────────────

function SimplifiedCommission({
  poAmount,
  pool,
  euAmt,
  tierName,
  tierRate,
}: {
  poAmount: number;
  pool: number;
  euAmt: number;
  tierName: string;
  tierRate: number;
}) {
  const costsDeducted = poAmount - pool;
  return (
    <div className="rounded-lg border border-brand-100 bg-brand-50/40 px-5 py-4">
      <p className="mb-3 text-[10px] font-medium uppercase tracking-wide text-gray-500">
        How your commission is calculated
      </p>
      <div className="flex items-baseline justify-between border-b border-gray-200 py-1.5">
        <span className="text-xs font-medium text-gray-800">PO Amount</span>
        <span className="font-mono text-xs font-medium text-gray-800">{fmt(poAmount)}</span>
      </div>
      <div className="flex items-baseline justify-between border-b border-gray-200 py-1.5">
        <span className="text-xs text-gray-600">Costs deducted</span>
        <span className="font-mono text-xs font-medium text-danger-600">({fmt(costsDeducted)})</span>
      </div>
      <div className="flex items-baseline justify-between border-b border-gray-200 py-1.5">
        <span className="text-xs font-medium text-gray-800">Pool</span>
        <span className="font-mono text-xs font-medium text-accent-600">{fmt(pool)}</span>
      </div>
      <div className="mt-1 flex items-baseline justify-between border-t-2 border-gray-300 pt-2.5">
        <span className="text-xs font-medium text-brand-600">
          Your commission — {tierName} tier ({tierRate}%)
        </span>
        <span className="font-mono text-sm font-semibold text-brand-600">{fmt(euAmt)}</span>
      </div>
    </div>
  );
}

// ── Component ───────────────────────────────────────────────

export default function PlayerDashboardPage() {
  const supabase = useMemo(() => createClient(), []);

  // Data state
  const [myPlayer, setMyPlayer] = useState<DBPlayer | null>(null);
  const [allPlayers, setAllPlayers] = useState<DBPlayer[]>([]);
  const [allPOs, setAllPOs] = useState<DBPO[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorState, setErrorState] = useState<
    "not_authenticated" | "no_player" | null
  >(null);

  // UI state
  const [posOpen, setPosOpen] = useState(false);
  const [introOpen, setIntroOpen] = useState(false);
  const [expandedPOId, setExpandedPOId] = useState<string | null>(null);

  // Month selector
  const now = new Date();
  const currentMonth =
    now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0");
  const [selectedMonth, setSelectedMonth] = useState(currentMonth);

  // ── Data fetching ─────────────────────────────────────────

  const fetchData = useCallback(async () => {
    setLoading(true);

    // 1. Get authenticated user
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      setErrorState("not_authenticated");
      setLoading(false);
      return;
    }

    // 2. Find player record linked to this user
    const { data: playerData } = await supabase
      .from("players")
      .select("*")
      .eq("user_id", user.id)
      .single();

    if (!playerData) {
      setErrorState("no_player");
      setLoading(false);
      return;
    }

    setMyPlayer(playerData);

    // 3. Fetch all accessible players and POs (RLS filters to own data)
    const [playersRes, posRes] = await Promise.all([
      supabase
        .from("players")
        .select("*")
        .order("created_at", { ascending: true }),
      supabase
        .from("purchase_orders")
        .select("*, delivery_orders(*)")
        .order("po_date", { ascending: true }),
    ]);

    if (playersRes.data) setAllPlayers(playersRes.data);
    if (posRes.data) setAllPOs(posRes.data as DBPO[]);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // ── Computed: month list ──────────────────────────────────

  const availableMonths = useMemo(() => {
    const months = [
      ...new Set(allPOs.map((po) => getMonth(po.po_date)).filter(Boolean)),
    ]
      .sort()
      .reverse();
    if (!months.includes(currentMonth)) months.unshift(currentMonth);
    return months;
  }, [allPOs, currentMonth]);

  // ── Computed: waterfall-ready data ────────────────────────

  const wPlayers = useMemo(
    () => allPlayers.map(toWaterfallPlayer),
    [allPlayers]
  );
  const wAllPOs = useMemo(() => allPOs.map(toWaterfallPO), [allPOs]);

  // ── Computed: my POs this month ───────────────────────────

  const myMonthPOs = useMemo(() => {
    if (!myPlayer) return [];
    return allPOs.filter(
      (po) =>
        po.end_user_id === myPlayer.id &&
        getMonth(po.po_date) === selectedMonth
    );
  }, [allPOs, myPlayer, selectedMonth]);

  // ── Computed: per-PO waterfall results ────────────────────

  const myPOData = useMemo(() => {
    return myMonthPOs.map((po) => {
      const wPO = toWaterfallPO(po);
      const w = calcPOWaterfall(wPO, wPlayers, wAllPOs);
      const poStatus = getPOStatus(po);
      const commStatus = getCommissionStatus(po);
      return { po, waterfall: w, poStatus, commStatus };
    });
  }, [myMonthPOs, wPlayers, wAllPOs]);

  // ── Computed: totals ──────────────────────────────────────

  const myTotalPO = useMemo(
    () => myMonthPOs.reduce((s, po) => s + po.po_amount, 0),
    [myMonthPOs]
  );

  const myEUComm = useMemo(
    () => myPOData.reduce((s, d) => s + d.waterfall.euAmt, 0),
    [myPOData]
  );

  const clearedEUComm = useMemo(
    () =>
      myPOData
        .filter((d) => d.po.commissions_cleared)
        .reduce((s, d) => s + d.waterfall.euAmt, 0),
    [myPOData]
  );

  const pendingEUComm = myEUComm - clearedEUComm;

  // ── Computed: tier progress per channel ───────────────────

  const gepPOs = useMemo(
    () => myMonthPOs.filter((po) => po.channel === "gep"),
    [myMonthPOs]
  );
  const punchPOs = useMemo(
    () => myMonthPOs.filter((po) => po.channel === "punchout"),
    [myMonthPOs]
  );

  const gepTotal = gepPOs.reduce((s, po) => s + po.po_amount, 0);
  const punchTotal = punchPOs.reduce((s, po) => s + po.po_amount, 0);

  const gepTiers = PO_EU_C;
  const punchTiers = myPlayer
    ? getEUTiers(
        {
          euTierMode: myPlayer.eu_tier_mode ?? "A",
          introTierMode: myPlayer.intro_tier_mode ?? "A",
        },
        "punchout"
      )
    : PO_EU_C;

  const gepTier = getTier(gepTotal, gepTiers);
  const punchTier = getTier(punchTotal, punchTiers);

  // ── Computed: introducer earnings ─────────────────────────
  // Recruits = other players who have introduced_by = myPlayer.id

  const recruits = useMemo(() => {
    if (!myPlayer) return [];
    return allPlayers.filter((p) => p.introduced_by === myPlayer.id);
  }, [allPlayers, myPlayer]);

  const introData = useMemo(() => {
    if (recruits.length === 0) return [];
    return recruits.map((recruit) => {
      const recruitPOs = allPOs.filter(
        (po) =>
          po.end_user_id === recruit.id &&
          getMonth(po.po_date) === selectedMonth
      );
      const recruitTotalPO = recruitPOs.reduce(
        (s, po) => s + po.po_amount,
        0
      );
      const recruitIntroComm = recruitPOs.reduce((s, po) => {
        const wPO = toWaterfallPO(po);
        const w = calcPOWaterfall(wPO, wPlayers, wAllPOs);
        return s + w.introAmt;
      }, 0);
      const clearedIntroComm = recruitPOs
        .filter((po) => po.commissions_cleared)
        .reduce((s, po) => {
          const wPO = toWaterfallPO(po);
          const w = calcPOWaterfall(wPO, wPlayers, wAllPOs);
          return s + w.introAmt;
        }, 0);

      // Commission status per recruit
      const allFullyPaid =
        recruitPOs.length > 0 &&
        recruitPOs.every(
          (po) =>
            po.delivery_orders.length > 0 &&
            po.delivery_orders.every((d) => d.buyer_paid)
        );
      const allCleared =
        recruitPOs.length > 0 &&
        recruitPOs.every((po) => po.commissions_cleared);
      const commStatus: CommStatus = allCleared
        ? "cleared"
        : allFullyPaid
          ? "payable"
          : "pending";

      return {
        name: recruit.name,
        monthlyPO: recruitTotalPO,
        introComm: recruitIntroComm,
        clearedComm: clearedIntroComm,
        commStatus,
      };
    });
  }, [recruits, allPOs, selectedMonth, wPlayers, wAllPOs]);

  const totalIntroComm = introData.reduce((s, r) => s + r.introComm, 0);
  const clearedIntroComm = introData.reduce((s, r) => s + r.clearedComm, 0);
  const pendingIntroComm = totalIntroComm - clearedIntroComm;
  const totalComm = myEUComm + totalIntroComm;

  // ── Loading state ─────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <p className="text-sm text-gray-500">Loading dashboard...</p>
      </div>
    );
  }

  // ── Error states ──────────────────────────────────────────

  if (errorState === "not_authenticated") {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <p className="text-sm text-gray-500">
          You are not authenticated. Please log in.
        </p>
      </div>
    );
  }

  if (errorState === "no_player" || !myPlayer) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <div className="text-center">
          <p className="text-sm font-medium text-gray-700">
            No player record found
          </p>
          <p className="mt-1 text-xs text-gray-500">
            Your account is not linked to a player record. Contact your
            administrator.
          </p>
        </div>
      </div>
    );
  }

  // ── Render ────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* Header + Month Picker */}
      <div>
        <div className="flex justify-end">
          <MonthPicker
            months={availableMonths}
            value={selectedMonth}
            onChange={setSelectedMonth}
            color="brand"
          />
        </div>
        <h1 className="mt-3 text-base font-medium text-gray-800">
          Welcome, Player
        </h1>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-4 gap-3">
        <MetricCard
          label="Total PO This Month"
          value={fmt(myTotalPO)}
          subtitle={`${myMonthPOs.length} PO${myMonthPOs.length !== 1 ? "s" : ""}`}
          className="bg-brand-50 border border-brand-100"
        />
        <MetricCard
          label="Total Earnings"
          value={fmt(totalComm)}
          color="success"
          className="bg-success-50 border border-success-100"
        />
        <MetricCard label="EU Commission" value={fmt(myEUComm)} color="brand">
          <div className="mt-1 flex gap-2.5">
            <span className="text-[10px] font-medium text-success-600">
              Cleared {fmt(clearedEUComm)}
            </span>
            <span className="text-[10px] font-medium text-amber-600">
              Pending {fmt(pendingEUComm)}
            </span>
          </div>
        </MetricCard>
        <MetricCard
          label="Intro Commission"
          value={fmt(totalIntroComm)}
          color="purple"
        >
          <div className="mt-1 flex gap-2.5">
            <span className="text-[10px] font-medium text-success-600">
              Cleared {fmt(clearedIntroComm)}
            </span>
            <span className="text-[10px] font-medium text-amber-600">
              Pending {fmt(pendingIntroComm)}
            </span>
          </div>
        </MetricCard>
      </div>

      {/* Tier Progress Cards */}
      <div
        className={cn(
          "grid gap-3",
          punchTotal > 0 && gepTotal > 0 ? "grid-cols-2" : "grid-cols-1"
        )}
      >
        {punchTotal > 0 && (
          <div className="rounded-lg border border-accent-100 bg-white p-5">
            <div className="mb-4 flex items-center gap-2">
              <ChannelBadge channel="punchout" />
              <span className="text-xs text-gray-500">Tier Progress</span>
            </div>
            <TierCard
              tier={punchTier}
              tiers={punchTiers}
              volume={punchTotal}
              color="accent"
              label="of pool"
            />
          </div>
        )}
        {gepTotal > 0 && (
          <div className="rounded-lg border border-brand-100 bg-white p-5">
            <div className="mb-4 flex items-center gap-2">
              <ChannelBadge channel="gep" />
              <span className="text-xs text-gray-500">Tier Progress</span>
            </div>
            <TierCard
              tier={gepTier}
              tiers={gepTiers}
              volume={gepTotal}
              color="brand"
              label="of pool"
            />
          </div>
        )}
        {punchTotal === 0 && gepTotal === 0 && (
          <div className="rounded-lg border border-gray-200 bg-white p-8 text-center">
            <p className="text-xs text-gray-500">
              No POs this month. Your tier will show once you have POs.
            </p>
          </div>
        )}
      </div>

      {/* My POs — collapsible with expandable rows */}
      <div className="rounded-lg border border-gray-200 bg-white px-5 py-1">
        <SectionHeader
          title={`My POs (${myMonthPOs.length})`}
          open={posOpen}
          onToggle={() => setPosOpen((o) => !o)}
          badge={{ label: fmt(myEUComm), color: "brand" }}
        />
        {posOpen && (
          <div className="pb-4 pt-1">
            {myMonthPOs.length === 0 ? (
              <p className="py-6 text-center text-xs text-gray-500">
                No POs this month.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-6 text-[9px]" />
                    <TableHead className="text-[9px]">Ref</TableHead>
                    <TableHead className="text-[9px]">Channel</TableHead>
                    <TableHead className="text-[9px]">Date</TableHead>
                    <TableHead className="text-right text-[9px]">
                      PO Amount
                    </TableHead>
                    <TableHead className="text-right text-[9px]">
                      Commission
                    </TableHead>
                    <TableHead className="text-[9px]">PO Status</TableHead>
                    <TableHead className="text-[9px]">Comm Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {myPOData.map(({ po, waterfall: w, poStatus, commStatus }) => {
                    const isExpanded = expandedPOId === po.id;
                    const dos = po.delivery_orders ?? [];
                    return (
                      <>
                        <TableRow
                          key={po.id}
                          className={cn(
                            "cursor-pointer",
                            isExpanded && "bg-brand-50/30"
                          )}
                          onClick={() =>
                            setExpandedPOId(isExpanded ? null : po.id)
                          }
                        >
                          <TableCell className="w-6 pr-0">
                            {isExpanded ? (
                              <ChevronDown className="size-3.5 text-gray-500" strokeWidth={2} />
                            ) : (
                              <ChevronRight className="size-3.5 text-gray-500" strokeWidth={2} />
                            )}
                          </TableCell>
                          <TableCell
                            className={cn(
                              "font-mono text-xs font-medium",
                              po.channel === "gep"
                                ? "text-brand-600"
                                : "text-accent-600"
                            )}
                          >
                            {po.ref}
                          </TableCell>
                          <TableCell>
                            <ChannelBadge channel={po.channel} />
                          </TableCell>
                          <TableCell className="text-xs text-gray-500">
                            {po.po_date}
                          </TableCell>
                          <TableCell className="text-right font-mono text-xs font-medium">
                            {fmt(po.po_amount)}
                          </TableCell>
                          <TableCell className="text-right font-mono text-xs font-medium text-brand-600">
                            {fmt(w.euAmt)}
                          </TableCell>
                          <TableCell>
                            <StatusBadge status={poStatus} />
                          </TableCell>
                          <TableCell>
                            <CommissionStatusBadge status={commStatus} />
                          </TableCell>
                        </TableRow>

                        {/* Expanded detail row */}
                        {isExpanded && (
                          <TableRow key={`${po.id}_detail`} className="hover:bg-transparent">
                            <TableCell
                              colSpan={8}
                              className="border-b border-gray-200 bg-brand-50/15 px-2 pb-4 pt-0"
                            >
                              <div className="rounded-lg border border-gray-200 bg-white p-4">
                                {/* DO Progress Bar */}
                                <DOProgressBar dos={dos} />

                                {/* DO Mini-Table */}
                                {dos.length > 0 ? (
                                  <Table>
                                    <TableHeader>
                                      <TableRow>
                                        <TableHead className="text-[9px]">DO</TableHead>
                                        <TableHead className="text-[9px]">Items</TableHead>
                                        <TableHead className="text-[9px]">Delivery</TableHead>
                                        <TableHead className="text-[9px]">Status</TableHead>
                                      </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                      {dos.map((d) => (
                                        <TableRow key={d.id}>
                                          <TableCell
                                            className={cn(
                                              "font-mono text-[11px] font-semibold",
                                              po.channel === "gep" ? "text-brand-600" : "text-accent-600"
                                            )}
                                          >
                                            {d.ref}
                                          </TableCell>
                                          <TableCell className="text-[11px] text-gray-600">
                                            {d.description || "—"}
                                          </TableCell>
                                          <TableCell className="text-[11px] text-gray-500">
                                            {deliveryLabel[d.delivery ?? "local"] ?? d.delivery}
                                          </TableCell>
                                          <TableCell>
                                            <DOStatusBadge status={getDOStatus(d)} />
                                          </TableCell>
                                        </TableRow>
                                      ))}
                                    </TableBody>
                                  </Table>
                                ) : (
                                  <p className="py-4 text-center text-[11px] text-gray-400">
                                    Delivery orders will appear here once your PO is processed.
                                  </p>
                                )}

                                {/* Simplified Commission Breakdown */}
                                {po.po_amount > 0 && (
                                  <div className="mt-4">
                                    <SimplifiedCommission
                                      poAmount={po.po_amount}
                                      pool={w.pool}
                                      euAmt={w.euAmt}
                                      tierName={w.euTier.name}
                                      tierRate={w.euTier.rate}
                                    />
                                  </div>
                                )}

                                {/* Payout Timeline */}
                                <PayoutTimeline po={po} />
                              </div>
                            </TableCell>
                          </TableRow>
                        )}
                      </>
                    );
                  })}
                  {/* Total row */}
                  <TableRow className="border-t-2 border-gray-300">
                    <TableCell />
                    <TableCell
                      colSpan={3}
                      className="text-xs font-medium text-gray-800"
                    >
                      Total
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs font-medium text-gray-800">
                      {fmt(myTotalPO)}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs font-medium text-brand-600">
                      {fmt(myEUComm)}
                    </TableCell>
                    <TableCell colSpan={2} />
                  </TableRow>
                </TableBody>
              </Table>
            )}
          </div>
        )}
      </div>

      {/* Introducer Earnings — collapsible, only shown if recruits exist */}
      {recruits.length > 0 && (
        <div className="rounded-lg border border-gray-200 bg-white px-5 py-1">
          <SectionHeader
            title={`Introducer Earnings (${recruits.length} recruit${recruits.length !== 1 ? "s" : ""})`}
            open={introOpen}
            onToggle={() => setIntroOpen((o) => !o)}
            badge={{ label: fmt(totalIntroComm), color: "purple" }}
          />
          {introOpen && (
            <div className="pb-4 pt-1">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-[9px]">Recruit</TableHead>
                    <TableHead className="text-right text-[9px]">
                      Monthly PO
                    </TableHead>
                    <TableHead className="text-right text-[9px]">
                      Your Commission
                    </TableHead>
                    <TableHead className="text-[9px]">Comm Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {introData.map((r) => (
                    <TableRow key={r.name}>
                      <TableCell className="text-xs font-medium text-gray-800">
                        {r.name}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs">
                        {fmt(r.monthlyPO)}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs font-medium text-purple-600">
                        {fmt(r.introComm)}
                      </TableCell>
                      <TableCell>
                        <CommissionStatusBadge status={r.commStatus} />
                      </TableCell>
                    </TableRow>
                  ))}
                  {/* Total row */}
                  <TableRow className="border-t-2 border-gray-300">
                    <TableCell className="text-xs font-medium text-gray-800">
                      Total
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs font-medium text-gray-800">
                      {fmt(introData.reduce((s, r) => s + r.monthlyPO, 0))}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs font-medium text-purple-600">
                      {fmt(totalIntroComm)}
                    </TableCell>
                    <TableCell />
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
