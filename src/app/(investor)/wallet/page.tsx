"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { Tables } from "@/lib/supabase/types";
import type { LedgerRow } from "@/lib/supabase/types-helpers";
import { cn } from "@/lib/utils";

// Business logic
import { INV_TIERS } from "@/lib/business-logic/constants";
import { getTier } from "@/lib/business-logic/tiers";
import {
  calcSharedDeployments,
  type DeploymentPO,
  type DeploymentInvestor,
} from "@/lib/business-logic/deployment";
import { buildCapitalEvents } from "@/lib/business-logic/capital-events";
import { fmt } from "@/lib/business-logic/formatters";
import { wouldDowngradeTier } from "@/lib/business-logic/compounding";

// UI
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";

import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Clock,
  Coins,
  Droplets,
  Lock,
  TrendingDown,
  type LucideIcon,
} from "lucide-react";

// ── Types ───────────────────────────────────────────────────

type DBInvestor = Tables<"investors">;
type DBWithdrawal = Tables<"withdrawals">;
type DBDepositRequest = Tables<"deposit_requests">;
type DBPO = Tables<"purchase_orders"> & {
  delivery_orders: Tables<"delivery_orders">[];
};
type DBDeposit = Tables<"deposits">;
type DBAdminAdjustment = Tables<"admin_adjustments">;
type DBReturnCredit = Tables<"return_credits">;
type DBIntroducerCredit = Tables<"introducer_credits">;

type DepositMethod = "bank_transfer" | "duitnow" | "other";

const MIN_AMOUNT = 5000;

// ── DB → allocator mappers ──────────────────────────────────

