"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { Plus, Pencil, Trash2, ChevronDown, ChevronRight, RefreshCw, Check, X, Banknote, ArrowDownToLine, ArrowDownCircle } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { Tables, LedgerRow } from "@/lib/supabase/types";
import { cn } from "@/lib/utils";

// Business logic
import { INV_TIERS, INV_INTRO_TIERS } from "@/lib/business-logic/constants";
import { getTier, getInvIntroTier } from "@/lib/business-logic/tiers";
import {
  calcSharedDeployments,
  type Deployment,
  type DeploymentPO,
  type DeploymentInvestor,
  type CapitalEvent,
} from "@/lib/business-logic/deployment";
import { fmt, getMonth, fmtMonth } from "@/lib/business-logic/formatters";
import {
  shouldAutoCompound,
  daysUntilCompound,
} from "@/lib/business-logic/compounding";
import { useSelectedMonth } from "@/lib/hooks/use-selected-month";

// Shared components
import { MetricCard } from "@/components/metric-card";
import { TierCard } from "@/components/tier-card";
import { ChannelBadge } from "@/components/channel-badge";
import { MonthPicker } from "@/components/month-picker";
import { SectionHeader } from "@/components/section-header";

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
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

// ── Types ───────────────────────────────────────────────────

type DBInvestor = Tables<"investors">;
type DBWithdrawal = Tables<"withdrawals">;
type DBReturnCredit = Tables<"return_credits">;
type DBCompoundLog = Tables<"compound_log">;
type DBPO = Tables<"purchase_orders"> & {
  delivery_orders: Tables<"delivery_orders">[];
};

// ── DB → Business-logic mappers ─────────────────────────────

function toDeploymentInvestor(inv: DBInvestor): DeploymentInvestor {
  return {
    id: inv.id,
    name: inv.name,
    capital: inv.capital,
    dateJoined: inv.date_joined ?? "",
  };
}

function toDeploymentPO(po: DBPO): DeploymentPO {
  return {
    id: po.id,
    ref: po.ref,
    poDate: po.po_date,
    poAmount: po.po_amount,
    channel: po.channel,
    dos: (po.delivery_orders ?? []).map((d) => ({
      buyerPaid: d.buyer_paid,
    })),
    commissionsCleared: po.commissions_cleared,
  };
}

// ── Per-investor computed stats ─────────────────────────────

interface InvestorStats {
  totalDeployed: number;
  idle: number;
  totalReturns: number;
  pendingReturns: number;
  activeCycles: number;
  completedCycles: number;
  deployments: Deployment[];
}

function getInvestorStats(
  invId: string,
  capital: number,
  deployments: Deployment[],
  remaining: Record<string, number>
): InvestorStats {
  const invDeps = deployments.filter((d) => d.investorId === invId);
  const totalDeployed = invDeps.reduce((s, d) => s + d.deployed, 0);
  const completedDeps = invDeps.filter((d) => d.cycleComplete);
  const activeDeps = invDeps.filter((d) => !d.cycleComplete);
  const totalReturns = completedDeps.reduce((s, d) => s + d.returnAmt, 0);
  const pendingReturns = activeDeps.reduce((s, d) => s + d.returnAmt, 0);
  const idle = remaining[invId] ?? capital - totalDeployed;

  return {
    totalDeployed,
    idle,
    totalReturns,
    pendingReturns,
    activeCycles: activeDeps.length,
    completedCycles: completedDeps.length,
    deployments: invDeps,
  };
}

// ── Introducer data ─────────────────────────────────────────

interface IntroducerRow {
  id: string;
  name: string;
  investorCount: number;
  totalCapitalIntroduced: number;
  tier: { name: string; rate: number; min: number; max: number };
  totalReturns: number;
  commission: number;
}

function calcIntroducerData(
  investors: DBInvestor[],
  deployments: Deployment[]
): IntroducerRow[] {
  const introducerIds = [
    ...new Set(investors.map((i) => i.introduced_by).filter(Boolean)),
  ] as string[];

  return introducerIds
    .map((introId) => {
      const intro = investors.find((i) => i.id === introId);
      if (!intro) return null;
      const theirInvestors = investors.filter(
        (i) => i.introduced_by === introId
      );
      const totalCapitalIntroduced = theirInvestors.reduce(
        (s, i) => s + i.capital,
        0
      );
      const tier = getInvIntroTier(totalCapitalIntroduced);

      // Commission = tier% * actual returns earned by their investors (completed cycles only)
      const totalReturns = theirInvestors.reduce((sum, inv) => {
        const invDeps = deployments.filter((d) => d.investorId === inv.id);
        return (
          sum +
          invDeps
            .filter((d) => d.cycleComplete)
            .reduce((s, d) => s + d.returnAmt, 0)
        );
      }, 0);
      const commission = totalReturns * (tier.rate / 100);

      return {
        id: introId,
        name: intro.name,
        investorCount: theirInvestors.length,
        totalCapitalIntroduced,
        tier,
        totalReturns,
        commission,
      };
    })
    .filter((x): x is IntroducerRow => x !== null);
}

// ── Component ───────────────────────────────────────────────

export default function InvestorsPage() {
  return <Suspense><InvestorsPageContent /></Suspense>;
}

