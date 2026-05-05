"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

import { calcPOWaterfall } from "@/lib/business-logic/waterfall";
import { fmt, fmtSigned, getMonth } from "@/lib/business-logic/formatters";
import {
  getCommissionStatus,
  type CommStatus,
} from "@/lib/business-logic/commission-status";

import { ChannelBadge } from "@/components/channel-badge";
import { CommissionStatusBadge } from "@/components/commission-status-badge";
import { MetricCard } from "@/components/metric-card";
import { MonthPicker } from "@/components/month-picker";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";

import {
  type DBPlayer,
  type DBPO,
  toWaterfallPlayer,
  toWaterfallPO,
  getDOStatus,
  DOStatusBadge,
  deliveryLabel,
  PayoutTimeline,
  DOProgressBar,
  SimplifiedIntroCommission,
} from "../_shared";
import { usePlayerSelectedMonth } from "../_month-context";

export default function PlayerIntroducerCommissionPage() {
  const supabase = useMemo(() => createClient(), []);

  const [myPlayer, setMyPlayer] = useState<DBPlayer | null>(null);
  const [allPlayers, setAllPlayers] = useState<DBPlayer[]>([]);
  const [allPOs, setAllPOs] = useState<DBPO[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorState, setErrorState] = useState<
    "not_authenticated" | "no_player" | null
  >(null);

  const [expandedRecruitId, setExpandedRecruitId] = useState<string | null>(
    null
  );
  const [expandedRecruitPOId, setExpandedRecruitPOId] = useState<string | null>(
    null
  );

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

    const [playersRes, posRes] = await Promise.all([
      supabase
        .from("players")
        .select("*")
        .order("created_at", { ascending: true }),
      supabase
        .from("purchase_orders")
        .select("*, delivery_orders(*)")
        .order("po_date", { ascending: true }),
    ]);

    if (playersRes.data) setAllPlayers(playersRes.data);
    if (posRes.data) setAllPOs(posRes.data as DBPO[]);
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

  const recruits = useMemo(() => {
    if (!myPlayer) return [];
    return allPlayers.filter((p) => p.introduced_by === myPlayer.id);
  }, [allPlayers, myPlayer]);

  const introData = useMemo(() => {
    if (recruits.length === 0) return [];
    return recruits.map((recruit) => {
      const recruitPOs = allPOs.filter(
        (po) =>
          po.end_user_id === recruit.id &&
          getMonth(po.po_date) === selectedMonth
      );

      const poBreakdown = recruitPOs.map((po) => {
        const w = calcPOWaterfall(
          toWaterfallPO(po),
          wPlayers,
          wAllPOs,
          po.po_amount
        );
        return {
          id: po.id,
          ref: po.ref,
          date: po.po_date,
          channel: po.channel as "punchout" | "gep",
          poAmount: po.po_amount,
          netIntroAmt: w.introAmt - w.introducerLossShare,
          commStatus: getCommissionStatus(po),
          po,
          pool: w.pool,
          introTierName: w.introTier?.name ?? "Base",
          introTierRate: w.introTier?.rate ?? 0,
        };
      });

      const recruitTotalPO = poBreakdown.reduce((s, p) => s + p.poAmount, 0);
      const recruitIntroComm = poBreakdown.reduce(
        (s, p) => s + p.netIntroAmt,
        0
      );

      const allFullyPaid =
        recruitPOs.length > 0 &&
        recruitPOs.every(
          (po) =>
            po.delivery_orders.length > 0 &&
            po.delivery_orders.every((d) => d.buyer_paid)
        );
      const allCleared =
        recruitPOs.length > 0 &&
        recruitPOs.every((po) => po.commissions_cleared);
      const commStatus: CommStatus = allCleared
        ? "cleared"
        : allFullyPaid
          ? "payable"
          : "pending";

      return {
        id: recruit.id,
        name: recruit.name,
        monthlyPO: recruitTotalPO,
        introComm: recruitIntroComm,
        commStatus,
        pos: poBreakdown,
      };
    });
  }, [recruits, allPOs, selectedMonth, wPlayers, wAllPOs]);

  const totalIntroComm = introData.reduce((s, r) => s + r.introComm, 0);
  const totalMonthlyPO = introData.reduce((s, r) => s + r.monthlyPO, 0);
  const clearedIntroComm = introData.reduce(
    (s, r) =>
      s + r.pos.filter((p) => p.commStatus === "cleared").reduce((ss, p) => ss + p.netIntroAmt, 0),
    0
  );
  const pendingIntroComm = totalIntroComm - clearedIntroComm;

  if (loading) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <p className="text-sm text-gray-500">Loading...</p>
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

      <div className="px-1 pt-2 pb-1">
        <p className="text-sm text-gray-500">Introducer Commission</p>
        <p className="mt-2 font-mono text-3xl font-semibold tracking-tight text-purple-600">
          {fmtSigned(totalIntroComm)}
        </p>
        <p className="mt-2 font-mono text-xs text-gray-500">
          <span className="font-medium text-gray-700">
            {recruits.length} recruit{recruits.length !== 1 ? "s" : ""}
          </span>
          {totalMonthlyPO > 0 && (
            <>
              <span className="text-gray-400"> · </span>
              <span>{fmt(totalMonthlyPO)} monthly PO</span>
            </>
          )}
          {pendingIntroComm > 0 && (
            <>
              <span className="text-gray-400"> · </span>
              <span className="text-amber-600">
                {fmt(pendingIntroComm)} pending
              </span>
            </>
          )}
        </p>
      </div>

      {recruits.length > 0 && (
        <div className="grid grid-cols-3 gap-4">
          <MetricCard
            label="Earned"
            value={fmtSigned(clearedIntroComm)}
            color={clearedIntroComm < 0 ? "danger" : "success"}
            subtitle="Cleared this month"
          />
          <MetricCard
            label="Pending"
            value={fmt(Math.max(0, pendingIntroComm))}
            color="amber"
            subtitle="Across active POs"
          />
          <MetricCard
            label="Recruits"
            value={String(recruits.length)}
            color="purple"
            subtitle={`${fmt(totalMonthlyPO)} monthly PO`}
          />
        </div>
      )}

      {recruits.length === 0 ? (
        <div className="rounded-2xl bg-white px-5 py-12 text-center shadow-[0_2px_8px_rgba(0,0,0,0.06),0_1px_3px_rgba(0,0,0,0.04)]">
          <p className="text-sm font-medium text-gray-700">
            You have no recruits yet
          </p>
          <p className="mt-1 text-xs text-gray-500">
            When a player you introduced earns commission, it will appear here.
          </p>
        </div>
      ) : (
        <div className="rounded-2xl bg-white p-6 shadow-[0_2px_8px_rgba(0,0,0,0.06),0_1px_3px_rgba(0,0,0,0.04)]">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-6 pr-0" />
                <TableHead className="text-[10px] uppercase tracking-wide">Recruit</TableHead>
                <TableHead className="text-right text-[10px] uppercase tracking-wide">
                  Monthly PO
                </TableHead>
                <TableHead className="text-right text-[10px] uppercase tracking-wide">
                  Your Commission
                </TableHead>
                <TableHead className="text-[10px] uppercase tracking-wide">Comm Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {introData.map((r) => {
                const isExpanded = expandedRecruitId === r.id;
                return (
                  <Fragment key={r.id}>
                    <TableRow
                      className={cn(
                        "cursor-pointer",
                        isExpanded && "bg-purple-50/30"
                      )}
                      onClick={() => {
                        setExpandedRecruitId(isExpanded ? null : r.id);
                        setExpandedRecruitPOId(null);
                      }}
                    >
                      <TableCell className="w-6 pr-0">
                        {isExpanded ? (
                          <ChevronDown
                            className="size-3.5 text-gray-500"
                            strokeWidth={2}
                          />
                        ) : (
                          <ChevronRight
                            className="size-3.5 text-gray-500"
                            strokeWidth={2}
                          />
                        )}
                      </TableCell>
                      <TableCell className="text-xs font-medium text-gray-800">
                        {r.name}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs">
                        {fmt(r.monthlyPO)}
                      </TableCell>
                      <TableCell
                        className={cn(
                          "text-right font-mono text-xs font-medium",
                          r.introComm < 0
                            ? "text-danger-600"
                            : "text-purple-600"
                        )}
                      >
                        {fmtSigned(r.introComm)}
                      </TableCell>
                      <TableCell>
                        <CommissionStatusBadge status={r.commStatus} />
                      </TableCell>
                    </TableRow>

                    {isExpanded && (
                      <TableRow className="hover:bg-transparent">
                        <TableCell
                          colSpan={5}
                          className="border-b border-gray-200 bg-purple-50/15 px-2 pb-4 pt-0"
                        >
                          <div className="rounded-lg border border-purple-100 bg-white p-3">
                            {r.pos.length === 0 ? (
                              <p className="text-center text-xs text-gray-500">
                                No POs this month
                              </p>
                            ) : (
                              <Table>
                                <TableHeader>
                                  <TableRow>
                                    <TableHead className="w-6" />
                                    <TableHead className="text-[10px] uppercase tracking-wide text-purple-600">
                                      Ref
                                    </TableHead>
                                    <TableHead className="text-[10px] uppercase tracking-wide text-purple-600">
                                      Date
                                    </TableHead>
                                    <TableHead className="text-[10px] uppercase tracking-wide text-purple-600">
                                      Channel
                                    </TableHead>
                                    <TableHead className="text-right text-[10px] uppercase tracking-wide text-purple-600">
                                      PO Amount
                                    </TableHead>
                                    <TableHead className="text-right text-[10px] uppercase tracking-wide text-purple-600">
                                      Intro Commission
                                    </TableHead>
                                    <TableHead className="text-[10px] uppercase tracking-wide text-purple-600">
                                      Comm Status
                                    </TableHead>
                                  </TableRow>
                                </TableHeader>
                                <TableBody>
                                  {r.pos.map((p) => {
                                    const isPOExpanded =
                                      expandedRecruitPOId === p.id;
                                    const pDos = p.po.delivery_orders ?? [];
                                    return (
                                      <Fragment key={p.id}>
                                        <TableRow
                                          className={cn(
                                            "cursor-pointer",
                                            isPOExpanded && "bg-purple-50/40"
                                          )}
                                          onClick={() =>
                                            setExpandedRecruitPOId(
                                              isPOExpanded ? null : p.id
                                            )
                                          }
                                        >
                                          <TableCell className="w-6 pr-0">
                                            {isPOExpanded ? (
                                              <ChevronDown
                                                className="size-3.5 text-gray-500"
                                                strokeWidth={2}
                                              />
                                            ) : (
                                              <ChevronRight
                                                className="size-3.5 text-gray-500"
                                                strokeWidth={2}
                                              />
                                            )}
                                          </TableCell>
                                          <TableCell
                                            className={cn(
                                              "font-mono text-xs font-medium",
                                              p.channel === "gep"
                                                ? "text-brand-600"
                                                : "text-accent-600"
                                            )}
                                          >
                                            {p.ref}
                                          </TableCell>
                                          <TableCell className="text-xs text-gray-500">
                                            {p.date}
                                          </TableCell>
                                          <TableCell>
                                            <ChannelBadge
                                              channel={p.channel}
                                            />
                                          </TableCell>
                                          <TableCell className="text-right font-mono text-xs">
                                            {fmt(p.poAmount)}
                                          </TableCell>
                                          <TableCell
                                            className={cn(
                                              "text-right font-mono text-xs font-medium",
                                              p.netIntroAmt < 0
                                                ? "text-danger-600"
                                                : "text-purple-600"
                                            )}
                                          >
                                            {fmtSigned(p.netIntroAmt)}
                                          </TableCell>
                                          <TableCell>
                                            <CommissionStatusBadge
                                              status={p.commStatus}
                                            />
                                          </TableCell>
                                        </TableRow>

                                        {isPOExpanded && (
                                          <TableRow
                                            key={`${p.id}_detail`}
                                            className="hover:bg-transparent"
                                          >
                                            <TableCell
                                              colSpan={7}
                                              className="border-b border-purple-100 bg-purple-50/25 px-2 pb-4 pt-0"
                                            >
                                              <div className="rounded-lg border border-purple-100 bg-white p-4">
                                                <DOProgressBar dos={pDos} />

                                                {pDos.length > 0 ? (
                                                  <Table>
                                                    <TableHeader>
                                                      <TableRow>
                                                        <TableHead className="text-[10px] uppercase tracking-wide">
                                                          DO
                                                        </TableHead>
                                                        <TableHead className="text-[10px] uppercase tracking-wide">
                                                          Items
                                                        </TableHead>
                                                        <TableHead className="text-[10px] uppercase tracking-wide">
                                                          Delivery
                                                        </TableHead>
                                                        <TableHead className="text-[10px] uppercase tracking-wide">
                                                          Status
                                                        </TableHead>
                                                      </TableRow>
                                                    </TableHeader>
                                                    <TableBody>
                                                      {pDos.map((d) => (
                                                        <TableRow key={d.id}>
                                                          <TableCell
                                                            className={cn(
                                                              "font-mono text-[11px] font-semibold",
                                                              p.channel === "gep"
                                                                ? "text-brand-600"
                                                                : "text-accent-600"
                                                            )}
                                                          >
                                                            {d.ref}
                                                          </TableCell>
                                                          <TableCell className="text-[11px] text-gray-600">
                                                            {d.description ||
                                                              "—"}
                                                          </TableCell>
                                                          <TableCell className="text-[11px] text-gray-500">
                                                            {deliveryLabel[
                                                              d.delivery ??
                                                                "local"
                                                            ] ?? d.delivery}
                                                          </TableCell>
                                                          <TableCell>
                                                            <DOStatusBadge
                                                              status={getDOStatus(
                                                                d
                                                              )}
                                                            />
                                                          </TableCell>
                                                        </TableRow>
                                                      ))}
                                                    </TableBody>
                                                  </Table>
                                                ) : (
                                                  <p className="py-4 text-center text-[11px] text-gray-400">
                                                    Delivery orders will
                                                    appear here once the PO
                                                    is processed.
                                                  </p>
                                                )}

                                                {p.poAmount > 0 && (
                                                  <div className="mt-4">
                                                    <SimplifiedIntroCommission
                                                      poAmount={p.poAmount}
                                                      pool={p.pool}
                                                      commission={
                                                        p.netIntroAmt
                                                      }
                                                      tierName={
                                                        p.introTierName
                                                      }
                                                      tierRate={
                                                        p.introTierRate
                                                      }
                                                    />
                                                  </div>
                                                )}

                                                <PayoutTimeline po={p.po} />
                                              </div>
                                            </TableCell>
                                          </TableRow>
                                        )}
                                      </Fragment>
                                    );
                                  })}
                                </TableBody>
                              </Table>
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
                <TableCell className="text-right font-mono text-xs font-medium text-gray-800">
                  {fmt(introData.reduce((s, r) => s + r.monthlyPO, 0))}
                </TableCell>
                <TableCell
                  className={cn(
                    "text-right font-mono text-xs font-medium",
                    totalIntroComm < 0 ? "text-danger-600" : "text-purple-600"
                  )}
                >
                  {fmtSigned(totalIntroComm)}
                </TableCell>
                <TableCell />
              </TableRow>
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
