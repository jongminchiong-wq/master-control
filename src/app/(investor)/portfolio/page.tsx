"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import type { Tables } from "@/lib/supabase/types";
import { cn } from "@/lib/utils";

// Business logic
import { INV_TIERS, INV_INTRO_TIERS } from "@/lib/business-logic/constants";
import { getTier } from "@/lib/business-logic/tiers";
import {
  calcSharedDeployments,
  type DeploymentPO,
  type DeploymentInvestor,
  type Deployment,
} from "@/lib/business-logic/deployment";
import { fmt, getMonth, fmtMonth } from "@/lib/business-logic/formatters";

// Shared components
import { TierCard } from "@/components/tier-card";
import { ChannelBadge } from "@/components/channel-badge";
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
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";

// Icons
import {
  DollarSign,
  TrendingUp,
  Users,
  ArrowRight,
  Star,
} from "lucide-react";

// ── Types ───────────────────────────────────────────────────

type DBInvestor = Tables<"investors">;
type DBPO = Tables<"purchase_orders"> & {
  delivery_orders: Tables<"delivery_orders">[];
};

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
  const [loading, setLoading] = useState(true);
  const [errorState, setErrorState] = useState<
    "not_authenticated" | "no_investor" | null
  >(null);

  // Sheet state
  const [deploymentsOpen, setDeploymentsOpen] = useState(false);
  const [returnsOpen, setReturnsOpen] = useState(false);
  const [introOpen, setIntroOpen] = useState(false);

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

    const [investorsRes, posRes] = await Promise.all([
      supabase
        .from("investors")
        .select("*")
        .order("created_at", { ascending: true }),
      supabase
        .from("purchase_orders")
        .select("*, delivery_orders(*)")
        .order("po_date", { ascending: true }),
    ]);

    if (investorsRes.data) setAllInvestors(investorsRes.data);
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

  // ── Computed: deployments for selected month ──────────────

  const monthPOs = useMemo(
    () => allPOs.filter((po) => getMonth(po.po_date) === selectedMonth),
    [allPOs, selectedMonth]
  );

  const deploymentPOs = useMemo(
    () => monthPOs.map(toDeploymentPO),
    [monthPOs]
  );

  const deploymentInvestors = useMemo(
    () => allInvestors.map(toDeploymentInvestor),
    [allInvestors]
  );

  const { deployments: allDeployments } = useMemo(
    () => calcSharedDeployments(deploymentPOs, deploymentInvestors),
    [deploymentPOs, deploymentInvestors]
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

  const totalDeployed = useMemo(
    () => myDeployments.reduce((s, d) => s + d.deployed, 0),
    [myDeployments]
  );

  const idle = myInvestor ? myInvestor.capital - totalDeployed : 0;

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
      <div className="flex items-center justify-between">
        <h1 className="text-base font-medium text-gray-800">Portfolio</h1>
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
            <p className="text-sm text-gray-500">Your capital</p>
            <p className="mt-2 font-mono text-3xl font-semibold tracking-tight text-gray-900">
              {fmt(myInvestor.capital)}
            </p>
            {totalReturns > 0 && (
              <p className="mt-2 font-mono text-sm font-medium text-success-600">
                +{fmt(totalReturns)} earned this month
              </p>
            )}
          </div>
          <div className="flex items-center gap-2 rounded-full bg-accent-50 px-4 py-2">
            <Star className="size-4 text-accent-600" strokeWidth={1.5} />
            <span className="text-sm font-semibold text-accent-600">
              {myTier.name}
            </span>
            <span className="font-mono text-sm font-bold text-accent-400">
              {myTier.rate}%
            </span>
            <span className="text-xs text-accent-600">per cycle</span>
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
              Introducer Network
            </p>
            <p className="mt-1 font-mono text-xl font-semibold text-purple-600">
              {fmt(totalIntroComm)}
            </p>
            <p className="mt-1 text-xs text-gray-500">
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
        <div className="mb-4 flex items-center justify-between">
          <p className="text-sm font-semibold text-gray-800">Investor Tier</p>
          <p className="font-mono text-xs font-medium text-accent-600">
            {myTier.name} &middot; {myTier.rate}% per cycle
          </p>
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

      {/* ═══ SHEET 1: DEPLOYMENTS ═══ */}
      <Sheet open={deploymentsOpen} onOpenChange={setDeploymentsOpen}>
        <SheetContent side="right" className="w-[80vw] sm:max-w-[80vw]">
          <SheetHeader>
            <SheetTitle>My Deployments</SheetTitle>
            <SheetDescription>
              {myDeployments.length} PO
              {myDeployments.length !== 1 ? "s" : ""} &middot;{" "}
              {fmt(totalDeployed)} deployed &middot; {utilisationPct}% utilised
            </SheetDescription>
          </SheetHeader>
          <div className="flex-1 overflow-y-auto px-6 pb-6">
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
        </SheetContent>
      </Sheet>

      {/* ═══ SHEET 2: RETURNS ═══ */}
      <Sheet open={returnsOpen} onOpenChange={setReturnsOpen}>
        <SheetContent side="right" className="w-[80vw] sm:max-w-[80vw]">
          <SheetHeader>
            <SheetTitle>Investment Returns</SheetTitle>
            <SheetDescription>
              {fmt(totalReturns + pendingReturns)} total &middot;{" "}
              {myTier.rate}% per cycle
            </SheetDescription>
          </SheetHeader>
          <div className="flex-1 overflow-y-auto px-6 pb-6">
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
        </SheetContent>
      </Sheet>

      {/* ═══ SHEET 3: INTRODUCER NETWORK ═══ */}
      {myRecruits.length > 0 && (
        <Sheet open={introOpen} onOpenChange={setIntroOpen}>
          <SheetContent side="right" className="w-[80vw] sm:max-w-[80vw]">
            <SheetHeader>
              <SheetTitle>Introducer Network</SheetTitle>
              <SheetDescription>
                {myRecruits.length} investor
                {myRecruits.length !== 1 ? "s" : ""} introduced &middot;{" "}
                {fmt(totalCapitalIntroduced)} total capital
              </SheetDescription>
            </SheetHeader>
            <div className="flex-1 overflow-y-auto px-6 pb-6">
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
          </SheetContent>
        </Sheet>
      )}
    </div>
  );
}
