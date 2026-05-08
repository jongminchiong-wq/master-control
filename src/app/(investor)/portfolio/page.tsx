"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";

import { INV_TIERS } from "@/lib/business-logic/constants";
import { fmt } from "@/lib/business-logic/formatters";

import { TierCard } from "@/components/tier-card";
import { FundingOpportunities } from "@/components/funding-opportunities";
import { useInvestorPortfolio } from "@/hooks/use-investor-portfolio";

import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";

import { ArrowRight, Clock } from "lucide-react";

export default function InvestorDashboardPage() {
  const {
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
    myTier,
    fundingStatus,
  } = useInvestorPortfolio();

  const [withdrawalsOpen, setWithdrawalsOpen] = useState(false);
  const [ledgerOpen, setLedgerOpen] = useState(false);

  const router = useRouter();
  const goDeposit = useCallback(
    () => router.push("/wallet?deposit=1"),
    [router]
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
      {/* ═══ HERO SECTION (on canvas, no card chrome) ═══ */}
      <div className="px-1 pt-2 pb-1">
        <p className="text-sm text-gray-500">Portfolio Value</p>
        <p className="mt-2 font-mono text-3xl font-semibold tracking-tight text-gray-900">
          {fmt(myInvestor.capital)}
        </p>
        {(totalReturns > 0 || lifetimeDeployed > 0) && (
          <div className="mt-2 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            {totalReturns > 0 ? (
              <p className="font-mono text-sm font-medium text-success-600">
                +{fmt(totalReturns)} total returns earned
              </p>
            ) : (
              <span />
            )}
            {lifetimeDeployed > 0 && (
              <p className="font-mono text-xs text-gray-500">
                Lifetime deployed{" "}
                <span className="font-medium text-gray-700">
                  {fmt(lifetimeDeployed)}
                </span>
                <span className="text-gray-400">
                  {" · "}
                  {myDeployments.length} cycle
                  {myDeployments.length !== 1 ? "s" : ""}
                </span>
              </p>
            )}
          </div>
        )}

        {/* Utilisation bar — all-time snapshot of live capital */}
        {myCapital > 0 && (
          <div className="mt-6">
            <div className="mb-2 flex items-baseline justify-between">
              <span className="text-xs font-medium uppercase tracking-wide text-gray-500">
                Capital utilisation
              </span>
              <span className="font-mono text-xs font-medium text-success-600">
                {utilisationPct}% deployed
              </span>
            </div>
            <div className="flex h-2 gap-0.5 overflow-hidden rounded-md bg-gray-100">
              <div
                className="rounded-md bg-brand-400 transition-all"
                style={{
                  width: `${(totalDeployed / myCapital) * 100}%`,
                }}
              />
              {idle > 0 && (
                <div
                  className="rounded-md bg-gray-200"
                  style={{
                    width: `${(idle / myCapital) * 100}%`,
                  }}
                />
              )}
            </div>
            <div className="mt-2 flex gap-5 text-xs">
              <span className="text-success-600">
                Deployed {fmt(totalDeployed)}
              </span>
              <span className="text-amber-600">Idle {fmt(idle)}</span>
            </div>
          </div>
        )}
      </div>

      {/* ═══ FUNDING OPPORTUNITIES (unfunded POs in pool) ═══ */}
      <FundingOpportunities
        status={fundingStatus}
        investorTierRate={myTier.rate}
        investorTierName={myTier.name}
        idleCapital={idle}
        onFund={goDeposit}
        onTopUp={goDeposit}
      />

      {/* Pending withdrawals notice */}
      {myWithdrawals.some((w) => w.status === "pending") && (
        <button
          type="button"
          onClick={() => setWithdrawalsOpen(true)}
          className="flex w-full items-center justify-between rounded-xl bg-amber-50 px-5 py-3 text-left ring-1 ring-amber-200 transition-colors hover:bg-amber-100/50"
        >
          <div className="flex items-center gap-2">
            <Clock className="size-4 text-amber-600" />
            <p className="text-sm font-medium text-amber-800">
              {myWithdrawals.filter((w) => w.status === "pending").length} withdrawal request{myWithdrawals.filter((w) => w.status === "pending").length > 1 ? "s" : ""} pending approval
            </p>
          </div>
          <ArrowRight className="size-4 text-amber-600" />
        </button>
      )}

      {/* ═══ TIER PROGRESS (on canvas) ═══ */}
      <div className="w-full px-1">
        <div className="mb-4">
          <p className="text-sm font-semibold text-gray-800">Investor Tier</p>
        </div>
        <TierCard
          tier={myTier}
          tiers={INV_TIERS}
          volume={myInvestor.capital}
          color="brand"
          label="per cycle"
        />
      </div>

      {/* ═══ SIMULATOR TEASER ═══ */}
      <div className="rounded-2xl bg-brand-50 px-6 py-5">
        <p className="text-sm font-semibold text-brand-800">
          What if you invested more?
        </p>
        <p className="mt-1 text-xs leading-relaxed text-brand-600">
          Try the simulator to see how different capital amounts and cycle
          lengths affect your returns.
        </p>
        <Link
          href="/returns"
          className="mt-3 inline-flex items-center gap-1.5 text-sm font-semibold text-brand-600 hover:text-brand-800"
        >
          Open Simulator
          <ArrowRight className="size-4" />
        </Link>
      </div>

      {/* Under Option C, withdrawals happen on the Wallet page only
          (capital type, min RM 5,000, admin approval). */}

      {/* ═══ SHEET: CAPITAL HISTORY ═══ */}
      <Sheet open={ledgerOpen} onOpenChange={setLedgerOpen}>
        <SheetContent side="right" className="w-[80vw] sm:max-w-[80vw]">
          <SheetHeader>
            <SheetTitle>Capital History</SheetTitle>
            <SheetDescription>
              Every deposit, withdrawal, return, and adjustment on
              your account, newest first.
            </SheetDescription>
          </SheetHeader>
          <div className="flex-1 overflow-y-auto px-6 pb-6">
            {myLedger.length === 0 ? (
              <p className="py-12 text-center text-xs text-gray-500">
                No movements yet.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-[10px]">Date</TableHead>
                    <TableHead className="text-[10px]">Type</TableHead>
                    <TableHead className="text-right text-[10px]">
                      Amount
                    </TableHead>
                    <TableHead className="text-right text-[10px]">
                      Balance
                    </TableHead>
                    <TableHead className="text-[10px]">Notes</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {myLedger.map((row, i) => {
                    const amount = row.amount ?? 0;
                    const kindLabel: Record<string, string> = {
                      deposit: "Deposit",
                      withdrawal: "Withdrawal",
                      return_credit: "Return",
                      admin_adjustment: "Adjustment",
                      introducer_credit: "Introducer Commission",
                    };
                    const kindColor: Record<string, string> = {
                      deposit: "text-success-600",
                      withdrawal: "text-danger-600",
                      return_credit: "text-accent-600",
                      admin_adjustment: "text-amber-600",
                      introducer_credit: "text-purple-600",
                    };
                    const kind = row.kind ?? "";
                    const amountColor =
                      amount > 0
                        ? "text-success-600"
                        : amount < 0
                          ? "text-danger-600"
                          : "text-gray-400";
                    const dateStr = row.at
                      ? new Date(row.at).toLocaleDateString(undefined, {
                          year: "numeric",
                          month: "short",
                          day: "2-digit",
                        })
                      : "--";
                    return (
                      <TableRow key={`${row.ref}-${i}`}>
                        <TableCell className="text-xs text-gray-600">
                          {dateStr}
                        </TableCell>
                        <TableCell
                          className={cn(
                            "text-xs font-medium",
                            kindColor[kind] ?? "text-gray-500"
                          )}
                        >
                          {kindLabel[kind] ?? kind}
                        </TableCell>
                        <TableCell
                          className={cn(
                            "text-right font-mono text-xs font-medium",
                            amountColor
                          )}
                        >
                          {amount === 0
                            ? "--"
                            : (amount > 0 ? "+" : "") + fmt(amount)}
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs">
                          {row.balance_after !== null
                            ? fmt(row.balance_after)
                            : "--"}
                        </TableCell>
                        <TableCell className="text-xs text-gray-500">
                          {row.notes ?? "--"}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </div>
        </SheetContent>
      </Sheet>

      {/* ═══ SHEET: WITHDRAWAL HISTORY ═══ */}
      <Sheet open={withdrawalsOpen} onOpenChange={setWithdrawalsOpen}>
        <SheetContent side="right" className="w-[80vw] sm:max-w-[80vw]">
          <SheetHeader>
            <SheetTitle>Withdrawal History</SheetTitle>
            <SheetDescription>
              {myWithdrawals.length} request
              {myWithdrawals.length !== 1 ? "s" : ""}
            </SheetDescription>
          </SheetHeader>
          <div className="flex-1 overflow-y-auto px-6 pb-6">
            {myWithdrawals.length === 0 ? (
              <p className="py-12 text-center text-xs text-gray-500">
                No withdrawal requests yet.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-[10px]">Date</TableHead>
                    <TableHead className="text-right text-[10px]">
                      Amount
                    </TableHead>
                    <TableHead className="text-[10px]">Type</TableHead>
                    <TableHead className="text-[10px]">Status</TableHead>
                    <TableHead className="text-[10px]">Notes</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {myWithdrawals.map((w) => {
                    const statusConfig: Record<
                      string,
                      { label: string; bg: string; text: string }
                    > = {
                      pending: {
                        label: "Pending",
                        bg: "bg-amber-50",
                        text: "text-amber-600",
                      },
                      approved: {
                        label: "Approved",
                        bg: "bg-accent-50",
                        text: "text-accent-600",
                      },
                      rejected: {
                        label: "Rejected",
                        bg: "bg-danger-50",
                        text: "text-danger-600",
                      },
                      completed: {
                        label: "Completed",
                        bg: "bg-success-50",
                        text: "text-success-600",
                      },
                    };
                    const sc = statusConfig[w.status] ?? statusConfig.pending;
                    return (
                      <TableRow key={w.id}>
                        <TableCell className="text-xs text-gray-500">
                          {w.requested_at
                            ? new Date(w.requested_at).toLocaleDateString()
                            : "--"}
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs font-medium text-brand-600">
                          {fmt(w.amount)}
                        </TableCell>
                        <TableCell className="text-xs capitalize text-gray-500">
                          {w.type}
                        </TableCell>
                        <TableCell>
                          <span
                            className={cn(
                              "inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-medium",
                              sc.bg,
                              sc.text
                            )}
                          >
                            {sc.label}
                          </span>
                        </TableCell>
                        <TableCell className="text-xs text-gray-500">
                          {w.notes ?? "--"}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </div>
        </SheetContent>
      </Sheet>

    </div>
  );
}
