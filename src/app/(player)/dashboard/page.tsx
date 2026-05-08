"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

import { calcPOWaterfall } from "@/lib/business-logic/waterfall";
import { fmt, fmtSigned, getMonth } from "@/lib/business-logic/formatters";
import { getCommissionStatus } from "@/lib/business-logic/commission-status";

import { MetricCard } from "@/components/metric-card";
import { MonthPicker } from "@/components/month-picker";

import { ArrowRight } from "lucide-react";

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
        <p className="text-sm text-gray-500">Lifetime Earnings</p>
        <p className="mt-2 font-mono text-3xl font-semibold tracking-tight text-gray-900">
          {fmtSigned(lifetimeEarned)}
        </p>
        {lifetimeEarned > 0 && (
          <>
            {myAllTimePOs.length > 0 && (
              <p className="mt-2 font-mono text-xs text-gray-500">
                <span className="font-medium text-gray-700">
                  {myAllTimePOs.length}
                </span>
                <span className="text-gray-400">
                  {" "}
                  PO{myAllTimePOs.length !== 1 ? "s" : ""} lifetime
                </span>
              </p>
            )}

            <div className="mt-6">
              <div className="mb-2 flex items-baseline justify-between">
                <span className="text-xs font-medium uppercase tracking-wide text-gray-500">
                  Lifetime status
                </span>
                <span className="font-mono text-xs font-medium text-success-600">
                  {Math.round(
                    ((lifetimeEarned - lifetimePending) / lifetimeEarned) * 100
                  )}
                  % cleared
                </span>
              </div>
              <div className="flex h-2 gap-0.5 overflow-hidden rounded-md bg-gray-100">
                <div
                  className="rounded-md bg-success-200 transition-all"
                  style={{
                    width: `${
                      ((lifetimeEarned - lifetimePending) / lifetimeEarned) *
                      100
                    }%`,
                  }}
                />
                {lifetimePending > 0 && (
                  <div
                    className="rounded-md bg-amber-200"
                    style={{
                      width: `${(lifetimePending / lifetimeEarned) * 100}%`,
                    }}
                  />
                )}
              </div>
              <div className="mt-2 flex gap-5 text-xs">
                <span className="text-success-600">
                  Cleared lifetime {fmt(lifetimeEarned - lifetimePending)}
                </span>
                {lifetimePending > 0 && (
                  <span className="text-amber-600">
                    Pending lifetime {fmt(lifetimePending)}
                  </span>
                )}
              </div>
            </div>
          </>
        )}
      </div>

      {myTotalPO > 0 && (
        <>
          <MetricCard
            label="This Month Earnings"
            value={fmtSigned(totalComm)}
            color={totalComm < 0 ? "danger" : "brand"}
          />
          <MetricCard
            label="Total PO This Month"
            value={fmt(myTotalPO)}
            subtitle={`across ${myMonthPOs.length} PO${myMonthPOs.length !== 1 ? "s" : ""}`}
            color="accent"
          />
        </>
      )}

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

      {/* ═══ SIMULATOR TEASER ═══ */}
      <div className="rounded-2xl bg-brand-50 px-6 py-5">
        <p className="text-sm font-semibold text-brand-800">
          Want to see how much you can earn?
        </p>
        <p className="mt-2 text-xs leading-relaxed text-brand-600">
          There are two ways to earn with us:
        </p>
        <ul className="mt-1 ml-4 list-disc space-y-0.5 text-xs leading-relaxed text-brand-600">
          <li>Bring in your own POs.</li>
          <li>Or invite other players who bring in POs.</li>
        </ul>
        <p className="mt-2 text-xs leading-relaxed text-brand-600">
          Both ways pay you a commission. Open the simulator to see what
          each way could pay.
        </p>
        <Link
          href="/simulator"
          className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-brand-600 hover:text-brand-800"
        >
          Open Simulator
          <ArrowRight className="size-4" />
        </Link>
      </div>

    </div>
  );
}
