"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import type { Tables, LedgerRow } from "@/lib/supabase/types";
import { cn } from "@/lib/utils";

// Business logic
import { INV_TIERS, INV_INTRO_TIERS } from "@/lib/business-logic/constants";
import { getTier } from "@/lib/business-logic/tiers";
import {
  calcSharedDeployments,
  type DeploymentPO,
  type DeploymentInvestor,
  type Deployment,
  type CapitalEvent,
} from "@/lib/business-logic/deployment";
import { fmt, getMonth, fmtMonth } from "@/lib/business-logic/formatters";
import {
  shouldAutoCompound,
  daysUntilCompound,
  wouldUpgradeTier,
  estimateAnnualCompound,
  COMPOUND_WINDOW_DAYS,
} from "@/lib/business-logic/compounding";

// Shared components
import { TierCard } from "@/components/tier-card";
import { ChannelBadge } from "@/components/channel-badge";
import { MonthPicker } from "@/components/month-picker";

// UI components
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";

// Icons
import {
  DollarSign,
  TrendingUp,
  Users,
  ArrowRight,
  Wallet,
  RefreshCw,
  ArrowDownToLine,
  Clock,
  History,
} from "lucide-react";

// ── Types ───────────────────────────────────────────────────

type DBInvestor = Tables<"investors">;
type DBWithdrawal = Tables<"withdrawals">;
type DBPO = Tables<"purchase_orders"> & {
  delivery_orders: Tables<"delivery_orders">[];
};
type DBCompoundLog = Tables<"compound_log">;

// ── DB → Business-logic mappers ─────────────────────────────

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

function toDeploymentInvestor(inv: DBInvestor): DeploymentInvestor {
  return {
    id: inv.id,
    name: inv.name,
    capital: inv.capital,
    dateJoined: inv.date_joined ?? "",
  };
}

// ── Cycle status helpers ────────────────────────────────────

type CycleStatus = "complete" | "active";

const cycleStatusConfig: Record<
  CycleStatus,
  { label: string; bg: string; text: string }
> = {
  complete: {
    label: "Complete",
    bg: "bg-success-50",
    text: "text-success-800",
  },
  active: { label: "Active", bg: "bg-amber-50", text: "text-amber-600" },
};

function CycleStatusBadge({ status }: { status: CycleStatus }) {
  const config = cycleStatusConfig[status];
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-medium",
        config.bg,
        config.text
      )}
    >
      {config.label}
    </span>
  );
}

// ── Component ───────────────────────────────────────────────

