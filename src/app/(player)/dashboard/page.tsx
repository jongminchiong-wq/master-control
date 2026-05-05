"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

import { calcPOWaterfall } from "@/lib/business-logic/waterfall";
import { getTier, getEUTiers } from "@/lib/business-logic/tiers";
import { PO_EU_C } from "@/lib/business-logic/constants";
import { fmt, fmtSigned, getMonth } from "@/lib/business-logic/formatters";
import { getCommissionStatus } from "@/lib/business-logic/commission-status";

import { MetricCard } from "@/components/metric-card";
import { TierCard } from "@/components/tier-card";
import { ChannelBadge } from "@/components/channel-badge";
import { MonthPicker } from "@/components/month-picker";

import {
  type DBPlayer,
  type DBPO,
  type DBLossDebit,
  type DBCommission,
  toWaterfallPlayer,
  toWaterfallPO,
} from "../_shared";
import { usePlayerSelectedMonth } from "../_month-context";

export default function PlayerDashboardPage() {
  const supabase = useMemo(() => createClient(), []);

  const [myPlayer, setMyPlayer] = useState<DBPlayer | null>(null);
  const [allPlayers, setAllPlayers] = useState<DBPlayer[]>([]);
  const [allPOs, setAllPOs] = useState<DBPO[]>([]);
  const [lossDebits, setLossDebits] = useState<DBLossDebit[]>([]);
  const [commissionLedger, setCommissionLedger] = useState<DBCommission[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorState, setErrorState] = useState<
    "not_authenticated" | "no_player" | null
  >(null);

  const now = new Date();
  const currentMonth =
    now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0");
  const [selectedMonth, setSelectedMonth] = usePlayerSelectedMonth();

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

    const { data: playerData } = await supabase
      .from("players")
      .select("*")
      .eq("user_id", user.id)
      .single();

    if (!playerData) {
      setErrorState("no_player");
      setLoading(false);
      return;
    }

    setMyPlayer(playerData);

    const [playersRes, posRes, debitsRes, commsRes] = await Promise.all([
      supabase
        .from("players")
        .select("*")
        .order("created_at", { ascending: true }),
      supabase
        .from("purchase_orders")
        .select("*, delivery_orders(*)")
        .order("po_date", { ascending: true }),
      supabase
        .from("player_loss_debits")
        .select("*")
        .eq("player_id", playerData.id)
        .order("cleared_at", { ascending: true }),
      supabase
        .from("player_commissions")
        .select("*")
        .eq("player_id", playerData.id)
        .order("created_at", { ascending: true }),
    ]);

    if (playersRes.data) setAllPlayers(playersRes.data);
    if (posRes.data) setAllPOs(posRes.data as DBPO[]);
    if (debitsRes.data) setLossDebits(debitsRes.data);
    if (commsRes.data) setCommissionLedger(commsRes.data);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const availableMonths = useMemo(() => {
    const poMonths = allPOs
      .map((po) => getMonth(po.po_date))
      .filter((m): m is string => Boolean(m));
    const anchors = [...poMonths, currentMonth];
    const earliest = anchors.reduce((a, b) => (a < b ? a : b));
    const latest = anchors.reduce((a, b) => (a > b ? a : b));

    const months: string[] = [];
    let [y, m] = earliest.split("-").map(Number);
    const [ly, lm] = latest.split("-").map(Number);
    while (y < ly || (y === ly && m <= lm)) {
      months.push(`${y}-${String(m).padStart(2, "0")}`);
      m++;
      if (m > 12) {
        m = 1;
        y++;
      }
    }
    return months.reverse();
  }, [allPOs, currentMonth]);

  const wPlayers = useMemo(
    () => allPlayers.map(toWaterfallPlayer),
    [allPlayers]
  );
  const wAllPOs = useMemo(() => allPOs.map(toWaterfallPO), [allPOs]);

  const myMonthPOs = useMemo(() => {
    if (!myPlayer) return [];
    return allPOs.filter(
      (po) =>
        po.end_user_id === myPlayer.id &&
        getMonth(po.po_date) === selectedMonth
    );
  }, [allPOs, myPlayer, selectedMonth]);

  const myPOData = useMemo(() => {
    return myMonthPOs.map((po) => {
      const wPO = toWaterfallPO(po);
      const w = calcPOWaterfall(wPO, wPlayers, wAllPOs, po.po_amount);
      return { po, waterfall: w };
    });
  }, [myMonthPOs, wPlayers, wAllPOs]);

  const myTotalPO = useMemo(
    () => myMonthPOs.reduce((s, po) => s + po.po_amount, 0),
    [myMonthPOs]
  );

  const myEUComm = useMemo(
    () =>
      myPOData.reduce(
        (s, d) => s + d.waterfall.euAmt - d.waterfall.playerLossShare,
        0
      ),
    [myPOData]
  );

  const clearedEUComm = useMemo(
    () =>
      myPOData
        .filter((d) => d.po.commissions_cleared)
        .reduce(
          (s, d) => s + d.waterfall.euAmt - d.waterfall.playerLossShare,
          0
        ),
    [myPOData]
  );

  const pendingEUComm = myEUComm - clearedEUComm;

  const gepPOs = useMemo(
    () => myMonthPOs.filter((po) => po.channel === "gep"),
    [myMonthPOs]
  );
  const punchPOs = useMemo(
    () => myMonthPOs.filter((po) => po.channel === "punchout"),
    [myMonthPOs]
  );

  const gepTotal = gepPOs.reduce((s, po) => s + po.po_amount, 0);
  const punchTotal = punchPOs.reduce((s, po) => s + po.po_amount, 0);

  const tierModes = myPlayer
    ? {
        euTierModeProxy: myPlayer.eu_tier_mode_proxy,
        euTierModeGrid: myPlayer.eu_tier_mode_grid,
        introTierModeProxy: myPlayer.intro_tier_mode_proxy,
        introTierModeGrid: myPlayer.intro_tier_mode_grid,
      }
    : null;
  const gepTiers = tierModes ? getEUTiers(tierModes, "gep") : PO_EU_C;
  const punchTiers = tierModes ? getEUTiers(tierModes, "punchout") : PO_EU_C;

  const gepTier = getTier(gepTotal, gepTiers);
  const punchTier = getTier(punchTotal, punchTiers);

  const recruits = useMemo(() => {
    if (!myPlayer) return [];
    return allPlayers.filter((p) => p.introduced_by === myPlayer.id);
  }, [allPlayers, myPlayer]);

  const introTotals = useMemo(() => {
    if (recruits.length === 0)
      return { earned: 0, cleared: 0 };
    const recruitIds = new Set(recruits.map((r) => r.id));
    let earned = 0;
    let cleared = 0;
    for (const po of allPOs) {
      if (!recruitIds.has(po.end_user_id)) continue;
      if (getMonth(po.po_date) !== selectedMonth) continue;
      const w = calcPOWaterfall(
        toWaterfallPO(po),
        wPlayers,
        wAllPOs,
        po.po_amount
      );
      const net = w.introAmt - w.introducerLossShare;
      earned += net;
      if (getCommissionStatus(po) === "cleared") cleared += net;
    }
    return { earned, cleared };
  }, [allPOs, recruits, selectedMonth, wPlayers, wAllPOs]);

  const totalIntroComm = introTotals.earned;
  const clearedIntroComm = introTotals.cleared;
  const pendingIntroComm = totalIntroComm - clearedIntroComm;
  const totalComm = myEUComm + totalIntroComm;

  const lifetimeDebits = useMemo(
    () => lossDebits.reduce((s, d) => s + d.amount, 0),
    [lossDebits]
  );

  const lifetimeCommissions = useMemo(
    () => commissionLedger.reduce((s, c) => s + c.amount, 0),
    [commissionLedger]
  );

  const outstandingCarry = Math.max(0, lifetimeDebits - lifetimeCommissions);

  const myAllTimePOs = useMemo(() => {
    if (!myPlayer) return [];
    return allPOs.filter((po) => po.end_user_id === myPlayer.id);
  }, [allPOs, myPlayer]);

  const lifetimeEUTotals = useMemo(() => {
    let earned = 0;
    let pending = 0;
    for (const po of myAllTimePOs) {
      const w = calcPOWaterfall(
        toWaterfallPO(po),
        wPlayers,
        wAllPOs,
        po.po_amount
      );
      const net = w.euAmt - w.playerLossShare;
      earned += net;
      if (!po.commissions_cleared) pending += net;
    }
    return { earned, pending };
  }, [myAllTimePOs, wPlayers, wAllPOs]);

  const lifetimeIntroTotals = useMemo(() => {
    let earned = 0;
    let pending = 0;
    if (recruits.length === 0) return { earned, pending };
    const recruitIds = new Set(recruits.map((r) => r.id));
    for (const po of allPOs) {
      if (!recruitIds.has(po.end_user_id)) continue;
      const w = calcPOWaterfall(
        toWaterfallPO(po),
        wPlayers,
        wAllPOs,
        po.po_amount
      );
      const net = w.introAmt - w.introducerLossShare;
      earned += net;
      if (!po.commissions_cleared) pending += net;
    }
    return { earned, pending };
  }, [allPOs, recruits, wPlayers, wAllPOs]);

  const lifetimeEarned = lifetimeEUTotals.earned + lifetimeIntroTotals.earned;
  const lifetimePending = Math.max(
    0,
    lifetimeEUTotals.pending + lifetimeIntroTotals.pending
  );

  if (loading) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <p className="text-sm text-gray-500">Loading dashboard...</p>
      </div>
    );
  }

  if (errorState === "not_authenticated") {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <p className="text-sm text-gray-500">
          You are not authenticated. Please log in.
        </p>
      </div>
    );
  }

  if (errorState === "no_player" || !myPlayer) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <div className="text-center">
          <p className="text-sm font-medium text-gray-700">
            No player record found
          </p>
          <p className="mt-1 text-xs text-gray-500">
            Your account is not linked to a player record. Contact your
            administrator.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex justify-end">
        <MonthPicker
          months={availableMonths}
          value={selectedMonth}
          onChange={setSelectedMonth}
          color="brand"
        />
      </div>

      {outstandingCarry > 0 && (
        <div className="flex w-full flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-xl bg-danger-50 px-5 py-3 ring-1 ring-danger-200">
          <div>
            <p className="text-sm font-medium text-danger-800">
              Outstanding loss carry
            </p>
            <p className="text-xs text-danger-700">
              Will net from next commissions before new amount is withdrawable.
            </p>
          </div>
          <span className="font-mono text-sm font-semibold text-danger-700">
            {fmt(outstandingCarry)}
          </span>
        </div>
      )}

      <div className="px-1 pt-2 pb-1">
        <p className="text-sm text-gray-500">Total Earnings</p>
        <p className="mt-2 font-mono text-3xl font-semibold tracking-tight text-gray-900">
          {fmtSigned(lifetimeEarned)}
        </p>
        {(lifetimePending > 0 || myTotalPO > 0) && (
          <div className="mt-2 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            {lifetimePending > 0 ? (
              <p className="font-mono text-sm font-medium text-amber-700">
                + {fmt(lifetimePending)} pending
              </p>
            ) : (
              <span />
            )}
            {myTotalPO > 0 && (
              <p className="font-mono text-xs text-gray-500">
                This month{" "}
                <span className="font-medium text-gray-700">
                  {fmtSigned(totalComm)}
                </span>
                <span className="text-gray-400">
                  {" · "}
                  {fmt(myTotalPO)} across {myMonthPOs.length} PO
                  {myMonthPOs.length !== 1 ? "s" : ""}
                </span>
              </p>
            )}
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-4">
        <MetricCard
          label="Player Commission"
          value={fmtSigned(myEUComm)}
          color={myEUComm < 0 ? "danger" : "brand"}
        >
          <div className="mt-1 flex gap-2.5">
            <span
              className={cn(
                "text-[10px] font-medium",
                clearedEUComm < 0 ? "text-danger-600" : "text-success-600"
              )}
            >
              Cleared {fmtSigned(clearedEUComm)}
            </span>
            <span
              className={cn(
                "text-[10px] font-medium",
                pendingEUComm < 0 ? "text-danger-600" : "text-amber-600"
              )}
            >
              Pending {fmtSigned(pendingEUComm)}
            </span>
          </div>
        </MetricCard>
        <MetricCard
          label="Intro Commission"
          value={fmtSigned(totalIntroComm)}
          color="purple"
        >
          <div className="mt-1 flex gap-2.5">
            <span className="text-[10px] font-medium text-success-600">
              Cleared {fmtSigned(clearedIntroComm)}
            </span>
            <span className="text-[10px] font-medium text-amber-600">
              Pending {fmtSigned(pendingIntroComm)}
            </span>
          </div>
        </MetricCard>
      </div>

      <div
        className={cn(
          "grid gap-4",
          punchTotal > 0 && gepTotal > 0 ? "grid-cols-2" : "grid-cols-1"
        )}
      >
        {punchTotal > 0 && (
          <div className="rounded-2xl bg-white p-6 shadow-[0_2px_8px_rgba(0,0,0,0.06),0_1px_3px_rgba(0,0,0,0.04)]">
            <div className="mb-4 flex items-center gap-2">
              <ChannelBadge channel="punchout" />
              <span className="text-xs text-gray-500">Tier Progress</span>
            </div>
            <TierCard
              tier={punchTier}
              tiers={punchTiers}
              volume={punchTotal}
              color="accent"
              label="of pool"
            />
          </div>
        )}
        {gepTotal > 0 && (
          <div className="rounded-2xl bg-white p-6 shadow-[0_2px_8px_rgba(0,0,0,0.06),0_1px_3px_rgba(0,0,0,0.04)]">
            <div className="mb-4 flex items-center gap-2">
              <ChannelBadge channel="gep" />
              <span className="text-xs text-gray-500">Tier Progress</span>
            </div>
            <TierCard
              tier={gepTier}
              tiers={gepTiers}
              volume={gepTotal}
              color="brand"
              label="of pool"
            />
          </div>
        )}
        {punchTotal === 0 && gepTotal === 0 && (
          <div className="rounded-2xl bg-white p-8 text-center shadow-[0_2px_8px_rgba(0,0,0,0.06),0_1px_3px_rgba(0,0,0,0.04)]">
            <p className="text-xs text-gray-500">
              No POs this month. Your tier will show once you have POs.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