function InvestorsPageContent() {
  const supabase = useMemo(() => createClient(), []);

  // Data state
  const [investors, setInvestors] = useState<DBInvestor[]>([]);
  const [allPOs, setAllPOs] = useState<DBPO[]>([]);
  const [withdrawals, setWithdrawals] = useState<DBWithdrawal[]>([]);
  const [returnCredits, setReturnCredits] = useState<DBReturnCredit[]>([]);
  const [compoundLogs, setCompoundLogs] = useState<DBCompoundLog[]>([]);
  const [ledgerRows, setLedgerRows] = useState<LedgerRow[]>([]);
  const [loading, setLoading] = useState(true);

  // UI state
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [editingInvestor, setEditingInvestor] = useState<DBInvestor | null>(
    null
  );
  const [depositInvestor, setDepositInvestor] = useState<DBInvestor | null>(
    null
  );
  const [saving, setSaving] = useState(false);
  const [introSectionOpen, setIntroSectionOpen] = useState(false);
  const [withdrawalsSectionOpen, setWithdrawalsSectionOpen] = useState(false);
  const [crediting, setCrediting] = useState(false);

  // Month selector (URL-driven, shared across admin pages)
  const [selectedMonth, setSelectedMonth] = useSelectedMonth();

  // Form state
  const emptyForm = {
    name: "",
    capital: "",
    date_joined: "",
    introduced_by: "",
    reason: "",
  };
  const [form, setForm] = useState(emptyForm);

  // Deposit dialog form state
  const emptyDepositForm = {
    amount: "",
    deposited_at: new Date().toISOString().slice(0, 10),
    method: "bank_transfer",
    reference: "",
    notes: "",
  };
  const [depositForm, setDepositForm] = useState(emptyDepositForm);

  // ── Data fetching ───────────────────────────────────────

  const fetchData = useCallback(async () => {
    setLoading(true);
    const [
      investorsRes,
      posRes,
      withdrawalsRes,
      creditsRes,
      ledgerRes,
      compoundLogRes,
    ] = await Promise.all([
      supabase
        .from("investors")
        .select("*")
        .order("created_at", { ascending: true }),
      supabase
        .from("purchase_orders")
        .select("*, delivery_orders(*)")
        .order("po_date", { ascending: true }),
      supabase
        .from("withdrawals")
        .select("*")
        .order("requested_at", { ascending: false }),
      supabase.from("return_credits").select("*"),
      supabase
        .from("v_investor_ledger")
        .select("*")
        .order("at", { ascending: false }),
      supabase
        .from("compound_log")
        .select("*")
        .order("created_at", { ascending: true }),
    ]);
    if (investorsRes.data) setInvestors(investorsRes.data);
    if (posRes.data) setAllPOs(posRes.data as DBPO[]);
    if (withdrawalsRes.data) setWithdrawals(withdrawalsRes.data);
    if (creditsRes.data) setReturnCredits(creditsRes.data);
    if (ledgerRes.data) setLedgerRows(ledgerRes.data);
    if (compoundLogRes.data) setCompoundLogs(compoundLogRes.data);
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
    ]
      .sort()
      .reverse();
    if (!months.includes(currentMonth)) months.unshift(currentMonth);
    if (!months.includes(selectedMonth)) months.unshift(selectedMonth);
    return months;
  }, [allPOs, selectedMonth]);

  const monthPOs = useMemo(
    () => allPOs.filter((po) => getMonth(po.po_date) === selectedMonth),
    [allPOs, selectedMonth]
  );

  // POs whose po_date is on or before the selected month — the pool the
  // allocator walks through to correctly account for prior-month deployments
  // that are still locking up investor capital.
  const poolPOs = useMemo(
    () => allPOs.filter((po) => getMonth(po.po_date) <= selectedMonth),
    [allPOs, selectedMonth]
  );

  // Capital-change events derived from compound_log. Feeds the allocator so
  // reinvested returns only affect POs dated *after* the reinvest, not before.
  const capitalEvents = useMemo<CapitalEvent[]>(
    () =>
      compoundLogs
        .filter((log) => log.created_at)
        .map((log) => ({
          investorId: log.investor_id,
          date: (log.created_at as string).slice(0, 10),
          delta: log.capital_after - log.capital_before,
        })),
    [compoundLogs]
  );

  // Deployment calculation
  const { deployments, remaining } = useMemo(() => {
    const dInvestors = investors.map(toDeploymentInvestor);
    const dPOs = poolPOs.map(toDeploymentPO);
    return calcSharedDeployments(dPOs, dInvestors, capitalEvents, selectedMonth);
  }, [investors, poolPOs, capitalEvents, selectedMonth]);

  // Per-investor stats
  const investorStatsMap = useMemo(() => {
    const map = new Map<string, InvestorStats>();
    for (const inv of investors) {
      map.set(
        inv.id,
        getInvestorStats(inv.id, inv.capital, deployments, remaining)
      );
    }
    return map;
  }, [investors, deployments, remaining]);

  // Summary metrics
  const totalCapital = useMemo(
    () => investors.reduce((s, i) => s + i.capital, 0),
    [investors]
  );
  // Idle = sum of investor balances still free at end-of-month (includes prior-
  // month POs still in flight). Deployed = capital minus idle.
  const totalIdle = useMemo(
    () =>
      investors.reduce(
        (s, inv) => s + Math.max(0, remaining[inv.id] ?? inv.capital),
        0
      ),
    [investors, remaining]
  );
  const totalDeployed = totalCapital - totalIdle;
  const totalReturnsEarned = useMemo(
    () =>
      deployments
        .filter((d) => d.cycleComplete)
        .reduce((s, d) => s + d.returnAmt, 0),
    [deployments]
  );
  const totalPendingReturns = useMemo(
    () =>
      deployments
        .filter((d) => !d.cycleComplete)
        .reduce((s, d) => s + d.returnAmt, 0),
    [deployments]
  );

  // Introducer data
  const introducerData = useMemo(
    () => calcIntroducerData(investors, deployments),
    [investors, deployments]
  );
  const totalIntroComm = useMemo(
    () => introducerData.reduce((s, d) => s + d.commission, 0),
    [introducerData]
  );

  // Pending withdrawals
  const pendingWithdrawals = useMemo(
    () => withdrawals.filter((w) => w.status === "pending"),
    [withdrawals]
  );

  // Credited PO IDs set (for idempotency check)
  const creditedPairs = useMemo(() => {
    const set = new Set<string>();
    returnCredits.forEach((rc) => set.add(`${rc.investor_id}:${rc.po_id}`));
    return set;
  }, [returnCredits]);

  // Total cash balance across all investors
  const totalCashBalance = useMemo(
    () => investors.reduce((s, i) => s + (i.cash_balance ?? 0), 0),
    [investors]
  );

  // Ledger grouped by investor, newest first
  const ledgerByInvestor = useMemo(() => {
    const map = new Map<string, LedgerRow[]>();
    for (const row of ledgerRows) {
      if (!row.investor_id) continue;
      const list = map.get(row.investor_id) ?? [];
      list.push(row);
      map.set(row.investor_id, list);
    }
    return map;
  }, [ledgerRows]);

  // ── Credit returns handler ──────────────────────────────────
  // Credits investor cash_balance for completed PO cycles that haven't been credited yet

  async function handleCreditReturns() {
    setCrediting(true);

    // Find POs with commissions_cleared set
    const clearedPOs = monthPOs.filter((po) => po.commissions_cleared);
    if (clearedPOs.length === 0) {
      setCrediting(false);
      return;
    }

    // Calculate deployments for this month (walk the full pool so prior-month
    // in-flight capital is respected, but only this month's deployments come
    // back from the function).
    const dInvestors = investors.map(toDeploymentInvestor);
    const dPOs = poolPOs.map(toDeploymentPO);
    const { deployments: monthDeployments } = calcSharedDeployments(
      dPOs,
      dInvestors,
      capitalEvents,
      selectedMonth
    );

    // For each cleared PO, credit each investor via atomic RPC
    let credited = 0;
    for (const po of clearedPOs) {
      const poDeps = monthDeployments.filter(
        (d) => d.poId === po.id && d.cycleComplete
      );
      for (const dep of poDeps) {
        const key = `${dep.investorId}:${dep.poId}`;
        if (creditedPairs.has(key)) continue; // already credited

        const { data, error } = await supabase.rpc("credit_investor_return", {
          p_investor_id: dep.investorId,
          p_po_id: dep.poId,
          p_amount: dep.returnAmt,
          p_deployed: dep.deployed,
          p_tier_rate: dep.returnRate,
        });

        const result = data as {
          success: boolean;
          error?: string;
          duplicate?: boolean;
        } | null;
        if (error) {
          console.error("Credit RPC error:", error.message);
          continue;
        }
        if (result?.duplicate) continue; // already credited, skip
        if (result?.success) credited++;
      }
    }

    setCrediting(false);
    if (credited > 0) fetchData();
  }

  // ── Compound handler (admin force-compound) ──────────────────

  async function handleCompoundInvestor(investor: DBInvestor) {
    if ((investor.cash_balance ?? 0) <= 0) return;
    setSaving(true);

    const { data, error } = await supabase.rpc("reinvest_cash", {
      p_investor_id: investor.id,
      p_source: "admin",
    });

    const result = data as { success: boolean; error?: string } | null;
    if (error || !result?.success) {
      console.error("Compound failed:", error?.message || result?.error);
    }

    setSaving(false);
    fetchData();
  }

  // ── Withdrawal approval handlers ────────────────────────────

  async function handleApproveWithdrawal(withdrawal: DBWithdrawal) {
    setSaving(true);

    // Cash balance was already deducted when the investor submitted the request.
    // Approve just updates the withdrawal status.
    await supabase
      .from("withdrawals")
      .update({
        status: "approved" as const,
        reviewed_at: new Date().toISOString(),
      })
      .eq("id", withdrawal.id);

    setSaving(false);
    fetchData();
  }

  async function handleRejectWithdrawal(withdrawalId: string, notes?: string) {
    setSaving(true);

    // Restore cash_balance since it was deducted when the request was submitted
    const withdrawal = withdrawals.find((w) => w.id === withdrawalId);
    if (withdrawal) {
      const investor = investors.find((i) => i.id === withdrawal.investor_id);
      if (investor) {
        const restoredBalance = (investor.cash_balance ?? 0) + withdrawal.amount;
        await supabase
          .from("investors")
          .update({ cash_balance: restoredBalance })
          .eq("id", investor.id);
      }
    }

    await supabase
      .from("withdrawals")
      .update({
        status: "rejected" as const,
        reviewed_at: new Date().toISOString(),
        notes: notes || null,
      })
      .eq("id", withdrawalId);
    setSaving(false);
    fetchData();
  }

  async function handleCompleteWithdrawal(withdrawalId: string) {
    setSaving(true);
    await supabase
      .from("withdrawals")
      .update({
        status: "completed" as const,
        processed_at: new Date().toISOString(),
      })
      .eq("id", withdrawalId);
    setSaving(false);
    fetchData();
  }

  // ── CRUD handlers ─────────────────────────────────────────

  async function handleAddInvestor() {
    if (!form.name.trim() || !form.capital || !form.date_joined) return;
    setSaving(true);
    const initialCapital = parseFloat(form.capital) || 0;

    // Insert investor with capital=0 so the ledger is populated via record_deposit.
    const { data: insertRes, error: insertErr } = await supabase
      .from("investors")
      .insert({
        name: form.name.trim(),
        capital: 0,
        date_joined: form.date_joined,
        introduced_by: form.introduced_by || null,
      })
      .select("id")
      .single();

    if (insertErr || !insertRes) {
      console.error("Add investor failed:", insertErr?.message);
      setSaving(false);
      return;
    }

    if (initialCapital > 0) {
      const { data, error } = await supabase.rpc("record_deposit", {
        p_investor_id: insertRes.id,
        p_amount: initialCapital,
        p_deposited_at: form.date_joined,
        p_method: "initial",
        p_notes: "Initial capital on investor creation",
      });
      const result = data as { success: boolean; error?: string } | null;
      if (error || !result?.success) {
        console.error(
          "Initial deposit failed:",
          error?.message || result?.error
        );
      }
    }

    setForm(emptyForm);
    setShowAddDialog(false);
    setSaving(false);
    fetchData();
  }

  async function handleEditInvestor() {
    if (!editingInvestor || !form.name.trim() || !form.capital) return;
    setSaving(true);

    // Non-capital fields update directly on the row.
    const { error: updateErr } = await supabase
      .from("investors")
      .update({
        name: form.name.trim(),
        date_joined: form.date_joined || null,
        introduced_by: form.introduced_by || null,
      })
      .eq("id", editingInvestor.id);

    if (updateErr) {
      console.error("Edit investor failed:", updateErr.message);
    }

    // Capital changes go through adjust_capital so the ledger stays complete.
    const newCapital = parseFloat(form.capital) || 0;
    if (newCapital !== editingInvestor.capital) {
      const { data, error } = await supabase.rpc("adjust_capital", {
        p_investor_id: editingInvestor.id,
        p_new_capital: newCapital,
        p_reason: form.reason.trim() || "Admin capital edit",
      });
      const result = data as { success: boolean; error?: string } | null;
      if (error || !result?.success) {
        console.error(
          "Adjust capital failed:",
          error?.message || result?.error
        );
      }
    }

    setEditingInvestor(null);
    setForm(emptyForm);
    setSaving(false);
    fetchData();
  }

  async function handleDeleteInvestor(id: string) {
    await supabase.from("investors").delete().eq("id", id);
    setConfirmDeleteId(null);
    setDeleteConfirmText("");
    if (expandedId === id) setExpandedId(null);
    fetchData();
  }

  function openDeleteDialog(investor: DBInvestor) {
    setDeleteConfirmText("");
    setConfirmDeleteId(investor.id);
  }

  function openEditDialog(investor: DBInvestor) {
    setForm({
      name: investor.name,
      capital: String(investor.capital),
      date_joined: investor.date_joined ?? "",
      introduced_by: investor.introduced_by ?? "",
      reason: "",
    });
    setEditingInvestor(investor);
  }

  // ── Deposit handler ─────────────────────────────────────────

  function openDepositDialog(investor: DBInvestor) {
    setDepositForm(emptyDepositForm);
    setDepositInvestor(investor);
  }

  async function handleRecordDeposit() {
    if (!depositInvestor) return;
    const amount = parseFloat(depositForm.amount) || 0;
    if (amount <= 0 || !depositForm.deposited_at) return;
    setSaving(true);

    const { data, error } = await supabase.rpc("record_deposit", {
      p_investor_id: depositInvestor.id,
      p_amount: amount,
      p_deposited_at: depositForm.deposited_at,
      p_method: depositForm.method || undefined,
      p_reference: depositForm.reference || undefined,
      p_notes: depositForm.notes || undefined,
    });
    const result = data as { success: boolean; error?: string } | null;
    if (error || !result?.success) {
      console.error("Deposit failed:", error?.message || result?.error);
    }

    setDepositInvestor(null);
    setDepositForm(emptyDepositForm);
    setSaving(false);
    fetchData();
  }

  // ── Loading state ─────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <p className="text-sm text-gray-500">Loading investors...</p>
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
            color="accent"
          />
        </div>
        <div className="mt-3">
          <h1 className="text-lg font-medium text-gray-800">Investors</h1>
          <p className="text-xs text-gray-500">
            Manage investors, capital deployment, and returns
          </p>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-7 gap-3">
        <MetricCard
          label="Investors"
          value={String(investors.length)}
          color="default"
        />
        <MetricCard
          label="Total Capital"
          value={fmt(totalCapital)}
          color="amber"
        />
        <MetricCard
          label="Deployed"
          value={fmt(totalDeployed)}
          color="success"
        />
        <MetricCard
          label="Idle"
          value={fmt(totalIdle)}
          color={totalIdle > 0 ? "amber" : "default"}
        />
        <MetricCard
          label="Cash Balance"
          value={fmt(totalCashBalance)}
          subtitle={
            pendingWithdrawals.length > 0
              ? `${pendingWithdrawals.length} pending withdrawal${pendingWithdrawals.length > 1 ? "s" : ""}`
              : undefined
          }
          color="brand"
        />
        <MetricCard
          label="Returns Earned"
          value={fmt(totalReturnsEarned)}
          subtitle={
            totalPendingReturns > 0
              ? `${fmt(totalPendingReturns)} pending`
              : undefined
          }
          color="accent"
        />
        <MetricCard
          label="Intro Commissions"
          value={fmt(totalIntroComm)}
          color="purple"
        />
      </div>

      {/* Credit Returns action bar */}
      {(() => {
        const clearedPOs = monthPOs.filter((po) => po.commissions_cleared);
        const uncreditedCount = clearedPOs.length > 0
          ? deployments.filter(
              (d) => d.cycleComplete && !creditedPairs.has(`${d.investorId}:${d.poId}`)
            ).length
          : 0;
        if (uncreditedCount === 0) return null;
        return (
          <div className="flex items-center justify-between rounded-xl bg-brand-50 px-5 py-3 ring-1 ring-brand-200">
            <div>
              <p className="text-sm font-medium text-brand-800">
                {uncreditedCount} uncredited return{uncreditedCount > 1 ? "s" : ""} from cleared POs
              </p>
              <p className="text-xs text-brand-600">
                Credit returns to investor cash balances. Auto-compounds in 7 days if not withdrawn.
              </p>
            </div>
            <Button
              size="sm"
              className="bg-brand-600 text-white hover:bg-brand-800"
              onClick={handleCreditReturns}
              disabled={crediting}
            >
              <Banknote className="size-3.5" data-icon="inline-start" />
              {crediting ? "Crediting..." : "Credit Returns"}
            </Button>
          </div>
        );
      })()}

      {/* Capital utilisation bar */}
      {totalCapital > 0 && (
        <div className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-gray-900/10">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
              Capital Utilisation
            </p>
            <p className="font-mono text-xs font-medium text-success-600">
              {((totalDeployed / totalCapital) * 100).toFixed(0)}% deployed
            </p>
          </div>
          <div className="flex h-3 gap-0.5 overflow-hidden rounded-full bg-gray-100">
            <div
              className="rounded-full bg-success-400 transition-all duration-500"
              style={{
                width: `${(totalDeployed / totalCapital) * 100}%`,
              }}
            />
          </div>
          <div className="mt-2 flex gap-4 text-xs">
            <span className="text-success-600">
              Deployed {fmt(totalDeployed)}
            </span>
            <span className="text-amber-600">Idle {fmt(totalIdle)}</span>
            {totalPendingReturns > 0 && (
              <span className="text-accent-600">
                Pending returns {fmt(totalPendingReturns)}
              </span>
            )}
          </div>
        </div>
      )}

      {/* Investors table panel */}
      <div className="rounded-xl bg-white shadow-sm ring-1 ring-gray-900/10">
        {/* Panel header */}
        <div className="flex items-center justify-between border-b border-gray-200 px-5 py-3">
          <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
            Investors ({investors.length})
          </p>
          <Button
            size="sm"
            className="bg-accent-600 text-white hover:bg-accent-800"
            onClick={() => {
              setForm(emptyForm);
              setShowAddDialog(true);
            }}
          >
            <Plus className="size-3.5" data-icon="inline-start" />
            Add Investor
          </Button>
        </div>

        {/* Table */}
        {investors.length === 0 ? (
          <div className="py-12 text-center text-sm text-gray-500">
            No investors yet. Click &quot;Add Investor&quot; to get started.
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
                  Capital
                </TableHead>
                <TableHead className="text-[10px] uppercase tracking-wider text-gray-500">
                  Tier
                </TableHead>
                <TableHead className="text-[10px] uppercase tracking-wider text-gray-500">
                  Joined
                </TableHead>
                <TableHead className="text-[10px] uppercase tracking-wider text-gray-500">
                  Deployed
                </TableHead>
                <TableHead className="text-[10px] uppercase tracking-wider text-gray-500">
                  Idle
                </TableHead>
                <TableHead className="text-[10px] uppercase tracking-wider text-gray-500">
                  Cash Bal
                </TableHead>
                <TableHead className="text-[10px] uppercase tracking-wider text-gray-500">
                  Returns
                </TableHead>
                <TableHead className="text-[10px] uppercase tracking-wider text-gray-500">
                  Pending
                </TableHead>
                <TableHead className="text-[10px] uppercase tracking-wider text-gray-500">
                  Cycles
                </TableHead>
                <TableHead className="text-[10px] uppercase tracking-wider text-gray-500">
                  Introducer
                </TableHead>
                <TableHead className="w-20" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {investors.map((investor) => {
                const stats = investorStatsMap.get(investor.id);
                const isExpanded = expandedId === investor.id;
                const tier = getTier(investor.capital, INV_TIERS);
                const introducer = investors.find(
                  (x) => x.id === investor.introduced_by
                );

                return (
                  <InvestorRow
                    key={investor.id}
                    investor={investor}
                    stats={stats}
                    tier={tier}
                    introducer={introducer}
                    isExpanded={isExpanded}
                    saving={saving}
                    ledger={ledgerByInvestor.get(investor.id) ?? []}
                    onToggleExpand={() =>
                      setExpandedId(isExpanded ? null : investor.id)
                    }
                    onEdit={() => openEditDialog(investor)}
                    onRequestDelete={() => openDeleteDialog(investor)}
                    onCompound={() => handleCompoundInvestor(investor)}
                    onRecordDeposit={() => openDepositDialog(investor)}
                  />
                );
              })}
            </TableBody>
          </Table>
        )}
      </div>

      {/* Investor Introducer Earnings section */}
      {introducerData.length > 0 && (
        <div className="rounded-xl bg-white shadow-sm ring-1 ring-gray-900/10">
          <div className="px-5">
            <SectionHeader
              title={`Investor Introducer Earnings (${introducerData.length})`}
              open={introSectionOpen}
              onToggle={() => setIntroSectionOpen(!introSectionOpen)}
              badge={{
                label: fmt(totalIntroComm),
                color: "purple",
              }}
            />
          </div>
          {introSectionOpen && (
            <div className="border-t border-gray-200 px-5 pb-5 pt-3">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-[10px] uppercase tracking-wider text-purple-600">
                      Introducer
                    </TableHead>
                    <TableHead className="text-[10px] uppercase tracking-wider text-purple-600">
                      Investors
                    </TableHead>
                    <TableHead className="text-[10px] uppercase tracking-wider text-purple-600">
                      Total Capital Introduced
                    </TableHead>
                    <TableHead className="text-[10px] uppercase tracking-wider text-purple-600">
                      Tier
                    </TableHead>
                    <TableHead className="text-[10px] uppercase tracking-wider text-purple-600">
                      Investor Returns
                    </TableHead>
                    <TableHead className="text-[10px] uppercase tracking-wider text-purple-600">
                      Commission
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {introducerData.map((d) => (
                    <TableRow key={d.id}>
                      <TableCell className="text-xs font-medium text-gray-800">
                        {d.name}
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {d.investorCount}
                      </TableCell>
                      <TableCell className="font-mono text-xs font-medium text-amber-600">
                        {fmt(d.totalCapitalIntroduced)}
                      </TableCell>
                      <TableCell className="font-mono text-xs font-medium text-purple-600">
                        {d.tier.name} ({d.tier.rate}%)
                      </TableCell>
                      <TableCell className="font-mono text-xs text-accent-600">
                        {fmt(d.totalReturns)}
                      </TableCell>
                      <TableCell className="font-mono text-xs font-medium text-purple-600">
                        {fmt(d.commission)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <p className="mt-3 text-[10px] text-gray-500">
                Tier based on total capital introduced. Commission = tier% of
                actual investor returns from completed cycles only.
              </p>
            </div>
          )}
        </div>
      )}

      {/* Withdrawal Requests section */}
      {withdrawals.length > 0 && (
        <div className="rounded-xl bg-white shadow-sm ring-1 ring-gray-900/10">
          <div className="px-5">
            <SectionHeader
              title={`Withdrawal Requests (${pendingWithdrawals.length} pending)`}
              open={withdrawalsSectionOpen}
              onToggle={() => setWithdrawalsSectionOpen(!withdrawalsSectionOpen)}
              badge={{
                label: pendingWithdrawals.length > 0
                  ? `${pendingWithdrawals.length} pending`
                  : "None pending",
                color: pendingWithdrawals.length > 0 ? "amber" : "success",
              }}
            />
          </div>
          {withdrawalsSectionOpen && (
            <div className="border-t border-gray-200 px-5 pb-5 pt-3">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-[10px] uppercase tracking-wider text-gray-500">
                      Investor
                    </TableHead>
                    <TableHead className="text-[10px] uppercase tracking-wider text-gray-500">
                      Amount
                    </TableHead>
                    <TableHead className="text-[10px] uppercase tracking-wider text-gray-500">
                      Type
                    </TableHead>
                    <TableHead className="text-[10px] uppercase tracking-wider text-gray-500">
                      Requested
                    </TableHead>
                    <TableHead className="text-[10px] uppercase tracking-wider text-gray-500">
                      Status
                    </TableHead>
                    <TableHead className="w-40" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {withdrawals.map((w) => {
                    const inv = investors.find((i) => i.id === w.investor_id);
                    const statusColors: Record<string, { bg: string; text: string }> = {
                      pending: { bg: "bg-amber-50", text: "text-amber-600" },
                      approved: { bg: "bg-accent-50", text: "text-accent-600" },
                      rejected: { bg: "bg-danger-50", text: "text-danger-600" },
                      completed: { bg: "bg-success-50", text: "text-success-600" },
                    };
                    const sc = statusColors[w.status] ?? statusColors.pending;
                    return (
                      <TableRow key={w.id}>
                        <TableCell className="text-xs font-medium text-gray-800">
                          {inv?.name ?? "Unknown"}
                        </TableCell>
                        <TableCell className="font-mono text-xs font-medium text-brand-600">
                          {fmt(w.amount)}
                        </TableCell>
                        <TableCell className="text-xs capitalize text-gray-500">
                          {w.type}
                        </TableCell>
                        <TableCell className="text-xs text-gray-500">
                          {w.requested_at
                            ? new Date(w.requested_at).toLocaleDateString()
                            : "--"}
                        </TableCell>
                        <TableCell>
                          <span
                            className={cn(
                              "inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-medium capitalize",
                              sc.bg,
                              sc.text
                            )}
                          >
                            {w.status}
                          </span>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center justify-end gap-1">
                            {w.status === "pending" && (
                              <>
                                <Button
                                  size="xs"
                                  className="bg-success-600 text-white hover:bg-success-800"
                                  onClick={() => handleApproveWithdrawal(w)}
                                  disabled={saving}
                                >
                                  <Check className="size-3" />
                                  Approve
                                </Button>
                                <Button
                                  size="xs"
                                  variant="outline"
                                  className="text-danger-600 hover:bg-danger-50"
                                  onClick={() => handleRejectWithdrawal(w.id)}
                                  disabled={saving}
                                >
                                  <X className="size-3" />
                                  Reject
                                </Button>
                              </>
                            )}
                            {w.status === "approved" && (
                              <Button
                                size="xs"
                                className="bg-brand-600 text-white hover:bg-brand-800"
                                onClick={() => handleCompleteWithdrawal(w.id)}
                                disabled={saving}
                              >
                                <ArrowDownToLine className="size-3" />
                                Mark Paid
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      )}

      {/* Add Investor Dialog */}
      <InvestorFormDialog
        open={showAddDialog}
        onOpenChange={setShowAddDialog}
        title="Add Investor"
        description="Register a new investor."
        form={form}
        setForm={setForm}
        investors={investors}
        excludeId={null}
        saving={saving}
        onSubmit={handleAddInvestor}
        submitLabel="Add Investor"
        mode="add"
        originalCapital={null}
      />

      {/* Edit Investor Dialog */}
      <InvestorFormDialog
        open={editingInvestor !== null}
        onOpenChange={(open) => {
          if (!open) setEditingInvestor(null);
        }}
        title="Edit Investor"
        description="Update investor details. Capital changes are recorded in the ledger as admin adjustments."
        form={form}
        setForm={setForm}
        investors={investors}
        excludeId={editingInvestor?.id ?? null}
        saving={saving}
        onSubmit={handleEditInvestor}
        submitLabel="Save Changes"
        mode="edit"
        originalCapital={editingInvestor?.capital ?? null}
      />

      <DepositDialog
        open={depositInvestor !== null}
        onOpenChange={(open) => {
          if (!open) setDepositInvestor(null);
        }}
        investor={depositInvestor}
        form={depositForm}
        setForm={setDepositForm}
        saving={saving}
        onSubmit={handleRecordDeposit}
      />

      <DeleteInvestorDialog
        open={confirmDeleteId !== null}
        onOpenChange={(open) => {
          if (!open) {
            setConfirmDeleteId(null);
            setDeleteConfirmText("");
          }
        }}
        investor={
          confirmDeleteId
            ? (investors.find((i) => i.id === confirmDeleteId) ?? null)
            : null
        }
        confirmText={deleteConfirmText}
        setConfirmText={setDeleteConfirmText}
        saving={saving}
        onConfirm={() => {
          if (confirmDeleteId) handleDeleteInvestor(confirmDeleteId);
        }}
      />
    </div>
  );
}

// ── Investor Form Dialog ──────────────────────────────────────

interface InvestorFormState {
  name: string;
  capital: string;
  date_joined: string;
  introduced_by: string;
  reason: string;
}

function InvestorFormDialog({
  open,
  onOpenChange,
  title,
  description,
  form,
  setForm,
  investors,
  excludeId,
  saving,
  onSubmit,
  submitLabel,
  mode,
  originalCapital,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  form: InvestorFormState;
  setForm: (
    f: InvestorFormState | ((prev: InvestorFormState) => InvestorFormState)
  ) => void;
  investors: DBInvestor[];
  excludeId: string | null;
  saving: boolean;
  onSubmit: () => void;
  submitLabel: string;
  mode: "add" | "edit";
  originalCapital: number | null;
}) {
  const capitalNum = parseFloat(form.capital) || 0;
  const previewTier = getTier(capitalNum, INV_TIERS);
  const capitalChanged =
    mode === "edit" &&
    originalCapital !== null &&
    capitalNum !== originalCapital;

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
              placeholder="Investor name"
            />
          </div>

          {/* Capital + tier preview */}
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-500">
              Capital (RM)
            </label>
            <Input
              type="number"
              value={form.capital}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, capital: e.target.value }))
              }
              placeholder="e.g. 100000"
            />
            {capitalNum > 0 && (
              <p className="mt-1 text-xs text-accent-600">
                {previewTier.name} tier ({previewTier.rate}%)
              </p>
            )}
            {mode === "edit" && originalCapital !== null && capitalChanged && (
              <p className="mt-1 text-xs text-amber-600">
                Changing from {fmt(originalCapital)} to {fmt(capitalNum)}.
                Difference ({fmt(capitalNum - originalCapital)}) will be
                recorded as an admin adjustment in the ledger.
              </p>
            )}
          </div>

          {/* Reason — only shown when editing and capital has changed */}
          {mode === "edit" && capitalChanged && (
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-500">
                Reason for adjustment (optional)
              </label>
              <Input
                value={form.reason}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, reason: e.target.value }))
                }
                placeholder="e.g. Correcting typo from intake"
              />
            </div>
          )}

          {/* Date joined */}
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-500">
              Date Joined
            </label>
            <Input
              type="date"
              value={form.date_joined}
              onChange={(e) =>
                setForm((prev) => ({
                  ...prev,
                  date_joined: e.target.value,
                }))
              }
            />
          </div>

          {/* Introduced By */}
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-500">
              Introduced By
            </label>
            <Select
              items={[
                { value: "__none__", label: "None" },
                ...investors
                  .filter((i) => i.id !== excludeId)
                  .map((i) => ({ value: i.id, label: i.name })),
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
                {investors
                  .filter((i) => i.id !== excludeId)
                  .map((i) => (
                    <SelectItem key={i.id} value={i.id}>
                      {i.name}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>
            Cancel
          </DialogClose>
          <Button
            className="bg-accent-600 text-white hover:bg-accent-800"
            onClick={onSubmit}
            disabled={
              saving ||
              !form.name.trim() ||
              !form.capital ||
              !form.date_joined
            }
          >
            {saving ? "Saving..." : submitLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Investor Row (with expandable detail) ─────────────────────

function InvestorRow({
  investor,
  stats,
  tier,
  introducer,
  isExpanded,
  saving,
  ledger,
  onToggleExpand,
  onEdit,
  onRequestDelete,
  onCompound,
  onRecordDeposit,
}: {
  investor: DBInvestor;
  stats: InvestorStats | undefined;
  tier: { name: string; rate: number; min: number; max: number };
  introducer: DBInvestor | undefined;
  isExpanded: boolean;
  saving: boolean;
  ledger: LedgerRow[];
  onToggleExpand: () => void;
  onEdit: () => void;
  onRequestDelete: () => void;
  onCompound: () => void;
  onRecordDeposit: () => void;
}) {
  return (
    <>
      {/* Main row */}
      <TableRow
        className={cn("cursor-pointer", isExpanded && "bg-accent-50/30")}
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
          {investor.name}
        </TableCell>
        <TableCell className="font-mono text-sm font-medium text-amber-600">
          {fmt(investor.capital)}
        </TableCell>
        <TableCell>
          <span className="font-mono text-xs font-medium text-success-600">
            {tier.name} ({tier.rate}%)
          </span>
        </TableCell>
        <TableCell className="text-xs text-gray-500">
          {investor.date_joined ?? "--"}
        </TableCell>
        <TableCell className="font-mono text-sm text-success-600">
          {fmt(stats?.totalDeployed ?? 0)}
        </TableCell>
        <TableCell
          className={cn(
            "font-mono text-xs",
            (stats?.idle ?? 0) > 0 ? "text-amber-600" : "text-gray-400"
          )}
        >
          {fmt(stats?.idle ?? 0)}
        </TableCell>
        <TableCell>
          {(investor.cash_balance ?? 0) > 0 ? (
            <div className="flex items-center gap-1.5">
              <span className="font-mono text-xs font-medium text-brand-600">
                {fmt(investor.cash_balance ?? 0)}
              </span>
              <button
                type="button"
                title="Compound now"
                className="rounded p-0.5 text-brand-400 transition-colors hover:bg-brand-50 hover:text-brand-600"
                onClick={(e) => {
                  e.stopPropagation();
                  onCompound();
                }}
                disabled={saving}
              >
                <RefreshCw className="size-3" />
              </button>
            </div>
          ) : (
            <span className="font-mono text-xs text-gray-400">--</span>
          )}
        </TableCell>
        <TableCell className="font-mono text-sm font-medium text-accent-600">
          {(stats?.totalReturns ?? 0) > 0
            ? fmt(stats!.totalReturns)
            : "--"}
        </TableCell>
        <TableCell className="font-mono text-xs text-gray-500">
          {(stats?.pendingReturns ?? 0) > 0
            ? fmt(stats!.pendingReturns)
            : "--"}
        </TableCell>
        <TableCell className="font-mono text-xs">
          {stats?.completedCycles ?? 0} / {stats?.activeCycles ?? 0}
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
              title="Edit investor"
            >
              <Pencil className="size-3 text-gray-400" />
            </Button>
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={onRequestDelete}
              title="Delete investor"
            >
              <Trash2 className="size-3 text-danger-400" />
            </Button>
          </div>
        </TableCell>
      </TableRow>

      {/* Expanded detail */}
      {isExpanded && stats && (
        <TableRow className="bg-accent-50/20 hover:bg-accent-50/20">
          <TableCell colSpan={13} className="p-0">
            <div className="space-y-4 p-5">
              {/* Tier progress */}
              <div className="max-w-xs">
                <TierCard
                  tier={tier}
                  tiers={INV_TIERS}
                  volume={investor.capital}
                  color="accent"
                  label="return per cycle"
                />
              </div>

              {/* Capital Deployment table */}
              <div className="rounded-lg border border-accent-100 bg-accent-50/30 p-4">
                <p className="mb-3 text-[10px] font-medium uppercase tracking-wider text-accent-600">
                  Capital Deployment
                </p>
                {stats.deployments.length === 0 ? (
                  <p className="py-4 text-center text-xs text-gray-500">
                    No POs to fund this month.
                  </p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-[9px] uppercase tracking-wider text-accent-600">
                          PO Ref
                        </TableHead>
                        <TableHead className="text-[9px] uppercase tracking-wider text-accent-600">
                          Channel
                        </TableHead>
                        <TableHead className="text-[9px] uppercase tracking-wider text-accent-600">
                          PO Date
                        </TableHead>
                        <TableHead className="text-[9px] uppercase tracking-wider text-accent-600">
                          PO Amount
                        </TableHead>
                        <TableHead className="text-[9px] uppercase tracking-wider text-accent-600">
                          Deployed
                        </TableHead>
                        <TableHead className="text-[9px] uppercase tracking-wider text-accent-600">
                          Rate
                        </TableHead>
                        <TableHead className="text-[9px] uppercase tracking-wider text-accent-600">
                          Return
                        </TableHead>
                        <TableHead className="text-[9px] uppercase tracking-wider text-accent-600">
                          Status
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {stats.deployments.map((dep) => (
                        <TableRow key={`${dep.investorId}-${dep.poId}`}>
                          <TableCell
                            className={cn(
                              "font-mono text-xs font-medium",
                              dep.channel === "gep"
                                ? "text-brand-600"
                                : "text-accent-600"
                            )}
                          >
                            {dep.poRef}
                          </TableCell>
                          <TableCell>
                            <ChannelBadge
                              channel={dep.channel as "punchout" | "gep"}
                            />
                          </TableCell>
                          <TableCell className="text-xs text-gray-500">
                            {dep.poDate}
                          </TableCell>
                          <TableCell className="font-mono text-xs">
                            {fmt(dep.poAmount)}
                          </TableCell>
                          <TableCell className="font-mono text-xs font-medium text-success-600">
                            {fmt(dep.deployed)}
                          </TableCell>
                          <TableCell className="font-mono text-xs font-medium text-brand-600">
                            {dep.returnRate}%
                          </TableCell>
                          <TableCell className="font-mono text-xs font-medium text-accent-600">
                            {fmt(dep.returnAmt)}
                          </TableCell>
                          <TableCell>
                            {dep.cycleComplete ? (
                              <span className="inline-flex items-center rounded-md bg-success-50 px-2 py-0.5 text-[10px] font-medium text-success-600">
                                Complete
                              </span>
                            ) : (
                              <span className="inline-flex items-center rounded-md bg-amber-50 px-2 py-0.5 text-[10px] font-medium text-amber-600">
                                Active
                              </span>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                      {/* Total row */}
                      <TableRow className="border-t-2 border-gray-200">
                        <TableCell colSpan={4} className="text-xs font-medium">
                          Total
                        </TableCell>
                        <TableCell className="font-mono text-xs font-medium text-success-600">
                          {fmt(stats.totalDeployed)}
                        </TableCell>
                        <TableCell />
                        <TableCell className="font-mono text-xs font-medium text-accent-600">
                          {fmt(stats.totalReturns + stats.pendingReturns)}
                        </TableCell>
                        <TableCell />
                      </TableRow>
                    </TableBody>
                  </Table>
                )}
              </div>

              {/* Returns summary */}
              <div className="grid grid-cols-4 gap-3">
                <div className="rounded-lg border border-success-100 bg-success-50/30 px-4 py-3">
                  <p className="text-[10px] font-medium uppercase tracking-wider text-success-600">
                    Earned (Completed)
                  </p>
                  <p className="mt-1 font-mono text-base font-medium text-success-600">
                    {fmt(stats.totalReturns)}
                  </p>
                  <p className="mt-0.5 text-[10px] text-gray-500">
                    {stats.completedCycles} cycle(s)
                  </p>
                </div>
                <div className="rounded-lg border border-amber-100 bg-amber-50/30 px-4 py-3">
                  <p className="text-[10px] font-medium uppercase tracking-wider text-amber-600">
                    Pending (Active)
                  </p>
                  <p className="mt-1 font-mono text-base font-medium text-amber-600">
                    {fmt(stats.pendingReturns)}
                  </p>
                  <p className="mt-0.5 text-[10px] text-gray-500">
                    {stats.activeCycles} cycle(s)
                  </p>
                </div>
                <div className="rounded-lg border border-accent-100 bg-accent-50/30 px-4 py-3">
                  <p className="text-[10px] font-medium uppercase tracking-wider text-accent-600">
                    Combined
                  </p>
                  <p className="mt-1 font-mono text-base font-medium text-accent-600">
                    {fmt(stats.totalReturns + stats.pendingReturns)}
                  </p>
                  <p className="mt-0.5 text-[10px] text-gray-500">
                    at {tier.rate}% per cycle
                  </p>
                </div>
                {/* Cash Balance card */}
                <div className="rounded-lg border border-brand-100 bg-brand-50/30 px-4 py-3">
                  <p className="text-[10px] font-medium uppercase tracking-wider text-brand-600">
                    Cash Balance
                  </p>
                  <p className="mt-1 font-mono text-base font-medium text-brand-600">
                    {fmt(investor.cash_balance ?? 0)}
                  </p>
                  {(investor.cash_balance ?? 0) > 0 && (
                    <>
                      <p className="mt-0.5 text-[10px] text-gray-500">
                        {investor.compound_at
                          ? `Compounds in ${daysUntilCompound(investor.compound_at) ?? 0} day(s)`
                          : "Ready to compound"}
                      </p>
                      <Button
                        size="xs"
                        className="mt-2 bg-brand-600 text-white hover:bg-brand-800"
                        onClick={(e) => {
                          e.stopPropagation();
                          onCompound();
                        }}
                        disabled={saving}
                      >
                        <RefreshCw className="size-3" />
                        Compound Now
                      </Button>
                    </>
                  )}
                </div>
              </div>

              {/* Capital history ledger */}
              <div className="rounded-lg border border-gray-200 bg-white p-4">
                <div className="mb-3 flex items-center justify-between">
                  <p className="text-[10px] font-medium uppercase tracking-wider text-gray-500">
                    Capital History
                  </p>
                  <Button
                    size="xs"
                    className="bg-accent-600 text-white hover:bg-accent-800"
                    onClick={(e) => {
                      e.stopPropagation();
                      onRecordDeposit();
                    }}
                    disabled={saving}
                  >
                    <ArrowDownCircle className="size-3" />
                    Record Deposit
                  </Button>
                </div>
                {ledger.length === 0 ? (
                  <p className="py-4 text-center text-xs text-gray-500">
                    No capital movements yet.
                  </p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="text-[9px] uppercase tracking-wider text-gray-500">
                          Date
                        </TableHead>
                        <TableHead className="text-[9px] uppercase tracking-wider text-gray-500">
                          Type
                        </TableHead>
                        <TableHead className="text-[9px] uppercase tracking-wider text-gray-500">
                          Amount
                        </TableHead>
                        <TableHead className="text-[9px] uppercase tracking-wider text-gray-500">
                          Balance
                        </TableHead>
                        <TableHead className="text-[9px] uppercase tracking-wider text-gray-500">
                          Notes
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {ledger.map((row, i) => (
                        <LedgerTableRow key={`${row.ref}-${i}`} row={row} />
                      ))}
                    </TableBody>
                  </Table>
                )}
              </div>
            </div>
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

// ── Ledger row ───────────────────────────────────────────────

function LedgerTableRow({ row }: { row: LedgerRow }) {
  const amount = row.amount ?? 0;
  const kindLabel: Record<string, string> = {
    deposit: "Deposit",
    withdrawal: "Withdrawal",
    return_credit: "Return",
    compound: "Compound",
    admin_adjustment: "Admin Adjustment",
  };
  const kindColor: Record<string, string> = {
    deposit: "text-success-600",
    withdrawal: "text-danger-600",
    return_credit: "text-accent-600",
    compound: "text-gray-500",
    admin_adjustment: "text-amber-600",
  };
  const kind = row.kind ?? "";
  const amountColor =
    amount > 0
      ? "text-success-600"
      : amount < 0
        ? "text-danger-600"
        : "text-gray-400";
  const dateStr = row.at
    ? new Date(row.at).toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "2-digit",
      })
    : "--";
  return (
    <TableRow>
      <TableCell className="text-xs text-gray-600">{dateStr}</TableCell>
      <TableCell
        className={cn(
          "text-xs font-medium",
          kindColor[kind] ?? "text-gray-500"
        )}
      >
        {kindLabel[kind] ?? kind}
      </TableCell>
      <TableCell
        className={cn("font-mono text-xs font-medium", amountColor)}
      >
        {amount === 0 ? "--" : (amount > 0 ? "+" : "") + fmt(amount)}
      </TableCell>
      <TableCell className="font-mono text-xs">
        {row.balance_after !== null ? fmt(row.balance_after) : "--"}
      </TableCell>
      <TableCell className="text-xs text-gray-500">
        {row.notes ?? "--"}
      </TableCell>
    </TableRow>
  );
}

// ── Deposit Dialog ───────────────────────────────────────────

interface DepositFormState {
  amount: string;
  deposited_at: string;
  method: string;
  reference: string;
  notes: string;
}

function DepositDialog({
  open,
  onOpenChange,
  investor,
  form,
  setForm,
  saving,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  investor: DBInvestor | null;
  form: DepositFormState;
  setForm: (
    f: DepositFormState | ((prev: DepositFormState) => DepositFormState)
  ) => void;
  saving: boolean;
  onSubmit: () => void;
}) {
  const amountNum = parseFloat(form.amount) || 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Record Deposit</DialogTitle>
          <DialogDescription>
            {investor
              ? `Log money received from ${investor.name}. Capital will increase by the amount entered.`
              : ""}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Amount */}
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-500">
              Amount (RM)
            </label>
            <Input
              type="number"
              value={form.amount}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, amount: e.target.value }))
              }
              placeholder="e.g. 10000"
            />
            {investor && amountNum > 0 && (
              <p className="mt-1 text-xs text-accent-600">
                Capital will become {fmt(investor.capital + amountNum)}
              </p>
            )}
          </div>

          {/* Date received */}
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-500">
              Date received
            </label>
            <Input
              type="date"
              value={form.deposited_at}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, deposited_at: e.target.value }))
              }
            />
          </div>

          {/* Method */}
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-500">
              Method
            </label>
            <Select
              value={form.method || "bank_transfer"}
              onValueChange={(v) =>
                setForm((prev) => ({ ...prev, method: v ?? "bank_transfer" }))
              }
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="bank_transfer">Bank transfer</SelectItem>
                <SelectItem value="cheque">Cheque</SelectItem>
                <SelectItem value="cash">Cash</SelectItem>
                <SelectItem value="other">Other</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Reference */}
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-500">
              Reference (optional)
            </label>
            <Input
              value={form.reference}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, reference: e.target.value }))
              }
              placeholder="Bank ref, cheque no., etc."
            />
          </div>

          {/* Notes */}
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-500">
              Notes (optional)
            </label>
            <Input
              value={form.notes}
              onChange={(e) =>
                setForm((prev) => ({ ...prev, notes: e.target.value }))
              }
              placeholder="e.g. Top-up for January cycle"
            />
          </div>
        </div>

        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
          <Button
            className="bg-accent-600 text-white hover:bg-accent-800"
            onClick={onSubmit}
            disabled={saving || amountNum <= 0 || !form.deposited_at}
          >
            {saving ? "Saving..." : "Record Deposit"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Delete Investor Dialog ────────────────────────────────────

function DeleteInvestorDialog({
  open,
  onOpenChange,
  investor,
  confirmText,
  setConfirmText,
  saving,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  investor: DBInvestor | null;
  confirmText: string;
  setConfirmText: (v: string) => void;
  saving: boolean;
  onConfirm: () => void;
}) {
  const canDelete =
    investor !== null && confirmText.trim() === investor.name && !saving;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Delete investor</DialogTitle>
          <DialogDescription>
            This permanently removes{" "}
            <span className="font-semibold text-gray-800">
              {investor?.name ?? ""}
            </span>{" "}
            and cascades to their deposits, admin adjustments, withdrawals,
            return credits, and compound log. There is no undo.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <label className="block text-xs font-medium text-gray-500">
            Type{" "}
            <span className="font-mono font-semibold text-gray-800">
              {investor?.name ?? ""}
            </span>{" "}
            to confirm
          </label>
          <Input
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder={investor?.name ?? ""}
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
