"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Database, Tables } from "@/lib/supabase/types";
import type { LedgerRow } from "@/lib/supabase/types-helpers";

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
import type { CycleStatus } from "@/components/cycle-status-badge";

type DBInvestor = Tables<"investors">;
type DBWithdrawal = Tables<"withdrawals">;
type DBPO = Tables<"purchase_orders"> & {
  delivery_orders: Tables<"delivery_orders">[];
};
type DBAdminAdjustment = Tables<"admin_adjustments">;
type DBReturnCredit = Tables<"return_credits">;
type DBIntroducerCredit = Tables<"introducer_credits">;
type DBDepositEvent = Database["public"]["Views"]["v_deposit_events"]["Row"];
type DBIntroducerCreditEvent =
  Database["public"]["Views"]["v_introducer_credit_events"]["Row"];

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

export type RecruitRow = {
  id: string;
  name: string;
  capital: number;
  commEarned: number;
  commPending: number;
  commTotal: number;
  commStatus: CycleStatus;
  clearedRows: ClearedRow[];
  pendingRows: PendingRow[];
};

export function useInvestorPortfolio() {
  const supabase = useMemo(() => createClient(), []);

  const [myInvestor, setMyInvestor] = useState<DBInvestor | null>(null);
  const [allInvestors, setAllInvestors] = useState<DBInvestor[]>([]);
  const [allPOs, setAllPOs] = useState<DBPO[]>([]);
  const [depositEvents, setDepositEvents] = useState<DBDepositEvent[]>([]);
  const [allWithdrawals, setAllWithdrawals] = useState<DBWithdrawal[]>([]);
  const [adminAdjustments, setAdminAdjustments] = useState<
    DBAdminAdjustment[]
  >([]);
  const [returnCredits, setReturnCredits] = useState<DBReturnCredit[]>([]);
  const [introducerCredits, setIntroducerCredits] = useState<
    DBIntroducerCredit[]
  >([]);
  const [introducerCreditEvents, setIntroducerCreditEvents] = useState<
    DBIntroducerCreditEvent[]
  >([]);
  const [myLedger, setMyLedger] = useState<LedgerRow[]>([]);
  const [myWithdrawals, setMyWithdrawals] = useState<DBWithdrawal[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorState, setErrorState] = useState<
    "not_authenticated" | "no_investor" | null
  >(null);

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
      supabase
        .from("withdrawals")
        .select("*")
        .order("requested_at", { ascending: true }),
      supabase
        .from("v_investor_ledger")
        .select("*")
        .eq("investor_id", investorData.id)
        .order("at", { ascending: false }),
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
      supabase
        .from("introducer_credits")
        .select("*")
        .order("created_at", { ascending: true }),
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

  const deploymentPOs = useMemo(() => allPOs.map(toDeploymentPO), [allPOs]);

  const deploymentInvestors = useMemo(
    () => allInvestors.map(toDeploymentInvestor),
    [allInvestors]
  );

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

  const allDeployments = useMemo(
    () => overlayReturnCredits(rawAllDeployments, returnCredits),
    [rawAllDeployments, returnCredits]
  );

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

  const myDeployments = useMemo(() => {
    if (!myInvestor) return [];
    return allDeployments.filter((d) => d.investorId === myInvestor.id);
  }, [allDeployments, myInvestor]);

  const myTier = useMemo(
    () => (myInvestor ? getTier(myInvestor.capital, INV_TIERS) : INV_TIERS[0]),
    [myInvestor]
  );

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

  const recruitData = useMemo<RecruitRow[]>(() => {
    if (myRecruits.length === 0 || !myInvestor) return [];
    return myRecruits.map((recruit) => {
      const recruitDeps = allDeployments.filter(
        (d) => d.investorId === recruit.id
      );
      const rReturnsPending = recruitDeps
        .filter((d) => !d.cycleComplete)
        .reduce((s, d) => s + d.returnAmt, 0);
      const myCredits = introducerCredits.filter(
        (ic) =>
          ic.introducer_id === myInvestor.id &&
          ic.introducee_id === recruit.id
      );
      const commEarned = myCredits.reduce(
        (s, ic) => s + Number(ic.amount),
        0
      );
      const commPending = rReturnsPending * (introTier.rate / 100);
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

  return {
    loading,
    errorState,
    myInvestor,
    myCapital,
    myWithdrawals,
    myLedger,
    myDeployments,
    totalDeployed,
    lifetimeDeployed,
    idle,
    utilisationPct,
    totalReturns,
    pendingReturns,
    completedDeps,
    activeDeps,
    lifetimeReturns,
    myTier,
    fundingStatus,
    myRecruits,
    recruitData,
    introTier,
    totalIntroCommEarned,
    totalIntroCommPending,
    totalIntroComm,
    totalCapitalIntroduced,
    allPOs,
    allInvestors,
  };
}
