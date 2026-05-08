"use client";

import { fmt } from "@/lib/business-logic/formatters";
import { useInvestorPortfolio } from "@/hooks/use-investor-portfolio";
import { CycleStatusBadge } from "@/components/cycle-status-badge";
import { MetricCard } from "@/components/metric-card";
import { cn } from "@/lib/utils";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";

export default function InvestorCycleHistoryPage() {
  const {
    loading,
    errorState,
    myInvestor,
    myDeployments,
    totalReturns,
    pendingReturns,
    completedDeps,
    activeDeps,
    lifetimeReturns,
    myTier,
  } = useInvestorPortfolio();

  if (loading) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <p className="text-sm text-gray-500">Loading cycle history...</p>
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
        <p className="text-sm text-gray-500">Cycle History</p>
        <p className="mt-2 font-mono text-3xl font-semibold tracking-tight text-accent-600">
          {fmt(lifetimeReturns)}
        </p>
        <p className="mt-1 text-xs text-gray-500">
          Credited to capital &middot; grows forever &middot; at current{" "}
          {myTier.rate}% tier
        </p>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <MetricCard
          label="Earned"
          value={fmt(totalReturns)}
          subtitle={`${completedDeps.length} cycle${completedDeps.length !== 1 ? "s" : ""}`}
          color="success"
        />
        <MetricCard
          label="Pending"
          value={fmt(pendingReturns)}
          subtitle={`${activeDeps.length} cycle${activeDeps.length !== 1 ? "s" : ""}`}
          color="amber"
        />
        <MetricCard
          label="Combined"
          value={fmt(totalReturns + pendingReturns)}
          subtitle={`at current ${myTier.rate}% tier`}
          color="accent"
        />
      </div>

      <div className="rounded-2xl bg-white p-6 shadow-[0_2px_8px_rgba(0,0,0,0.06),0_1px_3px_rgba(0,0,0,0.04)]">
        {myDeployments.length === 0 ? (
          <p className="py-12 text-center text-xs text-gray-500">
            No cycles yet. Returns appear here when your funded POs clear.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-[10px]">#</TableHead>
                <TableHead className="text-[10px]">PO Ref</TableHead>
                <TableHead className="text-right text-[10px]">Rate</TableHead>
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
    </div>
  );
}