export default function InvestorDashboardPage() {
  const supabase = useMemo(() => createClient(), []);

  // Data state
  const [myInvestor, setMyInvestor] = useState<DBInvestor | null>(null);
  const [allInvestors, setAllInvestors] = useState<DBInvestor[]>([]);
  const [allPOs, setAllPOs] = useState<DBPO[]>([]);
  const [compoundLogs, setCompoundLogs] = useState<DBCompoundLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorState, setErrorState] = useState<
    "not_authenticated" | "no_investor" | null
  >(null);

  // Sheet state
  const [deploymentsOpen, setDeploymentsOpen] = useState(false);
  const [returnsOpen, setReturnsOpen] = useState(false);
  const [introOpen, setIntroOpen] = useState(false);
  const [withdrawalsOpen, setWithdrawalsOpen] = useState(false);
  const [ledgerOpen, setLedgerOpen] = useState(false);

  // Capital history
  const [myLedger, setMyLedger] = useState<LedgerRow[]>([]);

  // Withdrawal dialog state
  const [showWithdrawDialog, setShowWithdrawDialog] = useState(false);
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [withdrawing, setWithdrawing] = useState(false);
  const [reinvesting, setReinvesting] = useState(false);

  // Withdrawal history
  const [myWithdrawals, setMyWithdrawals] = useState<DBWithdrawal[]>([]);

  // Month selector
  const now = new Date();
  const currentMonth =
    now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0");
  const [selectedMonth, setSelectedMonth] = useState(currentMonth);

  // ── Data fetching ─────────────────────────────────────────

  const fetchData = useCallback(async () => {
    setLoading(true);

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      setErrorState("not_authenticated");
      setLoading(false);
      return;
    }

    const { data: investorData } = await supabase
      .from("investors")
      .select("*")
      .eq("user_id", user.id)
      .single();

    if (!investorData) {
      setErrorState("no_investor");
      setLoading(false);
      return;
    }

    setMyInvestor(investorData);

    const [investorsRes, posRes, withdrawalsRes, ledgerRes, compoundLogRes] =
      await Promise.all([
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
          .eq("investor_id", investorData.id)
          .order("requested_at", { ascending: false }),
        supabase
          .from("v_investor_ledger")
          .select("*")
          .eq("investor_id", investorData.id)
          .order("at", { ascending: false }),
        // All investors' compound_log — needed because the deployment pool
        // allocates proportionally across all investors. RLS must allow
        // investors to read sibling rows for this to return useful data.
        supabase
          .from("compound_log")
          .select("*")
          .order("created_at", { ascending: true }),
      ]);

    if (investorsRes.data) setAllInvestors(investorsRes.data);
    if (posRes.data) setAllPOs(posRes.data as DBPO[]);
    if (withdrawalsRes.data) setMyWithdrawals(withdrawalsRes.data);
    if (ledgerRes.data) setMyLedger(ledgerRes.data);
    if (compoundLogRes.data) setCompoundLogs(compoundLogRes.data);

    // Auto-compound on read: if compound window has passed, compound automatically
    if (
      investorData.cash_balance > 0 &&
      shouldAutoCompound(investorData.compound_at)
    ) {
      await supabase.rpc("reinvest_cash", {
        p_investor_id: investorData.id,
        p_source: "auto",
      });

      // Refresh investor data after compound
      const { data: refreshed } = await supabase
        .from("investors")
        .select("*")
        .eq("id", investorData.id)
        .single();
      if (refreshed) setMyInvestor(refreshed);
    }

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

  // ── Computed: deployments for selected month ──────────────

  // POs whose po_date is on or before the selected month — the allocator
  // walks this pool so prior-month deployments that are still locking
  // capital are respected when computing end-of-month idle.
  const poolPOs = useMemo(
    () => allPOs.filter((po) => getMonth(po.po_date) <= selectedMonth),
    [allPOs, selectedMonth]
  );

  const deploymentPOs = useMemo(
    () => poolPOs.map(toDeploymentPO),
    [poolPOs]
  );

  const deploymentInvestors = useMemo(
    () => allInvestors.map(toDeploymentInvestor),
    [allInvestors]
  );

  // Capital-change events from compound_log. The allocator uses these to
  // defer reinvested returns to their actual date instead of baking them
  // into every historical PO's allocation.
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

  const { deployments: allDeployments, remaining } = useMemo(
    () =>
      calcSharedDeployments(
        deploymentPOs,
        deploymentInvestors,
        capitalEvents,
        selectedMonth
      ),
    [deploymentPOs, deploymentInvestors, capitalEvents, selectedMonth]
  );

  // ── Computed: my deployments ──────────────────────────────

  const myDeployments = useMemo(() => {
    if (!myInvestor) return [];
    return allDeployments.filter((d) => d.investorId === myInvestor.id);
  }, [allDeployments, myInvestor]);

  // ── Computed: investor tier ───────────────────────────────

  const myTier = useMemo(
    () => (myInvestor ? getTier(myInvestor.capital, INV_TIERS) : INV_TIERS[0]),
    [myInvestor]
  );

  // ── Computed: deployment stats ────────────────────────────
  // Idle comes from the allocator's `remaining` (reflects prior-month POs
  // still in flight). Deployed is capital minus idle — this can exceed the
  // sum of myDeployments[].deployed when capital is still locked from a
  // prior month that isn't displayed in the current month's table.

  const idle = useMemo(() => {
    if (!myInvestor) return 0;
    return Math.max(0, remaining[myInvestor.id] ?? myInvestor.capital);
  }, [myInvestor, remaining]);

  const totalDeployed = myInvestor ? myInvestor.capital - idle : 0;

  const completedDeps = useMemo(
    () => myDeployments.filter((d) => d.cycleComplete),
    [myDeployments]
  );

  const activeDeps = useMemo(
    () => myDeployments.filter((d) => !d.cycleComplete),
    [myDeployments]
  );

  const totalReturns = completedDeps.reduce((s, d) => s + d.returnAmt, 0);
  const pendingReturns = activeDeps.reduce((s, d) => s + d.returnAmt, 0);

  const utilisationPct =
    myInvestor && myInvestor.capital > 0
      ? ((totalDeployed / myInvestor.capital) * 100).toFixed(0)
      : "0";

  // ── Computed: introducer earnings ─────────────────────────

  const myRecruits = useMemo(() => {
    if (!myInvestor) return [];
    return allInvestors.filter((i) => i.introduced_by === myInvestor.id);
  }, [allInvestors, myInvestor]);

  const totalCapitalIntroduced = myRecruits.reduce(
    (s, i) => s + i.capital,
    0
  );
  const introTier = getTier(totalCapitalIntroduced, INV_INTRO_TIERS);

  const recruitData = useMemo(() => {
    if (myRecruits.length === 0) return [];
    return myRecruits.map((recruit) => {
      const recruitDeps = allDeployments.filter(
        (d) => d.investorId === recruit.id
      );
      const rReturnsEarned = recruitDeps
        .filter((d) => d.cycleComplete)
        .reduce((s, d) => s + d.returnAmt, 0);
      const rReturnsPending = recruitDeps
        .filter((d) => !d.cycleComplete)
        .reduce((s, d) => s + d.returnAmt, 0);
      const commEarned = rReturnsEarned * (introTier.rate / 100);
      const commPending = rReturnsPending * (introTier.rate / 100);
      const allComplete =
        recruitDeps.length > 0 && recruitDeps.every((d) => d.cycleComplete);
      const commStatus: CycleStatus =
        recruitDeps.length === 0
          ? "active"
          : allComplete
            ? "complete"
            : "active";
      return {
        name: recruit.name,
        capital: recruit.capital,
        returnsEarned: rReturnsEarned,
        commEarned,
        commPending,
        commTotal: commEarned + commPending,
        commStatus,
      };
    });
  }, [myRecruits, allDeployments, introTier.rate]);

  const totalIntroCommEarned = recruitData.reduce(
    (s, r) => s + r.commEarned,
    0
  );
  const totalIntroCommPending = recruitData.reduce(
    (s, r) => s + r.commPending,
    0
  );
  const totalIntroComm = totalIntroCommEarned + totalIntroCommPending;

  // ── Cash balance helpers ──────────────────────────────────

  const cashBalance = myInvestor?.cash_balance ?? 0;
  const compoundDaysLeft = daysUntilCompound(myInvestor?.compound_at ?? null);
  const tierUpgrade = myInvestor
    ? wouldUpgradeTier(myInvestor.capital, cashBalance)
    : null;

  // ── Withdrawal handler ──────────────────────────────────

  async function handleWithdraw() {
    if (!myInvestor) return;
    const amount = parseFloat(withdrawAmount);
    if (!amount || amount <= 0 || amount > cashBalance) return;

    setWithdrawing(true);

    const { data, error } = await supabase.rpc("submit_withdrawal", {
      p_investor_id: myInvestor.id,
      p_amount: amount,
      p_type: "returns",
    });

    const result = data as { success: boolean; error?: string } | null;
    if (error || !result?.success) {
      console.error("Withdrawal failed:", error?.message || result?.error);
    }

    setWithdrawing(false);
    setShowWithdrawDialog(false);
    setWithdrawAmount("");
    fetchData();
  }

  // ── Reinvest handler ────────────────────────────────────

  async function handleReinvest() {
    if (!myInvestor || cashBalance <= 0) return;

    setReinvesting(true);

    const { data: reinvestData, error: reinvestError } = await supabase.rpc(
      "reinvest_cash",
      {
        p_investor_id: myInvestor.id,
        p_source: "manual_reinvest",
      }
    );

    const reinvestResult = reinvestData as {
      success: boolean;
      error?: string;
    } | null;
    if (reinvestError || !reinvestResult?.success) {
      console.error(
        "Reinvest failed:",
        reinvestError?.message || reinvestResult?.error
      );
    }

    setReinvesting(false);
    fetchData();
  }

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

  if (errorState === "no_investor" || !myInvestor) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <div className="text-center">
          <p className="text-sm font-medium text-gray-700">
            No investor record found
          </p>
          <p className="mt-1 text-xs text-gray-500">
            Your account is not linked to an investor record. Contact your
            administrator.
          </p>
        </div>
      </div>
    );
  }

  // ── Render ────────────────────────────────────────────────

  return (
    <div className="space-y-5">
      {/* Header + Month Picker */}
      <div className="flex items-center justify-end gap-3">
        <button
          type="button"
          onClick={() => setLedgerOpen(true)}
          className="inline-flex items-center gap-1.5 rounded-full bg-gray-100 px-3 py-1.5 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-200"
        >
          <History className="size-3.5" />
          Capital history
        </button>
        <MonthPicker
          months={availableMonths}
          value={selectedMonth}
          onChange={setSelectedMonth}
          color="brand"
        />
      </div>

      {/* ═══ HERO SECTION ═══ */}
      <div className="rounded-2xl bg-white p-8 shadow-[0_2px_8px_rgba(0,0,0,0.06),0_1px_3px_rgba(0,0,0,0.04)]">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-sm text-gray-500">Portfolio Value</p>
            <p className="mt-2 font-mono text-3xl font-semibold tracking-tight text-gray-900">
              {fmt(myInvestor.capital)}
            </p>
            {totalReturns > 0 && (
              <p className="mt-2 font-mono text-sm font-medium text-success-600">
                +{fmt(totalReturns)} earned this month
              </p>
            )}
          </div>
        </div>

        {/* Utilisation bar inside hero */}
        {myInvestor.capital > 0 && (
          <div className="mt-6">
            <div className="mb-2 flex items-baseline justify-between">
              <span className="text-xs font-medium uppercase tracking-wide text-gray-500">
                Capital utilisation
              </span>
              <span className="font-mono text-xs font-medium text-success-600">
                {utilisationPct}% deployed
              </span>
            </div>
            <div className="flex h-2 gap-0.5 overflow-hidden rounded-md bg-gray-100">
              <div
                className="rounded-md bg-brand-400 transition-all"
                style={{
                  width: `${(totalDeployed / myInvestor.capital) * 100}%`,
                }}
              />
              {idle > 0 && (
                <div
                  className="rounded-md bg-gray-200"
                  style={{
                    width: `${(idle / myInvestor.capital) * 100}%`,
                  }}
                />
              )}
            </div>
            <div className="mt-2 flex gap-5 text-xs">
              <span className="text-success-600">
                Deployed {fmt(totalDeployed)}
              </span>
              <span className="text-amber-600">Idle {fmt(idle)}</span>
            </div>
          </div>
        )}
      </div>

      {/* ═══ CASH BALANCE CARD ═══ */}
      {cashBalance > 0 && (
        <div className="rounded-2xl bg-white p-6 shadow-[0_2px_8px_rgba(0,0,0,0.06),0_1px_3px_rgba(0,0,0,0.04)] ring-1 ring-brand-200">
          <div className="flex items-start justify-between">
            <div>
              <div className="flex items-center gap-2">
                <div className="flex size-8 items-center justify-center rounded-lg bg-brand-50">
                  <Wallet className="size-4 text-brand-600" strokeWidth={1.5} />
                </div>
                <p className="text-sm font-medium text-gray-800">Cash Balance</p>
              </div>
              <p className="mt-3 font-mono text-2xl font-semibold text-brand-600">
                {fmt(cashBalance)}
              </p>
              <div className="mt-2 flex items-center gap-1.5 text-xs text-gray-500">
                <Clock className="size-3" />
                {compoundDaysLeft !== null && compoundDaysLeft > 0
                  ? `Auto-compounds in ${compoundDaysLeft} day${compoundDaysLeft > 1 ? "s" : ""}`
                  : "Ready to compound"}
              </div>
              {tierUpgrade?.upgrades && (
                <p className="mt-2 text-xs font-medium text-brand-600">
                  Reinvesting unlocks {tierUpgrade.to.name} tier ({tierUpgrade.to.rate}%)
                </p>
              )}
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                className="text-gray-600"
                onClick={() => {
                  setWithdrawAmount("");
                  setShowWithdrawDialog(true);
                }}
              >
                <ArrowDownToLine className="size-3.5" data-icon="inline-start" />
                Withdraw
              </Button>
              <Button
                size="sm"
                className="bg-brand-600 text-white hover:bg-brand-800"
                onClick={handleReinvest}
                disabled={reinvesting}
              >
                <RefreshCw className="size-3.5" data-icon="inline-start" />
                {reinvesting ? "Reinvesting..." : "Reinvest Now"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Pending withdrawals notice */}
      {myWithdrawals.some((w) => w.status === "pending") && (
        <button
          type="button"
          onClick={() => setWithdrawalsOpen(true)}
          className="flex w-full items-center justify-between rounded-xl bg-amber-50 px-5 py-3 text-left ring-1 ring-amber-200 transition-colors hover:bg-amber-100/50"
        >
          <div className="flex items-center gap-2">
            <Clock className="size-4 text-amber-600" />
            <p className="text-sm font-medium text-amber-800">
              {myWithdrawals.filter((w) => w.status === "pending").length} withdrawal request{myWithdrawals.filter((w) => w.status === "pending").length > 1 ? "s" : ""} pending approval
            </p>
          </div>
          <ArrowRight className="size-4 text-amber-600" />
        </button>
      )}

      {/* ═══ SUMMARY CARDS ═══ */}
      <div
        className={cn(
          "grid gap-4",
          myRecruits.length > 0 ? "grid-cols-3" : "grid-cols-2"
        )}
      >
        {/* Card 1: Deployed */}
        <button
          type="button"
          onClick={() => setDeploymentsOpen(true)}
          className="group rounded-2xl bg-white p-6 text-left shadow-[0_2px_8px_rgba(0,0,0,0.06),0_1px_3px_rgba(0,0,0,0.04)] transition-all hover:-translate-y-0.5 hover:shadow-[0_4px_20px_rgba(0,0,0,0.1)]"
        >
          <div className="mb-4 flex size-10 items-center justify-center rounded-xl bg-brand-50">
            <DollarSign className="size-5 text-brand-600" strokeWidth={1.5} />
          </div>
          <p className="text-xs font-medium text-gray-500">Deployed</p>
          <p className="mt-1 font-mono text-xl font-semibold text-brand-600">
            {fmt(totalDeployed)}
          </p>
          <p className="mt-1 text-xs text-gray-500">
            {myDeployments.length} PO{myDeployments.length !== 1 ? "s" : ""}{" "}
            &middot; {utilisationPct}% utilised
          </p>
          <div className="mt-4 flex items-center gap-1.5 border-t border-gray-100 pt-4 text-sm font-semibold text-brand-600">
            View deployments
            <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" />
          </div>
        </button>

        {/* Card 2: Investment Returns */}
        <button
          type="button"
          onClick={() => setReturnsOpen(true)}
          className="group rounded-2xl bg-white p-6 text-left shadow-[0_2px_8px_rgba(0,0,0,0.06),0_1px_3px_rgba(0,0,0,0.04)] transition-all hover:-translate-y-0.5 hover:shadow-[0_4px_20px_rgba(0,0,0,0.1)]"
        >
          <div className="mb-4 flex size-10 items-center justify-center rounded-xl bg-accent-50">
            <TrendingUp
              className="size-5 text-accent-600"
              strokeWidth={1.5}
            />
          </div>
          <p className="text-xs font-medium text-gray-500">
            Investment Returns
          </p>
          <p className="mt-1 font-mono text-xl font-semibold text-accent-600">
            {fmt(totalReturns + pendingReturns)}
          </p>
          <div className="mt-1 flex gap-2">
            <span className="text-xs font-medium text-success-600">
              {fmt(totalReturns)} earned
            </span>
            <span className="text-xs font-medium text-amber-600">
              {fmt(pendingReturns)} pending
            </span>
          </div>
          <div className="mt-4 flex items-center gap-1.5 border-t border-gray-100 pt-4 text-sm font-semibold text-accent-600">
            View cycle history
            <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" />
          </div>
        </button>

        {/* Card 3: Introducer Network (conditional) */}
        {myRecruits.length > 0 && (
          <button
            type="button"
            onClick={() => setIntroOpen(true)}
            className="group rounded-2xl bg-white p-6 text-left shadow-[0_2px_8px_rgba(0,0,0,0.06),0_1px_3px_rgba(0,0,0,0.04)] transition-all hover:-translate-y-0.5 hover:shadow-[0_4px_20px_rgba(0,0,0,0.1)]"
          >
            <div className="mb-4 flex size-10 items-center justify-center rounded-xl bg-purple-50">
              <Users className="size-5 text-purple-600" strokeWidth={1.5} />
            </div>
            <p className="text-xs font-medium text-gray-500">
              Introducer Commission
            </p>
            <p className="mt-1 font-mono text-xl font-semibold text-purple-600">
              {fmt(totalIntroCommEarned)}
            </p>
            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
              <span className="text-[11px] font-medium text-success-600">
                Earned
              </span>
              {totalIntroCommPending > 0 && (
                <span className="text-[11px] font-medium text-amber-600">
                  {fmt(totalIntroCommPending)} pending
                </span>
              )}
            </div>
            <p className="mt-0.5 text-xs text-gray-500">
              {myRecruits.length} investor
              {myRecruits.length !== 1 ? "s" : ""} &middot;{" "}
              {fmt(totalCapitalIntroduced)} capital
            </p>
            <div className="mt-4 flex items-center gap-1.5 border-t border-gray-100 pt-4 text-sm font-semibold text-purple-600">
              View network
              <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" />
            </div>
          </button>
        )}
      </div>

      {/* ═══ TIER PROGRESS ═══ */}
      <div className="rounded-2xl bg-white p-6 shadow-[0_2px_8px_rgba(0,0,0,0.06),0_1px_3px_rgba(0,0,0,0.04)]">
        <div className="mb-4">
          <p className="text-sm font-semibold text-gray-800">Investor Tier</p>
        </div>
        <TierCard
          tier={myTier}
          tiers={INV_TIERS}
          volume={myInvestor.capital}
          color="brand"
          label="per cycle"
        />
        {/* Compound projection */}
        {myInvestor.capital > 0 && (() => {
          const projection = estimateAnnualCompound(myInvestor.capital, 60);
          return (
            <div className="mt-4 rounded-lg bg-brand-50/50 px-4 py-3">
              <p className="text-xs font-medium text-brand-800">
                Compound Projection (12 months)
              </p>
              <p className="mt-1 text-xs text-brand-600">
                At the current rate with auto-compounding, your{" "}
                <span className="font-mono font-medium">{fmt(myInvestor.capital)}</span>{" "}
                could grow to{" "}
                <span className="font-mono font-semibold">{fmt(projection.finalCapital)}</span>{" "}
                ({projection.annualPct.toFixed(1)}% effective annual return).
              </p>
            </div>
          );
        })()}
      </div>

      {/* ═══ SIMULATOR TEASER ═══ */}
      <div className="rounded-2xl bg-brand-50 px-6 py-5">
        <p className="text-sm font-semibold text-brand-800">
          What if you invested more?
        </p>
        <p className="mt-1 text-xs leading-relaxed text-brand-600">
          Try the simulator to see how different capital amounts and cycle
          lengths affect your returns.
        </p>
        <Link
          href="/returns"
          className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-brand-600 hover:text-brand-800"
        >
          Open Simulator
          <ArrowRight className="size-4" />
        </Link>
      </div>

      {/* ═══ DIALOG 1: DEPLOYMENTS ═══ */}
      <Dialog open={deploymentsOpen} onOpenChange={setDeploymentsOpen}>
        <DialogContent className="rounded-2xl p-6 sm:max-w-5xl">
          <DialogHeader>
            <DialogTitle>My Deployments</DialogTitle>
            <DialogDescription>
              {myDeployments.length} PO
              {myDeployments.length !== 1 ? "s" : ""} &middot;{" "}
              {fmt(totalDeployed)} deployed &middot; {utilisationPct}% utilised
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[65vh] overflow-y-auto">
            {myDeployments.length === 0 ? (
              <p className="py-12 text-center text-xs text-gray-500">
                No deployments this month.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-[10px]">PO Ref</TableHead>
                    <TableHead className="text-[10px]">Channel</TableHead>
                    <TableHead className="text-[10px]">PO Date</TableHead>
                    <TableHead className="text-right text-[10px]">
                      Deployed
                    </TableHead>
                    <TableHead className="text-right text-[10px]">
                      Return
                    </TableHead>
                    <TableHead className="text-[10px]">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {myDeployments.map((dep, i) => (
                    <TableRow key={`${dep.poId}-${i}`}>
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
                      <TableCell className="text-right font-mono text-xs font-medium text-brand-600">
                        {fmt(dep.deployed)}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs font-medium text-accent-600">
                        +{fmt(dep.returnAmt)}
                      </TableCell>
                      <TableCell>
                        <CycleStatusBadge
                          status={dep.cycleComplete ? "complete" : "active"}
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                  <TableRow className="border-t-2 border-gray-300">
                    <TableCell
                      colSpan={3}
                      className="text-xs font-medium text-gray-800"
                    >
                      Total
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs font-medium text-brand-600">
                      {fmt(totalDeployed)}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs font-medium text-accent-600">
                      +{fmt(totalReturns + pendingReturns)}
                    </TableCell>
                    <TableCell />
                  </TableRow>
                </TableBody>
              </Table>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* ═══ DIALOG 2: RETURNS ═══ */}
      <Dialog open={returnsOpen} onOpenChange={setReturnsOpen}>
        <DialogContent className="rounded-2xl p-6 sm:max-w-5xl">
          <DialogHeader>
            <DialogTitle>Investment Returns</DialogTitle>
            <DialogDescription>
              {fmt(totalReturns + pendingReturns)} total &middot;{" "}
              {myTier.rate}% per cycle
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[65vh] overflow-y-auto">
            {/* Returns Summary */}
            <div className="mb-6 grid grid-cols-3 gap-4">
              <div className="rounded-2xl bg-white p-6 shadow-[0_2px_8px_rgba(0,0,0,0.06),0_1px_3px_rgba(0,0,0,0.04)]">
                <p className="text-xs font-medium uppercase tracking-wide text-success-600">
                  Earned
                </p>
                <p className="mt-1.5 font-mono text-lg font-medium text-success-600">
                  {fmt(totalReturns)}
                </p>
                <p className="mt-1 text-xs text-gray-500">
                  {completedDeps.length} cycle
                  {completedDeps.length !== 1 ? "s" : ""}
                </p>
              </div>
              <div className="rounded-2xl bg-white p-6 shadow-[0_2px_8px_rgba(0,0,0,0.06),0_1px_3px_rgba(0,0,0,0.04)]">
                <p className="text-xs font-medium uppercase tracking-wide text-amber-600">
                  Pending
                </p>
                <p className="mt-1.5 font-mono text-lg font-medium text-amber-600">
                  {fmt(pendingReturns)}
                </p>
                <p className="mt-1 text-xs text-gray-500">
                  {activeDeps.length} cycle
                  {activeDeps.length !== 1 ? "s" : ""}
                </p>
              </div>
              <div className="rounded-2xl bg-white p-6 shadow-[0_2px_8px_rgba(0,0,0,0.06),0_1px_3px_rgba(0,0,0,0.04)]">
                <p className="text-xs font-medium uppercase tracking-wide text-accent-600">
                  Combined
                </p>
                <p className="mt-1.5 font-mono text-lg font-medium text-accent-600">
                  {fmt(totalReturns + pendingReturns)}
                </p>
                <p className="mt-1 text-xs text-gray-500">
                  at {myTier.rate}% per cycle
                </p>
              </div>
            </div>

            {/* Cycle History */}
            <p className="mb-3 text-xs font-medium uppercase tracking-wide text-gray-500">
              Cycle History
            </p>
            {myDeployments.length === 0 ? (
              <p className="py-8 text-center text-xs text-gray-500">
                No cycles yet.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-[10px]">#</TableHead>
                    <TableHead className="text-[10px]">PO Ref</TableHead>
                    <TableHead className="text-right text-[10px]">
                      Capital Out
                    </TableHead>
                    <TableHead className="text-right text-[10px]">
                      Return
                    </TableHead>
                    <TableHead className="text-right text-[10px]">
                      Net
                    </TableHead>
                    <TableHead className="text-[10px]">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {myDeployments.map((dep, i) => (
                    <TableRow key={`cycle-${dep.poId}-${i}`}>
                      <TableCell className="font-mono text-xs text-gray-500">
                        {i + 1}
                      </TableCell>
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
                      <TableCell className="text-right font-mono text-xs">
                        {fmt(dep.deployed)}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs font-medium text-accent-600">
                        +{fmt(dep.returnAmt)}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs font-medium text-success-600">
                        {fmt(dep.deployed + dep.returnAmt)}
                      </TableCell>
                      <TableCell>
                        <CycleStatusBadge
                          status={dep.cycleComplete ? "complete" : "active"}
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* ═══ WITHDRAW DIALOG ═══ */}
      <Dialog open={showWithdrawDialog} onOpenChange={setShowWithdrawDialog}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Withdraw Funds</DialogTitle>
            <DialogDescription>
              Request a withdrawal from your cash balance of{" "}
              <span className="font-mono font-medium text-brand-600">
                {fmt(cashBalance)}
              </span>
              . Your request will be sent to admin for approval.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-500">
                Amount (RM)
              </label>
              <Input
                type="number"
                value={withdrawAmount}
                onChange={(e) => setWithdrawAmount(e.target.value)}
                placeholder={`Max ${fmt(cashBalance)}`}
                max={cashBalance}
                min={1}
              />
              {parseFloat(withdrawAmount) > cashBalance && (
                <p className="mt-1 text-xs text-danger-600">
                  Amount exceeds your cash balance
                </p>
              )}
            </div>
            <button
              type="button"
              className="text-xs font-medium text-brand-600 hover:text-brand-800"
              onClick={() => setWithdrawAmount(String(cashBalance))}
            >
              Withdraw all ({fmt(cashBalance)})
            </button>
          </div>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>
              Cancel
            </DialogClose>
            <Button
              className="bg-brand-600 text-white hover:bg-brand-800"
              onClick={handleWithdraw}
              disabled={
                withdrawing ||
                !withdrawAmount ||
                parseFloat(withdrawAmount) <= 0 ||
                parseFloat(withdrawAmount) > cashBalance
              }
            >
              {withdrawing ? "Submitting..." : "Submit Request"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ═══ SHEET 5: CAPITAL HISTORY ═══ */}
      <Sheet open={ledgerOpen} onOpenChange={setLedgerOpen}>
        <SheetContent side="right" className="w-[80vw] sm:max-w-[80vw]">
          <SheetHeader>
            <SheetTitle>Capital History</SheetTitle>
            <SheetDescription>
              Every deposit, withdrawal, return, compound, and adjustment on
              your account, newest first.
            </SheetDescription>
          </SheetHeader>
          <div className="flex-1 overflow-y-auto px-6 pb-6">
            {myLedger.length === 0 ? (
              <p className="py-12 text-center text-xs text-gray-500">
                No movements yet.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-[10px]">Date</TableHead>
                    <TableHead className="text-[10px]">Type</TableHead>
                    <TableHead className="text-right text-[10px]">
                      Amount
                    </TableHead>
                    <TableHead className="text-right text-[10px]">
                      Balance
                    </TableHead>
                    <TableHead className="text-[10px]">Notes</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {myLedger.map((row, i) => {
                    const amount = row.amount ?? 0;
                    const kindLabel: Record<string, string> = {
                      deposit: "Deposit",
                      withdrawal: "Withdrawal",
                      return_credit: "Return",
                      compound: "Compound",
                      admin_adjustment: "Adjustment",
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
                      <TableRow key={`${row.ref}-${i}`}>
                        <TableCell className="text-xs text-gray-600">
                          {dateStr}
                        </TableCell>
                        <TableCell
                          className={cn(
                            "text-xs font-medium",
                            kindColor[kind] ?? "text-gray-500"
                          )}
                        >
                          {kindLabel[kind] ?? kind}
                        </TableCell>
                        <TableCell
                          className={cn(
                            "text-right font-mono text-xs font-medium",
                            amountColor
                          )}
                        >
                          {amount === 0
                            ? "--"
                            : (amount > 0 ? "+" : "") + fmt(amount)}
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs">
                          {row.balance_after !== null
                            ? fmt(row.balance_after)
                            : "--"}
                        </TableCell>
                        <TableCell className="text-xs text-gray-500">
                          {row.notes ?? "--"}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </div>
        </SheetContent>
      </Sheet>

      {/* ═══ SHEET 4: WITHDRAWAL HISTORY ═══ */}
      <Sheet open={withdrawalsOpen} onOpenChange={setWithdrawalsOpen}>
        <SheetContent side="right" className="w-[80vw] sm:max-w-[80vw]">
          <SheetHeader>
            <SheetTitle>Withdrawal History</SheetTitle>
            <SheetDescription>
              {myWithdrawals.length} request
              {myWithdrawals.length !== 1 ? "s" : ""}
            </SheetDescription>
          </SheetHeader>
          <div className="flex-1 overflow-y-auto px-6 pb-6">
            {myWithdrawals.length === 0 ? (
              <p className="py-12 text-center text-xs text-gray-500">
                No withdrawal requests yet.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-[10px]">Date</TableHead>
                    <TableHead className="text-right text-[10px]">
                      Amount
                    </TableHead>
                    <TableHead className="text-[10px]">Type</TableHead>
                    <TableHead className="text-[10px]">Status</TableHead>
                    <TableHead className="text-[10px]">Notes</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {myWithdrawals.map((w) => {
                    const statusConfig: Record<
                      string,
                      { label: string; bg: string; text: string }
                    > = {
                      pending: {
                        label: "Pending",
                        bg: "bg-amber-50",
                        text: "text-amber-600",
                      },
                      approved: {
                        label: "Approved",
                        bg: "bg-accent-50",
                        text: "text-accent-600",
                      },
                      rejected: {
                        label: "Rejected",
                        bg: "bg-danger-50",
                        text: "text-danger-600",
                      },
                      completed: {
                        label: "Completed",
                        bg: "bg-success-50",
                        text: "text-success-600",
                      },
                    };
                    const sc = statusConfig[w.status] ?? statusConfig.pending;
                    return (
                      <TableRow key={w.id}>
                        <TableCell className="text-xs text-gray-500">
                          {w.requested_at
                            ? new Date(w.requested_at).toLocaleDateString()
                            : "--"}
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs font-medium text-brand-600">
                          {fmt(w.amount)}
                        </TableCell>
                        <TableCell className="text-xs capitalize text-gray-500">
                          {w.type}
                        </TableCell>
                        <TableCell>
                          <span
                            className={cn(
                              "inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-medium",
                              sc.bg,
                              sc.text
                            )}
                          >
                            {sc.label}
                          </span>
                        </TableCell>
                        <TableCell className="text-xs text-gray-500">
                          {w.notes ?? "--"}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </div>
        </SheetContent>
      </Sheet>

      {/* ═══ DIALOG 3: INTRODUCER NETWORK ═══ */}
      {myRecruits.length > 0 && (
        <Dialog open={introOpen} onOpenChange={setIntroOpen}>
          <DialogContent className="rounded-2xl p-6 sm:max-w-5xl">
            <DialogHeader>
              <DialogTitle>Introducer Network</DialogTitle>
              <DialogDescription>
                {myRecruits.length} investor
                {myRecruits.length !== 1 ? "s" : ""} introduced &middot;{" "}
                {fmt(totalCapitalIntroduced)} total capital
              </DialogDescription>
            </DialogHeader>
            <div className="max-h-[65vh] overflow-y-auto">
              {/* Tier info */}
              <div className="mb-4 flex gap-3 text-xs">
                <span className="text-purple-600">
                  Tier:{" "}
                  <span className="font-mono font-medium">
                    {introTier.name} ({introTier.rate}%)
                  </span>
                </span>
                <span className="text-gray-500">
                  Capital:{" "}
                  <span className="font-mono font-medium text-brand-600">
                    {fmt(totalCapitalIntroduced)}
                  </span>
                </span>
              </div>

              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-[10px]">Investor</TableHead>
                    <TableHead className="text-right text-[10px]">
                      Capital
                    </TableHead>
                    <TableHead className="text-right text-[10px]">
                      Their Returns
                    </TableHead>
                    <TableHead className="text-right text-[10px]">
                      Your Commission
                    </TableHead>
                    <TableHead className="text-[10px]">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {recruitData.map((r) => (
                    <TableRow key={r.name}>
                      <TableCell className="text-xs font-medium text-gray-800">
                        {r.name}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs text-brand-600">
                        {fmt(r.capital)}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs">
                        {fmt(r.returnsEarned)}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs font-medium text-purple-600">
                        {fmt(r.commEarned)}
                      </TableCell>
                      <TableCell>
                        <CycleStatusBadge status={r.commStatus} />
                      </TableCell>
                    </TableRow>
                  ))}
                  <TableRow className="border-t-2 border-gray-300">
                    <TableCell className="text-xs font-medium text-gray-800">
                      Total
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs font-medium text-brand-600">
                      {fmt(totalCapitalIntroduced)}
                    </TableCell>
                    <TableCell />
                    <TableCell className="text-right font-mono text-xs font-medium text-purple-600">
                      {fmt(totalIntroCommEarned)}
                    </TableCell>
                    <TableCell />
                  </TableRow>
                </TableBody>
              </Table>
              <p className="mt-3 text-[11px] text-gray-500">
                Commission = {introTier.rate}% of your introduced
                investors&apos; returns. Earned when their cycles complete.
              </p>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
