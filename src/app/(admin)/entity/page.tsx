"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Save } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { Tables } from "@/lib/supabase/types";
import { cn } from "@/lib/utils";

// Business logic
import { INV_RATE } from "@/lib/business-logic/constants";
import { getInvIntroTier } from "@/lib/business-logic/tiers";
import {
  calcPOWaterfall,
  type PurchaseOrder,
  type Player,
  type WaterfallResult,
} from "@/lib/business-logic/waterfall";
import {
  calcSharedDeployments,
  type Deployment,
  type DeploymentPO,
  type DeploymentInvestor,
} from "@/lib/business-logic/deployment";
import { fmt, getMonth } from "@/lib/business-logic/formatters";
import { useSelectedMonth } from "@/lib/hooks/use-selected-month";

// Shared components
import { MetricCard } from "@/components/metric-card";
import { ChannelBadge } from "@/components/channel-badge";
import { MonthPicker } from "@/components/month-picker";
import { SectionHeader } from "@/components/section-header";
import { HealthCheck } from "@/components/health-check";
import { WaterfallTable } from "@/components/waterfall-table";

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
import { Input } from "@/components/ui/input";

// ── DB Types ───────────────────────────────────────────────

type DBPlayer = Tables<"players">;
type DBInvestor = Tables<"investors">;
type DBPO = Tables<"purchase_orders"> & {
  delivery_orders: Tables<"delivery_orders">[];
};
type DBOpex = Tables<"opex">;

// ── DB → Business-logic mappers ────────────────────────────

function toWaterfallPlayer(p: DBPlayer): Player {
  return {
    id: p.id,
    euTierMode: p.eu_tier_mode ?? "A",
    introTierMode: p.intro_tier_mode ?? "A",
    introducedBy: p.introduced_by,
  };
}

