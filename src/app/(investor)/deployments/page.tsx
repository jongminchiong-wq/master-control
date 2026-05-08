"use client";

import { fmt } from "@/lib/business-logic/formatters";
import { useInvestorPortfolio } from "@/hooks/use-investor-portfolio";
import { CycleStatusBadge } from "@/components/cycle-status-badge";
import { cn } from "@/lib/utils";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";

export default function InvestorDeploymentsPage() {
  const {
    loading,
    errorState,
    myInvestor,
    myDeployments,
    totalDeployed,
    lifetimeDeployed,
    utilisationPct,
  } = useInvestorPortfolio();

  if (loading) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <p className="text-sm text-gray-500">Loading deployments...</p>
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
        <p className="text-sm text-gray-500">Deployments</p>
        <p className="mt-2 font-mono text-3xl font-semibold tracking-tight text-brand-600">
          {fmt(totalDeployed)}
        </p>
        <p className="mt-1 text-xs text-gray-500">
          Currently in live POs &middot; {utilisationPct}% utilised &middot;
          Lifetime {fmt(lifetimeDeployed)} across {myDeployments.length} cycle
          {myDeployments.length !== 1 ? "s" : ""}
        </p>
      </div>

      <div className="rounded-2xl bg-white p-6 shadow-[0_2px_8px_rgba(0,0,0,0.06),0_1px_3px_rgba(0,0,0,0.04)]">
        {myDeployments.length === 0 ? (
          <p className="py-12 text-center text-xs text-gray-500">
            No deployments yet. Browse Funding Opportunities on Home to deploy
            capital.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-[10px]">PO Ref</TableHead>
                <TableHead className="text-[10px]">PO Date</TableHead>
                <TableHead className="text-[10px]">Description</TableHead>
                <TableHead className="text-right text-[10px]">
                  Deployed
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
                  <TableCell className="text-xs text-gray-500">
                    {dep.poDate}
                  </TableCell>
                  <TableCell className="text-xs text-gray-600">
                    {dep.description || "—"}
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs font-medium text-brand-600">
                    {fmt(dep.deployed)}
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
                  {fmt(lifetimeDeployed)}
                </TableCell>
                <TableCell />
              </TableRow>
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  );
}
