"use client";

import { Fragment, useCallback, useState } from "react";
import { cn } from "@/lib/utils";

import { INV_INTRO_TIERS } from "@/lib/business-logic/constants";
import { fmt } from "@/lib/business-logic/formatters";

import { CycleStatusBadge } from "@/components/cycle-status-badge";
import { useInvestorPortfolio } from "@/hooks/use-investor-portfolio";

import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";

import { ChevronRight } from "lucide-react";

function tierNameByRate(rate: number): string {
  return INV_INTRO_TIERS.find((t) => t.rate === rate)?.name ?? "—";
}

export default function InvestorNetworkPage() {
  const {
    loading,
    errorState,
    myInvestor,
    myRecruits,
    recruitData,
    introTier,
    totalIntroCommEarned,
    totalIntroCommPending,
    totalIntroComm,
    totalCapitalIntroduced,
  } = useInvestorPortfolio();

  const [expandedRecruit, setExpandedRecruit] = useState<string | null>(null);

  const toggleRecruit = useCallback((id: string) => {
    setExpandedRecruit((prev) => (prev === id ? null : id));
  }, []);

  if (loading) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <p className="text-sm text-gray-500">Loading network...</p>
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

  return (
    <div className="space-y-5">
      <div className="px-1 pt-2 pb-1">
        <p className="text-sm text-gray-500">Investors Network</p>
        <p className="mt-2 font-mono text-3xl font-semibold tracking-tight text-gray-900">
          {fmt(totalIntroCommEarned)}
        </p>
        <p className="mt-1 text-xs text-gray-500">
          {myRecruits.length} investor
          {myRecruits.length !== 1 ? "s" : ""} introduced &middot;{" "}
          {fmt(totalCapitalIntroduced)} total capital
        </p>
      </div>

      {myRecruits.length === 0 ? (
        <div className="flex min-h-[300px] items-center justify-center rounded-2xl bg-white p-6 shadow-sm">
          <p className="text-sm text-gray-500">
            You haven&apos;t introduced any investors yet.
          </p>
        </div>
      ) : (
        <div className="rounded-2xl bg-white p-6 shadow-sm">
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
                                  rate. The actual rate is locked when each
                                  PO clears, so a tier change before clear
                                  will adjust the final commission.
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
            Earned = credited to capital from cleared cycles, locked at the
            tier rate that was in effect when the PO cleared. Pending =
            forecast at the current tier rate ({introTier.rate}%) for cycles
            still in flight.
          </p>
        </div>
      )}
    </div>
  );
}
