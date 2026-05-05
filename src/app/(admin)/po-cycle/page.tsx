"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import {
  Plus,
  Trash2,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { Tables, TablesUpdate } from "@/lib/supabase/types";
import { cn } from "@/lib/utils";

// Business logic
import { calcPOWaterfall } from "@/lib/business-logic/waterfall";
import type {
  Player as WaterfallPlayer,
  PurchaseOrder as WaterfallPO,
} from "@/lib/business-logic/waterfall";
import { calcBufferPct } from "@/lib/business-logic/risk-buffer";
import { INV_RATE, DELIVERY_MODES } from "@/lib/business-logic/constants";
import { fmt, fmtSigned, getMonth, fmtMonth } from "@/lib/business-logic/formatters";
import { useSelectedMonth } from "@/lib/hooks/use-selected-month";
import {
  creditPOReturns,
  creditIntroducerCommissions,
  creditPlayerCommissions,
  creditPlayerLossDebits,
} from "@/lib/business-logic/credit";
import { buildCapitalEvents } from "@/lib/business-logic/capital-events";
import type {
  DeploymentInvestor,
  DeploymentPO,
} from "@/lib/business-logic/deployment";

// Shared components
import { MetricCard } from "@/components/metric-card";
import { ChannelBadge } from "@/components/channel-badge";
import { StatusBadge, type POStatus } from "@/components/status-badge";
import { MonthPicker } from "@/components/month-picker";
import { WaterfallTable, type WaterfallRow } from "@/components/waterfall-table";

// UI components
import { Button } from "@/components/ui/button";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

// ── Types ───────────────────────────────────────────────────

type DBPlayer = Tables<"players">;
type DBDO = Tables<"delivery_orders">;
type DBPO = Tables<"purchase_orders"> & {
  delivery_orders: DBDO[];
};

// ── DB → Business-logic mappers ─────────────────────────────

function toWaterfallPlayer(p: DBPlayer): WaterfallPlayer {
  return {
    id: p.id,
    euTierModeProxy: p.eu_tier_mode_proxy,
    euTierModeGrid: p.eu_tier_mode_grid,
    introTierModeProxy: p.intro_tier_mode_proxy,
    introTierModeGrid: p.intro_tier_mode_grid,
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
    })),
    otherCost: po.other_cost,
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

// ── DO status helper ────────────────────────────────────────

type DOStatus = "paid" | "overdue" | "invoiced" | "delivered" | "supplier-paid" | "pending";

function getDOStatus(d: DBDO): DOStatus {
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
  paid: { label: "Paid", bg: "bg-success-50", text: "text-success-800" },
  overdue: { label: "Overdue", bg: "bg-danger-50", text: "text-danger-800" },
  invoiced: { label: "Invoiced", bg: "bg-amber-50", text: "text-amber-600" },
  delivered: { label: "Delivered", bg: "bg-purple-50", text: "text-purple-800" },
  "supplier-paid": { label: "Supplier Paid", bg: "bg-amber-50", text: "text-amber-600" },
  pending: { label: "Pending", bg: "bg-gray-100", text: "text-gray-500" },
};

// ── Pipeline stage definitions ──────────────────────────────

interface StageInfo {
  name: string;
  color: string;
  borderColor: string;
  description: string;
  matchStatuses: POStatus[];
}

const STAGES: StageInfo[] = [
  {
    name: "PO Received",
    color: "text-brand-600",
    borderColor: "border-l-brand-400",
    description: "No DOs yet",
    matchStatuses: ["active", "no-dos"],
  },
  {
    name: "In Progress",
    color: "text-amber-600",
    borderColor: "border-l-amber-400",
    description: "Supplier paid / Delivered",
    matchStatuses: ["supplier-paid", "delivered"],
  },
  {
    name: "Invoiced",
    color: "text-amber-600",
    borderColor: "border-l-amber-400",
    description: "Awaiting payment",
    matchStatuses: ["invoiced", "overdue"],
  },
  {
    name: "Partial",
    color: "text-purple-600",
    borderColor: "border-l-purple-400",
    description: "Some DOs paid",
    matchStatuses: ["partial"],
  },
  {
    name: "Fully Paid",
    color: "text-accent-600",
    borderColor: "border-l-accent-400",
    description: "All DOs paid",
    matchStatuses: ["fully-paid"],
  },
  {
    name: "Cleared",
    color: "text-success-600",
    borderColor: "border-l-success-400",
    description: "Commissions cleared",
    matchStatuses: ["cleared"],
  },
];

// ── Component ───────────────────────────────────────────────

export default function POCyclePage() {
  return <Suspense><POCyclePageContent /></Suspense>;
}

