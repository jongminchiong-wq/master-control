"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { Database, Tables } from "@/lib/supabase/types";
import type { LedgerRow } from "@/lib/supabase/types-helpers";
import { cn } from "@/lib/utils";

// Business logic
import { INV_TIERS, INV_INTRO_TIERS } from "@/lib/business-logic/constants";
import { getTier } from "@/lib/business-logic/tiers";
import {
  calcSharedDeployments,
  overlayReturnCredits,
  type Deployment,
  type DeploymentPO,
  type DeploymentInvestor,
} from "@/lib/business-logic/deployment";
import { buildCapitalEvents } from "@/lib/business-logic/capital-events";
import { calcFundingStatus } from "@/lib/business-logic/funding-status";
import { fmt } from "@/lib/business-logic/formatters";

// Shared components
import { TierCard } from "@/components/tier-card";
import { FundingOpportunities } from "@/components/funding-opportunities";

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
  Clock,
  History,
  ChevronRight,
} from "lucide-react";

// ── Types ───────────────────────────────────────────────────

type DBInvestor = Tables<"investors">;
type DBWithdrawal = Tables<"withdrawals">;
type DBPO = Tables<"purchase_orders"> & {
  delivery_orders: Tables<"delivery_orders">[];
};
type DBAdminAdjustment = Tables<"admin_adjustments">;
type DBReturnCredit = Tables<"return_credits">;
type DBIntroducerCredit = Tables<"introducer_credits">;
// Pool-wide event rows from the views added in migration 013. The investor
// session is RLS-clipped on the underlying `deposits` and `introducer_credits`
// tables, so the allocator-feeding fetches go through these sanitised views
// to recover pool-wide visibility without leaking PII columns.
type DBDepositEvent = Database["public"]["Views"]["v_deposit_events"]["Row"];
type DBIntroducerCreditEvent =
  Database["public"]["Views"]["v_introducer_credit_events"]["Row"];

// ── DB → Business-logic mappers ─────────────────────────────

