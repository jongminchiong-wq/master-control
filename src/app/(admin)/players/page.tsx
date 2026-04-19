"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { Plus, Pencil, Trash2, ChevronDown, ChevronRight } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { Tables } from "@/lib/supabase/types";
import { cn } from "@/lib/utils";

// Business logic
import { calcPOWaterfall } from "@/lib/business-logic/waterfall";
import type {
  Player as WaterfallPlayer,
  PurchaseOrder as WaterfallPO,
} from "@/lib/business-logic/waterfall";
import { getTier, getEUTiers } from "@/lib/business-logic/tiers";
import { fmt, getMonth, fmtMonth } from "@/lib/business-logic/formatters";
import { useSelectedMonth } from "@/lib/hooks/use-selected-month";

// Shared components
import { MetricCard } from "@/components/metric-card";
import { TierCard } from "@/components/tier-card";
import { ChannelBadge } from "@/components/channel-badge";
import { StatusBadge, type POStatus } from "@/components/status-badge";
import { MonthPicker } from "@/components/month-picker";

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
  const fullyPaid = dos.length > 0 && dos.every((d) => d.buyer_paid);
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

// ── Component ───────────────────────────────────────────────

export default function PlayersPage() {
  return <Suspense><PlayersPageContent /></Suspense>;
}

