"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

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
  type APICommissionResponse,
  getDOStatus,
  DOStatusBadge,
  deliveryLabel,
  PayoutTimeline,
  DOProgressBar,
  SimplifiedIntroCommission,
  SimplifiedUplineCommission,
} from "../_shared";
import { usePlayerSelectedMonth } from "../_month-context";

export function IntroducerCommissionClient() {
  const [data, setData] = useState<APICommissionResponse | null>(null);
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
  const [expandedDownlineId, setExpandedDownlineId] = useState<string | null>(
    null
  );
  const [expandedDownlineRecruitId, setExpandedDownlineRecruitId] = useState<
    string | null
  >(null);
  const [expandedDownlineRecruitPOId, setExpandedDownlineRecruitPOId] =
    useState<string | null>(null);

  const now = new Date();
  const currentMonth =
    now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0");
  const [selectedMonth, setSelectedMonth] = usePlayerSelectedMonth();

  const fetchData = useCallback(async () => {
    setLoading(true);
    const res = await fetch("/api/player/commission", { cache: "no-store" });
    if (res.status === 401) {
      setErrorState("not_authenticated");
      setLoading(false);
      return;
    }
    if (res.status === 404) {
      setErrorState("no_player");
      setLoading(false);
      return;
    }
    if (!res.ok) {
      setErrorState("no_player");
      setLoading(false);
      return;
    }
    const json = (await res.json()) as APICommissionResponse;
    setData(json);
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const availableMonths = useMemo(() => {
    const allPOs = data?.pos ?? [];
    const poMonths = allPOs
      .map((p) => getMonth(p.po.po_date))
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
  }, [data, currentMonth]);

  const recruits = data?.recruits ?? [];
  const downlines = data?.downlines ?? [];
  const downlineRecruits = data?.downlineRecruits ?? [];
  const allAPIPOs = data?.pos ?? [];

  const introData = useMemo(() => {
    if (recruits.length === 0) return [];
    return recruits.map((recruit) => {
      const recruitPOs = allAPIPOs.filter(
        (p) =>
          p.po.end_user_id === recruit.id &&
          getMonth(p.po.po_date) === selectedMonth
      );

      const poBreakdown = recruitPOs.map((p) => ({
        id: p.po.id,
        ref: p.po.ref,
        date: p.po.po_date,
        channel: p.po.channel as "punchout" | "gep",
        poAmount: p.po.po_amount,
        netIntroAmt: p.waterfall.introAmt - p.waterfall.introducerLossShare,
        commStatus: getCommissionStatus(p.po),
        po: p.po,
        pool: p.waterfall.pool,
        introTierName: p.waterfall.introTier?.name ?? "Base",
        introTierRate: p.waterfall.introTier?.rate ?? 0,
      }));

      const recruitTotalPO = poBreakdown.reduce((s, p) => s + p.poAmount, 0);
      const recruitIntroComm = poBreakdown.reduce(
        (s, p) => s + p.netIntroAmt,
        0
      );

      const allFullyPaid =
        recruitPOs.length > 0 &&
        recruitPOs.every(
          (p) =>
            p.po.delivery_orders.length > 0 &&
            p.po.delivery_orders.every((d) => d.buyer_paid)
        );
      const allCleared =
        recruitPOs.length > 0 &&
        recruitPOs.every((p) => p.po.commissions_cleared);
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
  }, [recruits, allAPIPOs, selectedMonth]);

  const totalIntroComm = introData.reduce((s, r) => s + r.introComm, 0);
  const totalMonthlyPO = introData.reduce((s, r) => s + r.monthlyPO, 0);
  const clearedIntroComm = introData.reduce(
    (s, r) =>
      s + r.pos.filter((p) => p.commStatus === "cleared").reduce((ss, p) => ss + p.netIntroAmt, 0),
    0
  );
  const pendingIntroComm = totalIntroComm - clearedIntroComm;

  // Downline introducer earnings — for each downline (B), list its recruits
  // (C, D, ...); for each recruit, list their POs in the selected month with
  // this player's upline slice and the data needed for the breakdown panel.
  const downlineData = useMemo(() => {
    if (downlines.length === 0) return [];
    return downlines.map((dl) => {
      const dlRecruits = downlineRecruits.filter(
        (r) => r.downlineId === dl.id
      );
      const recruits = dlRecruits.map((recruit) => {
        const recruitPOs = allAPIPOs.filter(
          (p) =>
            p.po.end_user_id === recruit.id &&
            getMonth(p.po.po_date) === selectedMonth
        );
        const poBreakdown = recruitPOs.map((p) => ({
          id: p.po.id,
          ref: p.po.ref,
          date: p.po.po_date,
          channel: p.po.channel as "punchout" | "gep",
          poAmount: p.po.po_amount,
          netUplineAmt: p.waterfall.uplineAmt - p.waterfall.uplineLossShare,
          commStatus: getCommissionStatus(p.po),
          po: p.po,
          pool: p.waterfall.pool,
          introChunk:
            p.waterfall.introAmt +
            p.waterfall.uplineAmt +
            p.waterfall.introducerLossShare +
            p.waterfall.uplineLossShare,
          directSlice:
            p.waterfall.introAmt - p.waterfall.introducerLossShare,
          directTierName: p.waterfall.introTier?.name ?? "Base",
          directTierRate: p.waterfall.introTier?.rate ?? 0,
        }));

        const recruitMonthlyPO = poBreakdown.reduce(
          (s, p) => s + p.poAmount,
          0
        );
        const recruitUplineComm = poBreakdown.reduce(
          (s, p) => s + p.netUplineAmt,
          0
        );
        const allFullyPaid =
          recruitPOs.length > 0 &&
          recruitPOs.every(
            (p) =>
              p.po.delivery_orders.length > 0 &&
              p.po.delivery_orders.every((d) => d.buyer_paid)
          );
        const allCleared =
          recruitPOs.length > 0 &&
          recruitPOs.every((p) => p.po.commissions_cleared);
        const commStatus: CommStatus = allCleared
          ? "cleared"
          : allFullyPaid
            ? "payable"
            : "pending";

        return {
          id: recruit.id,
          name: recruit.name,
          monthlyPO: recruitMonthlyPO,
          uplineComm: recruitUplineComm,
          commStatus,
          pos: poBreakdown,
        };
      });

      const dlMonthlyPO = recruits.reduce((s, r) => s + r.monthlyPO, 0);
      const dlUplineComm = recruits.reduce((s, r) => s + r.uplineComm, 0);

      const allDownlinePOs = recruits.flatMap((r) => r.pos.map((p) => p.po));
      const dlAllFullyPaid =
        allDownlinePOs.length > 0 &&
        allDownlinePOs.every(
          (po) =>
            po.delivery_orders.length > 0 &&
            po.delivery_orders.every((d) => d.buyer_paid)
        );
      const dlAllCleared =
        allDownlinePOs.length > 0 &&
        allDownlinePOs.every((po) => po.commissions_cleared);
      const dlCommStatus: CommStatus = dlAllCleared
        ? "cleared"
        : dlAllFullyPaid
          ? "payable"
          : "pending";

      return {
        id: dl.id,
        name: dl.name,
        monthlyPO: dlMonthlyPO,
        uplineComm: dlUplineComm,
        commStatus: dlCommStatus,
        recruits,
      };
    });
  }, [downlines, downlineRecruits, allAPIPOs, selectedMonth]);

  const totalUplineComm = downlineData.reduce((s, d) => s + d.uplineComm, 0);
  const totalDownlineMonthlyPO = downlineData.reduce(
    (s, d) => s + d.monthlyPO,
    0
  );
  const clearedUplineComm = downlineData.reduce(
    (s, d) =>
      s +
      d.recruits.reduce(
        (rs, r) =>
          rs +
          r.pos
            .filter((p) => p.commStatus === "cleared")
            .reduce((ps, p) => ps + p.netUplineAmt, 0),
        0
      ),
    0
  );
  const pendingUplineComm = totalUplineComm - clearedUplineComm;

  const totalCommission = totalIntroComm + totalUplineComm;
  const totalCombinedMonthlyPO = totalMonthlyPO + totalDownlineMonthlyPO;
  const clearedCombined = clearedIntroComm + clearedUplineComm;
  const pendingCombined = pendingIntroComm + pendingUplineComm;

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

  if (errorState === "no_player" || !data) {
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
        <p className="mt-2 font-mono text-3xl font-semibold tracking-tight text-gray-900">
          {fmtSigned(totalCommission)}
        </p>
        <p className="mt-2 font-mono text-xs text-gray-500">
          <span className="font-medium text-gray-700">
            {recruits.length} recruit{recruits.length !== 1 ? "s" : ""}
          </span>
          {downlines.length > 0 && (
            <>
              <span className="text-gray-400"> + </span>
              <span className="font-medium text-gray-700">
                {downlines.length} downline{downlines.length !== 1 ? "s" : ""}
              </span>
            </>
          )}
          {totalCombinedMonthlyPO > 0 && (
            <>
              <span className="text-gray-400"> · </span>
              <span className="text-brand-600">
                {fmt(totalCombinedMonthlyPO)} monthly PO
              </span>
            </>
          )}
        </p>
      </div>

      {(recruits.length > 0 || downlines.length > 0) && (
        <div className="grid grid-cols-2 gap-4">
          <MetricCard
            label="Earned"
            value={fmtSigned(clearedCombined)}
            color={clearedCombined < 0 ? "danger" : "success"}
            subtitle="Cleared this month"
          />
          <MetricCard
            label="Pending"
            value={fmt(Math.max(0, pendingCombined))}
            color="amber"
            subtitle="Across active POs"
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

      {downlines.length > 0 && (
        <div className="rounded-2xl bg-white p-6 shadow-[0_2px_8px_rgba(0,0,0,0.06),0_1px_3px_rgba(0,0,0,0.04)]">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-6 pr-0" />
                <TableHead className="text-[10px] uppercase tracking-wide">
                  Downline
                </TableHead>
                <TableHead className="text-right text-[10px] uppercase tracking-wide">
                  Monthly PO
                </TableHead>
                <TableHead className="text-right text-[10px] uppercase tracking-wide">
                  Your Upline Slice
                </TableHead>
                <TableHead className="text-[10px] uppercase tracking-wide">
                  Comm Status
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {downlineData.map((dl) => {
                const isDownlineExpanded = expandedDownlineId === dl.id;
                const hasAnyPO = dl.recruits.some((r) => r.pos.length > 0);
                return (
                  <Fragment key={dl.id}>
                    <TableRow
                      className={cn(
                        "cursor-pointer",
                        isDownlineExpanded && "bg-purple-50/30"
                      )}
                      onClick={() => {
                        setExpandedDownlineId(
                          isDownlineExpanded ? null : dl.id
                        );
                        setExpandedDownlineRecruitId(null);
                        setExpandedDownlineRecruitPOId(null);
                      }}
                    >
                      <TableCell className="w-6 pr-0">
                        {isDownlineExpanded ? (
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
                        {dl.name}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs">
                        {fmt(dl.monthlyPO)}
                      </TableCell>
                      <TableCell
                        className={cn(
                          "text-right font-mono text-xs font-medium",
                          dl.uplineComm < 0
                            ? "text-danger-600"
                            : "text-purple-600"
                        )}
                      >
                        {fmtSigned(dl.uplineComm)}
                      </TableCell>
                      <TableCell>
                        <CommissionStatusBadge status={dl.commStatus} />
                      </TableCell>
                    </TableRow>

                    {isDownlineExpanded && (
                      <TableRow className="hover:bg-transparent">
                        <TableCell
                          colSpan={5}
                          className="border-b border-gray-200 bg-purple-50/15 px-2 pb-4 pt-0"
                        >
                          <div className="rounded-lg border border-purple-100 bg-white p-3">
                            {!hasAnyPO ? (
                              <p className="text-center text-xs text-gray-500">
                                No POs this month
                              </p>
                            ) : (
                              <Table>
                                <TableHeader>
                                  <TableRow>
                                    <TableHead className="w-6 pr-0" />
                                    <TableHead className="text-[10px] uppercase tracking-wide">
                                      Recruit
                                    </TableHead>
                                    <TableHead className="text-right text-[10px] uppercase tracking-wide">
                                      Monthly PO
                                    </TableHead>
                                    <TableHead className="text-right text-[10px] uppercase tracking-wide">
                                      Your Upline Slice
                                    </TableHead>
                                    <TableHead className="text-[10px] uppercase tracking-wide">
                                      Comm Status
                                    </TableHead>
                                  </TableRow>
                                </TableHeader>
                        <TableBody>
                          {dl.recruits.map((r) => {
                            const recruitKey = `${dl.id}_${r.id}`;
                            const isRecruitExpanded =
                              expandedDownlineRecruitId === recruitKey;
                            const hasRecruitPOs = r.pos.length > 0;
                            return (
                              <Fragment key={recruitKey}>
                                <TableRow
                                  className={cn(
                                    hasRecruitPOs && "cursor-pointer",
                                    isRecruitExpanded && "bg-purple-50/30"
                                  )}
                                  onClick={() => {
                                    if (!hasRecruitPOs) return;
                                    setExpandedDownlineRecruitId(
                                      isRecruitExpanded ? null : recruitKey
                                    );
                                    setExpandedDownlineRecruitPOId(null);
                                  }}
                                >
                                  <TableCell className="w-6 pr-0">
                                    {hasRecruitPOs ? (
                                      isRecruitExpanded ? (
                                        <ChevronDown
                                          className="size-3.5 text-gray-500"
                                          strokeWidth={2}
                                        />
                                      ) : (
                                        <ChevronRight
                                          className="size-3.5 text-gray-500"
                                          strokeWidth={2}
                                        />
                                      )
                                    ) : null}
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
                                      r.uplineComm < 0
                                        ? "text-danger-600"
                                        : "text-purple-600"
                                    )}
                                  >
                                    {fmtSigned(r.uplineComm)}
                                  </TableCell>
                                  <TableCell>
                                    {hasRecruitPOs ? (
                                      <CommissionStatusBadge
                                        status={r.commStatus}
                                      />
                                    ) : (
                                      <span className="text-[11px] text-gray-400">
                                        No POs this month
                                      </span>
                                    )}
                                  </TableCell>
                                </TableRow>

                                {isRecruitExpanded && hasRecruitPOs && (
                                  <TableRow className="hover:bg-transparent">
                                    <TableCell
                                      colSpan={5}
                                      className="border-b border-gray-200 bg-purple-50/15 px-2 pb-4 pt-0"
                                    >
                                      <div className="rounded-lg border border-purple-100 bg-white p-3">
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
                                                Your Upline Slice
                                              </TableHead>
                                              <TableHead className="text-[10px] uppercase tracking-wide text-purple-600">
                                                Comm Status
                                              </TableHead>
                                            </TableRow>
                                          </TableHeader>
                                          <TableBody>
                                            {r.pos.map((p) => {
                                              const poKey = `${recruitKey}_${p.id}`;
                                              const isPOExpanded =
                                                expandedDownlineRecruitPOId ===
                                                poKey;
                                              const pDos =
                                                p.po.delivery_orders ?? [];
                                              return (
                                                <Fragment key={poKey}>
                                                  <TableRow
                                                    className={cn(
                                                      "cursor-pointer",
                                                      isPOExpanded &&
                                                        "bg-purple-50/40"
                                                    )}
                                                    onClick={() =>
                                                      setExpandedDownlineRecruitPOId(
                                                        isPOExpanded
                                                          ? null
                                                          : poKey
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
                                                        p.netUplineAmt < 0
                                                          ? "text-danger-600"
                                                          : "text-purple-600"
                                                      )}
                                                    >
                                                      {fmtSigned(
                                                        p.netUplineAmt
                                                      )}
                                                    </TableCell>
                                                    <TableCell>
                                                      <CommissionStatusBadge
                                                        status={p.commStatus}
                                                      />
                                                    </TableCell>
                                                  </TableRow>

                                                  {isPOExpanded && (
                                                    <TableRow
                                                      key={`${poKey}_detail`}
                                                      className="hover:bg-transparent"
                                                    >
                                                      <TableCell
                                                        colSpan={7}
                                                        className="border-b border-purple-100 bg-purple-50/25 px-2 pb-4 pt-0"
                                                      >
                                                        <div className="rounded-lg border border-purple-100 bg-white p-4">
                                                          <DOProgressBar
                                                            dos={pDos}
                                                          />

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
                                                                {pDos.map(
                                                                  (d) => (
                                                                    <TableRow
                                                                      key={
                                                                        d.id
                                                                      }
                                                                    >
                                                                      <TableCell
                                                                        className={cn(
                                                                          "font-mono text-[11px] font-semibold",
                                                                          p.channel ===
                                                                            "gep"
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
                                                                        ] ??
                                                                          d.delivery}
                                                                      </TableCell>
                                                                      <TableCell>
                                                                        <DOStatusBadge
                                                                          status={getDOStatus(
                                                                            d
                                                                          )}
                                                                        />
                                                                      </TableCell>
                                                                    </TableRow>
                                                                  )
                                                                )}
                                                              </TableBody>
                                                            </Table>
                                                          ) : (
                                                            <p className="py-4 text-center text-[11px] text-gray-400">
                                                              Delivery orders
                                                              will appear here
                                                              once the PO is
                                                              processed.
                                                            </p>
                                                          )}

                                                          {p.poAmount > 0 && (
                                                            <div className="mt-4">
                                                              <SimplifiedUplineCommission
                                                                poAmount={
                                                                  p.poAmount
                                                                }
                                                                pool={p.pool}
                                                                introChunk={
                                                                  p.introChunk
                                                                }
                                                                directSlice={
                                                                  p.directSlice
                                                                }
                                                                uplineSlice={
                                                                  p.netUplineAmt
                                                                }
                                                                directTierName={
                                                                  p.directTierName
                                                                }
                                                                directTierRate={
                                                                  p.directTierRate
                                                                }
                                                              />
                                                            </div>
                                                          )}

                                                          <PayoutTimeline
                                                            po={p.po}
                                                          />
                                                        </div>
                                                      </TableCell>
                                                    </TableRow>
                                                  )}
                                                </Fragment>
                                              );
                                            })}
                                          </TableBody>
                                        </Table>
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
                  {fmt(downlineData.reduce((s, d) => s + d.monthlyPO, 0))}
                </TableCell>
                <TableCell
                  className={cn(
                    "text-right font-mono text-xs font-medium",
                    totalUplineComm < 0
                      ? "text-danger-600"
                      : "text-purple-600"
                  )}
                >
                  {fmtSigned(totalUplineComm)}
                </TableCell>
                <TableCell />
              </TableRow>
            </TableBody>
          </Table>

          <p className="mt-4 text-xs text-gray-500">
            You are the upline for {downlines.length} introducer
            {downlines.length !== 1 ? "s" : ""}. When their recruits
            place a PO, you earn the upline slice — the remainder of
            the intro commission after the direct introducer keeps
            their tier rate.
          </p>
        </div>
      )}
    </div>
  );
}
