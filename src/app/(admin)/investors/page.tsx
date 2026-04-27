"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Plus, Pencil, Trash2, ChevronDown, ChevronRight, Check, X, Banknote, ArrowDownCircle } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { Tables, LedgerRow } from "@/lib/supabase/types";
import { cn } from "@/lib/utils";

// Business logic
import { INV_TIERS } from "@/lib/business-logic/constants";
import { getTier, getInvIntroTier } from "@/lib/business-logic/tiers";
import {
  calcSharedDeployments,
  overlayReturnCredits,
  type Deployment,
  type DeploymentPO,
  type DeploymentInvestor,
} from "@/lib/business-logic/deployment";
import { buildCapitalEvents } from "@/lib/business-logic/capital-events";
import {
  creditPOReturns,
  creditIntroducerCommissions,
} from "@/lib/business-logic/credit";
import { fmt, getMonth } from "@/lib/business-logic/formatters";
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
type DBIntroducerCredit = Tables<"introducer_credits">;
type DBDeposit = Tables<"deposits">;
type DBAdminAdjustment = Tables<"admin_adjustments">;
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
  capitalAtHorizon: number,
  deployments: Deployment[],
  remaining: Record<string, number>
): InvestorStats {
  const invDeps = deployments.filter((d) => d.investorId === invId);
  const completedDeps = invDeps.filter((d) => d.cycleComplete);
  const activeDeps = invDeps.filter((d) => !d.cycleComplete);
  const totalReturns = completedDeps.reduce((s, d) => s + d.returnAmt, 0);
  const pendingReturns = activeDeps.reduce((s, d) => s + d.returnAmt, 0);
  // Idle is the allocator's `remaining` for this investor at horizon end.
  // Deployed is "capital actually in play at horizon" minus idle — this
  // captures open deployments from prior months still locking capital, not
  // just rows committed in the selected month.
  const idle = Math.max(0, remaining[invId] ?? capitalAtHorizon);
  const totalDeployed = Math.max(0, capitalAtHorizon - idle);

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
  // Earned: actually credited to capital (sum of introducer_credits rows
  // for this introducer). Pending: theoretical commission for cycles that
  // haven't cleared yet, computed at the *current* tier rate as a forward
  // estimate. commission = earned + pending — kept for backward
  // compatibility with the "INTRO COMMISSIONS" tile.
  commissionEarned: number;
  commissionPending: number;
  commission: number;
}