function toDeploymentPO(po: DBPO): DeploymentPO {
  return {
    id: po.id,
    ref: po.ref,
    poDate: po.po_date,
    poAmount: po.po_amount,
    channel: po.channel,
    description: po.description,
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

type CycleStatus = "complete" | "active" | "cleared" | "pending";

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
  cleared: {
    label: "Cleared",
    bg: "bg-success-50",
    text: "text-success-800",
  },
  pending: { label: "Pending", bg: "bg-amber-50", text: "text-amber-600" },
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

// ── Introducer drill-down helpers ───────────────────────────
// Kept as module-scope pure functions so they can be lifted into
// `src/lib/business-logic/` later without touching the call sites.

type ClearedRow = {
  poRef: string;
  clearedAt: string;
  tierRate: number;
  commission: number;
};

type PendingRow = {
  poRef: string;
  poDate: string;
  currentTierRate: number;
  projectedCommission: number;
};

function buildClearedRows(
  credits: DBIntroducerCredit[],
  poById: Map<string, DBPO>
): ClearedRow[] {
  return credits
    .map((ic) => {
      const po = poById.get(ic.po_id);
      return {
        poRef: po?.ref ?? "—",
        clearedAt: ic.created_at,
        tierRate: Number(ic.tier_rate),
        commission: Number(ic.amount),
      };
    })
    .sort((a, b) => (a.clearedAt < b.clearedAt ? 1 : -1));
}

function buildPendingRows(
  recruitDeps: Deployment[],
  currentTierRate: number
): PendingRow[] {
  return recruitDeps
    .filter((d) => !d.cycleComplete)
    .map((d) => ({
      poRef: d.poRef,
      poDate: d.poDate,
      currentTierRate,
      projectedCommission: d.returnAmt * (currentTierRate / 100),
    }))
    .sort((a, b) => (a.poDate < b.poDate ? -1 : 1));
}

function tierNameByRate(rate: number): string {
  return INV_INTRO_TIERS.find((t) => t.rate === rate)?.name ?? "—";
}

// ── Component ───────────────────────────────────────────────

export default function InvestorDashboardPage() {
  const supabase = useMemo(() => createClient(), []);

  // Data state
  const [myInvestor, setMyInvestor] = useState<DBInvestor | null>(null);
  const [allInvestors, setAllInvestors] = useState<DBInvestor[]>([]);
  const [allPOs, setAllPOs] = useState<DBPO[]>([]);
  // depositEvents/introducerCreditEvents come from migration-013 views — they
  // contain only the columns the allocator needs and are pool-wide for any
  // authenticated user. introducerCredits (full row) is still fetched
  // separately for the personal recruit-data section, where introducee_id /
  // tier_rate are needed and RLS-clipping to "my own credits" is correct.
  const [depositEvents, setDepositEvents] = useState<DBDepositEvent[]>([]);
  const [allWithdrawals, setAllWithdrawals] = useState<DBWithdrawal[]>([]);
  const [adminAdjustments, setAdminAdjustments] = useState<DBAdminAdjustment[]>(
    []
  );
  const [returnCredits, setReturnCredits] = useState<DBReturnCredit[]>([]);
  const [introducerCredits, setIntroducerCredits] = useState<
    DBIntroducerCredit[]
  >([]);
  const [introducerCreditEvents, setIntroducerCreditEvents] = useState<
    DBIntroducerCreditEvent[]
  >([]);
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
  const [expandedRecruit, setExpandedRecruit] = useState<string | null>(null);

  const toggleRecruit = useCallback((id: string) => {
    setExpandedRecruit((prev) => (prev === id ? null : id));
  }, []);
  const router = useRouter();
  const goDeposit = useCallback(() => router.push("/wallet?deposit=1"), [router]);

  // Capital history
  const [myLedger, setMyLedger] = useState<LedgerRow[]>([]);

  // Withdrawal history (investor's own). Capital withdrawals happen on
  // the Wallet page under Option C — Portfolio is read-only for wallet state.
  const [myWithdrawals, setMyWithdrawals] = useState<DBWithdrawal[]>([]);

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

    const [
      investorsRes,
      posRes,
      myWithdrawalsRes,
      allWithdrawalsRes,
      ledgerRes,
      depositEventsRes,
      adjustmentsRes,
      returnCreditsRes,
      introducerCreditsRes,
      introducerCreditEventsRes,
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
        .eq("investor_id", investorData.id)
        .order("requested_at", { ascending: false }),
      // Pool-wide capital events for the allocator seed (009 grants RLS).
      supabase
        .from("withdrawals")
        .select("*")
        .order("requested_at", { ascending: true }),
      supabase
        .from("v_investor_ledger")
        .select("*")
        .eq("investor_id", investorData.id)
        .order("at", { ascending: false }),
      // Pool-wide deposit events via the migration-013 view. The underlying
      // `deposits` table is RLS-clipped to own rows for non-admins; the view
      // exposes only investor_id/deposited_at/amount across all investors so
      // the shared allocator's seed math stays consistent with admin.
      supabase
        .from("v_deposit_events")
        .select("*")
        .order("deposited_at", { ascending: true }),
      supabase
        .from("admin_adjustments")
        .select("*")
        .order("created_at", { ascending: true }),
      supabase
        .from("return_credits")
        .select("*")
        .order("created_at", { ascending: true }),
      // Personal introducer_credits (full row) — RLS clips this to rows where
      // I am the introducer, which is exactly what the recruit-data section
      // below needs (introducee_id, locked tier_rate per credited PO).
      supabase
        .from("introducer_credits")
        .select("*")
        .order("created_at", { ascending: true }),
      // Pool-wide introducer-credit events via the migration-013 view. Same
      // rationale as v_deposit_events — the allocator needs every investor's
      // credit history to compute the right `remaining` seed; this view
      // exposes only the four columns it consumes (no introducee_id /
      // base_return / tier_rate leak).
      supabase
        .from("v_introducer_credit_events")
        .select("*")
        .order("created_at", { ascending: true }),
    ]);

    if (investorsRes.data) setAllInvestors(investorsRes.data);
    if (posRes.data) setAllPOs(posRes.data as DBPO[]);
    if (myWithdrawalsRes.data) setMyWithdrawals(myWithdrawalsRes.data);
    if (allWithdrawalsRes.data) setAllWithdrawals(allWithdrawalsRes.data);
    if (ledgerRes.data) setMyLedger(ledgerRes.data);
    if (depositEventsRes.data) setDepositEvents(depositEventsRes.data);
    if (adjustmentsRes.data) setAdminAdjustments(adjustmentsRes.data);
    if (returnCreditsRes.data) setReturnCredits(returnCreditsRes.data);
    if (introducerCreditsRes.data)
      setIntroducerCredits(introducerCreditsRes.data);
    if (introducerCreditEventsRes.data)
      setIntroducerCreditEvents(introducerCreditEventsRes.data);

    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // ── Computed: deployments (all-time) ──────────────────────
  // The investor dashboard shows a cumulative snapshot — no month scope.
  // Every PO feeds the allocator so prior-month deployments that are still
  // locking capital are respected in "idle" and "deployed".

  const deploymentPOs = useMemo(
    () => allPOs.map(toDeploymentPO),
    [allPOs]
  );

  const deploymentInvestors = useMemo(
    () => allInvestors.map(toDeploymentInvestor),
    [allInvestors]
  );

  // Every investors.capital mutation fed as a timeline event so the
  // allocator's `remaining` seed starts at true initial capital. See
  // lib/business-logic/capital-events.ts.
  const capitalEvents = useMemo(
    () =>
      buildCapitalEvents({
        deposits: depositEvents,
        withdrawals: allWithdrawals,
        adminAdjustments,
        returnCredits,
        introducerCredits: introducerCreditEvents,
        pos: allPOs,
      }),
    [
      depositEvents,
      allWithdrawals,
      adminAdjustments,
      returnCredits,
      introducerCreditEvents,
      allPOs,
    ]
  );

  const { deployments: rawAllDeployments, remaining } = useMemo(
    () =>
      calcSharedDeployments(
        deploymentPOs,
        deploymentInvestors,
        capitalEvents
      ),
    [deploymentPOs, deploymentInvestors, capitalEvents]
  );

  // Overlay frozen return_credits so completed cycles show the rate/amount
  // that was actually paid at clearance — the Investment Returns modal and
  // Cycle History table both derive from this. See deployment.ts for the
  // full rationale (tier-at-current-capital vs tier-at-clearance drift).
  const allDeployments = useMemo(
    () => overlayReturnCredits(rawAllDeployments, returnCredits),
    [rawAllDeployments, returnCredits]
  );

  // ── Computed: platform funding status (pool-wide) ─────────
  // Only backfill-eligible POs count as "funding opportunities" — mirrors
  // Pass-2 backfill rules in calcSharedDeployments. Without this filter, a
  // historically closed PO that happened to be short-funded at cycle close
  // would leak into the card as a ghost entry.

  const backfillEligiblePOs = useMemo(
    () =>
      deploymentPOs.filter((po) => {
        const fullyPaid =
          !!po.dos &&
          po.dos.length > 0 &&
          po.dos.every((d) => !!d.buyerPaid);
        return !fullyPaid && !po.commissionsCleared;
      }),
    [deploymentPOs]
  );

  const asOfDate = useMemo(() => {
    const d = new Date();
    return (
      d.getFullYear() +
      "-" +
      String(d.getMonth() + 1).padStart(2, "0") +
      "-" +
      String(d.getDate()).padStart(2, "0")
    );
  }, []);

  const fundingStatus = useMemo(
    () =>
      calcFundingStatus({
        monthPOs: backfillEligiblePOs,
        deployments: allDeployments,
        investors: deploymentInvestors,
        remaining,
        asOfDate,
      }),
    [backfillEligiblePOs, allDeployments, deploymentInvestors, remaining, asOfDate]
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
  // Idle comes from the allocator's `remaining` after walking every PO.
  // Deployed is live capital minus idle — captures open deployments
  // across any month still locking capital.

  const myCapital = myInvestor?.capital ?? 0;

  const idle = useMemo(() => {
    if (!myInvestor) return 0;
    return Math.max(0, remaining[myInvestor.id] ?? myCapital);
  }, [myInvestor, remaining, myCapital]);

  const totalDeployed = myInvestor ? Math.max(0, myCapital - idle) : 0;

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
    myInvestor && myCapital > 0
      ? ((totalDeployed / myCapital) * 100).toFixed(0)
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

  const poById = useMemo(() => {
    const map = new Map<string, DBPO>();
    for (const po of allPOs) map.set(po.id, po);
    return map;
  }, [allPOs]);

  const recruitData = useMemo(() => {
    if (myRecruits.length === 0 || !myInvestor) return [];
    return myRecruits.map((recruit) => {
      const recruitDeps = allDeployments.filter(
        (d) => d.investorId === recruit.id
      );
      const rReturnsPending = recruitDeps
        .filter((d) => !d.cycleComplete)
        .reduce((s, d) => s + d.returnAmt, 0);
      // Earned commission from this recruit comes from credited rows. Each
      // row carries its locked tier_rate from the moment the underlying PO
      // cleared, so a tier upgrade later doesn't retroactively rewrite the
      // displayed value.
      const myCredits = introducerCredits.filter(
        (ic) =>
          ic.introducer_id === myInvestor.id &&
          ic.introducee_id === recruit.id
      );
      const commEarned = myCredits.reduce(
        (s, ic) => s + Number(ic.amount),
        0
      );
      // Pending stays a forward estimate at the *current* tier rate.
      const commPending = rReturnsPending * (introTier.rate / 100);
      // Status reflects commission state, not cycle state: once an amount
      // has been credited via introducer_credits it is permanently cleared,
      // even if the same recruit later starts another cycle.
      const commStatus: CycleStatus =
        commEarned > 0 && commPending === 0
          ? "cleared"
          : commEarned > 0 && commPending > 0
            ? "active"
            : "pending";
      return {
        id: recruit.id,
        name: recruit.name,
        capital: recruit.capital,
        commEarned,
        commPending,
        commTotal: commEarned + commPending,
        commStatus,
        clearedRows: buildClearedRows(myCredits, poById),
        pendingRows: buildPendingRows(recruitDeps, introTier.rate),
      };
    });
  }, [
    myRecruits,
    allDeployments,
    introTier.rate,
    introducerCredits,
    myInvestor,
    poById,
  ]);

  const totalIntroCommEarned = recruitData.reduce(
    (s, r) => s + r.commEarned,
    0
  );
  const totalIntroCommPending = recruitData.reduce(
    (s, r) => s + r.commPending,
    0
  );
  const totalIntroComm = totalIntroCommEarned + totalIntroCommPending;

  // ── Lifetime metrics ──────────────────────────────────────
  // Under Option C, the "Deployed" card shows capital currently locked.
  // For total-ever-deployed and total-ever-earned we use:
  //   - Lifetime Deployed: sum of every deployment row (all time, never drops)
  //   - Lifetime Returns: sum of return_credits for this investor (permanent
  //     audit log — credit bumps capital, row persists)

  const lifetimeDeployed = useMemo(
    () => myDeployments.reduce((s, d) => s + d.deployed, 0),
    [myDeployments]
  );

  const lifetimeReturns = useMemo(() => {
    if (!myInvestor) return 0;
    return returnCredits
      .filter((rc) => rc.investor_id === myInvestor.id)
      .reduce((s, rc) => s + Number(rc.amount), 0);
  }, [returnCredits, myInvestor]);

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
      {/* ═══ HERO SECTION (on canvas, no card chrome) ═══ */}
      <div className="px-1 pt-2 pb-1">
        <p className="text-sm text-gray-500">Portfolio Value</p>
        <p className="mt-2 font-mono text-3xl font-semibold tracking-tight text-gray-900">
          {fmt(myInvestor.capital)}
        </p>
        {(totalReturns > 0 || lifetimeDeployed > 0) && (
          <div className="mt-2 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            {totalReturns > 0 ? (
              <p className="font-mono text-sm font-medium text-success-600">
                +{fmt(totalReturns)} total returns earned
              </p>
            ) : (
              <span />
            )}
            {lifetimeDeployed > 0 && (
              <p className="font-mono text-xs text-gray-500">
                Lifetime deployed{" "}
                <span className="font-medium text-gray-700">
                  {fmt(lifetimeDeployed)}
                </span>
                <span className="text-gray-400">
                  {" · "}
                  {myDeployments.length} cycle
                  {myDeployments.length !== 1 ? "s" : ""}
                </span>
              </p>
            )}
          </div>
        )}

        {/* Utilisation bar — all-time snapshot of live capital */}
        {myCapital > 0 && (
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
                  width: `${(totalDeployed / myCapital) * 100}%`,
                }}
              />
              {idle > 0 && (
                <div
                  className="rounded-md bg-gray-200"
                  style={{
                    width: `${(idle / myCapital) * 100}%`,
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

      {/* ═══ FUNDING OPPORTUNITIES (unfunded POs in pool) ═══ */}
      <FundingOpportunities
        status={fundingStatus}
        investorTierRate={myTier.rate}
        investorTierName={myTier.name}
        idleCapital={idle}
        onFund={goDeposit}
        onTopUp={goDeposit}
      />

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
        {/* Card 1: Deployed (currently locked) */}
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
            Currently in live POs &middot; {utilisationPct}% utilised
          </p>
          <div className="mt-4 flex items-center gap-1.5 border-t border-gray-100 pt-4 text-sm font-semibold text-brand-600">
            View deployments
            <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" />
          </div>
        </button>

        {/* Card 2: Lifetime Returns — from return_credits, never drops */}
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
          <p className="text-xs font-medium text-gray-500">Lifetime Returns</p>
          <p className="mt-1 font-mono text-xl font-semibold text-accent-600">
            {fmt(lifetimeReturns)}
          </p>
          <p className="mt-1 text-xs text-gray-500">
            Credited to capital &middot; grows forever
          </p>
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

      {/* ═══ TIER PROGRESS (on canvas, half-width) ═══ */}
      <div className="w-full max-w-[50%] px-1">
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
              {fmt(lifetimeDeployed)} lifetime
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[65vh] overflow-y-auto">
            {myDeployments.length === 0 ? (
              <p className="py-12 text-center text-xs text-gray-500">
                No deployments yet.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-[10px]">PO Ref</TableHead>
                    <TableHead className="text-[10px]">PO Date</TableHead>
                    <TableHead className="text-[10px]">Description</TableHead>
                    <TableHead className="text-right text-[10px]">
                      Deployed
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
                      <TableCell className="text-xs text-gray-500">
                        {dep.poDate}
                      </TableCell>
                      <TableCell className="text-xs text-gray-600">
                        {dep.description || "—"}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs font-medium text-brand-600">
                        {fmt(dep.deployed)}
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
                      {fmt(lifetimeDeployed)}
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
              {fmt(totalReturns + pendingReturns)} total &middot; at current{" "}
              {myTier.rate}% tier
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
                  at current {myTier.rate}% tier
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
                      Rate
                    </TableHead>
                    <TableHead className="text-right text-[10px]">
                      Return
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
                      <TableCell className="text-right font-mono text-xs text-gray-600">
                        {dep.returnRate}%
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
                </TableBody>
              </Table>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Under Option C, withdrawals happen on the Wallet page only
          (capital type, min RM 5,000, admin approval). */}

      {/* ═══ SHEET 5: CAPITAL HISTORY ═══ */}
      <Sheet open={ledgerOpen} onOpenChange={setLedgerOpen}>
        <SheetContent side="right" className="w-[80vw] sm:max-w-[80vw]">
          <SheetHeader>
            <SheetTitle>Capital History</SheetTitle>
            <SheetDescription>
              Every deposit, withdrawal, return, and adjustment on
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
                      admin_adjustment: "Adjustment",
                      introducer_credit: "Introducer Commission",
                    };
                    const kindColor: Record<string, string> = {
                      deposit: "text-success-600",
                      withdrawal: "text-danger-600",
                      return_credit: "text-accent-600",
                      admin_adjustment: "text-amber-600",
                      introducer_credit: "text-purple-600",
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
                  <span className="font-mono font-medium text-gray-700">
                    {fmt(totalCapitalIntroduced)}
                  </span>
                </span>
              </div>

              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[28px] text-[10px]" />
                    <TableHead className="text-[10px]">Investor</TableHead>
                    <TableHead className="text-right text-[10px]">
                      Capital
                    </TableHead>
                    <TableHead className="text-right text-[10px]">
                      Earned
                    </TableHead>
                    <TableHead className="text-right text-[10px]">
                      Pending
                    </TableHead>
                    <TableHead className="text-right text-[10px]">
                      Total
                    </TableHead>
                    <TableHead className="text-[10px]">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {recruitData.map((r) => {
                    const isExpanded = expandedRecruit === r.id;
                    const hasDetail =
                      r.clearedRows.length > 0 || r.pendingRows.length > 0;
                    return (
                      <Fragment key={r.id}>
                        <TableRow
                          onClick={
                            hasDetail ? () => toggleRecruit(r.id) : undefined
                          }
                          className={cn(
                            hasDetail && "cursor-pointer",
                            isExpanded && "bg-purple-50/30"
                          )}
                        >
                          <TableCell className="px-2">
                            {hasDetail && (
                              <ChevronRight
                                className={cn(
                                  "h-3.5 w-3.5 text-gray-400 transition-transform",
                                  isExpanded && "rotate-90"
                                )}
                              />
                            )}
                          </TableCell>
                          <TableCell className="text-xs font-medium text-gray-800">
                            {r.name}
                          </TableCell>
                          <TableCell className="text-right font-mono text-xs text-gray-700">
                            {fmt(r.capital)}
                          </TableCell>
                          <TableCell className="text-right font-mono text-xs font-medium text-success-600">
                            {fmt(r.commEarned)}
                          </TableCell>
                          <TableCell className="text-right font-mono text-xs text-amber-600">
                            {r.commPending > 0 ? fmt(r.commPending) : "--"}
                          </TableCell>
                          <TableCell className="text-right font-mono text-xs font-medium text-accent-600">
                            {fmt(r.commTotal)}
                          </TableCell>
                          <TableCell>
                            <CycleStatusBadge status={r.commStatus} />
                          </TableCell>
                        </TableRow>
                        {isExpanded && hasDetail && (
                          <TableRow className="hover:bg-transparent">
                            <TableCell
                              colSpan={7}
                              className="bg-gray-50/60 p-0"
                            >
                              <div className="space-y-5 px-4 py-4">
                                {r.clearedRows.length > 0 && (
                                  <div>
                                    <div className="mb-2 flex items-center justify-between">
                                      <div className="flex items-center gap-2">
                                        <span className="text-[10px] font-semibold uppercase tracking-wider text-success-700">
                                          Cleared cycles
                                        </span>
                                        <span className="font-mono text-[10px] text-gray-400">
                                          {r.clearedRows.length}
                                        </span>
                                      </div>
                                      <span className="text-[10px] text-gray-500">
                                        Tier rate locked at clear date
                                      </span>
                                    </div>
                                    <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
                                      <div className="grid grid-cols-5 gap-2 border-b border-gray-100 bg-gray-50 px-3 py-2 text-[10px] font-medium uppercase tracking-wider text-gray-500">
                                        <div>PO Ref</div>
                                        <div>Cleared</div>
                                        <div className="text-right">
                                          Tier @ Clear
                                        </div>
                                        <div className="text-right">Rate</div>
                                        <div className="text-right">
                                          Commission
                                        </div>
                                      </div>
                                      {r.clearedRows.map((cr, i) => (
                                        <div
                                          key={i}
                                          className="grid grid-cols-5 items-center gap-2 border-b border-gray-100 px-3 py-2 text-xs last:border-b-0"
                                        >
                                          <div className="font-mono text-accent-700">
                                            {cr.poRef}
                                          </div>
                                          <div className="font-mono text-gray-600">
                                            {cr.clearedAt.slice(0, 10)}
                                          </div>
                                          <div className="text-right">
                                            <span className="inline-flex items-center rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-700">
                                              {tierNameByRate(cr.tierRate)}
                                            </span>
                                          </div>
                                          <div className="text-right font-mono text-purple-600">
                                            {cr.tierRate}%
                                          </div>
                                          <div className="text-right font-mono font-medium text-success-600">
                                            +{fmt(cr.commission)}
                                          </div>
                                        </div>
                                      ))}
                                      <div className="flex items-center justify-between border-t border-gray-100 bg-gray-50/70 px-3 py-2">
                                        <span className="text-[10px] font-medium uppercase tracking-wider text-gray-500">
                                          Subtotal earned
                                        </span>
                                        <span className="font-mono text-xs font-semibold text-success-700">
                                          {fmt(r.commEarned)}
                                        </span>
                                      </div>
                                    </div>
                                  </div>
                                )}

                                {r.pendingRows.length > 0 && (
                                  <div>
                                    <div className="mb-2 flex items-center justify-between">
                                      <div className="flex items-center gap-2">
                                        <span className="text-[10px] font-semibold uppercase tracking-wider text-amber-700">
                                          Active
                                        </span>
                                        <span className="font-mono text-[10px] text-gray-400">
                                          {r.pendingRows.length}
                                        </span>
                                      </div>
                                      <span className="text-[10px] text-gray-500">
                                        Forecast at current tier rate &middot;{" "}
                                        {introTier.rate}%
                                      </span>
                                    </div>
                                    <div className="overflow-hidden rounded-lg border border-amber-100 bg-white">
                                      <div className="grid grid-cols-5 gap-2 border-b border-amber-100 bg-amber-50/50 px-3 py-2 text-[10px] font-medium uppercase tracking-wider text-gray-500">
                                        <div>PO Ref</div>
                                        <div>PO Date</div>
                                        <div className="text-right">
                                          Current Tier
                                        </div>
                                        <div className="text-right">Rate</div>
                                        <div className="text-right">
                                          Projected
                                        </div>
                                      </div>
                                      {r.pendingRows.map((pr, i) => (
                                        <div
                                          key={i}
                                          className="grid grid-cols-5 items-center gap-2 border-b border-amber-50 px-3 py-2 text-xs last:border-b-0"
                                        >
                                          <div className="font-mono text-accent-700">
                                            {pr.poRef}
                                          </div>
                                          <div className="font-mono text-gray-600">
                                            {pr.poDate}
                                          </div>
                                          <div className="text-right">
                                            <span className="inline-flex items-center rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-700">
                                              {introTier.name}
                                            </span>
                                          </div>
                                          <div className="text-right font-mono text-purple-600">
                                            {pr.currentTierRate}%
                                          </div>
                                          <div className="text-right font-mono font-medium text-amber-700">
                                            ~{fmt(pr.projectedCommission)}
                                          </div>
                                        </div>
                                      ))}
                                      <div className="flex items-center justify-between border-t border-amber-100 bg-amber-50/40 px-3 py-2">
                                        <span className="text-[10px] font-medium uppercase tracking-wider text-gray-500">
                                          Subtotal projected
                                        </span>
                                        <span className="font-mono text-xs font-semibold text-amber-700">
                                          ~{fmt(r.commPending)}
                                        </span>
                                      </div>
                                    </div>
                                    <p className="mt-2 text-[10px] italic text-gray-500">
                                      Projected amounts use the current tier
                                      rate. The actual rate is locked when
                                      each PO clears, so a tier change before
                                      clear will adjust the final commission.
                                    </p>
                                  </div>
                                )}
                              </div>
                            </TableCell>
                          </TableRow>
                        )}
                      </Fragment>
                    );
                  })}
                  <TableRow className="border-t-2 border-gray-300">
                    <TableCell />
                    <TableCell className="text-xs font-medium text-gray-800">
                      Total
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs font-medium text-gray-700">
                      {fmt(totalCapitalIntroduced)}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs font-medium text-success-600">
                      {fmt(totalIntroCommEarned)}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs font-medium text-amber-600">
                      {totalIntroCommPending > 0
                        ? fmt(totalIntroCommPending)
                        : "--"}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs font-medium text-accent-600">
                      {fmt(totalIntroComm)}
                    </TableCell>
                    <TableCell />
                  </TableRow>
                </TableBody>
              </Table>
              <p className="mt-3 text-[11px] text-gray-500">
                Earned = credited to capital from cleared cycles, locked at
                the tier rate that was in effect when the PO cleared. Pending
                = forecast at the current tier rate ({introTier.rate}%) for
                cycles still in flight.
              </p>
            </div>
          </DialogContent>
        </Dialog>
      )}

    </div>
  );
}