function PlayersPageContent() {
  const supabase = useMemo(() => createClient(), []);

  // Data state
  const [players, setPlayers] = useState<DBPlayer[]>([]);
  const [allPOs, setAllPOs] = useState<DBPO[]>([]);
  const [loading, setLoading] = useState(true);

  // UI state
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [editingPlayer, setEditingPlayer] = useState<DBPlayer | null>(null);
  const [saving, setSaving] = useState(false);

  // Month selector (URL-driven, shared across admin pages)
  const [selectedMonth, setSelectedMonth] = useSelectedMonth();

  // Form state
  const emptyForm = {
    name: "",
    eu_tier_mode: "A" as "A" | "B",
    intro_tier_mode: "A" as "A" | "B",
    introduced_by: "",
  };
  const [form, setForm] = useState(emptyForm);

  // ── Data fetching ───────────────────────────────────────

  const fetchData = useCallback(async () => {
    setLoading(true);
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
    if (playersRes.data) setPlayers(playersRes.data);
    if (posRes.data) setAllPOs(posRes.data as DBPO[]);
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
    const months = [
      ...new Set(allPOs.map((po) => getMonth(po.po_date)).filter(Boolean)),
    ].sort().reverse();
    if (!months.includes(currentMonth)) months.unshift(currentMonth);
    if (!months.includes(selectedMonth)) months.unshift(selectedMonth);
    return months;
  }, [allPOs, selectedMonth]);

  const monthPOs = useMemo(
    () => allPOs.filter((po) => getMonth(po.po_date) === selectedMonth),
    [allPOs, selectedMonth]
  );

  // Map to waterfall shapes (for the entire dataset, not just this month)
  const wPlayers = useMemo(() => players.map(toWaterfallPlayer), [players]);
  const wAllPOs = useMemo(() => allPOs.map(toWaterfallPO), [allPOs]);

  // Per-player stats for the selected month
  const playerStats = useMemo(() => {
    const stats = new Map<
      string,
      {
        totalPO: number;
        euComm: number;
        introComm: number;
        poCount: number;
        gepTotal: number;
        punchTotal: number;
      }
    >();

    for (const p of players) {
      const playerMonthPOs = monthPOs.filter(
        (po) => po.end_user_id === p.id
      );
      let euComm = 0;
      let gepTotal = 0;
      let punchTotal = 0;
      const totalPO = playerMonthPOs.reduce(
        (s, po) => s + po.po_amount,
        0
      );

      for (const po of playerMonthPOs) {
        const w = calcPOWaterfall(toWaterfallPO(po), wPlayers, wAllPOs);
        euComm += w.euAmt;
        if (po.channel === "gep") gepTotal += po.po_amount;
        else punchTotal += po.po_amount;
      }

      // Introducer earnings: commissions from recruits' POs
      const recruits = players.filter((r) => r.introduced_by === p.id);
      let introComm = 0;
      for (const r of recruits) {
        const recruitPOs = monthPOs.filter(
          (po) => po.end_user_id === r.id
        );
        for (const po of recruitPOs) {
          const w = calcPOWaterfall(toWaterfallPO(po), wPlayers, wAllPOs);
          introComm += w.introAmt;
        }
      }

      stats.set(p.id, {
        totalPO,
        euComm,
        introComm,
        poCount: playerMonthPOs.length,
        gepTotal,
        punchTotal,
      });
    }

    return stats;
  }, [players, monthPOs, wPlayers, wAllPOs]);

  // Summary metrics
  const totalPOValue = useMemo(
    () => monthPOs.reduce((s, po) => s + po.po_amount, 0),
    [monthPOs]
  );
  const totalCommissions = useMemo(() => {
    let sum = 0;
    for (const s of playerStats.values()) {
      sum += s.euComm + s.introComm;
    }
    return sum;
  }, [playerStats]);

  // ── CRUD handlers ─────────────────────────────────────────

  async function handleAddPlayer() {
    if (!form.name.trim()) return;
    setSaving(true);
    await supabase.from("players").insert({
      name: form.name.trim(),
      eu_tier_mode: form.eu_tier_mode,
      intro_tier_mode: form.intro_tier_mode,
      introduced_by: form.introduced_by || null,
    });
    setForm(emptyForm);
    setShowAddDialog(false);
    setSaving(false);
    fetchData();
  }

  async function handleEditPlayer() {
    if (!editingPlayer || !form.name.trim()) return;
    setSaving(true);
    await supabase
      .from("players")
      .update({
        name: form.name.trim(),
        eu_tier_mode: form.eu_tier_mode,
        intro_tier_mode: form.intro_tier_mode,
        introduced_by: form.introduced_by || null,
      })
      .eq("id", editingPlayer.id);
    setEditingPlayer(null);
    setForm(emptyForm);
    setSaving(false);
    fetchData();
  }

  async function handleDeletePlayer(id: string) {
    await supabase.from("players").delete().eq("id", id);
    setConfirmDeleteId(null);
    setDeleteConfirmText("");
    if (expandedId === id) setExpandedId(null);
    fetchData();
  }

  function openDeleteDialog(player: DBPlayer) {
    setDeleteConfirmText("");
    setConfirmDeleteId(player.id);
  }

  async function handleQuickTierUpdate(
    id: string,
    field: "eu_tier_mode" | "intro_tier_mode",
    value: "A" | "B"
  ) {
    const update =
      field === "eu_tier_mode"
        ? { eu_tier_mode: value }
        : { intro_tier_mode: value };
    await supabase.from("players").update(update).eq("id", id);
    setPlayers((prev) =>
      prev.map((p) => (p.id === id ? { ...p, [field]: value } : p))
    );
  }

  function openEditDialog(player: DBPlayer) {
    setForm({
      name: player.name,
      eu_tier_mode: player.eu_tier_mode ?? "A",
      intro_tier_mode: player.intro_tier_mode ?? "A",
      introduced_by: player.introduced_by ?? "",
    });
    setEditingPlayer(player);
  }

  // ── Loading state ─────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <p className="text-sm text-gray-500">Loading players...</p>
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
          <h1 className="text-lg font-medium text-gray-800">Players</h1>
          <p className="text-xs text-gray-500">
            Manage players and view their commissions
          </p>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-3">
        <MetricCard
          label="Total Players"
          value={String(players.length)}
          color="default"
        />
        <MetricCard
          label="Total PO Value"
          value={fmt(totalPOValue)}
          subtitle={`${monthPOs.length} POs this month`}
          color="success"
        />
        <MetricCard
          label="Total Commissions"
          value={fmt(totalCommissions)}
          subtitle="Player + Introducer"
          color="brand"
        />
      </div>

      {/* Players table panel */}
      <div className="rounded-xl bg-white ring-1 ring-gray-900/10 shadow-sm">
        {/* Panel header */}
        <div className="flex items-center justify-between border-b border-gray-200 px-5 py-3">
          <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
            Players ({players.length})
          </p>
          <Button
            size="sm"
            className="bg-brand-600 text-white hover:bg-brand-800"
            onClick={() => {
              setForm(emptyForm);
              setShowAddDialog(true);
            }}
          >
            <Plus className="size-3.5" data-icon="inline-start" />
            Add Player
          </Button>
        </div>

        {/* Table */}
        {players.length === 0 ? (
          <div className="py-12 text-center text-sm text-gray-500">
            No players yet. Click &quot;Add Player&quot; to get started.
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8" />
                <TableHead className="text-[10px] uppercase tracking-wider text-gray-500">
                  Name
                </TableHead>
                <TableHead className="text-[10px] uppercase tracking-wider text-gray-500">
                  Player Tier
                </TableHead>
                <TableHead className="text-[10px] uppercase tracking-wider text-gray-500">
                  Total PO
                </TableHead>
                <TableHead className="text-[10px] uppercase tracking-wider text-gray-500">
                  Channels
                </TableHead>
                <TableHead className="text-[10px] uppercase tracking-wider text-gray-500">
                  Total Commission
                </TableHead>
                <TableHead className="text-[10px] uppercase tracking-wider text-gray-500">
                  Introduced By
                </TableHead>
                <TableHead className="w-20" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {players.map((player) => {
                const stats = playerStats.get(player.id);
                const isExpanded = expandedId === player.id;
                const introducer = players.find(
                  (x) => x.id === player.introduced_by
                );

                // Determine tier based on dominant channel
                const mainChannel =
                  (stats?.punchTotal ?? 0) >= (stats?.gepTotal ?? 0)
                    ? "punchout"
                    : "gep";
                const euTiers = getEUTiers(
                  {
                    euTierMode: player.eu_tier_mode ?? "A",
                    introTierMode: player.intro_tier_mode ?? "A",
                  },
                  mainChannel
                );
                const tier = getTier(stats?.totalPO ?? 0, euTiers);
                const totalComm =
                  (stats?.euComm ?? 0) + (stats?.introComm ?? 0);

                return (
                  <PlayerRow
                    key={player.id}
                    player={player}
                    stats={stats}
                    tier={tier}
                    euTiers={euTiers}
                    mainChannel={mainChannel}
                    totalComm={totalComm}
                    introducer={introducer}
                    isExpanded={isExpanded}
                    players={players}
                    monthPOs={monthPOs}
                    wPlayers={wPlayers}
                    wAllPOs={wAllPOs}
                    onToggleExpand={() =>
                      setExpandedId(isExpanded ? null : player.id)
                    }
                    onEdit={() => openEditDialog(player)}
                    onRequestDelete={() => openDeleteDialog(player)}
                    onQuickTierUpdate={handleQuickTierUpdate}
                  />
                );
              })}
            </TableBody>
          </Table>
        )}
      </div>

      {/* Add Player Dialog */}
      <PlayerFormDialog
        open={showAddDialog}
        onOpenChange={setShowAddDialog}
        title="Add Player"
        description="Create a new player record."
        form={form}
        setForm={setForm}
        players={players}
        excludeId={null}
        saving={saving}
        onSubmit={handleAddPlayer}
        submitLabel="Add Player"
      />

      {/* Edit Player Dialog */}
      <PlayerFormDialog
        open={editingPlayer !== null}
        onOpenChange={(open) => {
          if (!open) setEditingPlayer(null);
        }}
        title="Edit Player"
        description="Update player details."
        form={form}
        setForm={setForm}
        players={players}
        excludeId={editingPlayer?.id ?? null}
        saving={saving}
        onSubmit={handleEditPlayer}
        submitLabel="Save Changes"
      />

      <DeletePlayerDialog
        open={confirmDeleteId !== null}
        onOpenChange={(open) => {
          if (!open) {
            setConfirmDeleteId(null);
            setDeleteConfirmText("");
          }
        }}
        player={
          confirmDeleteId
            ? (players.find((p) => p.id === confirmDeleteId) ?? null)
            : null
        }
        confirmText={deleteConfirmText}
        setConfirmText={setDeleteConfirmText}
        saving={saving}
        onConfirm={() => {
          if (confirmDeleteId) handleDeletePlayer(confirmDeleteId);
        }}
      />
    </div>
  );
}

