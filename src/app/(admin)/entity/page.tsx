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
  overlayReturnCredits,
  type Deployment,
  type DeploymentPO,
  type DeploymentInvestor,
} from "@/lib/business-logic/deployment";
import { buildCapitalEvents } from "@/lib/business-logic/capital-events";
import { calcFundingStatus } from "@/lib/business-logic/funding-status";
import { fmt, fmtSigned, getMonth } from "@/lib/business-logic/formatters";
import { useSelectedMonth } from "@/lib/hooks/use-selected-month";

// Shared components
import { MetricCard } from "@/components/metric-card";
import { ChannelBadge } from "@/components/channel-badge";
import { MonthPicker } from "@/components/month-picker";
import { SectionHeader } from "@/components/section-header";
import { HealthCheck } from "@/components/health-check";
import { UnfundedBanner } from "@/components/unfunded-banner";

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
type DBDeposit = Tables<"deposits">;
type DBWithdrawal = Tables<"withdrawals">;
type DBAdminAdjustment = Tables<"admin_adjustments">;
type DBReturnCredit = Tables<"return_credits">;
type DBIntroducerCredit = Tables<"introducer_credits">;

// ── DB → Business-logic mappers ────────────────────────────

function toWaterfallPlayer(p: DBPlayer): Player {
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
    })),
    otherCost: po.other_cost,
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
  // Commission payables run against PO face value, not the month-horizon
  // funded snapshot. A cleared PO is fully funded by definition, so what
  // gets paid to the player should not depend on intra-month deployment
  // timing. P&L / spread keep using the snapshot fields above.
  payableEuAmt: number;
  payableIntroAmt: number;
  payablePlayerLossShare: number;
  payableIntroducerLossShare: number;
  // Dual-introducer split. Non-zero only when the PO's direct introducer
  // has an upline (players.upline_id). uplineAmt is Alice's slice of the
  // intro chunk; uplineLossShare is her share of the cost-overrun loss.
  // The introAmt / introducerLossShare fields above are already reduced
  // to Bob's keep, so total intro paid out = intro + upline.
  payableUplineAmt: number;
  payableUplineLossShare: number;
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
  const [deposits, setDeposits] = useState<DBDeposit[]>([]);
  const [withdrawals, setWithdrawals] = useState<DBWithdrawal[]>([]);
  const [adminAdjustments, setAdminAdjustments] = useState<DBAdminAdjustment[]>(
    []
  );
  const [returnCredits, setReturnCredits] = useState<DBReturnCredit[]>([]);
  const [introducerCredits, setIntroducerCredits] = useState<
    DBIntroducerCredit[]
  >([]);
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
    const [
      playersRes,
      investorsRes,
      posRes,
      depositsRes,
      withdrawalsRes,
      adjustmentsRes,
      returnCreditsRes,
      introducerCreditsRes,
    ] = await Promise.all([
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
      supabase
        .from("deposits")
        .select("*")
        .order("deposited_at", { ascending: true }),
      supabase
        .from("withdrawals")
        .select("*")
        .order("requested_at", { ascending: true }),
      supabase
        .from("admin_adjustments")
        .select("*")
        .order("created_at", { ascending: true }),
      supabase
        .from("return_credits")
        .select("*")
        .order("created_at", { ascending: true }),
      supabase
        .from("introducer_credits")
        .select("*")
        .order("created_at", { ascending: true }),
    ]);
    if (playersRes.data) setPlayers(playersRes.data);
    if (investorsRes.data) setInvestors(investorsRes.data);
    if (posRes.data) setAllPOs(posRes.data as DBPO[]);
    if (depositsRes.data) setDeposits(depositsRes.data);
    if (withdrawalsRes.data) setWithdrawals(withdrawalsRes.data);
    if (adjustmentsRes.data) setAdminAdjustments(adjustmentsRes.data);
    if (returnCreditsRes.data) setReturnCredits(returnCreditsRes.data);
    if (introducerCreditsRes.data)
      setIntroducerCredits(introducerCreditsRes.data);
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
    // Include both PO months and investor-join months so the month picker
    // surfaces months where a late-joining investor's backfill appears
    // (their deployedAt = dateJoined), even if no PO originated that month.
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

  // POs whose po_date is on or before the selected month — passed to the
  // allocator so prior-month deployments that are still locking up capital
  // are respected when computing this month's allocations.
  const poolPOs = useMemo(
    () => allPOs.filter((po) => getMonth(po.po_date) <= selectedMonth),
    [allPOs, selectedMonth]
  );

  // Every investors.capital mutation fed as a timeline event so the
  // allocator's `remaining` seed starts at true initial capital. See
  // lib/business-logic/capital-events.ts.
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

  // ── Deployment calculations ──────────────────────────────
  // Two allocator passes for two different questions:
  //
  //   1. Month-scoped (`remaining`, `deployments`) — feeds P&L, investor
  //      spread, commission payables, and the per-PO deployments table.
  //      These are historical snapshots that must stay stable when the
  //      month picker moves; they correctly exclude capital events that
  //      occurred after the selected month's horizon.
  //
  //   2. Pool-wide (`poolRemaining`) — feeds only the "unfunded gap"
  //      banner. This is a live question ("what's short RIGHT NOW?") and
  //      must not depend on the month picker. Without this split, a late-
  //      credited return (return_credits.created_at after horizon) would
  //      make admin's banner disagree with the investor portfolio's
  //      Funding Opportunities card even though they describe the same
  //      pool. See plans/screenshot-1-n-2-stateless-hummingbird.md.

  const dPoolPOs = useMemo(() => poolPOs.map(toDeploymentPO), [poolPOs]);

  // Month-scoped call exposes only `deployments` to consumers on this page
  // (P&L, spread, payables, deployments table). `remaining` from this pass
  // is intentionally discarded — the unfunded banner uses the pool-wide
  // `poolRemaining` below, which correctly reflects live idle capital.
  const { deployments: rawDeployments } = useMemo(() => {
    return calcSharedDeployments(
      dPoolPOs,
      dInvestors,
      capitalEvents,
      selectedMonth
    );
  }, [dPoolPOs, dInvestors, capitalEvents, selectedMonth]);

  // Overlay frozen return_credits so P&L / spread / payables reflect the
  // tier rate actually paid at clearance — not whatever getTier() returns
  // from an investor's *current* capital (which drifts with deposits and
  // withdrawals). See lib/business-logic/deployment.ts for rationale.
  const deployments = useMemo(
    () => overlayReturnCredits(rawDeployments, returnCredits),
    [rawDeployments, returnCredits]
  );

  // ── Platform funding status (pool-wide, for unfunded banner) ─────────────
  // Pool-wide allocator: no selectedMonth → horizon = null → every capital
  // event applies, including late credits. Uses the full allPOs list so a
  // PO from a prior month that's still unfunded surfaces here.
  const dAllPOs = useMemo(() => allPOs.map(toDeploymentPO), [allPOs]);

  const { remaining: poolRemaining, deployments: poolDeployments } = useMemo(
    () => calcSharedDeployments(dAllPOs, dInvestors, capitalEvents),
    [dAllPOs, dInvestors, capitalEvents]
  );

  // Mirror the investor portfolio page's backfill-eligible filter: every
  // still-open PO (not fully cycle-complete). This is what "funding
  // opportunities" / "unfunded gap" actually describes.
  const backfillEligiblePOs = useMemo(
    () =>
      dAllPOs.filter((po) => {
        const fullyPaid =
          !!po.dos && po.dos.length > 0 && po.dos.every((d) => !!d.buyerPaid);
        return !fullyPaid && !po.commissionsCleared;
      }),
    [dAllPOs]
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
        deployments: poolDeployments,
        investors: dInvestors,
        remaining: poolRemaining,
        asOfDate,
      }),
    [backfillEligiblePOs, poolDeployments, dInvestors, poolRemaining, asOfDate]
  );

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
        const poAmt = dbPO.po_amount || 0;
        const poDeps = deployments.filter((d) => d.poId === dbPO.id);
        const funded = poDeps.reduce((s, d) => s + d.deployed, 0);
        // Snapshot waterfall: feeds P&L, entity gross, spread, investor cost.
        // Uses the month-horizon `funded` so historical months remain stable.
        const w = calcPOWaterfall(wPO, wPlayers, wAllPOs, funded);
        // Payable waterfall: feeds Commission Payables only. Uses PO face
        // value so the player-side commission is funding-timing-agnostic and
        // matches what every player-facing screen already displays.
        const wPayable = calcPOWaterfall(wPO, wPlayers, wAllPOs, poAmt);
        const hasSomePaid =
          dbPO.delivery_orders?.some((d) => d.buyer_paid) ?? false;
        const fullyPaid =
          dbPO.delivery_orders != null &&
          dbPO.delivery_orders.length > 0 &&
          dbPO.delivery_orders.every((d) => d.buyer_paid);

        const actualPaidToInvestors = poDeps.reduce(
          (s, d) => s + d.returnAmt,
          0
        );
        const unfunded = poAmt - funded;
        const waterfallDeducted = funded * (INV_RATE / 100);
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
          payableEuAmt: wPayable.euAmt,
          payableIntroAmt: wPayable.introAmt,
          payablePlayerLossShare: wPayable.playerLossShare,
          payableIntroducerLossShare: wPayable.introducerLossShare,
          payableUplineAmt: wPayable.uplineAmt,
          payableUplineLossShare: wPayable.uplineLossShare,
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
  const totalEUComm = revenuePOs.reduce(
    (s, p) => s + p.euAmt - p.playerLossShare,
    0
  );
  // Total intro paid out per PO = Bob's share + Alice's (upline) share,
  // net of each side's loss. introAmt/uplineAmt are pre-split; summing
  // them reconstructs the full chunk so single- and dual-intro POs feed
  // the same P&L line.
  const totalIntroComm = revenuePOs.reduce(
    (s, p) =>
      s +
      p.introAmt +
      p.uplineAmt -
      p.introducerLossShare -
      p.uplineLossShare,
    0
  );
  const entityGrossIncome = revenuePOs.reduce((s, p) => s + p.entityShare, 0);
  const totalEntityLossShare = revenuePOs.reduce(
    (s, p) => s + p.entityLossShare,
    0
  );
  const totalSpread = poData.reduce((s, p) => s + p.spread, 0);
  const entityNetBeforeOpex =
    entityGrossIncome +
    totalSpread +
    totalCogsReserve -
    totalInvIntroComm -
    totalEntityLossShare;
  const entityNetProfit = entityNetBeforeOpex - monthlyOpex;

  // ── Commission payables (fully-paid POs only) ────────────

  const fullyPaidPOs = useMemo(
    () => poData.filter((p) => p.fullyPaid),
    [poData]
  );
  const payableEUComm = fullyPaidPOs.reduce(
    (s, p) => s + p.payableEuAmt - p.payablePlayerLossShare,
    0
  );
  const payableIntroComm = fullyPaidPOs.reduce(
    (s, p) =>
      s +
      p.payableIntroAmt +
      p.payableUplineAmt -
      p.payableIntroducerLossShare -
      p.payableUplineLossShare,
    0
  );
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
        const euComm = pPOs.reduce(
          (s, po) => s + po.payableEuAmt - po.payablePlayerLossShare,
          0
        );
        // Direct introducer earnings — POs from this player's recruits.
        // payableIntroAmt is already Bob's keep in dual-intro mode.
        const recruits = players.filter((x) => x.introduced_by === p.id);
        const recruitPOs = fullyPaidPOs.filter((po) =>
          recruits.some((r) => r.id === po.endUserId)
        );
        const directIntroComm = recruitPOs.reduce(
          (s, po) => s + po.payableIntroAmt - po.payableIntroducerLossShare,
          0
        );
        // Upline earnings — POs whose direct introducer has this player
        // as their upline (chain: this player → downline B → end user).
        const downlineIds = new Set(
          players.filter((x) => x.upline_id === p.id).map((x) => x.id)
        );
        const downlineRecruitIds = new Set(
          players
            .filter((x) => x.introduced_by && downlineIds.has(x.introduced_by))
            .map((x) => x.id)
        );
        const uplinePOs = fullyPaidPOs.filter((po) =>
          downlineRecruitIds.has(po.endUserId)
        );
        const uplineComm = uplinePOs.reduce(
          (s, po) => s + po.payableUplineAmt - po.payableUplineLossShare,
          0
        );
        const introComm = directIntroComm + uplineComm;
        const total = euComm + introComm;
        return { name: p.name, euComm, introComm, total };
      })
      .filter((p) => p.total !== 0);
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

  // ── Reconciled Monthly P&L (cash-grounded) ───────────────
  // Every cash row maps 1:1 to a Cash Position line. By construction,
  // cashNetProfit ≡ netCash. Player/intro commissions use the payable
  // pass so they match the Player page for the same month.

  const cashRevenue = cashIn;
  const cashCOGS = cashOutCOGS;
  const cashGrossProfit = cashRevenue - cashCOGS;
  const cashPlatformFee = cashOutPlatform;
  const cashPlayerComm = payableEUComm;
  const cashIntroComm = payableIntroComm;
  const cashInvestorReturns = payableInvestorReturns;
  const cashInvIntroComm = payableInvIntroComm;
  const cashOpex = monthlyOpex;
  const cashNetProfit =
    cashRevenue -
    cashCOGS -
    cashPlatformFee -
    cashPlayerComm -
    cashIntroComm -
    cashInvestorReturns -
    cashInvIntroComm -
    cashOpex;

  // Accrual adjustments — entity income earned but not yet in cash.
  // Spread is recognised on completed deployment cycles only; reserve
  // is recognised on fully-paid POs (when supplier cost is realised).
  const accrualSpread = fullyPaidPOs.reduce((s, p) => s + p.spread, 0);
  const accrualCogsReserve = fullyPaidPOs.reduce(
    (s, p) => s + (p.riskAdjustedCogs - p.supplierTotal),
    0
  );
  const accrualNetProfit =
    cashNetProfit + accrualSpread + accrualCogsReserve;

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
          value={fmt(cashRevenue)}
          subtitle={`${fullyPaidPOs.length} fully-paid POs`}
          color="success"
        />
        <MetricCard
          label="Cash Net Profit"
          value={fmt(cashNetProfit)}
          subtitle="Ties to Cash Position"
          color={cashNetProfit >= 0 ? "success" : "danger"}
        />
        <MetricCard
          label="Total OPEX"
          value={fmt(monthlyOpex)}
          subtitle="Monthly operating cost"
          color="danger"
        />
        <MetricCard
          label="Net Profit"
          value={fmt(accrualNetProfit)}
          subtitle="Including spread + reserve"
          color={accrualNetProfit >= 0 ? "success" : "danger"}
        />
      </div>

      {/* Unfunded Banner — only renders when unfunded POs exist */}
      <UnfundedBanner status={fundingStatus} />

      {/* ═══ 1. MONTHLY P&L ═══ */}
      <div className="rounded-xl bg-white p-5 shadow-sm ring-1 ring-gray-200">
        <SectionHeader
          title="Monthly P&L"
          open={openSections.pnl}
          onToggle={() => toggleSection("pnl")}
          badge={{
            label: fmt(accrualNetProfit),
            color: accrualNetProfit >= 0 ? "success" : "danger",
          }}
        />
        {openSections.pnl && (
          <div className="pt-2">
            <table className="w-full border-collapse text-xs">
              <tbody>
                {/* CASH P&L — ties to Cash Position */}
                <tr>
                  <td
                    className="pb-1 text-[10px] font-medium uppercase tracking-wider text-gray-500"
                    colSpan={2}
                  >
                    Cash P&L (ties to Cash Position)
                  </td>
                </tr>
                <tr className="border-b-2 border-gray-200">
                  <td className="py-2 font-medium text-success-600">
                    Gross Revenue
                  </td>
                  <td className="py-2 text-right font-mono font-medium text-success-600">
                    {fmt(cashRevenue)}
                  </td>
                </tr>
                <tr className="border-b border-gray-100">
                  <td className="py-2 text-gray-600">
                    - COGS (actual supplier)
                  </td>
                  <td className="py-2 text-right font-mono text-danger-600">
                    ({fmt(cashCOGS)})
                  </td>
                </tr>
                <tr className="border-b-2 border-gray-200">
                  <td className="py-2 font-medium text-gray-800">
                    = Gross Profit
                  </td>
                  <td
                    className={cn(
                      "py-2 text-right font-mono font-medium",
                      cashGrossProfit >= 0
                        ? "text-success-600"
                        : "text-danger-600"
                    )}
                  >
                    {cashGrossProfit < 0
                      ? `(${fmt(Math.abs(cashGrossProfit))})`
                      : fmt(cashGrossProfit)}
                  </td>
                </tr>
                {[
                  { label: "- P Platform Fee", val: cashPlatformFee },
                  { label: "- Player Commissions", val: cashPlayerComm },
                  {
                    label: "- Player Introducer Commissions",
                    val: cashIntroComm,
                  },
                  {
                    label: "- Investor Returns (completed cycles)",
                    val: cashInvestorReturns,
                  },
                  {
                    label: "- Inv Introducer Commissions",
                    val: cashInvIntroComm,
                  },
                  { label: "- Monthly OPEX", val: cashOpex },
                ].map((row) => (
                  <tr key={row.label} className="border-b border-gray-100">
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
                      cashNetProfit >= 0
                        ? "text-success-600"
                        : "text-danger-600"
                    )}
                  >
                    = Cash Net Profit
                  </td>
                  <td
                    className={cn(
                      "py-2 text-right font-mono text-base font-medium",
                      cashNetProfit >= 0
                        ? "text-success-600"
                        : "text-danger-600"
                    )}
                  >
                    {cashNetProfit < 0
                      ? `(${fmt(Math.abs(cashNetProfit))})`
                      : fmt(cashNetProfit)}
                  </td>
                </tr>

                {/* ACCRUAL ADJUSTMENTS — entity income not yet in cash */}
                <tr>
                  <td
                    className="pt-5 pb-1 text-[10px] font-medium uppercase tracking-wider text-gray-500"
                    colSpan={2}
                  >
                    Accrual Adjustments (entity income not yet in cash)
                  </td>
                </tr>
                <tr className="border-b border-gray-100">
                  <td className="py-2 text-gray-600">
                    + Investor Spread Earned
                  </td>
                  <td
                    className={cn(
                      "py-2 text-right font-mono",
                      accrualSpread >= 0
                        ? "text-success-600"
                        : "text-danger-600"
                    )}
                  >
                    {accrualSpread < 0
                      ? `(${fmt(Math.abs(accrualSpread))})`
                      : fmt(accrualSpread)}
                  </td>
                </tr>
                <tr className="border-b border-gray-100">
                  <td className="py-2 text-gray-600">
                    + COGS Reserve Released
                  </td>
                  <td
                    className={cn(
                      "py-2 text-right font-mono",
                      accrualCogsReserve >= 0
                        ? "text-success-600"
                        : "text-danger-600"
                    )}
                  >
                    {accrualCogsReserve < 0
                      ? `(${fmt(Math.abs(accrualCogsReserve))})`
                      : fmt(accrualCogsReserve)}
                  </td>
                </tr>
                <tr className="border-t-2 border-gray-200">
                  <td
                    className={cn(
                      "py-2 font-medium",
                      accrualNetProfit >= 0
                        ? "text-success-600"
                        : "text-danger-600"
                    )}
                  >
                    = Accrual Net Profit
                  </td>
                  <td
                    className={cn(
                      "py-2 text-right font-mono text-base font-medium",
                      accrualNetProfit >= 0
                        ? "text-success-600"
                        : "text-danger-600"
                    )}
                  >
                    {accrualNetProfit < 0
                      ? `(${fmt(Math.abs(accrualNetProfit))})`
                      : fmt(accrualNetProfit)}
                  </td>
                </tr>
              </tbody>
            </table>

            {accrualNetProfit < 0 && (
              <HealthCheck entityNet={accrualNetProfit} className="mt-3" />
            )}
            {accrualNetProfit >= 0 && accrualNetProfit < 5000 && (
              <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-100 bg-amber-50 px-4 py-3 text-xs text-amber-600">
                Tight P&L this month at {fmt(accrualNetProfit)}. Watch the
                margins.
              </div>
            )}
            {accrualNetProfit >= 5000 && (
              <div className="mt-3 flex items-start gap-2 rounded-lg border border-success-100 bg-success-50 px-4 py-3 text-xs text-success-600">
                Healthy P&L this month at {fmt(accrualNetProfit)}.
              </div>
            )}

            <p className="mt-3 text-[10px] text-gray-500">
              Cash P&L matches Cash Position. Accrual section reflects entity
              income earned but not yet realised in cash.
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
                    label: "- Commissions payable (Player + Player Intro)",
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
                      Player Commission
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
                      <TableCell
                        className={
                          "font-mono " +
                          (p.euComm < 0 ? "text-danger-600" : "text-brand-600")
                        }
                      >
                        {p.euComm === 0 ? "-" : fmtSigned(p.euComm)}
                      </TableCell>
                      <TableCell
                        className={
                          "font-mono " +
                          (p.introComm < 0
                            ? "text-danger-600"
                            : "text-purple-600")
                        }
                      >
                        {p.introComm === 0 ? "-" : fmtSigned(p.introComm)}
                      </TableCell>
                      <TableCell
                        className={
                          "font-mono font-medium " +
                          (p.total < 0 ? "text-danger-600" : "text-brand-600")
                        }
                      >
                        {fmtSigned(p.total)}
                      </TableCell>
                    </TableRow>
                  ))}
                  <TableRow className="border-t-2 border-gray-200">
                    <TableCell className="font-medium">Total</TableCell>
                    <TableCell
                      className={
                        "font-mono font-medium " +
                        (payableEUComm < 0
                          ? "text-danger-600"
                          : "text-brand-600")
                      }
                    >
                      {fmtSigned(payableEUComm)}
                    </TableCell>
                    <TableCell
                      className={
                        "font-mono font-medium " +
                        (payableIntroComm < 0
                          ? "text-danger-600"
                          : "text-purple-600")
                      }
                    >
                      {fmtSigned(payableIntroComm)}
                    </TableCell>
                    <TableCell
                      className={
                        "font-mono font-medium " +
                        (payableEUComm + payableIntroComm < 0
                          ? "text-danger-600"
                          : "text-brand-600")
                      }
                    >
                      {fmtSigned(payableEUComm + payableIntroComm)}
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
