"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Tables } from "@/lib/supabase/types";
import { cn } from "@/lib/utils";

import { fmt } from "@/lib/business-logic/formatters";

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
  Check,
  X,
  ArrowDownToLine,
  ArrowUpFromLine,
  Inbox,
} from "lucide-react";

// ── Types ───────────────────────────────────────────────────

type DBInvestor = Tables<"investors">;
type DBDepositRequest = Tables<"deposit_requests">;
type DBWithdrawal = Tables<"withdrawals">;

type DepositRow = DBDepositRequest & { investor: DBInvestor | null };
type WithdrawalRow = DBWithdrawal & { investor: DBInvestor | null };

type ActionKind =
  | { kind: "approve_deposit"; row: DepositRow }
  | { kind: "reject_deposit"; row: DepositRow }
  | { kind: "approve_withdrawal"; row: WithdrawalRow }
  | { kind: "reject_withdrawal"; row: WithdrawalRow };

// ── Page ─────────────────────────────────────────────────────

export default function ApprovalsPage() {
  const supabase = useMemo(() => createClient(), []);

  const [loading, setLoading] = useState(true);
  const [pendingDeposits, setPendingDeposits] = useState<DepositRow[]>([]);
  const [pendingWithdrawals, setPendingWithdrawals] = useState<WithdrawalRow[]>(
    []
  );

  const [action, setAction] = useState<ActionKind | null>(null);
  const [notes, setNotes] = useState("");
  const [depositedAt, setDepositedAt] = useState(() => todayIso());
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // ── Fetch ─────────────────────────────────────────────────

  const fetchData = useCallback(async () => {
    setLoading(true);

    const [depositsRes, withdrawalsRes] = await Promise.all([
      supabase
        .from("deposit_requests")
        .select("*, investor:investors(*)")
        .eq("status", "pending")
        .order("requested_at", { ascending: true }),
      supabase
        .from("withdrawals")
        .select("*, investor:investors(*)")
        .eq("status", "pending")
        .order("requested_at", { ascending: true }),
    ]);

    if (depositsRes.data) {
      setPendingDeposits(depositsRes.data as DepositRow[]);
    }
    if (withdrawalsRes.data) {
      setPendingWithdrawals(withdrawalsRes.data as WithdrawalRow[]);
    }

    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // ── Handlers ──────────────────────────────────────────────

  function openAction(next: ActionKind) {
    setAction(next);
    setNotes("");
    setDepositedAt(todayIso());
    setErrorMsg(null);
  }

  async function confirmAction() {
    if (!action) return;
    setSubmitting(true);
    setErrorMsg(null);

    let rpcResult: { data: unknown; error: { message: string } | null };

    if (action.kind === "approve_deposit") {
      rpcResult = await supabase.rpc("approve_deposit_request", {
        p_request_id: action.row.id,
        p_deposited_at: depositedAt,
        p_admin_notes: notes.trim() || undefined,
      });
    } else if (action.kind === "reject_deposit") {
      rpcResult = await supabase.rpc("reject_deposit_request", {
        p_request_id: action.row.id,
        p_admin_notes: notes.trim() || undefined,
      });
    } else if (action.kind === "approve_withdrawal") {
      rpcResult = await supabase.rpc("approve_withdrawal", {
        p_withdrawal_id: action.row.id,
        p_admin_notes: notes.trim() || undefined,
      });
    } else {
      rpcResult = await supabase.rpc("reject_withdrawal", {
        p_withdrawal_id: action.row.id,
        p_admin_notes: notes.trim() || undefined,
      });
    }

    const result = rpcResult.data as
      | { success: boolean; error?: string }
      | null;
    if (rpcResult.error || !result?.success) {
      setErrorMsg(
        rpcResult.error?.message ||
          result?.error ||
          "Action failed — try again or check logs"
      );
      setSubmitting(false);
      return;
    }

    setSubmitting(false);
    setAction(null);
    fetchData();
  }

  // ── Render ────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <p className="text-sm text-gray-500">Loading approvals...</p>
      </div>
    );
  }

  const totalCount = pendingDeposits.length + pendingWithdrawals.length;

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-gray-900">
            Approvals
          </h1>
          <p className="mt-1 text-sm text-gray-500">
            Confirm investor deposits after the money arrives in the bank, and
            mark capital withdrawals completed after you pay out.
          </p>
        </div>
        <div className="rounded-full bg-gray-100 px-3 py-1.5 text-xs font-medium text-gray-700">
          {totalCount} pending
        </div>
      </div>

      {/* Empty state */}
      {totalCount === 0 && (
        <div className="flex flex-col items-center justify-center rounded-2xl bg-white p-12 shadow-[0_2px_8px_rgba(0,0,0,0.06),0_1px_3px_rgba(0,0,0,0.04)]">
          <div className="flex size-12 items-center justify-center rounded-full bg-gray-100">
            <Inbox className="size-6 text-gray-400" strokeWidth={1.6} />
          </div>
          <p className="mt-4 text-sm font-medium text-gray-700">
            Nothing pending
          </p>
          <p className="mt-1 text-xs text-gray-500">
            Deposit requests and capital withdrawals from investors will appear
            here.
          </p>
        </div>
      )}

      {/* Pending Deposits */}
      {pendingDeposits.length > 0 && (
        <section className="rounded-2xl bg-white p-6 shadow-[0_2px_8px_rgba(0,0,0,0.06),0_1px_3px_rgba(0,0,0,0.04)]">
          <div className="mb-4 flex items-center gap-2">
            <div className="flex size-8 items-center justify-center rounded-lg bg-success-50">
              <ArrowDownToLine
                className="size-4 text-success-600"
                strokeWidth={1.6}
              />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-gray-800">
                Deposit requests ({pendingDeposits.length})
              </h2>
              <p className="text-xs text-gray-500">
                Investor transferred money to the platform bank account. Verify
                receipt and approve to credit their capital.
              </p>
            </div>
          </div>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-[10px]">Requested</TableHead>
                <TableHead className="text-[10px]">Investor</TableHead>
                <TableHead className="text-right text-[10px]">Amount</TableHead>
                <TableHead className="text-[10px]">Method</TableHead>
                <TableHead className="text-[10px]">Reference</TableHead>
                <TableHead className="text-[10px]">Notes</TableHead>
                <TableHead className="text-right text-[10px]">
                  Actions
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pendingDeposits.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="text-xs text-gray-500">
                    {row.requested_at
                      ? new Date(row.requested_at).toLocaleDateString()
                      : "—"}
                  </TableCell>
                  <TableCell className="text-xs font-medium text-gray-800">
                    {row.investor?.name ?? "Unknown"}
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs font-medium text-success-600">
                    + {fmt(Number(row.amount))}
                  </TableCell>
                  <TableCell className="text-xs text-gray-600">
                    {row.method ?? "—"}
                  </TableCell>
                  <TableCell className="text-xs text-gray-600">
                    {row.reference ?? "—"}
                  </TableCell>
                  <TableCell className="max-w-[180px] truncate text-xs text-gray-500">
                    {row.notes ?? ""}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="inline-flex gap-2">
                      <Button
                        size="sm"
                        className="bg-success-600 text-white hover:bg-success-800"
                        onClick={() =>
                          openAction({ kind: "approve_deposit", row })
                        }
                      >
                        <Check className="size-3.5" strokeWidth={1.8} />
                        Approve
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="border-danger-200 text-danger-600 hover:bg-danger-50"
                        onClick={() =>
                          openAction({ kind: "reject_deposit", row })
                        }
                      >
                        <X className="size-3.5" strokeWidth={1.8} />
                        Reject
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </section>
      )}

      {/* Pending Withdrawals */}
      {pendingWithdrawals.length > 0 && (
        <section className="rounded-2xl bg-white p-6 shadow-[0_2px_8px_rgba(0,0,0,0.06),0_1px_3px_rgba(0,0,0,0.04)]">
          <div className="mb-4 flex items-center gap-2">
            <div className="flex size-8 items-center justify-center rounded-lg bg-danger-50">
              <ArrowUpFromLine
                className="size-4 text-danger-600"
                strokeWidth={1.6}
              />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-gray-800">
                Withdrawal requests ({pendingWithdrawals.length})
              </h2>
              <p className="text-xs text-gray-500">
                Investor&apos;s balance was already debited at submit time.
                Approve = you&apos;ve sent the bank transfer. Reject = refund
                the debited balance.
              </p>
            </div>
          </div>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-[10px]">Requested</TableHead>
                <TableHead className="text-[10px]">Investor</TableHead>
                <TableHead className="text-right text-[10px]">Amount</TableHead>
                <TableHead className="text-right text-[10px]">
                  Current capital
                </TableHead>
                <TableHead className="text-right text-[10px]">
                  Actions
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pendingWithdrawals.map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="text-xs text-gray-500">
                    {row.requested_at
                      ? new Date(row.requested_at).toLocaleDateString()
                      : "—"}
                  </TableCell>
                  <TableCell className="text-xs font-medium text-gray-800">
                    {row.investor?.name ?? "Unknown"}
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs font-medium text-danger-600">
                    − {fmt(Number(row.amount))}
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs text-gray-700">
                    {row.investor ? fmt(Number(row.investor.capital)) : "—"}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="inline-flex gap-2">
                      <Button
                        size="sm"
                        className="bg-brand-600 text-white hover:bg-brand-800"
                        onClick={() =>
                          openAction({ kind: "approve_withdrawal", row })
                        }
                      >
                        <Check className="size-3.5" strokeWidth={1.8} />
                        Mark paid
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="border-danger-200 text-danger-600 hover:bg-danger-50"
                        onClick={() =>
                          openAction({ kind: "reject_withdrawal", row })
                        }
                      >
                        <X className="size-3.5" strokeWidth={1.8} />
                        Reject &amp; refund
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </section>
      )}

      {/* Confirm dialog */}
      <Dialog
        open={action !== null}
        onOpenChange={(open) => {
          if (!open) setAction(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{actionTitle(action)}</DialogTitle>
            <DialogDescription>{actionDescription(action)}</DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {action && "row" in action && action.row && (
              <div className="rounded-lg bg-gray-50 p-3 text-xs">
                <div className="flex items-center justify-between">
                  <span className="text-gray-500">Investor</span>
                  <span className="font-medium text-gray-800">
                    {"investor" in action.row
                      ? action.row.investor?.name ?? "Unknown"
                      : "Unknown"}
                  </span>
                </div>
                <div className="mt-1 flex items-center justify-between">
                  <span className="text-gray-500">Amount</span>
                  <span
                    className={cn(
                      "font-mono font-medium",
                      action.kind === "approve_deposit" ||
                        action.kind === "reject_deposit"
                        ? "text-success-600"
                        : "text-danger-600"
                    )}
                  >
                    {fmt(Number(action.row.amount))}
                  </span>
                </div>
              </div>
            )}

            {action?.kind === "approve_deposit" && (
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-500">
                  Deposit date (when the money arrived)
                </label>
                <Input
                  type="date"
                  value={depositedAt}
                  onChange={(e) => setDepositedAt(e.target.value)}
                />
              </div>
            )}

            <div>
              <label className="mb-1 block text-xs font-medium text-gray-500">
                Admin note{" "}
                <span className="font-normal text-gray-400">(optional)</span>
              </label>
              <Input
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="e.g. Bank ref TXN-8891"
              />
            </div>

            {errorMsg && <p className="text-xs text-danger-600">{errorMsg}</p>}
          </div>

          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>
              Cancel
            </DialogClose>
            <Button
              className={cn(
                "text-white",
                action?.kind.startsWith("approve")
                  ? "bg-brand-600 hover:bg-brand-800"
                  : "bg-danger-600 hover:bg-danger-800"
              )}
              onClick={confirmAction}
              disabled={submitting}
            >
              {submitting ? "Submitting..." : actionButtonLabel(action)}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── Helpers ─────────────────────────────────────────────────

function todayIso(): string {
  const d = new Date();
  return (
    d.getFullYear() +
    "-" +
    String(d.getMonth() + 1).padStart(2, "0") +
    "-" +
    String(d.getDate()).padStart(2, "0")
  );
}

function actionTitle(action: ActionKind | null): string {
  if (!action) return "";
  if (action.kind === "approve_deposit") return "Approve deposit request";
  if (action.kind === "reject_deposit") return "Reject deposit request";
  if (action.kind === "approve_withdrawal")
    return "Mark withdrawal as paid out";
  return "Reject withdrawal and refund";
}

function actionDescription(action: ActionKind | null): string {
  if (!action) return "";
  if (action.kind === "approve_deposit")
    return "Confirms the transfer arrived. Investor's capital will increase by the deposit amount.";
  if (action.kind === "reject_deposit")
    return "Marks the request rejected. No capital change.";
  if (action.kind === "approve_withdrawal")
    return "Marks the withdrawal completed. Balance was already debited at submission — no further balance change.";
  return "Refunds the debited balance (capital or cash) and marks the withdrawal rejected.";
}

function actionButtonLabel(action: ActionKind | null): string {
  if (!action) return "Confirm";
  if (action.kind === "approve_deposit") return "Approve";
  if (action.kind === "reject_deposit") return "Reject";
  if (action.kind === "approve_withdrawal") return "Mark paid";
  return "Reject & refund";
}