// ── Player Form Dialog ──────────────────────────────────────

function PlayerFormDialog({
  open,
  onOpenChange,
  title,
  description,
  form,
  setForm,
  players,
  excludeId,
  saving,
  onSubmit,
  submitLabel,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  form: {
    name: string;
    eu_tier_mode: "A" | "B";
    intro_tier_mode: "A" | "B";
    introduced_by: string;
  };
  setForm: (
    f: typeof form | ((prev: typeof form) => typeof form)
  ) => void;
  players: DBPlayer[];
  excludeId: string | null;
  saving: boolean;
  onSubmit: () => void;
  submitLabel: string;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Name */}
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-500">
              Name
            </label>
            <Input
              value={form.name}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, name: e.target.value }))
              }
              placeholder="Player name"
            />
          </div>

          {/* Tier modes */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-500">
                Player Tier Mode (Proxy)
              </label>
              <div className="flex gap-1.5">
                {(["A", "B"] as const).map((opt) => (
                  <button
                    key={opt}
                    type="button"
                    onClick={() =>
                      setForm((prev) => ({
                        ...prev,
                        eu_tier_mode: opt,
                      }))
                    }
                    className={cn(
                      "flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                      form.eu_tier_mode === opt
                        ? "bg-brand-50 text-brand-600 ring-2 ring-brand-400"
                        : "bg-gray-100 text-gray-500 hover:bg-gray-200"
                    )}
                  >
                    {opt === "A" ? "A (24-33%)" : "B (33-42%)"}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-500">
                Intro Tier Mode (Grid)
              </label>
              <div className="flex gap-1.5">
                {(["A", "B"] as const).map((opt) => (
                  <button
                    key={opt}
                    type="button"
                    onClick={() =>
                      setForm((prev) => ({
                        ...prev,
                        intro_tier_mode: opt,
                      }))
                    }
                    className={cn(
                      "flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
                      form.intro_tier_mode === opt
                        ? "bg-purple-50 text-purple-600 ring-2 ring-purple-400"
                        : "bg-gray-100 text-gray-500 hover:bg-gray-200"
                    )}
                  >
                    {opt === "A" ? "A (12-21%)" : "B (21-30%)"}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Introduced By */}
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-500">
              Introduced By
            </label>
            <Select
              value={form.introduced_by || "__none__"}
              onValueChange={(v) =>
                setForm((prev) => ({
                  ...prev,
                  introduced_by: v === "__none__" ? "" : (v ?? ""),
                }))
              }
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">None</SelectItem>
                {players
                  .filter((p) => p.id !== excludeId)
                  .map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter>
          <DialogClose
            render={<Button variant="outline" />}
          >
            Cancel
          </DialogClose>
          <Button
            className="bg-brand-600 text-white hover:bg-brand-800"
            onClick={onSubmit}
            disabled={saving || !form.name.trim()}
          >
            {saving ? "Saving..." : submitLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Player Row (with expandable detail) ─────────────────────

function PlayerRow({
  player,
  stats,
  tier,
  euTiers,
  mainChannel,
  totalComm,
  introducer,
  isExpanded,
  players,
  monthPOs,
  wPlayers,
  wAllPOs,
  onToggleExpand,
  onEdit,
  onRequestDelete,
  onQuickTierUpdate,
}: {
  player: DBPlayer;
  stats:
    | {
        totalPO: number;
        euComm: number;
        introComm: number;
        poCount: number;
        gepTotal: number;
        punchTotal: number;
      }
    | undefined;
  tier: { name: string; rate: number; min: number; max: number };
  euTiers: { name: string; rate: number; min: number; max: number }[];
  mainChannel: string;
  totalComm: number;
  introducer: DBPlayer | undefined;
  isExpanded: boolean;
  players: DBPlayer[];
  monthPOs: DBPO[];
  wPlayers: WaterfallPlayer[];
  wAllPOs: WaterfallPO[];
  onToggleExpand: () => void;
  onEdit: () => void;
  onRequestDelete: () => void;
  onQuickTierUpdate: (
    id: string,
    field: "eu_tier_mode" | "intro_tier_mode",
    value: "A" | "B"
  ) => void;
}) {
  const playerPOs = monthPOs.filter(
    (po) => po.end_user_id === player.id
  );
  const recruits = players.filter((p) => p.introduced_by === player.id);

  return (
    <>
      {/* Main row */}
      <TableRow
        className={cn(
          "cursor-pointer",
          isExpanded && "bg-brand-50/30"
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
        <TableCell className="font-medium text-gray-800">
          {player.name}
        </TableCell>
        <TableCell>
          <span className="font-mono text-xs font-medium text-brand-600">
            {tier.name} ({tier.rate}%)
          </span>
        </TableCell>
        <TableCell className="font-mono text-sm">
          {(stats?.totalPO ?? 0) > 0 ? fmt(stats!.totalPO) : "--"}
        </TableCell>
        <TableCell>
          <div className="flex gap-1">
            {(stats?.gepTotal ?? 0) > 0 && (
              <ChannelBadge channel="gep" />
            )}
            {(stats?.punchTotal ?? 0) > 0 && (
              <ChannelBadge channel="punchout" />
            )}
            {(stats?.totalPO ?? 0) === 0 && (
              <span className="text-xs text-gray-400">--</span>
            )}
          </div>
        </TableCell>
        <TableCell className="font-mono text-sm font-medium text-brand-600">
          {totalComm > 0 ? fmt(totalComm) : "--"}
        </TableCell>
        <TableCell className="text-xs text-gray-500">
          {introducer?.name ?? "--"}
        </TableCell>
        <TableCell>
          <div
            className="flex items-center justify-end gap-1"
            onClick={(e) => e.stopPropagation()}
          >
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={onEdit}
              title="Edit player"
            >
              <Pencil className="size-3 text-gray-400" />
            </Button>
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={onRequestDelete}
              title="Delete player"
            >
              <Trash2 className="size-3 text-danger-400" />
            </Button>
          </div>
        </TableCell>
      </TableRow>

      {/* Expanded detail */}
      {isExpanded && (
        <TableRow className="bg-brand-50/20 hover:bg-brand-50/20">
          <TableCell colSpan={8} className="p-0">
            <div className="space-y-4 p-5">
              {/* Tier mode quick toggles */}
              <div className="flex gap-6">
                <div>
                  <p className="mb-1.5 text-[10px] font-medium uppercase tracking-wider text-gray-500">
                    Player Tier Mode (Proxy)
                  </p>
                  <div className="flex gap-1">
                    {(["A", "B"] as const).map((opt) => (
                      <button
                        key={opt}
                        type="button"
                        onClick={() =>
                          onQuickTierUpdate(
                            player.id,
                            "eu_tier_mode",
                            opt
                          )
                        }
                        className={cn(
                          "rounded-md px-3 py-1 text-[10px] font-medium transition-colors",
                          (player.eu_tier_mode ?? "A") === opt
                            ? "bg-brand-50 text-brand-600 ring-2 ring-brand-400"
                            : "bg-gray-100 text-gray-500 hover:bg-gray-200"
                        )}
                      >
                        {opt}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="mb-1.5 text-[10px] font-medium uppercase tracking-wider text-gray-500">
                    Intro Tier Mode (Grid)
                  </p>
                  <div className="flex gap-1">
                    {(["A", "B"] as const).map((opt) => (
                      <button
                        key={opt}
                        type="button"
                        onClick={() =>
                          onQuickTierUpdate(
                            player.id,
                            "intro_tier_mode",
                            opt
                          )
                        }
                        className={cn(
                          "rounded-md px-3 py-1 text-[10px] font-medium transition-colors",
                          (player.intro_tier_mode ?? "A") === opt
                            ? "bg-purple-50 text-purple-600 ring-2 ring-purple-400"
                            : "bg-gray-100 text-gray-500 hover:bg-gray-200"
                        )}
                      >
                        {opt}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Tier progress */}
              {(stats?.totalPO ?? 0) > 0 && (
                <div className="max-w-xs">
                  <TierCard
                    tier={tier}
                    tiers={euTiers}
                    volume={stats!.totalPO}
                    color={mainChannel === "gep" ? "brand" : "accent"}
                    label="of pool"
                  />
                </div>
              )}

              {/* End-User Earnings */}
              <div className="rounded-lg border border-brand-100 bg-brand-50/30 p-4">
                <p className="mb-3 text-[10px] font-medium uppercase tracking-wider text-brand-600">
                  Player Earnings
                </p>
                {playerPOs.length === 0 ? (
                  <p className="py-4 text-center text-xs text-gray-500">
                    No POs this month. Add POs in the PO Cycle page.
                  </p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-[9px] uppercase tracking-wider text-brand-600">
                          Ref
                        </TableHead>
                        <TableHead className="text-[9px] uppercase tracking-wider text-brand-600">
                          Channel
                        </TableHead>
                        <TableHead className="text-[9px] uppercase tracking-wider text-brand-600">
                          Date
                        </TableHead>
                        <TableHead className="text-[9px] uppercase tracking-wider text-brand-600">
                          PO Amount
                        </TableHead>
                        <TableHead className="text-[9px] uppercase tracking-wider text-brand-600">
                          Commission
                        </TableHead>
                        <TableHead className="text-[9px] uppercase tracking-wider text-brand-600">
                          Status
                        </TableHead>
                        <TableHead className="text-[9px] uppercase tracking-wider text-brand-600">
                          Comm Status
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {playerPOs.map((po) => {
                        const w = calcPOWaterfall(
                          toWaterfallPO(po),
                          wPlayers,
                          wAllPOs
                        );
                        const status = getPOStatus(po);
                        const commStatus = getCommissionStatus(po);
                        return (
                          <TableRow key={po.id}>
                            <TableCell className="font-mono text-xs font-medium text-brand-600">
                              {po.ref}
                            </TableCell>
                            <TableCell>
                              <ChannelBadge
                                channel={
                                  po.channel as "punchout" | "gep"
                                }
                              />
                            </TableCell>
                            <TableCell className="text-xs text-gray-500">
                              {po.po_date}
                            </TableCell>
                            <TableCell className="font-mono text-xs">
                              {fmt(po.po_amount)}
                            </TableCell>
                            <TableCell className="font-mono text-xs font-medium text-brand-600">
                              {fmt(w.euAmt)}
                            </TableCell>
                            <TableCell>
                              <StatusBadge status={status} />
                            </TableCell>
                            <TableCell>
                              <CommissionStatusBadge status={commStatus} />
                            </TableCell>
                          </TableRow>
                        );
                      })}
                      {/* Total row */}
                      <TableRow className="border-t-2 border-gray-200">
                        <TableCell
                          colSpan={3}
                          className="text-xs font-medium"
                        >
                          Total
                        </TableCell>
                        <TableCell className="font-mono text-xs font-medium">
                          {fmt(stats?.totalPO ?? 0)}
                        </TableCell>
                        <TableCell className="font-mono text-xs font-medium text-brand-600">
                          {fmt(stats?.euComm ?? 0)}
                        </TableCell>
                        <TableCell colSpan={2} />
                      </TableRow>
                    </TableBody>
                  </Table>
                )}
              </div>

              {/* Introducer Earnings */}
              {recruits.length > 0 && (
                <IntroducerEarnings
                  player={player}
                  recruits={recruits}
                  monthPOs={monthPOs}
                  wPlayers={wPlayers}
                  wAllPOs={wAllPOs}
                  introComm={stats?.introComm ?? 0}
                />
              )}
            </div>
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

// ── Introducer Earnings sub-component ───────────────────────

function IntroducerEarnings({
  player,
  recruits,
  monthPOs,
  wPlayers,
  wAllPOs,
  introComm,
}: {
  player: DBPlayer;
  recruits: DBPlayer[];
  monthPOs: DBPO[];
  wPlayers: WaterfallPlayer[];
  wAllPOs: WaterfallPO[];
  introComm: number;
}) {
  const recruitData = recruits.map((r) => {
    const rPOs = monthPOs.filter((po) => po.end_user_id === r.id);
    const rTotal = rPOs.reduce((s, po) => s + po.po_amount, 0);
    const rIntro = rPOs.reduce((s, po) => {
      const w = calcPOWaterfall(toWaterfallPO(po), wPlayers, wAllPOs);
      return s + w.introAmt;
    }, 0);
    return { name: r.name, monthlyPO: rTotal, introComm: rIntro };
  });

  const groupPO = recruitData.reduce((s, r) => s + r.monthlyPO, 0);

  return (
    <div className="rounded-lg border border-purple-100 bg-purple-50/30 p-4">
      <p className="mb-3 text-[10px] font-medium uppercase tracking-wider text-purple-600">
        Introducer Earnings
      </p>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="text-[9px] uppercase tracking-wider text-purple-600">
              Recruit
            </TableHead>
            <TableHead className="text-[9px] uppercase tracking-wider text-purple-600">
              Monthly PO
            </TableHead>
            <TableHead className="text-[9px] uppercase tracking-wider text-purple-600">
              Intro Commission
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {recruitData.map((r) => (
            <TableRow key={r.name}>
              <TableCell className="text-xs font-medium">
                {r.name}
              </TableCell>
              <TableCell className="font-mono text-xs">
                {fmt(r.monthlyPO)}
              </TableCell>
              <TableCell className="font-mono text-xs font-medium text-purple-600">
                {fmt(r.introComm)}
              </TableCell>
            </TableRow>
          ))}
          <TableRow className="border-t-2 border-gray-200">
            <TableCell className="text-xs font-medium">Total</TableCell>
            <TableCell className="font-mono text-xs font-medium">
              {fmt(groupPO)}
            </TableCell>
            <TableCell className="font-mono text-xs font-medium text-purple-600">
              {fmt(introComm)}
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
    </div>
  );
}

// ── Delete Player Dialog ─────────────────────────────────────

function DeletePlayerDialog({
  open,
  onOpenChange,
  player,
  confirmText,
  setConfirmText,
  saving,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  player: DBPlayer | null;
  confirmText: string;
  setConfirmText: (v: string) => void;
  saving: boolean;
  onConfirm: () => void;
}) {
  const canDelete =
    player !== null && confirmText.trim() === player.name && !saving;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Delete player</DialogTitle>
          <DialogDescription>
            This permanently removes{" "}
            <span className="font-semibold text-gray-800">
              {player?.name ?? ""}
            </span>{" "}
            and cascades to their purchase orders and delivery orders. There
            is no undo.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <label className="block text-xs font-medium text-gray-500">
            Type{" "}
            <span className="font-mono font-semibold text-gray-800">
              {player?.name ?? ""}
            </span>{" "}
            to confirm
          </label>
          <Input
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder={player?.name ?? ""}
            autoFocus
          />
        </div>

        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
          <Button
            variant="destructive"
            onClick={onConfirm}
            disabled={!canDelete}
          >
            {saving ? "Deleting..." : "Delete permanently"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
