"use client";

import {
  Fragment,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
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
import {
  fmt,
  fmtSigned,
  getMonth,
  fmtMonth,
} from "@/lib/business-logic/formatters";
import { useSelectedMonth } from "@/lib/hooks/use-selected-month";

// Shared components
import { MetricCard } from "@/components/metric-card";
import { TierCard } from "@/components/tier-card";
import { ChannelBadge } from "@/components/channel-badge";
import { StatusBadge, type POStatus } from "@/components/status-badge";
import { MonthPicker } from "@/components/month-picker";
import { CommissionStatusBadge } from "@/components/commission-status-badge";
import { getCommissionStatus } from "@/lib/business-logic/commission-status";

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

type EUProxyMode = "A" | "A_PLUS" | "B";
type EUGridMode = "A" | "B";
type IntroMode = "A" | "A_PLUS" | "B";

const EU_PROXY_MODES: readonly EUProxyMode[] = ["A", "A_PLUS", "B"] as const;
const EU_GRID_MODES: readonly EUGridMode[] = ["A", "B"] as const;
const INTRO_MODES: readonly IntroMode[] = ["A", "A_PLUS", "B"] as const;

const EU_PROXY_LABELS: Record<EUProxyMode, string> = {
  A: "Default (24-33%)",
  A_PLUS: "Premium (30-39%)",
  B: "Exclusive (33-42%)",
};

const EU_GRID_LABELS: Record<EUGridMode, string> = {
  A: "Default (21-30%)",
  B: "Exclusive (24-33%)",
};

const INTRO_PROXY_LABELS: Record<IntroMode, string> = {
  A: "Default (12-21%)",
  A_PLUS: "Premium (30-39%)",
  B: "Exclusive (21-30%)",
};

const INTRO_GRID_LABELS: Record<IntroMode, string> = {
  A: "Default (21-30%)",
  A_PLUS: "Premium (30-39%)",
  B: "Exclusive (27-36%)",
};

function narrowEUProxy(v: string): EUProxyMode {
  return v === "B" || v === "A_PLUS" ? v : "A";
}

function narrowEUGrid(v: string): EUGridMode {
  return v === "B" ? "B" : "A";
}

function narrowIntro(v: string): IntroMode {
  return v === "B" || v === "A_PLUS" ? v : "A";
}

// ── DB → Business-logic mappers ─────────────────────────────

function toWaterfallPlayer(p: DBPlayer): WaterfallPlayer {
  return {
    id: p.id,
    euTierModeProxy: p.eu_tier_mode_proxy,
    euTierModeGrid: p.eu_tier_mode_grid,
    introTierModeProxy: p.intro_tier_mode_proxy,
    introTierModeGrid: p.intro_tier_mode_grid,
    introducedBy: p.introduced_by,
    uplineId: p.upline_id,
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

  // Form state — DB defaults: eu_proxy 'A', eu_grid 'B', intro_proxy 'A', intro_grid 'A'.
  // allow_introducer defaults to false for newly-added players; admin opts in.
  const emptyForm = {
    name: "",
    eu_tier_mode_proxy: "A" as EUProxyMode,
    eu_tier_mode_grid: "B" as EUGridMode,
    intro_tier_mode_proxy: "A" as IntroMode,
    intro_tier_mode_grid: "A" as IntroMode,
    introduced_by: "",
    upline_id: "",
    allow_introducer: false,
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
        // Players page doesn't fetch deployments — assume full funding for
        // commission preview. Entity page is the authoritative reconciliation.
        const w = calcPOWaterfall(toWaterfallPO(po), wPlayers, wAllPOs, po.po_amount);
        // Net the player's loss share so loss-making POs surface as negative,
        // mirroring the introducer aggregation below.
        euComm += w.euAmt - w.playerLossShare;
        if (po.channel === "gep") gepTotal += po.po_amount;
        else punchTotal += po.po_amount;
      }

      // Introducer earnings: commissions from recruits' POs, net of any
      // loss share the introducer absorbs when supplier cost exceeds PO.
      const recruits = players.filter((r) => r.introduced_by === p.id);
      let introComm = 0;
      for (const r of recruits) {
        const recruitPOs = monthPOs.filter(
          (po) => po.end_user_id === r.id
        );
        for (const po of recruitPOs) {
          const w = calcPOWaterfall(toWaterfallPO(po), wPlayers, wAllPOs, po.po_amount);
          introComm += w.introAmt - w.introducerLossShare;
        }
      }

      // Upline earnings: when this player is somebody else's upline, the
      // dual-intro split routes (1 − introRate%) of the chunk to them.
      // Find downlines (B's whose upline_id is this player), then sum
      // (uplineAmt − uplineLossShare) over POs from B's recruits.
      const downlines = players.filter((d) => d.upline_id === p.id);
      for (const dl of downlines) {
        const dlRecruits = players.filter((r) => r.introduced_by === dl.id);
        for (const r of dlRecruits) {
          const dlRecruitPOs = monthPOs.filter(
            (po) => po.end_user_id === r.id
          );
          for (const po of dlRecruitPOs) {
            const w = calcPOWaterfall(
              toWaterfallPO(po),
              wPlayers,
              wAllPOs,
              po.po_amount
            );
            introComm += w.uplineAmt - w.uplineLossShare;
          }
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
      eu_tier_mode_proxy: form.eu_tier_mode_proxy,
      eu_tier_mode_grid: form.eu_tier_mode_grid,
      intro_tier_mode_proxy: form.intro_tier_mode_proxy,
      intro_tier_mode_grid: form.intro_tier_mode_grid,
      introduced_by: form.introduced_by || null,
      upline_id: form.upline_id || null,
      allow_introducer: form.allow_introducer,
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
        eu_tier_mode_proxy: form.eu_tier_mode_proxy,
        eu_tier_mode_grid: form.eu_tier_mode_grid,
        intro_tier_mode_proxy: form.intro_tier_mode_proxy,
        intro_tier_mode_grid: form.intro_tier_mode_grid,
        introduced_by: form.introduced_by || null,
        upline_id: form.upline_id || null,
        allow_introducer: form.allow_introducer,
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

  type TierField =
    | "eu_tier_mode_proxy"
    | "eu_tier_mode_grid"
    | "intro_tier_mode_proxy"
    | "intro_tier_mode_grid";

  async function handleQuickTierUpdate(
    id: string,
    field: TierField,
    value: string
  ) {
    // Build an explicitly-typed update payload to satisfy Supabase's
    // RejectExcessProperties guard, which forbids dynamic-keyed objects.
    const update =
      field === "eu_tier_mode_proxy"
        ? { eu_tier_mode_proxy: value }
        : field === "eu_tier_mode_grid"
          ? { eu_tier_mode_grid: value }
          : field === "intro_tier_mode_proxy"
            ? { intro_tier_mode_proxy: value }
            : { intro_tier_mode_grid: value };
    await supabase.from("players").update(update).eq("id", id);
    setPlayers((prev) =>
      prev.map((p) => (p.id === id ? { ...p, [field]: value } : p))
    );
  }

  function openEditDialog(player: DBPlayer) {
    setForm({
      name: player.name,
      eu_tier_mode_proxy: narrowEUProxy(player.eu_tier_mode_proxy),
      eu_tier_mode_grid: narrowEUGrid(player.eu_tier_mode_grid),
      intro_tier_mode_proxy: narrowIntro(player.intro_tier_mode_proxy),
      intro_tier_mode_grid: narrowIntro(player.intro_tier_mode_grid),
      introduced_by: player.introduced_by ?? "",
      upline_id: player.upline_id ?? "",
      allow_introducer: player.allow_introducer,
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
          value={fmtSigned(totalCommissions)}
          subtitle="Player + Introducer"
          color={totalCommissions < 0 ? "danger" : "brand"}
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

                // Per-channel tiers — each ladder is independent.
                const tierMode = {
                  euTierModeProxy: player.eu_tier_mode_proxy,
                  euTierModeGrid: player.eu_tier_mode_grid,
                  introTierModeProxy: player.intro_tier_mode_proxy,
                  introTierModeGrid: player.intro_tier_mode_grid,
                };
                const punchTiers = getEUTiers(tierMode, "punchout");
                const gepTiers = getEUTiers(tierMode, "gep");
                const punchTier = getTier(stats?.punchTotal ?? 0, punchTiers);
                const gepTier = getTier(stats?.gepTotal ?? 0, gepTiers);
                const totalComm =
                  (stats?.euComm ?? 0) + (stats?.introComm ?? 0);

                return (
                  <PlayerRow
                    key={player.id}
                    player={player}
                    stats={stats}
                    punchTier={punchTier}
                    gepTier={gepTier}
                    punchTiers={punchTiers}
                    gepTiers={gepTiers}
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
    eu_tier_mode_proxy: EUProxyMode;
    eu_tier_mode_grid: EUGridMode;
    intro_tier_mode_proxy: IntroMode;
    intro_tier_mode_grid: IntroMode;
    introduced_by: string;
    upline_id: string;
    allow_introducer: boolean;
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

          {/* Tier modes — 4 toggles, stacked grid */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-500">
                Player Tier (P)
              </label>
              <div className="flex flex-col gap-1">
                {EU_PROXY_MODES.map((opt) => (
                  <button
                    key={opt}
                    type="button"
                    onClick={() =>
                      setForm((prev) => ({ ...prev, eu_tier_mode_proxy: opt }))
                    }
                    className={cn(
                      "rounded-md px-3 py-1.5 text-left text-[11px] font-medium transition-colors",
                      form.eu_tier_mode_proxy === opt
                        ? "bg-brand-50 text-brand-600 ring-2 ring-brand-400"
                        : "bg-gray-100 text-gray-500 hover:bg-gray-200"
                    )}
                  >
                    {EU_PROXY_LABELS[opt]}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-500">
                Player Tier (G)
              </label>
              <div className="flex flex-col gap-1">
                {EU_GRID_MODES.map((opt) => (
                  <button
                    key={opt}
                    type="button"
                    onClick={() =>
                      setForm((prev) => ({ ...prev, eu_tier_mode_grid: opt }))
                    }
                    className={cn(
                      "rounded-md px-3 py-1.5 text-left text-[11px] font-medium transition-colors",
                      form.eu_tier_mode_grid === opt
                        ? "bg-brand-50 text-brand-600 ring-2 ring-brand-400"
                        : "bg-gray-100 text-gray-500 hover:bg-gray-200"
                    )}
                  >
                    {EU_GRID_LABELS[opt]}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-500">
                Intro Tier (P)
              </label>
              <div className="flex flex-col gap-1">
                {INTRO_MODES.map((opt) => (
                  <button
                    key={opt}
                    type="button"
                    onClick={() =>
                      setForm((prev) => ({
                        ...prev,
                        intro_tier_mode_proxy: opt,
                      }))
                    }
                    className={cn(
                      "rounded-md px-3 py-1.5 text-left text-[11px] font-medium transition-colors",
                      form.intro_tier_mode_proxy === opt
                        ? "bg-purple-50 text-purple-600 ring-2 ring-purple-400"
                        : "bg-gray-100 text-gray-500 hover:bg-gray-200"
                    )}
                  >
                    {INTRO_PROXY_LABELS[opt]}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-500">
                Intro Tier (G)
              </label>
              <div className="flex flex-col gap-1">
                {INTRO_MODES.map((opt) => (
                  <button
                    key={opt}
                    type="button"
                    onClick={() =>
                      setForm((prev) => ({
                        ...prev,
                        intro_tier_mode_grid: opt,
                      }))
                    }
                    className={cn(
                      "rounded-md px-3 py-1.5 text-left text-[11px] font-medium transition-colors",
                      form.intro_tier_mode_grid === opt
                        ? "bg-purple-50 text-purple-600 ring-2 ring-purple-400"
                        : "bg-gray-100 text-gray-500 hover:bg-gray-200"
                    )}
                  >
                    {INTRO_GRID_LABELS[opt]}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Introducer Network — controls whether the player UI shows
              the Introducer Commission tab + simulator cards. Display only;
              commission math is unaffected. Default for new players: Off. */}
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-500">
              Introducer Network
            </label>
            <div className="flex gap-1">
              {([false, true] as const).map((opt) => (
                <button
                  key={String(opt)}
                  type="button"
                  onClick={() =>
                    setForm((prev) => ({ ...prev, allow_introducer: opt }))
                  }
                  className={cn(
                    "flex-1 rounded-md px-3 py-1.5 text-[11px] font-medium transition-colors",
                    form.allow_introducer === opt
                      ? "bg-purple-50 text-purple-600 ring-2 ring-purple-400"
                      : "bg-gray-100 text-gray-500 hover:bg-gray-200"
                  )}
                >
                  {opt ? "On" : "Off"}
                </button>
              ))}
            </div>
            <p className="mt-1 text-[10px] leading-snug text-gray-500">
              When Off, this player&apos;s app hides the Introducer Commission
              tab and the simulator&apos;s Introducer + Downline cards.
            </p>
          </div>

          {/* Introduced By */}
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-500">
              Introduced By
            </label>
            <Select
              items={[
                { value: "__none__", label: "None" },
                ...players
                  .filter((p) => p.id !== excludeId)
                  .map((p) => ({ value: p.id, label: p.name })),
              ]}
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

          {/* Upline (optional dual-introducer) — when set, this player's
              own intro commission chunk is split with their upline using
              the same tier rate that sizes the chunk. Candidates must
              have no upline of their own (chain depth = 1).
              Hidden if this player is currently somebody else's upline,
              to enforce the same depth invariant from the other side. */}
          {(() => {
            const isCurrentlyAnUpline = excludeId
              ? players.some((p) => p.upline_id === excludeId)
              : false;
            if (isCurrentlyAnUpline) {
              return (
                <div className="rounded-md bg-amber-50 px-3 py-2 text-[11px] text-amber-700 ring-1 ring-amber-200">
                  This player is already an upline for someone else, so
                  they cannot themselves have an upline. Chain depth is
                  one level.
                </div>
              );
            }
            const candidates = players.filter(
              (p) => p.id !== excludeId && p.upline_id == null
            );
            return (
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-500">
                  Upline <span className="text-gray-400">(optional)</span>
                </label>
                <Select
                  items={[
                    { value: "__none__", label: "None" },
                    ...candidates.map((p) => ({ value: p.id, label: p.name })),
                  ]}
                  value={form.upline_id || "__none__"}
                  onValueChange={(v) =>
                    setForm((prev) => ({
                      ...prev,
                      upline_id: v === "__none__" ? "" : (v ?? ""),
                    }))
                  }
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">None</SelectItem>
                    {candidates.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="mt-1 text-[10px] leading-snug text-gray-500">
                  When set, this player&apos;s intro commission is split:
                  they keep their own tier % (24/27/30/33), the upline
                  gets the rest.
                </p>
              </div>
            );
          })()}
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
  punchTier,
  gepTier,
  punchTiers,
  gepTiers,
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
  punchTier: { name: string; rate: number; min: number; max: number };
  gepTier: { name: string; rate: number; min: number; max: number };
  punchTiers: { name: string; rate: number; min: number; max: number }[];
  gepTiers: { name: string; rate: number; min: number; max: number }[];
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
    field:
      | "eu_tier_mode_proxy"
      | "eu_tier_mode_grid"
      | "intro_tier_mode_proxy"
      | "intro_tier_mode_grid",
    value: string
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
          <div className="flex items-center gap-1.5">
            <span>{player.name}</span>
            {player.allow_introducer && (
              <span className="rounded bg-purple-50 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wider text-purple-600 ring-1 ring-purple-200">
                +Intro
              </span>
            )}
          </div>
        </TableCell>
        <TableCell>
          {(stats?.punchTotal ?? 0) === 0 && (stats?.gepTotal ?? 0) === 0 ? (
            <span className="text-xs text-gray-400">--</span>
          ) : (
            <div className="flex flex-col gap-0.5">
              {(stats?.punchTotal ?? 0) > 0 && (
                <span className="font-mono text-xs font-medium text-accent-600">
                  P: {punchTier.name} ({punchTier.rate}%)
                </span>
              )}
              {(stats?.gepTotal ?? 0) > 0 && (
                <span className="font-mono text-xs font-medium text-brand-600">
                  G: {gepTier.name} ({gepTier.rate}%)
                </span>
              )}
            </div>
          )}
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
        <TableCell
          className={cn(
            "font-mono text-sm font-medium",
            totalComm < 0 ? "text-danger-600" : "text-brand-600"
          )}
        >
          {totalComm === 0 ? "--" : fmtSigned(totalComm)}
        </TableCell>
        <TableCell className="text-xs text-gray-500">
          <div className="flex flex-col gap-0.5">
            <span>{introducer?.name ?? "--"}</span>
            {player.upline_id && (
              <span className="font-mono text-[9px] uppercase tracking-wider text-purple-600">
                + upline:{" "}
                {players.find((p) => p.id === player.upline_id)?.name ?? "?"}
              </span>
            )}
          </div>
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
              {/* Tier mode quick toggles — 4 channels x mode pairs */}
              <div className="grid grid-cols-2 gap-x-6 gap-y-3">
                <div>
                  <p className="mb-1.5 text-[10px] font-medium uppercase tracking-wider text-gray-500">
                    Player Tier (P)
                  </p>
                  <div className="flex gap-1">
                    {EU_PROXY_MODES.map((opt) => (
                      <button
                        key={opt}
                        type="button"
                        onClick={() =>
                          onQuickTierUpdate(player.id, "eu_tier_mode_proxy", opt)
                        }
                        className={cn(
                          "rounded-md px-3 py-1 text-[10px] font-medium transition-colors",
                          narrowEUProxy(player.eu_tier_mode_proxy) === opt
                            ? "bg-brand-50 text-brand-600 ring-2 ring-brand-400"
                            : "bg-gray-100 text-gray-500 hover:bg-gray-200"
                        )}
                      >
                        {opt === "A_PLUS" ? "A+" : opt}
                      </button>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="mb-1.5 text-[10px] font-medium uppercase tracking-wider text-gray-500">
                    Player Tier (G)
                  </p>
                  <div className="flex gap-1">
                    {EU_GRID_MODES.map((opt) => (
                      <button
                        key={opt}
                        type="button"
                        onClick={() =>
                          onQuickTierUpdate(player.id, "eu_tier_mode_grid", opt)
                        }
                        className={cn(
                          "rounded-md px-3 py-1 text-[10px] font-medium transition-colors",
                          narrowEUGrid(player.eu_tier_mode_grid) === opt
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
                    Intro Tier (P)
                  </p>
                  <div className="flex gap-1">
                    {INTRO_MODES.map((opt) => (
                      <button
                        key={opt}
                        type="button"
                        onClick={() =>
                          onQuickTierUpdate(
                            player.id,
                            "intro_tier_mode_proxy",
                            opt
                          )
                        }
                        className={cn(
                          "rounded-md px-3 py-1 text-[10px] font-medium transition-colors",
                          narrowIntro(player.intro_tier_mode_proxy) === opt
                            ? "bg-purple-50 text-purple-600 ring-2 ring-purple-400"
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
                    Intro Tier (G)
                  </p>
                  <div className="flex gap-1">
                    {INTRO_MODES.map((opt) => (
                      <button
                        key={opt}
                        type="button"
                        onClick={() =>
                          onQuickTierUpdate(
                            player.id,
                            "intro_tier_mode_grid",
                            opt
                          )
                        }
                        className={cn(
                          "rounded-md px-3 py-1 text-[10px] font-medium transition-colors",
                          narrowIntro(player.intro_tier_mode_grid) === opt
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

              {/* Tier progress — one card per channel */}
              {(stats?.totalPO ?? 0) > 0 && (
                <div className="flex flex-wrap gap-6">
                  {(stats?.punchTotal ?? 0) > 0 && (
                    <div className="max-w-xs flex-1 rounded-lg border border-accent-100 bg-white p-4">
                      <div className="mb-3 flex items-center gap-2">
                        <ChannelBadge channel="punchout" />
                        <span className="text-[10px] uppercase tracking-wider text-gray-500">
                          Tier Progress
                        </span>
                      </div>
                      <TierCard
                        tier={punchTier}
                        tiers={punchTiers}
                        volume={stats!.punchTotal}
                        color="accent"
                        label="of pool"
                      />
                    </div>
                  )}
                  {(stats?.gepTotal ?? 0) > 0 && (
                    <div className="max-w-xs flex-1 rounded-lg border border-brand-100 bg-white p-4">
                      <div className="mb-3 flex items-center gap-2">
                        <ChannelBadge channel="gep" />
                        <span className="text-[10px] uppercase tracking-wider text-gray-500">
                          Tier Progress
                        </span>
                      </div>
                      <TierCard
                        tier={gepTier}
                        tiers={gepTiers}
                        volume={stats!.gepTotal}
                        color="brand"
                        label="of pool"
                      />
                    </div>
                  )}
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
                          wAllPOs,
                          po.po_amount
                        );
                        const status = getPOStatus(po);
                        const commStatus = getCommissionStatus(po);
                        const netEuComm = w.euAmt - w.playerLossShare;
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
                            <TableCell
                              className={cn(
                                "font-mono text-xs font-medium",
                                netEuComm < 0 ? "text-danger-600" : "text-brand-600"
                              )}
                            >
                              {fmtSigned(netEuComm)}
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
                        <TableCell
                          className={cn(
                            "font-mono text-xs font-medium",
                            (stats?.euComm ?? 0) < 0 ? "text-danger-600" : "text-brand-600"
                          )}
                        >
                          {fmtSigned(stats?.euComm ?? 0)}
                        </TableCell>
                        <TableCell colSpan={2} />
                      </TableRow>
                    </TableBody>
                  </Table>
                )}
              </div>

              {/* Introducer Earnings — also fires when the player is
                  somebody's upline (no direct recruits but earns the
                  upline slice from downline B's recruits). */}
              {(recruits.length > 0 ||
                players.some((d) => d.upline_id === player.id)) && (
                <IntroducerEarnings
                  player={player}
                  recruits={recruits}
                  allPlayers={players}
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
  allPlayers,
  monthPOs,
  wPlayers,
  wAllPOs,
  introComm,
}: {
  player: DBPlayer;
  recruits: DBPlayer[];
  allPlayers: DBPlayer[];
  monthPOs: DBPO[];
  wPlayers: WaterfallPlayer[];
  wAllPOs: WaterfallPO[];
  introComm: number;
}) {
  const [expandedRecruitId, setExpandedRecruitId] = useState<string | null>(
    null
  );

  const recruitData = recruits.map((r) => {
    const rPOs = monthPOs.filter((po) => po.end_user_id === r.id);
    const poBreakdown = rPOs.map((po) => {
      const w = calcPOWaterfall(
        toWaterfallPO(po),
        wPlayers,
        wAllPOs,
        po.po_amount
      );
      return {
        id: po.id,
        ref: po.ref,
        date: po.po_date,
        channel: po.channel as "punchout" | "gep",
        poAmount: po.po_amount,
        netIntroAmt: w.introAmt - w.introducerLossShare,
        commStatus: getCommissionStatus(po),
      };
    });
    const rTotal = poBreakdown.reduce((s, p) => s + p.poAmount, 0);
    const rIntro = poBreakdown.reduce((s, p) => s + p.netIntroAmt, 0);
    return {
      id: r.id,
      name: r.name,
      monthlyPO: rTotal,
      introComm: rIntro,
      pos: poBreakdown,
    };
  });

  const groupPO = recruitData.reduce((s, r) => s + r.monthlyPO, 0);

  // Downline earnings — when this player is somebody's upline, gather
  // POs from each downline's recruits and surface this player's upline
  // slice (uplineAmt, the bigger piece — typically 67–76% of the chunk).
  const downlines = allPlayers.filter((d) => d.upline_id === player.id);
  const downlineData = downlines.map((dl) => {
    const dlRecruits = allPlayers.filter((x) => x.introduced_by === dl.id);
    const pos = monthPOs
      .filter((po) => dlRecruits.some((r) => r.id === po.end_user_id))
      .map((po) => {
        const w = calcPOWaterfall(
          toWaterfallPO(po),
          wPlayers,
          wAllPOs,
          po.po_amount
        );
        const recruit = dlRecruits.find((r) => r.id === po.end_user_id);
        return {
          id: po.id,
          ref: po.ref,
          date: po.po_date,
          channel: po.channel as "punchout" | "gep",
          poAmount: po.po_amount,
          recruitName: recruit?.name ?? "—",
          netUplineAmt: w.uplineAmt - w.uplineLossShare,
          commStatus: getCommissionStatus(po),
        };
      });
    return {
      id: dl.id,
      name: dl.name,
      monthlyPO: pos.reduce((s, p) => s + p.poAmount, 0),
      uplineComm: pos.reduce((s, p) => s + p.netUplineAmt, 0),
      pos,
    };
  });

  const directIntroTotal = recruitData.reduce(
    (s, r) => s + r.introComm,
    0
  );
  const downlineUplineTotal = downlineData.reduce(
    (s, d) => s + d.uplineComm,
    0
  );
  const hasDownlineEarnings = downlineData.some((dl) => dl.pos.length > 0);

  return (
    <div className="space-y-4 rounded-lg border border-purple-100 bg-purple-50/30 p-4">
      <p className="text-[10px] font-medium uppercase tracking-wider text-purple-600">
        Introducer Earnings
      </p>
      {recruits.length > 0 && (
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-6 pr-0" />
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
          {recruitData.map((r) => {
            const isExpanded = expandedRecruitId === r.id;
            return (
              <Fragment key={r.id}>
                <TableRow
                  className={cn(
                    "cursor-pointer",
                    isExpanded && "bg-purple-100/40"
                  )}
                  onClick={() =>
                    setExpandedRecruitId(isExpanded ? null : r.id)
                  }
                >
                  <TableCell className="w-6 pr-0">
                    {isExpanded ? (
                      <ChevronDown
                        className="size-3.5 text-purple-600"
                        strokeWidth={2}
                      />
                    ) : (
                      <ChevronRight
                        className="size-3.5 text-purple-600"
                        strokeWidth={2}
                      />
                    )}
                  </TableCell>
                  <TableCell className="text-xs font-medium">
                    {r.name}
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {fmt(r.monthlyPO)}
                  </TableCell>
                  <TableCell
                    className={cn(
                      "font-mono text-xs font-medium",
                      r.introComm < 0
                        ? "text-danger-600"
                        : "text-purple-600"
                    )}
                  >
                    {fmtSigned(r.introComm)}
                  </TableCell>
                </TableRow>

                {isExpanded && (
                  <TableRow className="hover:bg-transparent">
                    <TableCell
                      colSpan={4}
                      className="border-b border-purple-100 bg-purple-50/40 px-2 pb-4 pt-0"
                    >
                      <div className="rounded-lg border border-purple-100 bg-white p-3">
                        {r.pos.length === 0 ? (
                          <p className="text-center text-xs text-gray-500">
                            No POs this month
                          </p>
                        ) : (
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead className="text-[9px] uppercase tracking-wider text-purple-600">
                                  Ref
                                </TableHead>
                                <TableHead className="text-[9px] uppercase tracking-wider text-purple-600">
                                  Date
                                </TableHead>
                                <TableHead className="text-[9px] uppercase tracking-wider text-purple-600">
                                  Channel
                                </TableHead>
                                <TableHead className="text-right text-[9px] uppercase tracking-wider text-purple-600">
                                  PO Amount
                                </TableHead>
                                <TableHead className="text-right text-[9px] uppercase tracking-wider text-purple-600">
                                  Intro Commission
                                </TableHead>
                                <TableHead className="text-[9px] uppercase tracking-wider text-purple-600">
                                  Comm Status
                                </TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {r.pos.map((p) => (
                                <TableRow key={p.id}>
                                  <TableCell
                                    className={cn(
                                      "font-mono text-xs font-medium",
                                      p.channel === "gep"
                                        ? "text-brand-600"
                                        : "text-accent-600"
                                    )}
                                  >
                                    {p.ref}
                                  </TableCell>
                                  <TableCell className="text-xs text-gray-500">
                                    {p.date}
                                  </TableCell>
                                  <TableCell>
                                    <ChannelBadge channel={p.channel} />
                                  </TableCell>
                                  <TableCell className="text-right font-mono text-xs">
                                    {fmt(p.poAmount)}
                                  </TableCell>
                                  <TableCell
                                    className={cn(
                                      "text-right font-mono text-xs font-medium",
                                      p.netIntroAmt < 0
                                        ? "text-danger-600"
                                        : "text-purple-600"
                                    )}
                                  >
                                    {fmtSigned(p.netIntroAmt)}
                                  </TableCell>
                                  <TableCell>
                                    <CommissionStatusBadge
                                      status={p.commStatus}
                                    />
                                  </TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                )}
              </Fragment>
            );
          })}
          <TableRow className="border-t-2 border-gray-200">
            <TableCell />
            <TableCell className="text-xs font-medium">
              Direct recruits subtotal
            </TableCell>
            <TableCell className="font-mono text-xs font-medium">
              {fmt(groupPO)}
            </TableCell>
            <TableCell
              className={cn(
                "font-mono text-xs font-medium",
                directIntroTotal < 0 ? "text-danger-600" : "text-purple-600"
              )}
            >
              {fmtSigned(directIntroTotal)}
            </TableCell>
          </TableRow>
        </TableBody>
      </Table>
      )}

      {hasDownlineEarnings && (
        <div className="space-y-2">
          <p className="text-[10px] font-medium uppercase tracking-wider text-purple-600">
            Downline introducer earnings
          </p>
          <p className="text-[10px] leading-snug text-gray-500">
            This player is the upline for {downlines.length} introducer
            {downlines.length !== 1 ? "s" : ""}. When their recruits place
            a PO, this player earns the upline slice — the larger piece of
            the intro chunk after the direct introducer keeps their tier
            rate.
          </p>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-[9px] uppercase tracking-wider text-purple-600">
                  Downline
                </TableHead>
                <TableHead className="text-[9px] uppercase tracking-wider text-purple-600">
                  Recruit
                </TableHead>
                <TableHead className="text-[9px] uppercase tracking-wider text-purple-600">
                  Ref
                </TableHead>
                <TableHead className="text-right text-[9px] uppercase tracking-wider text-purple-600">
                  PO Amount
                </TableHead>
                <TableHead className="text-right text-[9px] uppercase tracking-wider text-purple-600">
                  Upline Slice
                </TableHead>
                <TableHead className="text-[9px] uppercase tracking-wider text-purple-600">
                  Status
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {downlineData.flatMap((dl) =>
                dl.pos.length === 0
                  ? []
                  : dl.pos.map((p, idx) => (
                      <TableRow key={`${dl.id}_${p.id}`}>
                        <TableCell className="text-xs font-medium text-gray-800">
                          {idx === 0 ? dl.name : ""}
                        </TableCell>
                        <TableCell className="text-xs text-gray-700">
                          {p.recruitName}
                        </TableCell>
                        <TableCell
                          className={cn(
                            "font-mono text-xs font-medium",
                            p.channel === "gep"
                              ? "text-brand-600"
                              : "text-accent-600"
                          )}
                        >
                          {p.ref}
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs">
                          {fmt(p.poAmount)}
                        </TableCell>
                        <TableCell
                          className={cn(
                            "text-right font-mono text-xs font-medium",
                            p.netUplineAmt < 0
                              ? "text-danger-600"
                              : "text-purple-600"
                          )}
                        >
                          {fmtSigned(p.netUplineAmt)}
                        </TableCell>
                        <TableCell>
                          <CommissionStatusBadge status={p.commStatus} />
                        </TableCell>
                      </TableRow>
                    ))
              )}
              <TableRow className="border-t-2 border-gray-200">
                <TableCell
                  colSpan={3}
                  className="text-xs font-medium text-gray-800"
                >
                  Downline subtotal
                </TableCell>
                <TableCell className="text-right font-mono text-xs font-medium">
                  {fmt(downlineData.reduce((s, d) => s + d.monthlyPO, 0))}
                </TableCell>
                <TableCell
                  className={cn(
                    "text-right font-mono text-xs font-medium",
                    downlineUplineTotal < 0
                      ? "text-danger-600"
                      : "text-purple-600"
                  )}
                >
                  {fmtSigned(downlineUplineTotal)}
                </TableCell>
                <TableCell />
              </TableRow>
            </TableBody>
          </Table>
        </div>
      )}

      {(recruits.length > 0 || hasDownlineEarnings) && (
        <div className="flex items-center justify-between border-t border-purple-200 pt-3 text-xs font-medium">
          <span className="text-gray-800">Total introducer earnings</span>
          <span
            className={cn(
              "font-mono",
              introComm < 0 ? "text-danger-600" : "text-purple-600"
            )}
          >
            {fmtSigned(introComm)}
          </span>
        </div>
      )}
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