function calcIntroducerData(
  investors: DBInvestor[],
  deployments: Deployment[],
  introducerCredits: DBIntroducerCredit[]
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

      // Pending commission: cycles still active (not cleared) — apply the
      // current tier rate as a forward estimate. Once cleared, the credit
      // is locked into a row at the rate-as-of-clear-date.
      const pendingReturns = theirInvestors.reduce((sum, inv) => {
        const invDeps = deployments.filter((d) => d.investorId === inv.id);
        return (
          sum +
          invDeps
            .filter((d) => !d.cycleComplete)
            .reduce((s, d) => s + d.returnAmt, 0)
        );
      }, 0);
      const commissionPending = pendingReturns * (tier.rate / 100);

      // Earned commission: sum of credited introducer_credits for this
      // introducer. base_return on each row is the introducee's actual
      // PO return — summing those gives "investor returns that paid out"
      // for the displayed total returns column.
      const myCredits = introducerCredits.filter(
        (ic) => ic.introducer_id === introId
      );
      const commissionEarned = myCredits.reduce(
        (s, ic) => s + Number(ic.amount),
        0
      );
      const earnedReturns = myCredits.reduce(
        (s, ic) => s + Number(ic.base_return),
        0
      );

      // totalReturns is what the investors page used to display in the
      // "Investor Returns" column (basis for commission). Earned cycles
      // come from credits rows, pending from in-flight deployments.
      const totalReturns = earnedReturns + pendingReturns;

      return {
        id: introId,
        name: intro.name,
        investorCount: theirInvestors.length,
        totalCapitalIntroduced,
        tier,
        totalReturns,
        commissionEarned,
        commissionPending,
        commission: commissionEarned + commissionPending,
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
  const [introducerCredits, setIntroducerCredits] = useState<
    DBIntroducerCredit[]
  >([]);
  const [adminAdjustments, setAdminAdjustments] = useState<DBAdminAdjustment[]>(
    []
  );
  const [deposits, setDeposits] = useState<DBDeposit[]>([]);
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
      introCreditsRes,
      ledgerRes,
      adjustmentsRes,
      depositsRes,
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
      supabase.from("introducer_credits").select("*"),
      supabase
        .from("v_investor_ledger")
        .select("*")
        .order("at", { ascending: false }),
      supabase
        .from("admin_adjustments")
        .select("*")
        .order("created_at", { ascending: true }),
      supabase
        .from("deposits")
        .select("*")
        .order("deposited_at", { ascending: true }),
    ]);
    if (investorsRes.data) setInvestors(investorsRes.data);
    if (posRes.data) setAllPOs(posRes.data as DBPO[]);
    if (withdrawalsRes.data) setWithdrawals(withdrawalsRes.data);
    if (creditsRes.data) setReturnCredits(creditsRes.data);
    if (introCreditsRes.data) setIntroducerCredits(introCreditsRes.data);
    if (ledgerRes.data) setLedgerRows(ledgerRes.data);
    if (adjustmentsRes.data) setAdminAdjustments(adjustmentsRes.data);
    if (depositsRes.data) setDeposits(depositsRes.data);
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
    // Include both PO months and investor-join months. A late-joining
    // investor (e.g. March) whose capital backfills a Feb PO needs March to
    // appear in the dropdown so their deployment row surfaces under its
    // deployedAt month.
    const months = [
      ...new Set([
        ...allPOs.map((po) => getMonth(po.po_date)),
        ...investors.map((i) => getMonth(i.date_joined ?? "")),
      ].filter(Boolean)),
    ]
      .sort()
      .reverse();
    if (!months.includes(currentMonth)) months.unshift(currentMonth);
    if (!months.includes(selectedMonth)) months.unshift(selectedMonth);
    return months;
  }, [allPOs, investors, selectedMonth]);

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

  // Every event that mutates investors.capital on the timeline — deposits,
  // capital withdrawals (submit-time debit), admin adjustments, and return
  // credits (Option C: credits bump capital directly). Builder lives in
  // lib/business-logic/capital-events so all four allocator-calling pages
  // stay in sync; missing a source here silently corrupts `remaining`.
  const capitalEvents = useMemo(
    () =>
      buildCapitalEvents({
        deposits,
        withdrawals,
        adminAdjustments,
        returnCredits,
        introducerCredits,
        pos: allPOs,
      }),
    [
      deposits,
      withdrawals,
      adminAdjustments,
      returnCredits,
      introducerCredits,
      allPOs,
    ]
  );

  // Deployment calculation
  const { deployments: rawDeployments, remaining } = useMemo(() => {
    const dInvestors = investors.map(toDeploymentInvestor);
    const dPOs = poolPOs.map(toDeploymentPO);
    return calcSharedDeployments(dPOs, dInvestors, capitalEvents, selectedMonth);
  }, [investors, poolPOs, capitalEvents, selectedMonth]);

  // Overlay frozen return_credits onto completed-cycle rows so historical
  // returns survive later capital changes. See overlayReturnCredits in
  // lib/business-logic/deployment.ts for the full rationale.
  const deployments = useMemo(
    () => overlayReturnCredits(rawDeployments, returnCredits),
    [rawDeployments, returnCredits]
  );

  // Per-investor "capital at horizon": live capital minus any capital event
  // (deposit or reinvest) dated strictly after the selected month's end.
  // Used as the utilisation denominator so past-month views don't inflate
  // "Deployed" with capital that hadn't arrived yet at that horizon.
  const capitalAtHorizonMap = useMemo(() => {
    const endOfHorizon = `${selectedMonth}-31`;
    const futureDelta: Record<string, number> = {};
    for (const ev of capitalEvents) {
      if ((ev.date || "") > endOfHorizon) {
        futureDelta[ev.investorId] = (futureDelta[ev.investorId] ?? 0) + ev.delta;
      }
    }
    const map = new Map<string, number>();
    for (const inv of investors) {
      map.set(inv.id, inv.capital - (futureDelta[inv.id] ?? 0));
    }
    return map;
  }, [investors, capitalEvents, selectedMonth]);

  // Per-investor stats
  const investorStatsMap = useMemo(() => {
    const map = new Map<string, InvestorStats>();
    for (const inv of investors) {
      const capAtHorizon = capitalAtHorizonMap.get(inv.id) ?? inv.capital;
      map.set(
        inv.id,
        getInvestorStats(inv.id, capAtHorizon, deployments, remaining)
      );
    }
    return map;
  }, [investors, deployments, remaining, capitalAtHorizonMap]);

  // Summary metrics
  // `totalCapital` is live capital (assets under management) — shown on the
  // "Total Capital" metric card so admins always see the cumulative number.
  const totalCapital = useMemo(
    () => investors.reduce((s, i) => s + i.capital, 0),
    [investors]
  );
  // `totalCapitalAtHorizon` is the sum of each investor's capital that had
  // actually arrived by the end of the selected month. It's the utilisation
  // denominator — so Feb/Mar don't pretend that April's deposits were already
  // in the pool.
  const totalCapitalAtHorizon = useMemo(
    () =>
      investors.reduce(
        (s, inv) => s + (capitalAtHorizonMap.get(inv.id) ?? inv.capital),
        0
      ),
    [investors, capitalAtHorizonMap]
  );
  // Idle = sum of investor balances still free at end-of-month (includes prior-
  // month POs still in flight). Clamped by horizon capital so an investor
  // hasn't-yet-deposited future capital doesn't count as idle today.
  const totalIdle = useMemo(
    () =>
      investors.reduce(
        (s, inv) =>
          s +
          Math.max(
            0,
            remaining[inv.id] ?? (capitalAtHorizonMap.get(inv.id) ?? inv.capital)
          ),
        0
      ),
    [investors, remaining, capitalAtHorizonMap]
  );
  const totalDeployed = Math.max(0, totalCapitalAtHorizon - totalIdle);
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
    () => calcIntroducerData(investors, deployments, introducerCredits),
    [investors, deployments, introducerCredits]
  );
  const totalIntroCommEarned = useMemo(
    () => introducerData.reduce((s, d) => s + d.commissionEarned, 0),
    [introducerData]
  );
  const totalIntroCommPending = useMemo(
    () => introducerData.reduce((s, d) => s + d.commissionPending, 0),
    [introducerData]
  );
  const totalIntroComm = totalIntroCommEarned + totalIntroCommPending;

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

  // Introducer-credit triple-key set: introducer:introducee:po. Used by the
  // auto-fire effect to know which (introducer, introducee, po) combos are
  // still missing a credit row, mirroring the creditedPairs check.
  const introCreditedTriples = useMemo(() => {
    const set = new Set<string>();
    introducerCredits.forEach((ic) =>
      set.add(`${ic.introducer_id}:${ic.introducee_id}:${ic.po_id}`)
    );
    return set;
  }, [introducerCredits]);

  // Live capital snapshot per investor — fed to creditIntroducerCommissions
  // so its tier-rate calculation matches what calcIntroducerData uses on the
  // tile (sum of introducees' current capital).
  const capitalById = useMemo(() => {
    const map = new Map<string, number>();
    for (const inv of investors) map.set(inv.id, inv.capital);
    return map;
  }, [investors]);

  // introducedBy lookup — same investor list, just keyed for O(1) access in
  // creditIntroducerCommissions where we need it per cycle-complete deployment.
  const introducedByMap = useMemo(() => {
    const map = new Map<string, string | null>();
    for (const inv of investors) map.set(inv.id, inv.introduced_by);
    return map;
  }, [investors]);

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
  // Fallback path: credits returns for any cleared PO in the current month
  // whose (investor, PO) rows are missing. The primary path is the
  // PO-cycle page firing creditPOReturns inline when admin types a clear
  // date — this effect only catches stragglers (direct-SQL clears, older
  // sessions that cleared before the PO-cycle inline fire existed).
  //
  // Each call passes po.commissions_cleared as p_credit_date so the
  // return_credits row lands with the real earn date, not now().

  const handleCreditReturns = useCallback(async () => {
    setCrediting(true);

    // Target any cleared PO (regardless of po_date month) that has at least
    // one cycle-complete deployment row missing from return_credits. Using
    // the full poolPOs — not just monthPOs — catches the case where a Feb
    // PO cleared in March has a late-joiner backfill that needs crediting
    // when the admin opens the March view.
    const uncreditedPOIds = new Set(
      deployments
        .filter(
          (d) =>
            d.cycleComplete &&
            !creditedPairs.has(`${d.investorId}:${d.poId}`)
        )
        .map((d) => d.poId)
    );
    const clearedPOs = poolPOs.filter(
      (po) => po.commissions_cleared && uncreditedPOIds.has(po.id)
    );
    if (clearedPOs.length === 0) {
      setCrediting(false);
      return;
    }

    const dInvestors = investors.map(toDeploymentInvestor);
    const dPOs = poolPOs.map(toDeploymentPO);

    let credited = 0;
    for (const po of clearedPOs) {
      if (!po.commissions_cleared) continue;
      const result = await creditPOReturns({
        supabase,
        poId: po.id,
        clearDate: po.commissions_cleared,
        investors: dInvestors,
        poolPOs: dPOs,
        capitalEvents,
        alreadyCredited: creditedPairs,
      });
      credited += result.credited;
      for (const err of result.errors) {
        console.error("Credit RPC error:", err);
      }

      // Same PO clear must also credit introducer commissions for any
      // introducee whose return just landed. Runs after creditPOReturns so
      // the introducer's tier (sum of introducees' capital) reflects any
      // re-investment that just happened from this PO.
      const introResult = await creditIntroducerCommissions({
        supabase,
        poId: po.id,
        clearDate: po.commissions_cleared,
        investors: dInvestors,
        introducedBy: introducedByMap,
        capitalById,
        poolPOs: dPOs,
        capitalEvents,
        alreadyCredited: introCreditedTriples,
      });
      credited += introResult.credited;
      for (const err of introResult.errors) {
        console.error("Introducer credit RPC error:", err);
      }
    }

    setCrediting(false);
    if (credited > 0) fetchData();
  }, [
    deployments,
    investors,
    poolPOs,
    capitalEvents,
    creditedPairs,
    introCreditedTriples,
    introducedByMap,
    capitalById,
    supabase,
    fetchData,
  ]);

  // ── Auto-fire credit returns on page load ───────────────────
  // Replaces the old "admin must click Credit Returns" flow. Whenever we
  // detect any cleared PO with uncredited (investor, PO) deployment rows,
  // fire the credit loop once. Idempotent server-side via
  // UNIQUE(investor_id, po_id) on return_credits.
  //
  // The check is per-(investor, PO) pair, not per-PO. Older behaviour only
  // asked "does this PO have ANY credit?" — which missed the case where Pass
  // 1 credited investor A but Pass 2 had a backfill row for late-joiner B
  // that never made it into return_credits. With per-pair, auto-fire runs
  // whenever any deployment row lacks a matching return_credit, and the RPC
  // skips duplicates, so historical gaps self-heal on the next page load
  // without a separate migration.

  const autoCreditedRef = useRef(false);
  useEffect(() => {
    if (loading || crediting || autoCreditedRef.current) return;
    const hasUncreditedReturn = deployments.some(
      (d) =>
        d.cycleComplete &&
        !creditedPairs.has(`${d.investorId}:${d.poId}`)
    );
    // An introducer commission can be missing even when the underlying
    // return is already credited (e.g. backfill ran but no introducer
    // existed at that time, or introduced_by was set after the fact).
    // The auto-fire fires when *either* class of credit is missing.
    const hasUncreditedIntro = deployments.some((d) => {
      if (!d.cycleComplete) return false;
      const introducerId = introducedByMap.get(d.investorId);
      if (!introducerId || introducerId === d.investorId) return false;
      return !introCreditedTriples.has(
        `${introducerId}:${d.investorId}:${d.poId}`
      );
    });
    if (!hasUncreditedReturn && !hasUncreditedIntro) return;
    autoCreditedRef.current = true;
    void handleCreditReturns();
  }, [
    loading,
    crediting,
    deployments,
    creditedPairs,
    introCreditedTriples,
    introducedByMap,
    handleCreditReturns,
  ]);

  // ── Withdrawal approval handlers ────────────────────────────
  // Under Option C there is only 'capital' type. All three handlers go
  // through the migration-008 RPCs so they correctly operate on capital
  // (the RPC handles the debit/refund atomically).

  async function handleApproveWithdrawal(withdrawal: DBWithdrawal) {
    setSaving(true);
    const { data, error } = await supabase.rpc("approve_withdrawal", {
      p_withdrawal_id: withdrawal.id,
    });
    const result = data as { success: boolean; error?: string } | null;
    if (error || !result?.success) {
      console.error(
        "Approve withdrawal failed:",
        error?.message || result?.error
      );
    }
    setSaving(false);
    fetchData();
  }

  async function handleRejectWithdrawal(withdrawalId: string, notes?: string) {
    setSaving(true);
    const { data, error } = await supabase.rpc("reject_withdrawal", {
      p_withdrawal_id: withdrawalId,
      p_admin_notes: notes,
    });
    const result = data as { success: boolean; error?: string } | null;
    if (error || !result?.success) {
      console.error(
        "Reject withdrawal failed:",
        error?.message || result?.error
      );
    }
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
      <div className="grid grid-cols-6 gap-3">
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
          value={fmt(totalIntroCommEarned)}
          subtitle={
            totalIntroCommPending > 0
              ? `${fmt(totalIntroCommPending)} pending`
              : undefined
          }
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
                Credit returns straight to investor capital. Fires automatically on page load — this button is a manual retry.
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
      {totalCapitalAtHorizon > 0 && (
        <div className="rounded-xl bg-white p-4 shadow-sm ring-1 ring-gray-900/10">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
              Capital Utilisation
            </p>
            <p className="font-mono text-xs font-medium text-success-600">
              {((totalDeployed / totalCapitalAtHorizon) * 100).toFixed(0)}% deployed
            </p>
          </div>
          <div className="flex h-3 gap-0.5 overflow-hidden rounded-full bg-gray-100">
            <div
              className="rounded-full bg-success-400 transition-all duration-500"
              style={{
                width: `${(totalDeployed / totalCapitalAtHorizon) * 100}%`,
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
                      Earned
                    </TableHead>
                    <TableHead className="text-[10px] uppercase tracking-wider text-purple-600">
                      Pending
                    </TableHead>
                    <TableHead className="text-[10px] uppercase tracking-wider text-purple-600">
                      Total
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
                      <TableCell className="font-mono text-xs font-medium text-success-600">
                        {fmt(d.commissionEarned)}
                      </TableCell>
                      <TableCell className="font-mono text-xs text-amber-600">
                        {d.commissionPending > 0
                          ? fmt(d.commissionPending)
                          : "--"}
                      </TableCell>
                      <TableCell className="font-mono text-xs font-medium text-purple-600">
                        {fmt(d.commission)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <p className="mt-3 text-[10px] text-gray-500">
                Tier based on total capital introduced. Earned = credited to
                capital from cleared cycles. Pending = forecast at current
                tier rate for cycles still in flight.
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
                            {/* 'approved' is transient — approve_withdrawal
                                RPC moves status straight to 'completed'.
                                No manual Mark Paid step remains. */}
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
          <TableCell colSpan={12} className="p-0">
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
              <div className="grid grid-cols-3 gap-3">
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
    introducer_credit: "Introducer Commission",
    admin_adjustment: "Admin Adjustment",
  };
  const kindColor: Record<string, string> = {
    deposit: "text-success-600",
    withdrawal: "text-danger-600",
    return_credit: "text-accent-600",
    introducer_credit: "text-purple-600",
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
            return credits, and admin adjustments. There is no undo.
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