function toDeploymentPO(po: DBPO): DeploymentPO {
  return {
    id: po.id,
    ref: po.ref,
    poDate: po.po_date,
    poAmount: po.po_amount,
    channel: po.channel,
    dos: (po.delivery_orders ?? []).map((d) => ({ buyerPaid: d.buyer_paid })),
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

// ── Ledger row labels / colours ─────────────────────────────

const LEDGER_KIND_LABEL: Record<string, string> = {
  deposit: "Deposit",
  withdrawal: "Withdrawal",
  return_credit: "Return",
  introducer_credit: "Introducer Commission",
  admin_adjustment: "Adjustment",
};

function ledgerKindColor(kind: string, amount: number): string {
  if (kind === "deposit") return "text-success-600";
  if (kind === "withdrawal") return "text-danger-600";
  if (kind === "return_credit") return "text-accent-600";
  if (kind === "introducer_credit") return "text-purple-600";
  if (kind === "admin_adjustment") {
    return amount >= 0 ? "text-success-600" : "text-danger-600";
  }
  return "text-gray-700";
}

// ── Component ───────────────────────────────────────────────

export default function WalletPage() {
  // useSearchParams() inside WalletPageContent triggers Next.js 16's
  // client-side bailout check. Wrapping in Suspense lets the build
  // prerender the shell and hydrate the search-param-dependent logic
  // on the client.
  return (
    <Suspense>
      <WalletPageContent />
    </Suspense>
  );
}

function WalletPageContent() {
  const supabase = useMemo(() => createClient(), []);

  const [loading, setLoading] = useState(true);
  const [errorState, setErrorState] = useState<
    "not_authenticated" | "no_investor" | null
  >(null);

  const [myInvestor, setMyInvestor] = useState<DBInvestor | null>(null);
  const [allInvestors, setAllInvestors] = useState<DBInvestor[]>([]);
  const [allPOs, setAllPOs] = useState<DBPO[]>([]);
  const [myWithdrawals, setMyWithdrawals] = useState<DBWithdrawal[]>([]);
  const [myDepositRequests, setMyDepositRequests] = useState<
    DBDepositRequest[]
  >([]);
  const [myLedger, setMyLedger] = useState<LedgerRow[]>([]);
  const [deposits, setDeposits] = useState<DBDeposit[]>([]);
  const [allWithdrawals, setAllWithdrawals] = useState<DBWithdrawal[]>([]);
  const [adminAdjustments, setAdminAdjustments] = useState<DBAdminAdjustment[]>(
    []
  );
  const [returnCredits, setReturnCredits] = useState<DBReturnCredit[]>([]);
  const [introducerCredits, setIntroducerCredits] = useState<
    DBIntroducerCredit[]
  >([]);

  // Dialog / form state
  const [depositOpen, setDepositOpen] = useState(false);

  // Auto-open the deposit dialog when arriving via ?deposit=1 (e.g. from
  // the Funding Opportunities card on the portfolio page).
  const router = useRouter();
  const searchParams = useSearchParams();
  useEffect(() => {
    if (searchParams.get("deposit") === "1") {
      setDepositOpen(true);
      router.replace("/wallet");
    }
  }, [searchParams, router]);
  const [depositAmount, setDepositAmount] = useState("");
  const [depositMethod, setDepositMethod] =
    useState<DepositMethod>("bank_transfer");
  const [depositReference, setDepositReference] = useState("");
  const [depositNotes, setDepositNotes] = useState("");
  const [submittingDeposit, setSubmittingDeposit] = useState(false);
  const [depositError, setDepositError] = useState<string | null>(null);

  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [submittingWithdraw, setSubmittingWithdraw] = useState(false);
  const [withdrawError, setWithdrawError] = useState<string | null>(null);

  const [filterKind, setFilterKind] = useState<string>("all");

  // ── Fetch ─────────────────────────────────────────────────

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
      depositRequestsRes,
      ledgerRes,
      depositsRes,
      adjustmentsRes,
      returnCreditsRes,
      introducerCreditsRes,
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
      // Pool-wide withdrawals feed the allocator seed (009 adds the RLS
      // policy so investors can read sibling rows).
      supabase
        .from("withdrawals")
        .select("*")
        .order("requested_at", { ascending: true }),
      supabase
        .from("deposit_requests")
        .select("*")
        .eq("investor_id", investorData.id)
        .order("requested_at", { ascending: false }),
      supabase
        .from("v_investor_ledger")
        .select("*")
        .eq("investor_id", investorData.id)
        .order("at", { ascending: false }),
      supabase
        .from("deposits")
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
      // Pool-wide introducer_credits feed the allocator seed for *every*
      // investor — not just me — because the seed is computed across all
      // investors. RLS will mask other investors' rows but those don't
      // touch this user's allocator state.
      supabase
        .from("introducer_credits")
        .select("*")
        .order("created_at", { ascending: true }),
    ]);

    if (investorsRes.data) setAllInvestors(investorsRes.data);
    if (posRes.data) setAllPOs(posRes.data as DBPO[]);
    if (myWithdrawalsRes.data) setMyWithdrawals(myWithdrawalsRes.data);
    if (allWithdrawalsRes.data) setAllWithdrawals(allWithdrawalsRes.data);
    if (depositRequestsRes.data) setMyDepositRequests(depositRequestsRes.data);
    if (ledgerRes.data) setMyLedger(ledgerRes.data);
    if (depositsRes.data) setDeposits(depositsRes.data);
    if (adjustmentsRes.data) setAdminAdjustments(adjustmentsRes.data);
    if (returnCreditsRes.data) setReturnCredits(returnCreditsRes.data);
    if (introducerCreditsRes.data)
      setIntroducerCredits(introducerCreditsRes.data);

    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // ── Allocator (same recipe as Portfolio) ──────────────────

  const deploymentPOs = useMemo(() => allPOs.map(toDeploymentPO), [allPOs]);
  const deploymentInvestors = useMemo(
    () => allInvestors.map(toDeploymentInvestor),
    [allInvestors]
  );
  const capitalEvents = useMemo(
    () =>
      buildCapitalEvents({
        deposits,
        withdrawals: allWithdrawals,
        adminAdjustments,
        returnCredits,
        introducerCredits,
        pos: allPOs,
      }),
    [
      deposits,
      allWithdrawals,
      adminAdjustments,
      returnCredits,
      introducerCredits,
      allPOs,
    ]
  );

  const { remaining } = useMemo(
    () =>
      calcSharedDeployments(
        deploymentPOs,
        deploymentInvestors,
        capitalEvents
      ),
    [deploymentPOs, deploymentInvestors, capitalEvents]
  );

  // ── Derived balances ──────────────────────────────────────

  const capital = myInvestor?.capital ?? 0;
  const rawIdle = useMemo(() => {
    if (!myInvestor) return 0;
    return Math.max(0, remaining[myInvestor.id] ?? capital);
  }, [myInvestor, remaining, capital]);
  const deployed = Math.max(0, capital - rawIdle);

  // Pending capital withdrawals are already debited from `capital`, so
  // they do NOT reduce idle a second time. We still surface them as a
  // visible "in-flight" line so the user knows money is moving.
  const pendingCapitalWithdrawals = useMemo(
    () =>
      myWithdrawals.filter(
        (w) =>
          w.type === "capital" &&
          (w.status === "pending" || w.status === "approved")
      ),
    [myWithdrawals]
  );
  const pendingCapitalWithdrawalTotal = pendingCapitalWithdrawals.reduce(
    (s, w) => s + Number(w.amount),
    0
  );

  const pendingDeposits = useMemo(
    () => myDepositRequests.filter((r) => r.status === "pending"),
    [myDepositRequests]
  );
  const pendingDepositTotal = pendingDeposits.reduce(
    (s, r) => s + Number(r.amount),
    0
  );

  const tier = getTier(capital, INV_TIERS);

  // Client-side tier-downgrade preview for the withdraw form
  const withdrawAmountNum = parseFloat(withdrawAmount) || 0;
  const downgrade = useMemo(
    () => wouldDowngradeTier(capital, withdrawAmountNum),
    [capital, withdrawAmountNum]
  );

  const withdrawableIdle = rawIdle;

  // ── Handlers ──────────────────────────────────────────────

  async function handleSubmitDeposit() {
    if (!myInvestor) return;
    const amount = parseFloat(depositAmount);
    if (!amount || amount < MIN_AMOUNT) {
      setDepositError(`Minimum deposit is RM ${MIN_AMOUNT.toLocaleString()}`);
      return;
    }
    if (!depositReference.trim()) {
      setDepositError("Transfer reference is required");
      return;
    }

    setSubmittingDeposit(true);
    setDepositError(null);

    const { data, error } = await supabase.rpc("submit_deposit_request", {
      p_investor_id: myInvestor.id,
      p_amount: amount,
      p_method: depositMethod,
      p_reference: depositReference.trim(),
      p_notes: depositNotes.trim() || undefined,
    });

    const result = data as { success: boolean; error?: string } | null;
    if (error || !result?.success) {
      setDepositError(error?.message || result?.error || "Submission failed");
      setSubmittingDeposit(false);
      return;
    }

    setSubmittingDeposit(false);
    setDepositOpen(false);
    setDepositAmount("");
    setDepositReference("");
    setDepositNotes("");
    setDepositMethod("bank_transfer");
    fetchData();
  }

  async function handleSubmitWithdraw() {
    if (!myInvestor) return;
    const amount = parseFloat(withdrawAmount);
    if (!amount || amount < MIN_AMOUNT) {
      setWithdrawError(
        `Minimum capital withdrawal is RM ${MIN_AMOUNT.toLocaleString()}`
      );
      return;
    }
    if (amount > withdrawableIdle) {
      setWithdrawError("Amount exceeds your idle capital");
      return;
    }

    setSubmittingWithdraw(true);
    setWithdrawError(null);

    const { data, error } = await supabase.rpc("submit_withdrawal", {
      p_investor_id: myInvestor.id,
      p_amount: amount,
      p_type: "capital",
    });

    const result = data as { success: boolean; error?: string } | null;
    if (error || !result?.success) {
      setWithdrawError(error?.message || result?.error || "Submission failed");
      setSubmittingWithdraw(false);
      return;
    }

    setSubmittingWithdraw(false);
    setWithdrawOpen(false);
    setWithdrawAmount("");
    fetchData();
  }

  // ── Filtered ledger ───────────────────────────────────────

  const filteredLedger = useMemo(() => {
    if (filterKind === "all") return myLedger;
    return myLedger.filter((row) => row.kind === filterKind);
  }, [myLedger, filterKind]);

  // ── Loading / error states ────────────────────────────────

  if (loading) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <p className="text-sm text-gray-500">Loading wallet...</p>
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

  // ── Render ────────────────────────────────────────────────

  return (
    <div className="space-y-5">
      {/* ═══ HERO: BALANCE OVERVIEW ═══ */}
      <div className="rounded-2xl bg-white p-8 shadow-[0_2px_8px_rgba(0,0,0,0.06),0_1px_3px_rgba(0,0,0,0.04)]">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-sm text-gray-500">Wallet</p>
            <p className="mt-2 font-mono text-3xl font-semibold tracking-tight text-gray-900">
              {fmt(capital)}
            </p>
            <p className="mt-1 text-xs text-gray-500">
              Capital
            </p>
          </div>
          <div className="flex gap-2">
            <Button
              className="bg-success-600 text-white hover:bg-success-800"
              onClick={() => {
                setDepositError(null);
                setDepositOpen(true);
              }}
            >
              <ArrowDownToLine className="size-4" strokeWidth={1.6} />
              Deposit
            </Button>
            <Button
              variant="outline"
              className="border-brand-200 text-brand-600 hover:bg-brand-50"
              onClick={() => {
                setWithdrawError(null);
                setWithdrawOpen(true);
              }}
            >
              <ArrowUpFromLine className="size-4" strokeWidth={1.6} />
              Withdraw
            </Button>
          </div>
        </div>

        {/* Utilisation bar */}
        {capital > 0 && (
          <div className="mt-6">
            <div className="mb-2 flex items-baseline justify-between">
              <span className="text-xs font-medium uppercase tracking-wide text-gray-500">
                Capital utilisation
              </span>
              <span className="font-mono text-xs font-medium text-success-600">
                {((deployed / capital) * 100).toFixed(0)}% deployed
              </span>
            </div>
            <div className="flex h-2 gap-0.5 overflow-hidden rounded-md bg-gray-100">
              <div
                className="rounded-md bg-brand-400 transition-all"
                style={{ width: `${(deployed / capital) * 100}%` }}
              />
              {rawIdle > 0 && (
                <div
                  className="rounded-md bg-gray-200"
                  style={{ width: `${(rawIdle / capital) * 100}%` }}
                />
              )}
            </div>
            <div className="mt-2 flex flex-wrap gap-5 text-xs">
              <span className="text-success-600">
                Deployed {fmt(deployed)}
              </span>
              <span className="text-amber-600">Idle {fmt(rawIdle)}</span>
            </div>
          </div>
        )}
      </div>

      {/* ═══ BREAKDOWN CARDS ═══ */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <BalanceCard
          label="Capital"
          value={capital}
          hint={`${tier.name} tier · ${tier.rate}%`}
          color="brand"
          icon={Coins}
        />
        <BalanceCard
          label="Idle"
          value={rawIdle}
          hint="Withdrawable"
          color="amber"
          icon={Droplets}
        />
        <BalanceCard
          label="Deployed"
          value={deployed}
          hint="Locked in live POs"
          color="brand"
          icon={Lock}
        />
      </div>

      {/* ═══ PENDING REQUESTS ═══ */}
      {(pendingDeposits.length > 0 ||
        pendingCapitalWithdrawals.length > 0) && (
        <div className="rounded-2xl bg-white p-6 shadow-[0_2px_8px_rgba(0,0,0,0.06),0_1px_3px_rgba(0,0,0,0.04)]">
          <div className="mb-3 flex items-center gap-2">
            <Clock className="size-4 text-amber-600" strokeWidth={1.6} />
            <h2 className="text-sm font-semibold text-gray-800">
              Pending requests
            </h2>
          </div>

          {pendingDeposits.length > 0 && (
            <div className="mb-4">
              <p className="text-[11px] font-medium uppercase tracking-wide text-gray-500">
                Deposits awaiting confirmation (total{" "}
                <span className="font-mono text-success-600">
                  {fmt(pendingDepositTotal)}
                </span>
                )
              </p>
              <div className="mt-2 space-y-1">
                {pendingDeposits.map((r) => (
                  <div
                    key={r.id}
                    className="flex items-center justify-between rounded-lg border border-gray-100 bg-gray-50 px-3 py-2 text-xs"
                  >
                    <span className="font-mono text-success-600">
                      + {fmt(Number(r.amount))}
                    </span>
                    <span className="text-gray-500">
                      {r.method ?? "—"}
                      {r.reference ? ` · ${r.reference}` : ""}
                    </span>
                    <span className="text-gray-400">
                      {r.requested_at
                        ? new Date(r.requested_at).toLocaleDateString()
                        : ""}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {pendingCapitalWithdrawals.length > 0 && (
            <div>
              <p className="text-[11px] font-medium uppercase tracking-wide text-gray-500">
                Capital withdrawals awaiting payout (total{" "}
                <span className="font-mono text-danger-600">
                  {fmt(pendingCapitalWithdrawalTotal)}
                </span>
                )
              </p>
              <p className="mt-1 text-[11px] text-gray-500">
                Capital already debited. Admin will transfer funds to your
                bank account.
              </p>
              <div className="mt-2 space-y-1">
                {pendingCapitalWithdrawals.map((w) => (
                  <div
                    key={w.id}
                    className="flex items-center justify-between rounded-lg border border-gray-100 bg-gray-50 px-3 py-2 text-xs"
                  >
                    <span className="font-mono text-danger-600">
                      − {fmt(Number(w.amount))}
                    </span>
                    <span className="text-gray-500">
                      Status: {w.status}
                    </span>
                    <span className="text-gray-400">
                      {w.requested_at
                        ? new Date(w.requested_at).toLocaleDateString()
                        : ""}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ═══ TRANSACTION HISTORY ═══ */}
      <div className="rounded-2xl bg-white p-6 shadow-[0_2px_8px_rgba(0,0,0,0.06),0_1px_3px_rgba(0,0,0,0.04)]">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-gray-800">
            Transaction history
          </h2>
          <div className="flex items-center gap-2">
            <label className="text-[11px] text-gray-500">Filter</label>
            <select
              value={filterKind}
              onChange={(e) => setFilterKind(e.target.value)}
              className="h-8 rounded-lg border border-input bg-transparent px-2 text-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <option value="all">All</option>
              <option value="deposit">Deposits</option>
              <option value="withdrawal">Withdrawals</option>
              <option value="return_credit">Returns</option>
              <option value="introducer_credit">Introducer</option>
              <option value="admin_adjustment">Adjustments</option>
            </select>
          </div>
        </div>

        {filteredLedger.length === 0 ? (
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
              {filteredLedger.map((row, i) => {
                const amount = row.amount ?? 0;
                const kind = row.kind ?? "";
                const label = LEDGER_KIND_LABEL[kind] ?? kind;
                const colorClass = ledgerKindColor(kind, amount);
                const prefix =
                  amount > 0 ? "+" : amount < 0 ? "−" : "";
                return (
                  <TableRow key={`${kind}-${row.ref}-${i}`}>
                    <TableCell className="text-xs text-gray-500">
                      {row.at
                        ? new Date(row.at).toLocaleDateString()
                        : "—"}
                    </TableCell>
                    <TableCell className="text-xs">
                      <span
                        className={cn(
                          "inline-block rounded-md px-2 py-0.5 text-[10px] font-medium",
                          kind === "deposit" && "bg-success-50 text-success-800",
                          kind === "withdrawal" && "bg-danger-50 text-danger-800",
                          kind === "return_credit" &&
                            "bg-accent-50 text-accent-800",
                          kind === "admin_adjustment" &&
                            "bg-amber-50 text-amber-800"
                        )}
                      >
                        {label}
                      </span>
                    </TableCell>
                    <TableCell
                      className={cn(
                        "text-right font-mono text-xs font-medium",
                        colorClass
                      )}
                    >
                      {`${prefix} ${fmt(Math.abs(amount))}`}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs text-gray-700">
                      {row.balance_after !== null
                        ? fmt(Number(row.balance_after))
                        : "—"}
                    </TableCell>
                    <TableCell className="max-w-[280px] truncate text-xs text-gray-500">
                      {row.notes ?? ""}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </div>

      {/* ═══ DEPOSIT DIALOG ═══ */}
      <Dialog open={depositOpen} onOpenChange={setDepositOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Request deposit</DialogTitle>
            <DialogDescription>
              Transfer the funds to the platform&apos;s bank account first,
              then submit this form with the reference. Your capital will
              increase after the admin confirms receipt.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-500">
                Amount (RM) — min RM 5,000
              </label>
              <Input
                type="number"
                value={depositAmount}
                onChange={(e) => setDepositAmount(e.target.value)}
                placeholder="e.g. 10000"
                min={MIN_AMOUNT}
                step={1000}
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-500">
                Transfer method
              </label>
              <select
                value={depositMethod}
                onChange={(e) =>
                  setDepositMethod(e.target.value as DepositMethod)
                }
                className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                <option value="bank_transfer">Bank transfer</option>
                <option value="duitnow">DuitNow</option>
                <option value="other">Other</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-500">
                Transfer reference
              </label>
              <Input
                type="text"
                value={depositReference}
                onChange={(e) => setDepositReference(e.target.value)}
                placeholder="e.g. TRX-887 or the last 4 digits of your transfer"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-500">
                Notes (optional)
              </label>
              <Input
                type="text"
                value={depositNotes}
                onChange={(e) => setDepositNotes(e.target.value)}
                placeholder="Anything the admin should know"
              />
            </div>
            {depositError && (
              <p className="text-xs text-danger-600">{depositError}</p>
            )}
          </div>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>
              Cancel
            </DialogClose>
            <Button
              className="bg-success-600 text-white hover:bg-success-800"
              onClick={handleSubmitDeposit}
              disabled={
                submittingDeposit ||
                !depositAmount ||
                parseFloat(depositAmount) < MIN_AMOUNT ||
                !depositReference.trim()
              }
            >
              {submittingDeposit ? "Submitting..." : "Submit request"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ═══ WITHDRAW CAPITAL DIALOG ═══ */}
      <Dialog open={withdrawOpen} onOpenChange={setWithdrawOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Withdraw capital</DialogTitle>
            <DialogDescription>
              Withdraw from your idle capital. Minimum RM 5,000. Your capital
              will be debited immediately, and the admin will transfer funds
              to your bank account after approval.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="rounded-lg bg-gray-50 p-3 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-gray-500">Withdrawable idle</span>
                <span className="font-mono font-medium text-amber-600">
                  {fmt(withdrawableIdle)}
                </span>
              </div>
              <div className="mt-1 flex items-center justify-between">
                <span className="text-gray-500">Current capital</span>
                <span className="font-mono font-medium text-gray-700">
                  {fmt(capital)}
                </span>
              </div>
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-gray-500">
                Amount (RM) — min RM 5,000
              </label>
              <Input
                type="number"
                value={withdrawAmount}
                onChange={(e) => setWithdrawAmount(e.target.value)}
                placeholder={`Max ${fmt(withdrawableIdle)}`}
                min={MIN_AMOUNT}
                max={withdrawableIdle}
                step={1000}
              />
              {withdrawAmountNum > withdrawableIdle && (
                <p className="mt-1 text-xs text-danger-600">
                  Amount exceeds your idle capital
                </p>
              )}
            </div>

            {withdrawAmountNum >= MIN_AMOUNT &&
              withdrawAmountNum <= withdrawableIdle &&
              downgrade.downgrades && (
                <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
                  <TrendingDown
                    className="mt-0.5 size-4 shrink-0"
                    strokeWidth={1.6}
                  />
                  <div>
                    <p className="font-medium">Tier change warning</p>
                    <p className="mt-1">
                      This withdrawal drops you from{" "}
                      <span className="font-mono font-medium">
                        {downgrade.from.name} ({downgrade.from.rate}%)
                      </span>{" "}
                      to{" "}
                      <span className="font-mono font-medium">
                        {downgrade.to.name} ({downgrade.to.rate}%)
                      </span>
                      . Your return rate on future PO cycles will be lower.
                    </p>
                  </div>
                </div>
              )}

            {withdrawError && (
              <p className="text-xs text-danger-600">{withdrawError}</p>
            )}
          </div>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>
              Cancel
            </DialogClose>
            <Button
              className="bg-brand-600 text-white hover:bg-brand-800"
              onClick={handleSubmitWithdraw}
              disabled={
                submittingWithdraw ||
                !withdrawAmount ||
                withdrawAmountNum < MIN_AMOUNT ||
                withdrawAmountNum > withdrawableIdle
              }
            >
              {submittingWithdraw ? "Submitting..." : "Submit request"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── BalanceCard sub-component ───────────────────────────────

type BalanceColor = "brand" | "accent" | "amber" | "success" | "gray";

function BalanceCard({
  label,
  value,
  hint,
  color,
  icon: Icon,
}: {
  label: string;
  value: number;
  hint?: string;
  color: BalanceColor;
  icon: LucideIcon;
}) {
  const colorMap: Record<BalanceColor, string> = {
    brand: "text-brand-600",
    accent: "text-accent-600",
    amber: "text-amber-600",
    success: "text-success-600",
    gray: "text-gray-700",
  };
  const iconBg: Record<BalanceColor, string> = {
    brand: "bg-brand-50 text-brand-600",
    accent: "bg-accent-50 text-accent-600",
    amber: "bg-amber-50 text-amber-600",
    success: "bg-success-50 text-success-600",
    gray: "bg-gray-100 text-gray-600",
  };
  return (
    <div className="rounded-2xl bg-white p-5 shadow-[0_2px_8px_rgba(0,0,0,0.06),0_1px_3px_rgba(0,0,0,0.04)]">
      <div className="flex items-center gap-2">
        <div
          className={cn(
            "flex size-7 items-center justify-center rounded-lg",
            iconBg[color]
          )}
        >
          <Icon className="size-3.5" strokeWidth={1.6} />
        </div>
        <p className="text-[11px] font-medium uppercase tracking-wide text-gray-500">
          {label}
        </p>
      </div>
      <p
        className={cn(
          "mt-3 font-mono text-xl font-semibold",
          colorMap[color]
        )}
      >
        {fmt(value)}
      </p>
      {hint && <p className="mt-1 text-[11px] text-gray-500">{hint}</p>}
    </div>
  );
}