function POCyclePageContent() {
  const supabase = useMemo(() => createClient(), []);

  // Data state
  const [players, setPlayers] = useState<DBPlayer[]>([]);
  const [allPOs, setAllPOs] = useState<DBPO[]>([]);
  // Investor join dates — used only to widen the month-picker so a late
  // joiner's backfill month (which may have no PO originated in it) is
  // selectable. We don't need the full investor records here.
  const [investorJoinDates, setInvestorJoinDates] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  // UI state
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [confirmDeletePOId, setConfirmDeletePOId] = useState<string | null>(null);
  const [confirmDeleteDOId, setConfirmDeleteDOId] = useState<string | null>(null);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [saving, setSaving] = useState(false);

  // Filters
  const [filterChannel, setFilterChannel] = useState("__all__");
  const [filterEU, setFilterEU] = useState("__all__");
  const [filterStatus, setFilterStatus] = useState("__all__");

  // Month selector (URL-driven, shared across admin pages)
  const [selectedMonth, setSelectedMonth] = useSelectedMonth();

  // PO form state
  const emptyPOForm = {
    end_user_id: "",
    channel: "punchout" as "punchout" | "gep",
    po_date: "",
    po_amount: "",
    description: "",
    note: "",
  };
  const [poForm, setPOForm] = useState(emptyPOForm);

  // DO form state
  const emptyDOForm = {
    description: "",
    amount: "",
    delivery: "local" as "local" | "sea" | "international",
  };
  const [doForm, setDOForm] = useState(emptyDOForm);

  // ── Data fetching ───────────────────────────────────────

  const fetchData = useCallback(async () => {
    setLoading(true);
    const [playersRes, posRes, investorsRes] = await Promise.all([
      supabase
        .from("players")
        .select("*")
        .order("created_at", { ascending: true }),
      supabase
        .from("purchase_orders")
        .select("*, delivery_orders(*)")
        .order("po_date", { ascending: false }),
      supabase.from("investors").select("date_joined"),
    ]);
    if (playersRes.data) setPlayers(playersRes.data);
    if (posRes.data) setAllPOs(posRes.data as DBPO[]);
    if (investorsRes.data) {
      setInvestorJoinDates(
        investorsRes.data
          .map((i) => i.date_joined)
          .filter((d): d is string => !!d)
      );
    }
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // ── Computed data ─────────────────────────────────────────

  const availableMonths = useMemo(() => {
    const now = new Date();
    const currentMonth =
      now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0");
    // Include both PO months and investor-join months so the picker offers
    // months where a backfill deployment would surface (deployedAt =
    // inv.dateJoined) even if no PO originated in that month.
    const months = [
      ...new Set([
        ...allPOs.map((po) => getMonth(po.po_date)),
        ...investorJoinDates.map((d) => getMonth(d)),
      ].filter(Boolean)),
    ]
      .sort()
      .reverse();
    if (!months.includes(currentMonth)) months.unshift(currentMonth);
    if (!months.includes(selectedMonth)) months.unshift(selectedMonth);
    return months;
  }, [allPOs, investorJoinDates, selectedMonth]);

  const monthPOs = useMemo(
    () => allPOs.filter((po) => getMonth(po.po_date) === selectedMonth),
    [allPOs, selectedMonth]
  );

  // Map to waterfall shapes (full dataset for cumulative tier calc)
  const wPlayers = useMemo(() => players.map(toWaterfallPlayer), [players]);
  const wAllPOs = useMemo(() => allPOs.map(toWaterfallPO), [allPOs]);

  // Pipeline stage counts
  const stageData = useMemo(() => {
    return STAGES.map((stage) => {
      const matched = monthPOs.filter((po) =>
        stage.matchStatuses.includes(getPOStatus(po))
      );
      const overdueCount =
        stage.name === "Invoiced"
          ? matched.filter((po) => getPOStatus(po) === "overdue").length
          : 0;
      return {
        ...stage,
        count: matched.length,
        value: matched.reduce((s, po) => s + po.po_amount, 0),
        overdueCount,
      };
    });
  }, [monthPOs]);

  // Summary metrics
  const totalPOs = monthPOs.length;
  const totalValue = useMemo(
    () => monthPOs.reduce((s, po) => s + po.po_amount, 0),
    [monthPOs]
  );

  // Filtered POs
  const filteredPOs = useMemo(() => {
    return monthPOs.filter((po) => {
      if (filterChannel !== "__all__" && po.channel !== filterChannel) return false;
      if (filterEU !== "__all__" && po.end_user_id !== filterEU) return false;
      if (filterStatus !== "__all__") {
        const status = getPOStatus(po);
        switch (filterStatus) {
          case "poreceived":
            if (status !== "active" && status !== "no-dos") return false;
            break;
          case "inprogress":
            if (status !== "supplier-paid" && status !== "delivered") return false;
            break;
          case "invoiced":
            if (status !== "invoiced" && status !== "overdue") return false;
            break;
          case "partial":
            if (status !== "partial") return false;
            break;
          case "fullypaid":
            if (status !== "fully-paid") return false;
            break;
          case "cleared":
            if (status !== "cleared") return false;
            break;
          case "overdue":
            if (status !== "overdue") return false;
            break;
          case "active":
            if (status === "cleared") return false;
            break;
        }
      }
      return true;
    });
  }, [monthPOs, filterChannel, filterEU, filterStatus]);

  // ── Auto-generate PO ref ──────────────────────────────────

  const nextRef = useMemo(() => {
    // Find max ref number across all POs (not just this month)
    let maxNum = 0;
    for (const po of allPOs) {
      const match = po.ref.match(/\d+$/);
      if (match) {
        const num = parseInt(match[0], 10);
        if (num > maxNum) maxNum = num;
      }
    }
    return maxNum + 1;
  }, [allPOs]);

  // ── CRUD: Purchase Orders ─────────────────────────────────

  async function handleAddPO() {
    if (!poForm.end_user_id || !poForm.po_date || !poForm.po_amount) return;
    setSaving(true);

    const prefix = poForm.channel === "gep" ? "GRID-" : "PRX-";
    const ref = prefix + String(nextRef).padStart(3, "0");

    await supabase.from("purchase_orders").insert({
      ref,
      channel: poForm.channel,
      end_user_id: poForm.end_user_id,
      po_date: poForm.po_date,
      po_amount: parseFloat(poForm.po_amount) || 0,
      description: poForm.description.trim() || null,
      note: poForm.note.trim() || null,
    });

    setPOForm(emptyPOForm);
    setShowAddDialog(false);
    setSaving(false);
    fetchData();
  }

  async function handleDeletePO(poId: string) {
    await supabase.from("purchase_orders").delete().eq("id", poId);
    setConfirmDeletePOId(null);
    if (expandedId === poId) setExpandedId(null);
    fetchData();
  }

  async function handleUpdatePOMeta(
    poId: string,
    field: "description" | "note" | "other_cost" | "other_cost_reason",
    value: string | number,
  ) {
    let next: string | number | null;
    if (field === "other_cost") {
      next = typeof value === "number" ? value : parseFloat(value) || 0;
    } else if (typeof value === "string") {
      next = value.trim() === "" ? null : value;
    } else {
      next = value;
    }
    const update: TablesUpdate<"purchase_orders"> =
      field === "other_cost"
        ? { other_cost: next as number }
        : field === "description"
          ? { description: next as string | null }
          : field === "note"
            ? { note: next as string | null }
            : { other_cost_reason: next as string | null };
    await supabase.from("purchase_orders").update(update).eq("id", poId);
    setAllPOs((prev) =>
      prev.map((po) => (po.id === poId ? { ...po, [field]: next } : po)),
    );
  }

  async function handleUpdateCommissionsCleared(poId: string, date: string) {
    await supabase
      .from("purchase_orders")
      .update({ commissions_cleared: date || null })
      .eq("id", poId);
    // Optimistic update
    setAllPOs((prev) =>
      prev.map((po) =>
        po.id === poId
          ? { ...po, commissions_cleared: date || null }
          : po
      )
    );

    // Sync ledger timestamps to the new clear date. The credit RPCs are
    // idempotent (ON CONFLICT DO NOTHING), so they won't update an
    // existing player_commissions / player_loss_debits row when the
    // admin edits the cleared date. Without this sync, the ledger keeps
    // the original clear date forever — and the dashboard / withdrawals
    // statement would attribute the row to whatever month that original
    // date fell in. Skipped on un-clear (date === "") so the rows stay
    // as a record of the historical clear.
    if (date) {
      const clearedAtIso = `${date}T00:00:00Z`;
      await Promise.all([
        supabase
          .from("player_commissions")
          .update({ created_at: clearedAtIso })
          .eq("po_id", poId),
        supabase
          .from("player_loss_debits")
          .update({ cleared_at: clearedAtIso })
          .eq("po_id", poId),
      ]);
    }

    // Fire investor credits inline on clear. This replaces the old "admin
    // must visit the Investors page for the auto-fire effect to run" path,
    // which was landing return_credits rows with now() instead of the
    // actual clear date — producing the timestamp drift diagnosed in
    // plans/screenshot-1-n-2-stateless-hummingbird.md. The Investors-page
    // auto-fire still runs as a safety net for clears that slip past this
    // path (direct SQL, older client sessions, etc.); the RPC is idempotent
    // via UNIQUE(investor_id, po_id) so redundant fires are no-ops.
    if (!date) return;
    try {
      const [
        investorsRes,
        depositsRes,
        withdrawalsRes,
        adjustmentsRes,
        rcRes,
        icRes,
      ] = await Promise.all([
        supabase.from("investors").select("*"),
        supabase.from("deposits").select("*"),
        supabase.from("withdrawals").select("*"),
        supabase.from("admin_adjustments").select("*"),
        supabase.from("return_credits").select("*"),
        supabase.from("introducer_credits").select("*"),
      ]);

      if (!investorsRes.data) return;

      const dInvestors: DeploymentInvestor[] = investorsRes.data.map((i) => ({
        id: i.id,
        name: i.name,
        capital: i.capital,
        dateJoined: i.date_joined ?? "",
      }));
      // Lookup tables for the introducer-credit pass — we need both the
      // introducer chain and the live capital snapshot to compute tier.
      const introducedByMap = new Map<string, string | null>();
      const capitalById = new Map<string, number>();
      for (const i of investorsRes.data) {
        introducedByMap.set(i.id, i.introduced_by);
        capitalById.set(i.id, i.capital);
      }
      // Pool-wide PO list for the allocator — mirrors the admin Entity page
      // (all POs up to horizon, since late clears can affect older months).
      const dPOs: DeploymentPO[] = allPOs.map((po) => ({
        id: po.id,
        ref: po.ref,
        poDate: po.po_date,
        poAmount: po.po_amount,
        channel: po.channel,
        dos: (po.delivery_orders ?? []).map((d) => ({ buyerPaid: d.buyer_paid })),
        commissionsCleared:
          po.id === poId ? date : po.commissions_cleared,
      }));
      // Patch in the optimistic commissions_cleared date so any existing
      // return_credits for this PO (e.g. a stale row from a prior clear +
      // undo cycle) get dated at the fresh clear date — matches how dPOs
      // above injects the same optimistic value for the allocator.
      const patchedPOs = allPOs.map((po) =>
        po.id === poId ? { ...po, commissions_cleared: date } : po
      );
      const capitalEvents = buildCapitalEvents({
        deposits: depositsRes.data ?? [],
        withdrawals: withdrawalsRes.data ?? [],
        adminAdjustments: adjustmentsRes.data ?? [],
        returnCredits: rcRes.data ?? [],
        introducerCredits: icRes.data ?? [],
        pos: patchedPOs,
      });

      const result = await creditPOReturns({
        supabase,
        poId,
        clearDate: date,
        investors: dInvestors,
        poolPOs: dPOs,
        capitalEvents,
      });

      for (const err of result.errors) {
        console.error("Credit RPC error on PO clear:", err);
      }

      // Same flow for introducer commissions — must run after the investor
      // returns are credited so the introducer's tier reflects any
      // reinvestment that just happened from this PO.
      const introResult = await creditIntroducerCommissions({
        supabase,
        poId,
        clearDate: date,
        investors: dInvestors,
        introducedBy: introducedByMap,
        capitalById,
        poolPOs: dPOs,
        capitalEvents,
      });

      for (const err of introResult.errors) {
        console.error("Introducer credit RPC error on PO clear:", err);
      }

      // Player-side ledger (migration 015). Independent of investor flow:
      // a failure here doesn't roll back the investor credits above and
      // vice versa. Idempotent on (player, po, type).
      const wPlayers = players.map(toWaterfallPlayer);
      const wPOs = patchedPOs.map(toWaterfallPO);
      const playerResult = await creditPlayerCommissions({
        supabase,
        poId,
        clearDate: date,
        players: wPlayers,
        pos: wPOs,
      });
      for (const err of playerResult.errors) {
        console.error("Player commission RPC error on PO clear:", err);
      }

      // Loss debits when supplier cost > PO amount (Phase 2). Idempotent
      // and independent of the profit-side credit above — a failure here
      // does not roll back commissions or investor returns.
      const lossResult = await creditPlayerLossDebits({
        supabase,
        poId,
        clearDate: date,
        players: wPlayers,
        pos: wPOs,
      });
      for (const err of lossResult.errors) {
        console.error("Player loss debit RPC error on PO clear:", err);
      }
    } catch (err) {
      // Non-fatal: the PO is still marked cleared. Investors-page auto-fire
      // will catch up next time that page loads.
      console.error("Inline credit-on-clear failed:", err);
    }
  }

  // ── CRUD: Delivery Orders ─────────────────────────────────

  async function handleAddDO(poId: string) {
    if (!doForm.description || !doForm.amount) return;
    setSaving(true);

    const doRef = "DO-" + String(Date.now()).slice(-4);
    await supabase.from("delivery_orders").insert({
      po_id: poId,
      ref: doRef,
      description: doForm.description,
      amount: parseFloat(doForm.amount) || 0,
      delivery: doForm.delivery,
    });

    setDOForm(emptyDOForm);
    setSaving(false);
    fetchData();
  }

  async function handleDeleteDO(doId: string) {
    await supabase.from("delivery_orders").delete().eq("id", doId);
    setConfirmDeleteDOId(null);
    fetchData();
  }

  async function handleUpdateDODate(
    doId: string,
    field: "supplier_paid" | "delivered" | "invoiced" | "buyer_paid",
    value: string
  ) {
    const updatePayload: Record<string, string | null> = {};
    updatePayload[field] = value || null;
    await supabase
      .from("delivery_orders")
      .update(updatePayload as { supplier_paid?: string | null; delivered?: string | null; invoiced?: string | null; buyer_paid?: string | null })
      .eq("id", doId);
    // Optimistic update
    setAllPOs((prev) =>
      prev.map((po) => ({
        ...po,
        delivery_orders: po.delivery_orders.map((d) =>
          d.id === doId ? { ...d, [field]: value || null } : d
        ),
      }))
    );
  }

  async function handleUpdateDODelivery(doId: string, value: string) {
    await supabase
      .from("delivery_orders")
      .update({ delivery: value as "local" | "sea" | "international" })
      .eq("id", doId);
    setAllPOs((prev) =>
      prev.map((po) => ({
        ...po,
        delivery_orders: po.delivery_orders.map((d) =>
          d.id === doId ? { ...d, delivery: value } : d
        ),
      }))
    );
  }

  // ── Loading state ─────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <p className="text-sm text-gray-500">Loading PO cycle...</p>
      </div>
    );
  }

  // ── Render ────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <div className="flex justify-end">
          <MonthPicker
            months={availableMonths}
            value={selectedMonth}
            onChange={setSelectedMonth}
            color="brand"
          />
        </div>
        <div className="mt-3">
          <h1 className="text-lg font-medium text-gray-800">PO Cycle</h1>
          <p className="text-xs text-gray-500">
            {totalPOs} POs &middot; {fmt(totalValue)} total value
          </p>
        </div>
      </div>

      {/* Pipeline stage cards */}
      <div className="grid grid-cols-6 gap-2.5">
        {stageData.map((stage) => (
          <div
            key={stage.name}
            className={cn(
              "rounded-lg border border-l-[3px] bg-gray-50 px-3.5 py-3",
              stage.borderColor,
              "border-gray-200"
            )}
          >
            <p
              className={cn(
                "text-[9px] font-medium uppercase tracking-wide",
                stage.color
              )}
            >
              {stage.name}
            </p>
            <p className="mt-1 font-mono text-lg font-medium text-gray-800">
              {stage.count}
            </p>
            <p className="font-mono text-[11px] text-gray-500">
              {fmt(stage.value)}
            </p>
            {stage.overdueCount > 0 && (
              <p className="mt-1 text-[9px] font-medium text-danger-600">
                {stage.overdueCount} overdue
              </p>
            )}
            <p className="mt-1 text-[8px] text-gray-400">
              {stage.description}
            </p>
          </div>
        ))}
      </div>

      {/* PO Table panel */}
      <div className="rounded-xl bg-white shadow-sm ring-1 ring-gray-900/10">
        {/* Panel header */}
        <div className="flex items-center justify-between border-b border-gray-200 px-5 py-3">
          <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
            PO Cycle ({filteredPOs.length})
          </p>
          <Button
            size="sm"
            className="bg-brand-600 text-white hover:bg-brand-800"
            onClick={() => {
              setPOForm(emptyPOForm);
              setShowAddDialog(true);
            }}
          >
            <Plus className="size-3.5" data-icon="inline-start" />
            New PO
          </Button>
        </div>

        {/* Filters */}
        <div className="flex gap-3 border-b border-gray-100 px-5 py-2.5">
          <div>
            <label className="mb-0.5 block text-[8px] font-medium uppercase tracking-wider text-gray-400">
              Channel
            </label>
            <Select value={filterChannel} onValueChange={(v) => { if (v) setFilterChannel(v); }}>
              <SelectTrigger className="h-7 w-28 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All</SelectItem>
                <SelectItem value="punchout">Proxy</SelectItem>
                <SelectItem value="gep">Grid</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="mb-0.5 block text-[8px] font-medium uppercase tracking-wider text-gray-400">
              Player
            </label>
            <Select
              items={[
                { value: "__all__", label: "All" },
                ...players.map((p) => ({ value: p.id, label: p.name })),
              ]}
              value={filterEU}
              onValueChange={(v) => { if (v) setFilterEU(v); }}
            >
              <SelectTrigger className="h-7 w-36 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All</SelectItem>
                {players.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="mb-0.5 block text-[8px] font-medium uppercase tracking-wider text-gray-400">
              Status
            </label>
            <Select value={filterStatus} onValueChange={(v) => { if (v) setFilterStatus(v); }}>
              <SelectTrigger className="h-7 w-32 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All</SelectItem>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="poreceived">PO Received</SelectItem>
                <SelectItem value="inprogress">In Progress</SelectItem>
                <SelectItem value="invoiced">Invoiced</SelectItem>
                <SelectItem value="partial">Partial</SelectItem>
                <SelectItem value="overdue">Overdue</SelectItem>
                <SelectItem value="fullypaid">Fully Paid</SelectItem>
                <SelectItem value="cleared">Cleared</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Table */}
        {filteredPOs.length === 0 ? (
          <div className="py-12 text-center text-sm text-gray-500">
            {allPOs.length === 0
              ? 'No POs yet. Click "New PO" to create one.'
              : "No POs match your filters."}
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8" />
                <TableHead className="text-[10px] uppercase tracking-wider text-gray-500">
                  Ref
                </TableHead>
                <TableHead className="text-[10px] uppercase tracking-wider text-gray-500">
                  Channel
                </TableHead>
                <TableHead className="text-[10px] uppercase tracking-wider text-gray-500">
                  Date
                </TableHead>
                <TableHead className="text-[10px] uppercase tracking-wider text-gray-500">
                  Player
                </TableHead>
                <TableHead className="text-[10px] uppercase tracking-wider text-gray-500">
                  Introducer
                </TableHead>
                <TableHead className="text-[10px] uppercase tracking-wider text-gray-500">
                  PO Amount
                </TableHead>
                <TableHead className="text-[10px] uppercase tracking-wider text-gray-500">
                  Risk-Adj
                </TableHead>
                <TableHead className="text-[10px] uppercase tracking-wider text-gray-500">
                  DOs
                </TableHead>
                <TableHead className="text-[10px] uppercase tracking-wider text-gray-500">
                  Player Comm
                </TableHead>
                <TableHead className="text-[10px] uppercase tracking-wider text-gray-500">
                  Status
                </TableHead>
                <TableHead className="w-20" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredPOs.map((po) => (
                <PORow
                  key={po.id}
                  po={po}
                  players={players}
                  wPlayers={wPlayers}
                  wAllPOs={wAllPOs}
                  isExpanded={expandedId === po.id}
                  confirmDeletePOId={confirmDeletePOId}
                  confirmDeleteDOId={confirmDeleteDOId}
                  doForm={doForm}
                  saving={saving}
                  onToggleExpand={() =>
                    setExpandedId(expandedId === po.id ? null : po.id)
                  }
                  onRequestDeletePO={() => setConfirmDeletePOId(po.id)}
                  onConfirmDeletePO={() => handleDeletePO(po.id)}
                  onCancelDeletePO={() => setConfirmDeletePOId(null)}
                  onUpdateCommissionsCleared={(date) =>
                    handleUpdateCommissionsCleared(po.id, date)
                  }
                  onUpdatePOMeta={(field, value) =>
                    handleUpdatePOMeta(po.id, field, value)
                  }
                  onAddDO={() => handleAddDO(po.id)}
                  onDeleteDO={handleDeleteDO}
                  onRequestDeleteDO={setConfirmDeleteDOId}
                  onCancelDeleteDO={() => setConfirmDeleteDOId(null)}
                  onUpdateDODate={handleUpdateDODate}
                  onUpdateDODelivery={handleUpdateDODelivery}
                  onDOFormChange={setDOForm}
                />
              ))}
            </TableBody>
          </Table>
        )}
      </div>

      {/* Add PO Dialog */}
      <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>New Purchase Order</DialogTitle>
            <DialogDescription>
              Create a PO, then add delivery orders inside it.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {/* Channel */}
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-500">
                Channel
              </label>
              <div className="flex gap-1.5">
                {(["punchout", "gep"] as const).map((ch) => (
                  <button
                    key={ch}
                    type="button"
                    onClick={() =>
                      setPOForm((prev) => ({ ...prev, channel: ch }))
                    }
                    className={cn(
                      "flex-1 rounded-md px-3 py-2 text-xs font-medium transition-colors",
                      poForm.channel === ch
                        ? ch === "gep"
                          ? "bg-brand-50 text-brand-600 ring-2 ring-brand-400"
                          : "bg-accent-50 text-accent-600 ring-2 ring-accent-400"
                        : "bg-gray-100 text-gray-500 hover:bg-gray-200"
                    )}
                  >
                    {ch === "gep" ? "Grid" : "Proxy"}
                  </button>
                ))}
              </div>
              <p className="mt-1 text-[10px] text-gray-400">
                {poForm.channel === "punchout"
                  ? "3% platform fee applies"
                  : "No platform fee"}
              </p>
            </div>

            {/* End-User */}
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-500">
                Player
              </label>
              <Select
                items={[
                  { value: "__none__", label: "Select player" },
                  ...players.map((p) => ({ value: p.id, label: p.name })),
                ]}
                value={poForm.end_user_id || "__none__"}
                onValueChange={(v) =>
                  setPOForm((prev) => ({
                    ...prev,
                    end_user_id: v === "__none__" ? "" : (v ?? ""),
                  }))
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Select player</SelectItem>
                  {players.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {poForm.end_user_id && (
                <p className="mt-1 text-[10px] text-gray-400">
                  Introducer:{" "}
                  <span className="font-medium text-purple-600">
                    {players.find(
                      (p) =>
                        p.id ===
                        players.find((x) => x.id === poForm.end_user_id)
                          ?.introduced_by
                    )?.name ?? "None"}
                  </span>
                </p>
              )}
              {players.length === 0 && (
                <p className="mt-1 text-[10px] text-danger-600">
                  No players yet. Add players in the Players page first.
                </p>
              )}
            </div>

            {/* Date + Amount */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-500">
                  PO Date
                </label>
                <Input
                  type="date"
                  value={poForm.po_date}
                  onChange={(e) =>
                    setPOForm((prev) => ({ ...prev, po_date: e.target.value }))
                  }
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-500">
                  PO Amount (RM)
                </label>
                <Input
                  type="number"
                  value={poForm.po_amount}
                  onChange={(e) =>
                    setPOForm((prev) => ({
                      ...prev,
                      po_amount: e.target.value,
                    }))
                  }
                  placeholder="e.g. 150000"
                />
              </div>
            </div>

            {/* Description */}
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-500">
                Description
              </label>
              <Input
                type="text"
                value={poForm.description}
                onChange={(e) =>
                  setPOForm((prev) => ({
                    ...prev,
                    description: e.target.value,
                  }))
                }
                placeholder="Short label for this PO"
              />
            </div>

            {/* Note */}
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-500">
                Note
              </label>
              <textarea
                rows={3}
                value={poForm.note}
                onChange={(e) =>
                  setPOForm((prev) => ({ ...prev, note: e.target.value }))
                }
                placeholder="Internal notes (optional)"
                className="w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1.5 text-base placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 outline-none transition-colors md:text-sm"
              />
            </div>
          </div>

          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>
              Cancel
            </DialogClose>
            <Button
              className="bg-brand-600 text-white hover:bg-brand-800"
              onClick={handleAddPO}
              disabled={
                saving ||
                !poForm.end_user_id ||
                !poForm.po_date ||
                !poForm.po_amount
              }
            >
              {saving ? "Creating..." : "Create PO"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── PO Row (with expandable detail) ─────────────────────────

function PORow({
  po,
  players,
  wPlayers,
  wAllPOs,
  isExpanded,
  confirmDeletePOId,
  confirmDeleteDOId,
  doForm,
  saving,
  onToggleExpand,
  onRequestDeletePO,
  onConfirmDeletePO,
  onCancelDeletePO,
  onUpdateCommissionsCleared,
  onUpdatePOMeta,
  onAddDO,
  onDeleteDO,
  onRequestDeleteDO,
  onCancelDeleteDO,
  onUpdateDODate,
  onUpdateDODelivery,
  onDOFormChange,
}: {
  po: DBPO;
  players: DBPlayer[];
  wPlayers: WaterfallPlayer[];
  wAllPOs: WaterfallPO[];
  isExpanded: boolean;
  confirmDeletePOId: string | null;
  confirmDeleteDOId: string | null;
  doForm: {
    description: string;
    amount: string;
    delivery: "local" | "sea" | "international";
  };
  saving: boolean;
  onToggleExpand: () => void;
  onRequestDeletePO: () => void;
  onConfirmDeletePO: () => void;
  onCancelDeletePO: () => void;
  onUpdateCommissionsCleared: (date: string) => void;
  onUpdatePOMeta: (
    field: "description" | "note" | "other_cost" | "other_cost_reason",
    value: string | number,
  ) => void;
  onAddDO: () => void;
  onDeleteDO: (doId: string) => void;
  onRequestDeleteDO: (doId: string) => void;
  onCancelDeleteDO: () => void;
  onUpdateDODate: (
    doId: string,
    field: "supplier_paid" | "delivered" | "invoiced" | "buyer_paid",
    value: string
  ) => void;
  onUpdateDODelivery: (doId: string, value: string) => void;
  onDOFormChange: (
    f:
      | typeof doForm
      | ((prev: typeof doForm) => typeof doForm)
  ) => void;
}) {
  const eu = players.find((p) => p.id === po.end_user_id);
  const intro = eu?.introduced_by
    ? players.find((p) => p.id === eu.introduced_by)
    : undefined;
  const status = getPOStatus(po);
  const dos = po.delivery_orders ?? [];
  const paidDOs = dos.filter((d) => d.buyer_paid).length;
  const chColor = po.channel === "gep" ? "brand" : "accent";

  // Risk-adjusted COGS
  const riskAdjustedCogs = dos.reduce((s, d) => {
    const bp = calcBufferPct(d.amount, d.delivery ?? "local");
    return s + d.amount * (1 + bp / 100);
  }, 0);

  // EU commission from waterfall. PO list view doesn't fetch deployments —
  // assume full funding for the player-commission preview. The entity page
  // is the authoritative view that uses actual Σ deployed.
  const waterfall = po.po_amount > 0
    ? calcPOWaterfall(toWaterfallPO(po), wPlayers, wAllPOs, po.po_amount)
    : null;
  // Net the player's loss share so loss-making POs surface as a negative
  // value rather than the clamped RM 0 from w.euAmt.
  const euComm = waterfall ? waterfall.euAmt - waterfall.playerLossShare : 0;

  // Can clear commissions?
  const canClear = dos.length > 0 && dos.every((d) => d.buyer_paid);

  return (
    <>
      {/* Main row */}
      <TableRow
        className={cn(
          "cursor-pointer",
          isExpanded && (chColor === "brand" ? "bg-brand-50/30" : "bg-accent-50/30")
        )}
        onClick={onToggleExpand}
      >
        <TableCell className="w-8 pr-0">
          {isExpanded ? (
            <ChevronDown className="size-3.5 text-gray-400" />
          ) : (
            <ChevronRight className="size-3.5 text-gray-400" />
          )}
        </TableCell>
        <TableCell
          className={cn(
            "font-mono text-xs font-medium",
            chColor === "brand" ? "text-brand-600" : "text-accent-600"
          )}
        >
          {po.ref}
        </TableCell>
        <TableCell>
          <ChannelBadge channel={po.channel as "punchout" | "gep"} />
        </TableCell>
        <TableCell className="text-xs text-gray-500">{po.po_date}</TableCell>
        <TableCell className="text-sm font-medium text-gray-800">
          {eu?.name ?? "?"}
        </TableCell>
        <TableCell className="text-xs text-purple-600">
          {intro?.name ?? "--"}
        </TableCell>
        <TableCell className="font-mono text-sm font-medium">
          {po.po_amount > 0 ? fmt(po.po_amount) : "--"}
        </TableCell>
        <TableCell
          className={cn(
            "font-mono text-[11px]",
            riskAdjustedCogs > po.po_amount
              ? "text-danger-600"
              : "text-gray-500"
          )}
        >
          {riskAdjustedCogs > 0 ? fmt(riskAdjustedCogs) : "--"}
        </TableCell>
        <TableCell className="font-mono text-[11px]">
          {paidDOs}/{dos.length}
        </TableCell>
        <TableCell
          className={cn(
            "font-mono text-sm font-medium",
            euComm < 0
              ? "text-danger-600"
              : chColor === "brand"
                ? "text-brand-600"
                : "text-accent-600"
          )}
        >
          {po.po_amount > 0 ? fmtSigned(euComm) : "--"}
        </TableCell>
        <TableCell>
          <StatusBadge status={status} />
        </TableCell>
        <TableCell>
          <div
            className="flex items-center justify-end gap-1"
            onClick={(e) => e.stopPropagation()}
          >
            {confirmDeletePOId === po.id ? (
              <div className="flex items-center gap-1">
                <Button
                  variant="destructive"
                  size="xs"
                  onClick={onConfirmDeletePO}
                >
                  Delete
                </Button>
                <Button
                  variant="outline"
                  size="xs"
                  onClick={onCancelDeletePO}
                >
                  Cancel
                </Button>
              </div>
            ) : (
              <Button
                variant="ghost"
                size="icon-xs"
                onClick={onRequestDeletePO}
                title="Delete PO"
              >
                <Trash2 className="size-3 text-danger-400" />
              </Button>
            )}
          </div>
        </TableCell>
      </TableRow>

      {/* Expanded detail */}
      {isExpanded && (
        <TableRow
          className={cn(
            "hover:bg-transparent",
            chColor === "brand" ? "bg-brand-50/20" : "bg-accent-50/20"
          )}
        >
          <TableCell colSpan={12} className="p-0">
            <div className="space-y-4 p-5">
              {/* Commissions Cleared + Description + Note */}
              <div className="flex flex-wrap items-start gap-4">
                <div>
                  <label className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-gray-500">
                    Commissions Cleared
                  </label>
                  <Input
                    type="date"
                    value={po.commissions_cleared ?? ""}
                    onChange={(e) =>
                      onUpdateCommissionsCleared(e.target.value)
                    }
                    disabled={!canClear}
                    className="h-7 w-40 text-xs"
                  />
                  {!canClear && (
                    <p className="mt-0.5 text-[9px] text-gray-400">
                      All DOs must be buyer-paid first
                    </p>
                  )}
                </div>

                <div className="min-w-[220px] flex-1">
                  <label className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-gray-500">
                    Description
                  </label>
                  <Input
                    key={`desc-${po.id}-${po.description ?? ""}`}
                    defaultValue={po.description ?? ""}
                    onBlur={(e) => {
                      if ((e.target.value ?? "") !== (po.description ?? "")) {
                        onUpdatePOMeta("description", e.target.value);
                      }
                    }}
                    placeholder="Short label for this PO"
                    className="h-7 text-xs"
                  />
                  <p className="mt-0.5 text-[9px] text-gray-400">
                    Visible to investors
                  </p>
                </div>

                <div className="min-w-[260px] flex-[1.4]">
                  <label className="mb-1 block text-[10px] font-medium uppercase tracking-wider text-gray-500">
                    Note
                  </label>
                  <textarea
                    key={`note-${po.id}-${po.note ?? ""}`}
                    rows={2}
                    defaultValue={po.note ?? ""}
                    onBlur={(e) => {
                      if ((e.target.value ?? "") !== (po.note ?? "")) {
                        onUpdatePOMeta("note", e.target.value);
                      }
                    }}
                    placeholder="Internal notes (optional)"
                    className="w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-xs placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 outline-none transition-colors"
                  />
                  <p className="mt-0.5 text-[9px] text-gray-400">
                    Visible to the player who owns this PO
                  </p>
                </div>
              </div>

              {/* Delivery Orders section */}
              <div>
                <p className="mb-2 text-[10px] font-medium uppercase tracking-wider text-gray-500">
                  Delivery Orders ({dos.length})
                </p>

                {/* Add DO form */}
                <div className="mb-3 rounded-lg border border-dashed border-gray-200 bg-gray-50 p-3">
                  <div className="mb-2 flex gap-2">
                    <div className="flex-[2]">
                      <label className="mb-0.5 block text-[8px] font-medium uppercase tracking-wider text-gray-400">
                        Items / Description
                      </label>
                      <Input
                        value={doForm.description}
                        onChange={(e) =>
                          onDOFormChange((prev) => ({
                            ...prev,
                            description: e.target.value,
                          }))
                        }
                        placeholder="e.g. 3x gaskets, 2x flanges"
                        className="h-7 text-xs"
                      />
                    </div>
                    <div className="flex-1">
                      <label className="mb-0.5 block text-[8px] font-medium uppercase tracking-wider text-gray-400">
                        Supplier Cost (RM)
                      </label>
                      <Input
                        type="number"
                        value={doForm.amount}
                        onChange={(e) =>
                          onDOFormChange((prev) => ({
                            ...prev,
                            amount: e.target.value,
                          }))
                        }
                        placeholder="e.g. 60000"
                        className="h-7 text-xs"
                      />
                    </div>
                  </div>

                  {/* Delivery + Urgency + Buffer preview */}
                  <div
                    className={cn(
                      "mb-2 flex items-end gap-4 rounded-md p-2.5",
                      chColor === "brand"
                        ? "border border-brand-100 bg-brand-50/30"
                        : "border border-accent-100 bg-accent-50/30"
                    )}
                  >
                    <div>
                      <label
                        className={cn(
                          "mb-1 block text-[8px] font-medium uppercase tracking-wider",
                          chColor === "brand"
                            ? "text-brand-600"
                            : "text-accent-600"
                        )}
                      >
                        Delivery
                      </label>
                      <div className="flex gap-1">
                        {DELIVERY_MODES.map((dm) => (
                          <button
                            key={dm.id}
                            type="button"
                            onClick={() =>
                              onDOFormChange((prev) => ({
                                ...prev,
                                delivery: dm.id,
                              }))
                            }
                            className={cn(
                              "rounded-full px-2.5 py-1 text-[10px] font-medium transition-colors",
                              doForm.delivery === dm.id
                                ? chColor === "brand"
                                  ? "bg-brand-600 text-white"
                                  : "bg-accent-600 text-white"
                                : "bg-white text-gray-500 ring-1 ring-gray-200 hover:bg-gray-50"
                            )}
                          >
                            {dm.label}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="ml-auto text-right">
                      <p className="text-[8px] font-medium uppercase tracking-wider text-gray-400">
                        Risk Buffer
                      </p>
                      <p
                        className={cn(
                          "font-mono text-base font-medium",
                          chColor === "brand"
                            ? "text-brand-600"
                            : "text-accent-600"
                        )}
                      >
                        +
                        {calcBufferPct(
                          parseFloat(doForm.amount) || 15000,
                          doForm.delivery
                        ).toFixed(1)}
                        %
                      </p>
                      {doForm.amount && (
                        <p className="font-mono text-[10px] text-gray-500">
                          &rarr;{" "}
                          {fmt(
                            (parseFloat(doForm.amount) || 0) *
                              (1 +
                                calcBufferPct(
                                  parseFloat(doForm.amount) || 15000,
                                  doForm.delivery
                                ) /
                                  100)
                          )}
                        </p>
                      )}
                    </div>
                  </div>

                  <Button
                    size="sm"
                    className={cn(
                      "text-white",
                      chColor === "brand"
                        ? "bg-brand-600 hover:bg-brand-800"
                        : "bg-accent-600 hover:bg-accent-800"
                    )}
                    onClick={onAddDO}
                    disabled={saving || !doForm.description || !doForm.amount}
                  >
                    <Plus className="size-3.5" data-icon="inline-start" />
                    Add DO
                  </Button>
                </div>

                {/* DO table */}
                {dos.length === 0 ? (
                  <p className="py-4 text-center text-xs text-gray-400">
                    No delivery orders yet. Add a DO above.
                  </p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full border-collapse text-[10px]">
                      <thead>
                        <tr className="border-b-2 border-gray-200">
                          {[
                            "DO",
                            "Items",
                            "Cost",
                            "Delivery",
                            "Buffer %",
                            "Risk-Adj",
                            "Supplier Paid",
                            "Delivered",
                            "Invoiced",
                            "Buyer Paid",
                            "Status",
                            "",
                          ].map((h) => (
                            <th
                              key={h}
                              className="px-1.5 py-1.5 text-left text-[7px] font-medium uppercase tracking-wide text-gray-400"
                            >
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {dos.map((d) => {
                          const doSt = getDOStatus(d);
                          const cfg = doStatusConfig[doSt];
                          const bp = calcBufferPct(
                            d.amount,
                            d.delivery ?? "local"
                          );
                          const riskAdj = d.amount * (1 + bp / 100);

                          return (
                            <tr
                              key={d.id}
                              className="border-b border-gray-100"
                            >
                              <td
                                className={cn(
                                  "px-1.5 py-2 font-mono text-[9px] font-medium",
                                  chColor === "brand"
                                    ? "text-brand-600"
                                    : "text-accent-600"
                                )}
                              >
                                {d.ref}
                              </td>
                              <td className="max-w-[100px] truncate px-1.5 py-2">
                                {d.description}
                              </td>
                              <td className="px-1.5 py-2 font-mono">
                                {fmt(d.amount)}
                              </td>
                              <td className="px-1.5 py-2">
                                <select
                                  value={d.delivery ?? "local"}
                                  onChange={(e) =>
                                    onUpdateDODelivery(d.id, e.target.value)
                                  }
                                  className="h-6 rounded border border-gray-200 bg-gray-50 px-1 text-[9px]"
                                >
                                  {DELIVERY_MODES.map((dm) => (
                                    <option key={dm.id} value={dm.id}>
                                      {dm.label}
                                    </option>
                                  ))}
                                </select>
                              </td>
                              <td
                                className={cn(
                                  "px-1.5 py-2 font-mono font-medium",
                                  chColor === "brand"
                                    ? "text-brand-600"
                                    : "text-accent-600"
                                )}
                              >
                                +{bp.toFixed(1)}%
                              </td>
                              <td className="px-1.5 py-2 font-mono text-danger-600">
                                {fmt(riskAdj)}
                              </td>
                              <td className="px-1.5 py-2">
                                <input
                                  type="date"
                                  value={d.supplier_paid ?? ""}
                                  onChange={(e) =>
                                    onUpdateDODate(
                                      d.id,
                                      "supplier_paid",
                                      e.target.value
                                    )
                                  }
                                  className="h-6 w-[100px] rounded border border-gray-200 bg-gray-50 px-1 text-[9px]"
                                />
                              </td>
                              <td className="px-1.5 py-2">
                                <input
                                  type="date"
                                  value={d.delivered ?? ""}
                                  onChange={(e) =>
                                    onUpdateDODate(
                                      d.id,
                                      "delivered",
                                      e.target.value
                                    )
                                  }
                                  className="h-6 w-[100px] rounded border border-gray-200 bg-gray-50 px-1 text-[9px]"
                                />
                              </td>
                              <td className="px-1.5 py-2">
                                <input
                                  type="date"
                                  value={d.invoiced ?? ""}
                                  onChange={(e) =>
                                    onUpdateDODate(
                                      d.id,
                                      "invoiced",
                                      e.target.value
                                    )
                                  }
                                  className="h-6 w-[100px] rounded border border-gray-200 bg-gray-50 px-1 text-[9px]"
                                />
                              </td>
                              <td className="px-1.5 py-2">
                                <input
                                  type="date"
                                  value={d.buyer_paid ?? ""}
                                  onChange={(e) =>
                                    onUpdateDODate(
                                      d.id,
                                      "buyer_paid",
                                      e.target.value
                                    )
                                  }
                                  className="h-6 w-[100px] rounded border border-gray-200 bg-gray-50 px-1 text-[9px]"
                                />
                              </td>
                              <td className="px-1.5 py-2">
                                <span
                                  className={cn(
                                    "inline-flex items-center rounded-md px-1.5 py-0.5 text-[8px] font-medium",
                                    cfg.bg,
                                    cfg.text
                                  )}
                                >
                                  {cfg.label}
                                </span>
                              </td>
                              <td className="px-1.5 py-2 text-right">
                                {confirmDeleteDOId === d.id ? (
                                  <span className="inline-flex items-center gap-1">
                                    <Button
                                      variant="destructive"
                                      size="xs"
                                      onClick={() => onDeleteDO(d.id)}
                                    >
                                      Delete
                                    </Button>
                                    <Button
                                      variant="outline"
                                      size="xs"
                                      onClick={onCancelDeleteDO}
                                    >
                                      Cancel
                                    </Button>
                                  </span>
                                ) : (
                                  <Button
                                    variant="ghost"
                                    size="icon-xs"
                                    onClick={() => onRequestDeleteDO(d.id)}
                                    title="Delete DO"
                                  >
                                    <Trash2 className="size-2.5 text-danger-400" />
                                  </Button>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                        {/* DO totals row */}
                        {dos.length > 0 && (() => {
                          const supplierTotal = dos.reduce(
                            (s, d) => s + d.amount,
                            0
                          );
                          const riskAdjTotal = dos.reduce((s, d) => {
                            const bp = calcBufferPct(
                              d.amount,
                              d.delivery ?? "local"
                            );
                            return s + d.amount * (1 + bp / 100);
                          }, 0);
                          const avgBufferPct =
                            supplierTotal > 0
                              ? ((riskAdjTotal / supplierTotal - 1) * 100)
                              : 0;

                          return (
                            <tr className="border-t-2 border-gray-200">
                              <td
                                colSpan={2}
                                className="px-1.5 py-2 text-[10px] font-medium"
                              >
                                Total
                              </td>
                              <td className="px-1.5 py-2 font-mono font-medium">
                                {fmt(supplierTotal)}
                              </td>
                              <td colSpan={2} />
                              <td
                                className={cn(
                                  "px-1.5 py-2 font-mono font-medium",
                                  chColor === "brand"
                                    ? "text-brand-600"
                                    : "text-accent-600"
                                )}
                              >
                                +{avgBufferPct.toFixed(1)}%
                              </td>
                              <td className="px-1.5 py-2 font-mono font-medium text-danger-600">
                                {fmt(riskAdjTotal)}
                              </td>
                              <td
                                colSpan={6}
                                className="px-1.5 py-2 text-gray-500"
                              >
                                {paidDOs} of {dos.length} DOs paid
                              </td>
                            </tr>
                          );
                        })()}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* Other Cost (PO-level, no risk buffer) */}
              <div className="rounded-lg border border-dashed border-gray-200 bg-gray-50 p-3">
                <p className="mb-2 text-[10px] font-medium uppercase tracking-wider text-gray-500">
                  Other Cost
                </p>
                <div className="flex flex-wrap items-end gap-3">
                  <div>
                    <label className="mb-0.5 block text-[8px] font-medium uppercase tracking-wider text-gray-400">
                      Amount (RM)
                    </label>
                    <Input
                      key={`other-cost-${po.id}-${po.other_cost}`}
                      type="number"
                      defaultValue={po.other_cost || ""}
                      onBlur={(e) => {
                        const next = parseFloat(e.target.value) || 0;
                        if (next !== (po.other_cost || 0)) {
                          onUpdatePOMeta("other_cost", next);
                        }
                      }}
                      placeholder="0"
                      className="h-7 w-32 text-xs"
                    />
                  </div>
                  <div className="min-w-[200px] flex-1">
                    <label className="mb-0.5 block text-[8px] font-medium uppercase tracking-wider text-gray-400">
                      Reason
                    </label>
                    <Input
                      key={`other-reason-${po.id}-${po.other_cost_reason ?? ""}`}
                      defaultValue={po.other_cost_reason ?? ""}
                      onBlur={(e) => {
                        if ((e.target.value ?? "") !== (po.other_cost_reason ?? "")) {
                          onUpdatePOMeta("other_cost_reason", e.target.value);
                        }
                      }}
                      placeholder="e.g. customs surcharge"
                      className="h-7 text-xs"
                    />
                  </div>
                </div>
                <p className="mt-1 text-[9px] text-gray-400">
                  Optional. Subtracted from gross profit. No risk buffer applied.
                </p>
              </div>

              {/* Commission Breakdown (waterfall) */}
              {waterfall && po.po_amount > 0 && (
                <div>
                  <p className="mb-2 text-[10px] font-medium uppercase tracking-wider text-gray-500">
                    Commission Breakdown (
                    {po.channel === "gep" ? "Grid" : "Proxy"}{" "}
                    Waterfall)
                  </p>
                  <WaterfallTable
                    rows={buildWaterfallRows(waterfall, po, intro)}
                  />
                  {waterfall.rawLoss > 0 && (
                    <p className="mt-2 rounded-md border border-danger-100 bg-danger-50 p-2 text-[10px] text-danger-600">
                      Negative pool — combined supplier cost, risk buffer,
                      and fees exceed PO value by {fmt(waterfall.rawLoss)}.
                      Loss shared per profit-split ratios above. Player and
                      introducer shares are netted from their next
                      commissions when this PO is cleared.
                    </p>
                  )}
                  {dos.length > 0 &&
                    !dos.every((d) => d.buyer_paid) && (
                      <p className="mt-2 rounded-md border border-amber-100 bg-amber-50 p-2 text-[10px] text-amber-600">
                        Commission only applies when all DOs are paid and PO
                        is fully completed.
                      </p>
                    )}
                </div>
              )}
            </div>
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

// ── Build waterfall rows for the commission breakdown ────────

function buildWaterfallRows(
  w: ReturnType<typeof calcPOWaterfall>,
  po: DBPO,
  intro: DBPlayer | undefined
): WaterfallRow[] {
  const rows: WaterfallRow[] = [
    {
      label: "PO Amount (Buyer Value)",
      val: w.poAmount,
      bold: true,
    },
    {
      label: `Supplier Cost (${(po.delivery_orders ?? []).length} DOs)`,
      val: -w.supplierTotal,
      color: "default",
    },
    {
      label: `Risk-Adjusted COGS (${w.effectiveCogsPct.toFixed(1)}% of PO)`,
      val: -w.riskAdjustedCogs,
      color: "danger",
    },
  ];

  if (w.otherCost > 0) {
    rows.push({
      label: po.other_cost_reason
        ? `Other Cost (${po.other_cost_reason})`
        : "Other Cost",
      val: -w.otherCost,
      color: "danger",
    });
  }

  rows.push({
    label: "= Gross Profit",
    val: w.gross,
    color: w.gross >= 0 ? "success" : "danger",
    bold: true,
  });

  if (w.channel === "punchout") {
    rows.push({
      label: "Proxy Platform (3%)",
      val: -w.platformFee,
      color: "danger",
    });
  }

  rows.push(
    {
      label: `Investor (${INV_RATE}%)`,
      val: -w.investorFee,
      color: "danger",
    },
    {
      label: "= Pool",
      val: w.pool,
      color: w.pool >= 0 ? "accent" : "danger",
      bold: true,
    },
    {
      label: `Player (${w.euTier.name} ${w.euTier.rate}% of Pool)`,
      val: -w.euAmt,
      color: "brand",
    },
    {
      label: "= Entity Gross",
      val: w.entityGross,
      color: "success",
      bold: true,
    }
  );

  if (w.intro) {
    const introName = intro?.name ? `${intro.name} · ` : "";
    rows.push({
      label: `Player Introducer (${introName}${w.introRate}% of Entity Gross)`,
      val: -w.introAmt,
      color: "purple",
    });
  }

  rows.push({
    label: "= Entity Before OPEX",
    val: w.entityShare,
    color: w.entityShare >= 0 ? "accent" : "danger",
    bold: true,
  });

  if (w.rawLoss > 0) {
    rows.push({
      label: "Loss Distribution (Pool Deficit)",
      val: w.rawLoss,
      color: "danger",
      bold: true,
    });
    rows.push({
      label: `Player Absorbs (${w.euTier.rate}% mirror)`,
      val: w.playerLossShare,
      color: "danger",
    });
    if (w.intro) {
      const introName = intro?.name ? `${intro.name} · ` : "";
      rows.push({
        label: `Introducer Absorbs (${introName}${w.introRate}% mirror)`,
        val: w.introducerLossShare,
        color: "danger",
      });
    }
    rows.push({
      label: "Entity Absorbs",
      val: w.entityLossShare,
      color: "danger",
    });
  }

  return rows;
}