function toWaterfallPO(po: DBPO): PurchaseOrder {
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

// ── Per-PO extended waterfall data ─────────────────────────

interface POEntityData extends WaterfallResult {
  poId: string;
  ref: string;
  poDate: string;
  poAmt: number;
  hasSomePaid: boolean;
  fullyPaid: boolean;
  endUserId: string;
  waterfallDeducted: number;
  actualPaidToInvestors: number;
  funded: number;
  unfunded: number;
  spread: number;
  investorBreakdown: InvestorBreakdownRow[];
}

interface InvestorBreakdownRow {
  name: string;
  deployed: number;
  deductedAt5: number;
  paidAtTier: number;
  tierRate: number;
  spread: number;
}

// ── Investor introducer data ───────────────────────────────

interface InvIntroRow {
  id: string;
  name: string;
  investorCount: number;
  totalCapitalIntroduced: number;
  tier: { name: string; rate: number; min: number; max: number };
  totalReturns: number;
  commission: number;
}

function calcInvIntroData(
  investors: DBInvestor[],
  deployments: Deployment[]
): InvIntroRow[] {
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

      // Only count returns from completed cycles
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
    .filter((x): x is InvIntroRow => x !== null);
}

// ── Per-player payable ─────────────────────────────────────

interface PlayerPayable {
  name: string;
  euComm: number;
  introComm: number;
  total: number;
}

// ── Component ──────────────────────────────────────────────

export default function EntityPage() {
  return <Suspense><EntityPageContent /></Suspense>;
}

function EntityPageContent() {
  const supabase = useMemo(() => createClient(), []);

  // Data state
  const [players, setPlayers] = useState<DBPlayer[]>([]);
  const [investors, setInvestors] = useState<DBInvestor[]>([]);
  const [allPOs, setAllPOs] = useState<DBPO[]>([]);
  const [opex, setOpex] = useState<DBOpex | null>(null);
  const [loading, setLoading] = useState(true);

  // OPEX form state
  const [opexForm, setOpexForm] = useState({
    rental: 0,
    salary: 0,
    utilities: 0,
    others: 0,
  });
  const [opexSaving, setOpexSaving] = useState(false);
  const [opexDirty, setOpexDirty] = useState(false);

  // Section toggles
  const [openSections, setOpenSections] = useState({
    pnl: false,
    opex: false,
    cash: false,
    payables: false,
    spread: false,
  });
  const toggleSection = (key: keyof typeof openSections) =>
    setOpenSections((prev) => ({ ...prev, [key]: !prev[key] }));

  // Spread detail expansion
  const [expandedPO, setExpandedPO] = useState<string | null>(null);

  // Month selector (URL-driven, shared across admin pages)
  const [selectedMonth, setSelectedMonth] = useSelectedMonth();

  // ── Data fetching ────────────────────────────────────────

  const fetchData = useCallback(async () => {
    setLoading(true);
    const [playersRes, investorsRes, posRes] = await Promise.all([
      supabase
        .from("players")
        .select("*")
        .order("created_at", { ascending: true }),
      supabase
        .from("investors")
        .select("*")
        .order("created_at", { ascending: true }),
      supabase
        .from("purchase_orders")
        .select("*, delivery_orders(*)")
        .order("po_date", { ascending: true }),
    ]);
    if (playersRes.data) setPlayers(playersRes.data);
    if (investorsRes.data) setInvestors(investorsRes.data);
    if (posRes.data) setAllPOs(posRes.data as DBPO[]);
    setLoading(false);
  }, [supabase]);

  const fetchOpex = useCallback(
    async (month: string) => {
      const { data } = await supabase
        .from("opex")
        .select("*")
        .eq("month", month)
        .maybeSingle();
      setOpex(data);
      if (data) {
        setOpexForm({
          rental: data.rental ?? 0,
          salary: data.salary ?? 0,
          utilities: data.utilities ?? 0,
          others: data.others ?? 0,
        });
      } else {
        setOpexForm({ rental: 0, salary: 0, utilities: 0, others: 0 });
      }
      setOpexDirty(false);
    },
    [supabase]
  );

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  useEffect(() => {
    fetchOpex(selectedMonth);
  }, [fetchOpex, selectedMonth]);

  // ── OPEX save handler ────────────────────────────────────

  const saveOpex = async () => {
    setOpexSaving(true);
    if (opex) {
      // Update existing
      await supabase
        .from("opex")
        .update({
          rental: opexForm.rental,
          salary: opexForm.salary,
          utilities: opexForm.utilities,
          others: opexForm.others,
        })
        .eq("id", opex.id);
    } else {
      // Insert new
      await supabase.from("opex").insert({
        month: selectedMonth,
        rental: opexForm.rental,
        salary: opexForm.salary,
        utilities: opexForm.utilities,
        others: opexForm.others,
      });
    }
    await fetchOpex(selectedMonth);
    setOpexSaving(false);
  };

  const updateOpexField = (
    field: keyof typeof opexForm,
    value: number
  ) => {
    setOpexForm((prev) => ({ ...prev, [field]: value }));
    setOpexDirty(true);
  };

  // ── Available months ─────────────────────────────────────

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

  // ── Map DB rows to business-logic types ──────────────────

  const wPlayers = useMemo(() => players.map(toWaterfallPlayer), [players]);
  const wAllPOs = useMemo(() => allPOs.map(toWaterfallPO), [allPOs]);
  const dInvestors = useMemo(
    () => investors.map(toDeploymentInvestor),
    [investors]
  );

  // ── Filter to selected month ─────────────────────────────

  const monthPOs = useMemo(
    () => allPOs.filter((po) => getMonth(po.po_date) === selectedMonth),
    [allPOs, selectedMonth]
  );
  const monthWPOs = useMemo(
    () => wAllPOs.filter((po) => getMonth(po.poDate) === selectedMonth),
    [wAllPOs, selectedMonth]
  );

  // ── Deployment calculations ──────────────────────────────

  const { deployments } = useMemo(() => {
    const dMonthPOs = monthPOs.map(toDeploymentPO);
    return calcSharedDeployments(dMonthPOs, dInvestors);
  }, [monthPOs, dInvestors]);

  // ── Investor introducer commissions ──────────────────────

  const invIntroData = useMemo(
    () => calcInvIntroData(investors, deployments),
    [investors, deployments]
  );
  const totalInvIntroComm = useMemo(
    () => invIntroData.reduce((s, d) => s + d.commission, 0),
    [invIntroData]
  );

  // ── Monthly OPEX ─────────────────────────────────────────

  const monthlyOpex =
    opexForm.rental + opexForm.salary + opexForm.utilities + opexForm.others;

  // ── Per-PO waterfall + spread ────────────────────────────

  const poData: POEntityData[] = useMemo(() => {
    return monthPOs
      .filter((po) => (po.po_amount || 0) > 0)
      .map((dbPO) => {
        const wPO = toWaterfallPO(dbPO);
        const w = calcPOWaterfall(wPO, wPlayers, wAllPOs);
        const poAmt = dbPO.po_amount || 0;
        const hasSomePaid =
          dbPO.delivery_orders?.some((d) => d.buyer_paid) ?? false;
        const fullyPaid =
          dbPO.delivery_orders != null &&
          dbPO.delivery_orders.length > 0 &&
          dbPO.delivery_orders.every((d) => d.buyer_paid);

        const poDeps = deployments.filter((d) => d.poId === dbPO.id);
        const actualPaidToInvestors = poDeps.reduce(
          (s, d) => s + d.returnAmt,
          0
        );
        const funded = poDeps.reduce((s, d) => s + d.deployed, 0);
        const unfunded = poAmt - funded;
        const waterfallDeducted = poAmt * (INV_RATE / 100);
        const spread = waterfallDeducted - actualPaidToInvestors;

        const investorBreakdown: InvestorBreakdownRow[] = poDeps.map((d) => ({
          name: d.investorName,
          deployed: d.deployed,
          deductedAt5: d.deployed * (INV_RATE / 100),
          paidAtTier: d.returnAmt,
          tierRate: d.returnRate,
          spread: d.deployed * (INV_RATE / 100) - d.returnAmt,
        }));

        return {
          ...w,
          poId: dbPO.id,
          ref: dbPO.ref,
          poDate: dbPO.po_date,
          poAmt,
          hasSomePaid,
          fullyPaid,
          endUserId: dbPO.end_user_id,
          waterfallDeducted,
          actualPaidToInvestors,
          funded,
          unfunded,
          spread,
          investorBreakdown,
        };
      });
  }, [monthPOs, wPlayers, wAllPOs, deployments]);

  // ── P&L calculations ─────────────────────────────────────

  const revenuePOs = useMemo(
    () => poData.filter((p) => p.hasSomePaid),
    [poData]
  );
  const totalRevenue = revenuePOs.reduce((s, p) => s + p.poAmt, 0);
  const totalCOGS = revenuePOs.reduce((s, p) => s + p.riskAdjustedCogs, 0);
  const totalActualSupplierCost = revenuePOs.reduce(
    (s, p) => s + p.supplierTotal,
    0
  );
  const totalCogsReserve = totalCOGS - totalActualSupplierCost;
  const grossProfit = revenuePOs.reduce((s, p) => s + p.gross, 0);
  const totalPlatformFee = revenuePOs.reduce((s, p) => s + p.platformFee, 0);
  const totalInvestorCost = revenuePOs.reduce((s, p) => s + p.investorFee, 0);
  const totalPool = revenuePOs.reduce((s, p) => s + p.pool, 0);
  const totalEUComm = revenuePOs.reduce((s, p) => s + p.euAmt, 0);
  const totalIntroComm = revenuePOs.reduce((s, p) => s + p.introAmt, 0);
  const entityGrossIncome = revenuePOs.reduce((s, p) => s + p.entityShare, 0);
  const totalSpread = poData.reduce((s, p) => s + p.spread, 0);
  const entityNetBeforeOpex =
    entityGrossIncome + totalSpread + totalCogsReserve - totalInvIntroComm;
  const entityNetProfit = entityNetBeforeOpex - monthlyOpex;

  // ── Commission payables (fully-paid POs only) ────────────

  const fullyPaidPOs = useMemo(
    () => poData.filter((p) => p.fullyPaid),
    [poData]
  );
  const payableEUComm = fullyPaidPOs.reduce((s, p) => s + p.euAmt, 0);
  const payableIntroComm = fullyPaidPOs.reduce((s, p) => s + p.introAmt, 0);
  const payableInvestorReturns = deployments
    .filter((d) => d.cycleComplete)
    .reduce((s, d) => s + d.returnAmt, 0);
  const payableInvIntroComm = totalInvIntroComm;
  const totalPayables =
    payableEUComm +
    payableIntroComm +
    payableInvestorReturns +
    payableInvIntroComm;

  // Per-player commission breakdown
  const playerPayables: PlayerPayable[] = useMemo(() => {
    return players
      .map((p) => {
        const pPOs = fullyPaidPOs.filter((po) => po.endUserId === p.id);
        const euComm = pPOs.reduce((s, po) => s + po.euAmt, 0);
        // Intro earnings — POs from this player's recruits
        const recruits = players.filter((x) => x.introduced_by === p.id);
        const recruitPOs = fullyPaidPOs.filter((po) =>
          recruits.some((r) => r.id === po.endUserId)
        );
        const introComm = recruitPOs.reduce((s, po) => s + po.introAmt, 0);
        const total = euComm + introComm;
        return { name: p.name, euComm, introComm, total };
      })
      .filter((p) => p.total > 0);
  }, [players, fullyPaidPOs]);

  // ── Cash position (fully-paid POs only) ──────────────────

  const cashInPOs = useMemo(
    () => poData.filter((p) => p.fullyPaid),
    [poData]
  );
  const cashIn = cashInPOs.reduce((s, p) => s + p.poAmt, 0);
  const cashOutCOGS = cashInPOs.reduce((s, p) => s + p.supplierTotal, 0);
  const cashOutPlatform = cashInPOs.reduce((s, p) => s + p.platformFee, 0);
  const cashOutInvestors = payableInvestorReturns;
  const cashOutCommissions = payableEUComm + payableIntroComm;
  const cashOutInvIntro = payableInvIntroComm;
  const cashOutOpex = monthlyOpex;
  const totalCashOut =
    cashOutCOGS +
    cashOutPlatform +
    cashOutInvestors +
    cashOutCommissions +
    cashOutInvIntro +
    cashOutOpex;
  const netCash = cashIn - totalCashOut;

  // ── Spread totals ────────────────────────────────────────

  const totalWaterfallDeducted = poData.reduce(
    (s, p) => s + p.waterfallDeducted,
    0
  );
  const totalPaidToInvestors = poData.reduce(
    (s, p) => s + p.actualPaidToInvestors,
    0
  );

  // ── Loading state ────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <p className="text-sm text-gray-500">Loading entity data...</p>
      </div>
    );
  }

  // ── Render ───────────────────────────────────────────────

  return (
    <div className="space-y-5">
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
        <h1 className="mt-3 text-lg font-medium text-gray-800">Entity</h1>
      </div>

      {/* Hero Summary Cards */}
      <div className="grid grid-cols-4 gap-3">
        <MetricCard
          label="Gross Revenue"
          value={fmt(totalRevenue)}
          subtitle={`${revenuePOs.length} POs with payments`}
          color="success"
        />
        <MetricCard
          label="Entity Net Income"
          value={fmt(entityGrossIncome)}
          subtitle="After EU + EU Intro deductions"
          color={entityGrossIncome > 0 ? "accent" : "danger"}
        />
        <MetricCard
          label="Total OPEX"
          value={fmt(monthlyOpex)}
          subtitle="Monthly operating cost"
          color="danger"
        />
        <MetricCard
          label="Net Profit"
          value={fmt(entityNetProfit)}
          subtitle="Income + spread + reserve - inv intro - OPEX"
          color={entityNetProfit >= 0 ? "success" : "danger"}
        />
      </div>

      {/* Health Check */}
      <HealthCheck entityNet={entityNetProfit} />

      {/* ═══ 1. MONTHLY P&L ═══ */}
      <div className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-gray-200">
        <SectionHeader
          title="Monthly P&L"
          open={openSections.pnl}
          onToggle={() => toggleSection("pnl")}
          badge={{
            label: fmt(entityNetProfit),
            color: entityNetProfit >= 0 ? "success" : "danger",
          }}
        />
        {openSections.pnl && (
          <div className="pt-2">
            <WaterfallTable
              rows={[
                {
                  label: `Gross Revenue (POs with payments)`,
                  val: totalRevenue,
                  color: "success",
                  bold: true,
                },
                {
                  label: "- Risk-Adjusted COGS",
                  val: -totalCOGS,
                  color: "danger",
                },
                {
                  label: "= Gross Profit",
                  val: grossProfit,
                  color: "success",
                  bold: true,
                },
                {
                  label: "- Proxy Platform Fee (3%)",
                  val: -totalPlatformFee,
                  color: "danger",
                },
                {
                  label: "- Investor Cost (5% of PO)",
                  val: -totalInvestorCost,
                  color: "danger",
                },
                {
                  label: "= Pool",
                  val: totalPool,
                  color: "accent",
                  bold: true,
                },
                {
                  label: "- EU Commissions",
                  val: -totalEUComm,
                  color: "brand",
                },
                {
                  label: "- EU Introducer Commissions",
                  val: -totalIntroComm,
                  color: "purple",
                },
                {
                  label: "= Entity Gross Income",
                  val: entityGrossIncome,
                  color: "accent",
                  bold: true,
                },
                {
                  label: "+ Investor Spread (5% - tier rate)",
                  val: totalSpread,
                  color: "success",
                },
                {
                  label: "+ COGS Reserve (risk buffer margin)",
                  val: totalCogsReserve,
                  color: "success",
                },
                {
                  label: "- Inv Introducer Commissions",
                  val: -totalInvIntroComm,
                  color: "amber",
                },
                {
                  label: "= Entity Before OPEX",
                  val: entityNetBeforeOpex,
                  color: "accent",
                  bold: true,
                },
                {
                  label: "- Monthly OPEX",
                  val: -monthlyOpex,
                  color: "danger",
                },
                {
                  label: "= Net Profit",
                  val: entityNetProfit,
                  color: entityNetProfit >= 0 ? "success" : "danger",
                  bold: true,
                },
              ]}
            />
            <p className="mt-2 text-[10px] text-gray-500">
              Revenue recognized from POs with at least 1 DO buyer-paid.{" "}
              {monthPOs.length - revenuePOs.length} PO(s) not yet recognized.
            </p>
          </div>
        )}
      </div>

      {/* ═══ 2. OPEX TRACKER ═══ */}
      <div className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-gray-200">
        <SectionHeader
          title="Monthly OPEX"
          open={openSections.opex}
          onToggle={() => toggleSection("opex")}
          badge={{ label: fmt(monthlyOpex), color: "danger" }}
        />
        {openSections.opex && (
          <div className="space-y-3 pt-2">
            {(
              [
                { label: "Rental", key: "rental" as const },
                { label: "Salary", key: "salary" as const },
                { label: "Utilities", key: "utilities" as const },
                { label: "Others", key: "others" as const },
              ] as const
            ).map((item) => (
              <div
                key={item.key}
                className="flex items-center justify-between"
              >
                <span className="text-xs font-medium text-gray-600">
                  {item.label}
                </span>
                <div className="flex items-center gap-1.5">
                  <span className="text-[11px] text-gray-500">RM</span>
                  <Input
                    type="number"
                    min={0}
                    step={100}
                    value={opexForm[item.key]}
                    onChange={(e) =>
                      updateOpexField(
                        item.key,
                        Math.max(0, parseFloat(e.target.value) || 0)
                      )
                    }
                    className="w-28 bg-gray-50 text-right font-mono text-sm font-medium"
                  />
                </div>
              </div>
            ))}
            <div className="flex items-center justify-between border-t-2 border-gray-200 pt-3">
              <span className="text-xs font-medium text-gray-800">
                Total OPEX
              </span>
              <span className="font-mono text-sm font-medium text-danger-600">
                {fmt(monthlyOpex)}
              </span>
            </div>
            {opexDirty && (
              <div className="flex justify-end">
                <Button
                  size="sm"
                  onClick={saveOpex}
                  disabled={opexSaving}
                  className="gap-1.5 bg-brand-600 text-white hover:bg-brand-800"
                >
                  <Save className="size-3.5" />
                  {opexSaving ? "Saving..." : "Save OPEX"}
                </Button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ═══ 3. CASH POSITION ═══ */}
      <div className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-gray-200">
        <SectionHeader
          title="Entity Cash Position"
          open={openSections.cash}
          onToggle={() => toggleSection("cash")}
          badge={{
            label: fmt(netCash),
            color: netCash >= 0 ? "success" : "danger",
          }}
        />
        {openSections.cash && (
          <div className="pt-2">
            <table className="w-full border-collapse text-xs">
              <tbody>
                <tr className="border-b-2 border-gray-200">
                  <td className="py-2 font-medium text-success-600">
                    Cash In (from fully paid POs)
                  </td>
                  <td className="py-2 text-right font-mono font-medium text-success-600">
                    {fmt(cashIn)}
                  </td>
                </tr>
                {[
                  {
                    label: "- COGS (actual supplier costs)",
                    val: cashOutCOGS,
                  },
                  { label: "- Platform fees", val: cashOutPlatform },
                  {
                    label: "- Investor returns (completed cycles)",
                    val: cashOutInvestors,
                  },
                  {
                    label: "- Commissions payable (EU + EU Intro)",
                    val: cashOutCommissions,
                  },
                  {
                    label: "- Inv Introducer commissions",
                    val: cashOutInvIntro,
                  },
                  { label: "- OPEX", val: cashOutOpex },
                ].map((row, i) => (
                  <tr key={i} className="border-b border-gray-100">
                    <td className="py-2 text-gray-600">{row.label}</td>
                    <td className="py-2 text-right font-mono text-danger-600">
                      ({fmt(row.val)})
                    </td>
                  </tr>
                ))}
                <tr className="border-t-2 border-gray-200">
                  <td
                    className={cn(
                      "py-2 font-medium",
                      netCash >= 0 ? "text-success-600" : "text-danger-600"
                    )}
                  >
                    = Net Cash
                  </td>
                  <td
                    className={cn(
                      "py-2 text-right font-mono text-base font-medium",
                      netCash >= 0 ? "text-success-600" : "text-danger-600"
                    )}
                  >
                    {fmt(netCash)}
                  </td>
                </tr>
              </tbody>
            </table>
            {netCash < 0 && (
              <HealthCheck entityNet={netCash} className="mt-3" />
            )}
            {netCash >= 0 && netCash < 5000 && (
              <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-100 bg-amber-50 px-4 py-3 text-xs text-amber-600">
                Tight cash position at {fmt(netCash)}. Watch the margins.
              </div>
            )}
            {netCash >= 5000 && (
              <div className="mt-3 flex items-start gap-2 rounded-lg border border-success-100 bg-success-50 px-4 py-3 text-xs text-success-600">
                Healthy cash position at {fmt(netCash)}.
              </div>
            )}
          </div>
        )}
      </div>

      {/* ═══ 4. COMMISSION PAYABLES ═══ */}
      <div className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-gray-200">
        <SectionHeader
          title="Commission Payables"
          open={openSections.payables}
          onToggle={() => toggleSection("payables")}
          badge={{ label: fmt(totalPayables), color: "brand" }}
        />
        {openSections.payables && (
          <div className="pt-2">
            <p className="mb-3 text-[10px] text-gray-500">
              Commissions are only payable when ALL DOs in a PO are buyer-paid.{" "}
              {fullyPaidPOs.length} of {monthPOs.length} POs fully paid this
              month.
            </p>

            {playerPayables.length === 0 ? (
              <p className="py-5 text-center text-xs text-gray-500">
                No commissions payable this month.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-[9px] uppercase tracking-wide">
                      Player
                    </TableHead>
                    <TableHead className="text-[9px] uppercase tracking-wide">
                      EU Commission
                    </TableHead>
                    <TableHead className="text-[9px] uppercase tracking-wide">
                      Intro Commission
                    </TableHead>
                    <TableHead className="text-[9px] uppercase tracking-wide">
                      Total Payable
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {playerPayables.map((p, i) => (
                    <TableRow key={i}>
                      <TableCell className="font-medium">{p.name}</TableCell>
                      <TableCell className="font-mono text-brand-600">
                        {p.euComm > 0 ? fmt(p.euComm) : "-"}
                      </TableCell>
                      <TableCell className="font-mono text-purple-600">
                        {p.introComm > 0 ? fmt(p.introComm) : "-"}
                      </TableCell>
                      <TableCell className="font-mono font-medium text-brand-600">
                        {fmt(p.total)}
                      </TableCell>
                    </TableRow>
                  ))}
                  <TableRow className="border-t-2 border-gray-200">
                    <TableCell className="font-medium">Total</TableCell>
                    <TableCell className="font-mono font-medium text-brand-600">
                      {fmt(payableEUComm)}
                    </TableCell>
                    <TableCell className="font-mono font-medium text-purple-600">
                      {fmt(payableIntroComm)}
                    </TableCell>
                    <TableCell className="font-mono font-medium text-brand-600">
                      {fmt(payableEUComm + payableIntroComm)}
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            )}

            {/* Investor Returns Payable */}
            {payableInvestorReturns > 0 && (
              <div className="mt-4 rounded-lg border border-amber-100 bg-amber-50 px-4 py-3">
                <p className="text-[10px] font-medium uppercase tracking-wide text-amber-600">
                  Investor Returns Payable
                </p>
                <p className="mt-1 font-mono text-base font-medium text-amber-600">
                  {fmt(payableInvestorReturns)}
                </p>
                <p className="mt-0.5 text-[10px] text-gray-500">
                  From{" "}
                  {deployments.filter((d) => d.cycleComplete).length} completed
                  cycle(s)
                </p>
              </div>
            )}

            {/* Inv Introducer Commissions Payable */}
            {payableInvIntroComm > 0 && (
              <div className="mt-3 rounded-lg border border-amber-100 bg-amber-50 px-4 py-3">
                <p className="text-[10px] font-medium uppercase tracking-wide text-amber-600">
                  Inv Introducer Commissions Payable
                </p>
                <p className="mt-1 font-mono text-base font-medium text-amber-600">
                  {fmt(payableInvIntroComm)}
                </p>
                <p className="mt-0.5 text-[10px] text-gray-500">
                  {invIntroData.length} introducer(s):{" "}
                  {invIntroData
                    .map(
                      (d) =>
                        `${d.name} (${d.tier.name} ${d.tier.rate}% = ${fmt(d.commission)})`
                    )
                    .join(", ")}
                </p>
              </div>
            )}

            {/* Total Payables */}
            {totalPayables > 0 && (
              <div className="mt-3 flex items-center justify-between rounded-lg border border-brand-100 bg-brand-50 px-4 py-3">
                <span className="text-xs font-medium text-brand-600">
                  Total Payables
                </span>
                <span className="font-mono text-base font-medium text-brand-600">
                  {fmt(totalPayables)}
                </span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ═══ 5. INVESTOR SPREAD ═══ */}
      <div className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-gray-200">
        <SectionHeader
          title="Investor Spread"
          open={openSections.spread}
          onToggle={() => toggleSection("spread")}
          badge={{ label: fmt(totalSpread), color: "success" }}
        />
        {openSections.spread && (
          <div className="pt-2">
            {/* Spread utilisation bar */}
            {totalWaterfallDeducted > 0 && (
              <div className="mb-4">
                <div className="mb-1.5 flex items-center justify-between">
                  <span className="text-[10px] font-medium uppercase tracking-wide text-gray-500">
                    5% Deduction Split
                  </span>
                  <span className="font-mono text-xs font-medium text-success-600">
                    {(
                      (totalSpread / totalWaterfallDeducted) *
                      100
                    ).toFixed(1)}
                    % retained
                  </span>
                </div>
                <div className="flex h-3.5 gap-0.5 overflow-hidden rounded-full">
                  <div
                    className="rounded-full bg-amber-400 transition-all"
                    style={{
                      width: `${(totalPaidToInvestors / totalWaterfallDeducted) * 100}%`,
                    }}
                  />
                  <div
                    className="rounded-full bg-success-400 transition-all"
                    style={{
                      width: `${(totalSpread / totalWaterfallDeducted) * 100}%`,
                    }}
                  />
                </div>
                <div className="mt-1.5 flex gap-4 text-[10px]">
                  <span className="text-amber-600">
                    Paid to investors {fmt(totalPaidToInvestors)}
                  </span>
                  <span className="text-success-600">
                    Entity reserve {fmt(totalSpread)}
                  </span>
                </div>
              </div>
            )}

            <p className="mb-2 text-[10px] text-gray-500">
              Click a PO to see per-investor breakdown.
            </p>

            {poData.length === 0 ? (
              <p className="py-5 text-center text-xs text-gray-500">
                No POs this month.
              </p>
            ) : (
              <div className="space-y-0.5">
                {poData.map((po) => {
                  const isOpen = expandedPO === po.poId;
                  return (
                    <div key={po.poId}>
                      {/* PO row */}
                      <button
                        type="button"
                        onClick={() =>
                          setExpandedPO(isOpen ? null : po.poId)
                        }
                        className={cn(
                          "grid w-full grid-cols-[16px_90px_60px_90px_90px_100px_80px_80px] items-center gap-1 rounded-lg px-2 py-2.5 text-left transition-colors",
                          isOpen
                            ? "bg-gray-50 ring-1 ring-gray-200"
                            : "hover:bg-gray-50"
                        )}
                      >
                        {isOpen ? (
                          <ChevronDown className="size-3 text-gray-500" />
                        ) : (
                          <ChevronRight className="size-3 text-gray-500" />
                        )}
                        <span
                          className={cn(
                            "font-mono text-[11px] font-medium",
                            po.channel === "gep"
                              ? "text-brand-600"
                              : "text-accent-600"
                          )}
                        >
                          {po.ref}
                        </span>
                        <ChannelBadge
                          channel={po.channel as "punchout" | "gep"}
                        />
                        <span className="font-mono text-[11px] font-medium">
                          {fmt(po.poAmt)}
                        </span>
                        <span className="font-mono text-[10px] text-danger-600">
                          {fmt(po.waterfallDeducted)}
                        </span>
                        <span className="font-mono text-[10px] text-amber-600">
                          {fmt(po.actualPaidToInvestors)}
                        </span>
                        <span className="font-mono text-[11px] font-medium text-success-600">
                          {fmt(po.spread)}
                        </span>
                        <span>
                          {po.fullyPaid ? (
                            <span className="rounded-md bg-success-50 px-2 py-0.5 text-[9px] font-medium text-success-600">
                              Earned
                            </span>
                          ) : (
                            <span className="rounded-md bg-amber-50 px-2 py-0.5 text-[9px] font-medium text-amber-600">
                              Pending
                            </span>
                          )}
                        </span>
                      </button>

                      {/* Per-investor breakdown */}
                      {isOpen && po.investorBreakdown.length > 0 && (
                        <div className="px-3 pb-3 pl-7">
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead className="text-[8px] uppercase tracking-wide">
                                  Investor
                                </TableHead>
                                <TableHead className="text-[8px] uppercase tracking-wide">
                                  Deployed
                                </TableHead>
                                <TableHead className="text-[8px] uppercase tracking-wide">
                                  Deducted (5%)
                                </TableHead>
                                <TableHead className="text-[8px] uppercase tracking-wide">
                                  Paid (Tier %)
                                </TableHead>
                                <TableHead className="text-[8px] uppercase tracking-wide">
                                  Entity Spread
                                </TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {po.investorBreakdown.map((inv, i) => (
                                <TableRow key={i}>
                                  <TableCell className="text-[10px] font-medium">
                                    {inv.name}
                                  </TableCell>
                                  <TableCell className="font-mono text-[10px]">
                                    {fmt(inv.deployed)}
                                  </TableCell>
                                  <TableCell className="font-mono text-[10px] text-danger-600">
                                    {fmt(inv.deductedAt5)}
                                  </TableCell>
                                  <TableCell className="font-mono text-[10px] text-amber-600">
                                    {fmt(inv.paidAtTier)} ({inv.tierRate}%)
                                  </TableCell>
                                  <TableCell className="font-mono text-[10px] font-medium text-success-600">
                                    {fmt(inv.spread)}
                                  </TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                          {po.unfunded > 0 && (
                            <p className="mt-2 text-[9px] text-danger-600">
                              Unfunded {fmt(po.unfunded)} — full 5% (
                              {fmt(po.unfunded * INV_RATE / 100)}) goes to
                              entity reserve
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}

                {/* Spread totals row */}
                <div className="grid grid-cols-[16px_90px_60px_90px_90px_100px_80px_80px] items-center gap-1 border-t-2 border-gray-200 px-2 py-2.5">
                  <span />
                  <span className="text-[11px] font-medium">Total</span>
                  <span />
                  <span />
                  <span className="font-mono text-[11px] font-medium text-danger-600">
                    {fmt(totalWaterfallDeducted)}
                  </span>
                  <span className="font-mono text-[11px] font-medium text-amber-600">
                    {fmt(totalPaidToInvestors)}
                  </span>
                  <span className="font-mono text-[11px] font-medium text-success-600">
                    {fmt(totalSpread)}
                  </span>
                  <span />
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
