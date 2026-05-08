"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Tables } from "@/lib/supabase/types";
import { cn } from "@/lib/utils";

import { fmt, fmtMonth, getMonth } from "@/lib/business-logic/formatters";

import { SectionHeader } from "@/components/section-header";
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

type DBPlayer = Tables<"players">;
type DBCommission = Tables<"player_commissions">;
type DBLossDebit = Tables<"player_loss_debits">;
type DBWithdrawal = Tables<"player_withdrawals">;
type DBPOMonth = Pick<Tables<"purchase_orders">, "id" | "po_date">;

type Status = "pending" | "approved" | "paid" | "rejected";

const statusStyles: Record<Status, string> = {
  pending: "bg-amber-50 text-amber-700",
  approved: "bg-accent-50 text-accent-700",
  paid: "bg-success-50 text-success-700",
  rejected: "bg-danger-50 text-danger-700",
};

function StatusPill({ status }: { status: string }) {
  const key = (status as Status) ?? "pending";
  return (
    <span
      className={cn(
        "inline-flex rounded-full px-2 py-0.5 text-xs font-medium",
        statusStyles[key] ?? "bg-gray-100 text-gray-600",
      )}
    >
      {key.charAt(0).toUpperCase() + key.slice(1)}
    </span>
  );
}

const MIN_WITHDRAWAL = 100;
const MIN_BALANCE_RESERVE = 1;

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-MY", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export default function PlayerWithdrawalsPage() {
  const supabase = useMemo(() => createClient(), []);

  const [loading, setLoading] = useState(true);
  const [errorState, setErrorState] = useState<
    "not_authenticated" | "no_player" | null
  >(null);

  const [myPlayer, setMyPlayer] = useState<DBPlayer | null>(null);
  const [commissions, setCommissions] = useState<DBCommission[]>([]);
  const [lossDebits, setLossDebits] = useState<DBLossDebit[]>([]);
  const [withdrawals, setWithdrawals] = useState<DBWithdrawal[]>([]);
  const [pos, setPos] = useState<DBPOMonth[]>([]);

  const [amountInput, setAmountInput] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const [statementOpen, setStatementOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setErrorMsg(null);
    setSuccessMsg(null);

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

    const [commRes, debitRes, wRes] = await Promise.all([
      supabase
        .from("player_commissions")
        .select("*")
        .eq("player_id", playerData.id)
        .order("created_at", { ascending: true }),
      supabase
        .from("player_loss_debits")
        .select("*")
        .eq("player_id", playerData.id)
        .order("cleared_at", { ascending: true }),
      supabase
        .from("player_withdrawals")
        .select("*")
        .eq("player_id", playerData.id)
        .order("requested_at", { ascending: false }),
    ]);

    if (commRes.data) setCommissions(commRes.data);
    if (debitRes.data) setLossDebits(debitRes.data);
    if (wRes.data) setWithdrawals(wRes.data);

    // Fetch the PO month for every PO this player has a ledger row
    // against. Used by monthlyStatement to group by po_date instead of
    // the ledger-row timestamp.
    const poIds = Array.from(
      new Set([
        ...(commRes.data ?? []).map((c) => c.po_id),
        ...(debitRes.data ?? []).map((d) => d.po_id),
      ]),
    );
    if (poIds.length > 0) {
      const { data: poData } = await supabase
        .from("purchase_orders")
        .select("id, po_date")
        .in("id", poIds);
      if (poData) setPos(poData);
    } else {
      setPos([]);
    }

    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Available = unlinked commissions − loss debits − amounts locked in
  // pending/approved withdrawals. Loss debits are a permanent reduction:
  // a player must earn enough commissions to cover their accumulated
  // debits before any new amount becomes withdrawable. Mirrors the SQL
  // in submit_player_withdrawal so client and server agree.
  const {
    availableTotal,
    euTotal,
    introTotal,
    lockedAmount,
    debitTotal,
  } = useMemo(() => {
    const unlinked = commissions.filter((c) => !c.withdrawal_id);
    const eu = unlinked
      .filter((c) => c.type === "eu")
      .reduce((s, c) => s + c.amount, 0);
    const intro = unlinked
      .filter((c) => c.type === "intro")
      .reduce((s, c) => s + c.amount, 0);
    const locked = withdrawals
      .filter((w) => w.status === "pending" || w.status === "approved")
      .reduce((s, w) => s + w.amount, 0);
    const debits = lossDebits.reduce((s, d) => s + d.amount, 0);
    return {
      availableTotal: Math.max(0, eu + intro - debits - locked),
      euTotal: eu,
      introTotal: intro,
      lockedAmount: locked,
      debitTotal: debits,
    };
  }, [commissions, lossDebits, withdrawals]);

  const maxWithdrawable = Math.max(
    0,
    Math.round(availableTotal) - MIN_BALANCE_RESERVE,
  );

  // Outstanding loss carry — what's still owed after offsetting against
  // unlinked commissions. When commissions ≥ debits the carry is zero;
  // otherwise the difference is what the player must earn back before
  // any new withdrawal becomes possible.
  const outstandingCarry = useMemo(
    () => Math.max(0, debitTotal - (euTotal + introTotal)),
    [debitTotal, euTotal, introTotal]
  );

  // Lifetime carry — debits vs. all-time commissions (including those
  // already linked to past withdrawals). Used only for the Loss Share
  // History badge so it shows "Settled" once total earnings have ever
  // covered total debits, matching how the dashboard displayed it.
  const lifetimeCommissions = useMemo(
    () => commissions.reduce((s, c) => s + c.amount, 0),
    [commissions]
  );
  const lifetimeCarry = Math.max(0, debitTotal - lifetimeCommissions);

  // Monthly statement — commissions and debits grouped by the PO's
  // po_date so each row appears under the month of the PO that produced
  // it (matches the dashboard's "My POs this month" attribution).
  // Ledger rows whose PO is not visible in `pos` are dropped.
  const monthlyStatement = useMemo(() => {
    const poMonth = new Map(pos.map((p) => [p.id, getMonth(p.po_date)]));
    const byMonth = new Map<
      string,
      { commissions: number; debits: number }
    >();
    for (const c of commissions) {
      const m = poMonth.get(c.po_id);
      if (!m) continue;
      const row = byMonth.get(m) ?? { commissions: 0, debits: 0 };
      row.commissions += c.amount;
      byMonth.set(m, row);
    }
    for (const d of lossDebits) {
      const m = poMonth.get(d.po_id);
      if (!m) continue;
      const row = byMonth.get(m) ?? { commissions: 0, debits: 0 };
      row.debits += d.amount;
      byMonth.set(m, row);
    }
    return Array.from(byMonth.entries())
      .map(([month, row]) => ({
        month,
        commissions: row.commissions,
        debits: row.debits,
        net: row.commissions - row.debits,
      }))
      .sort((a, b) => (a.month < b.month ? 1 : -1));
  }, [commissions, lossDebits, pos]);

  async function handleSubmit() {
    if (!myPlayer) return;
    setErrorMsg(null);
    setSuccessMsg(null);

    const amount = parseFloat(amountInput);
    if (!Number.isFinite(amount) || amount <= 0) {
      setErrorMsg("Enter a positive amount.");
      return;
    }
    if (amount < MIN_WITHDRAWAL) {
      setErrorMsg(`Minimum withdrawal is RM ${MIN_WITHDRAWAL}.`);
      return;
    }
    if (amount > maxWithdrawable + 0.005) {
      setErrorMsg(
        `Amount exceeds your available balance. RM ${MIN_BALANCE_RESERVE} must remain to keep your account active.`,
      );
      return;
    }

    setSubmitting(true);
    const { data, error } = await supabase.rpc("submit_player_withdrawal", {
      p_player_id: myPlayer.id,
      p_amount: amount,
    });
    setSubmitting(false);

    if (error) {
      setErrorMsg(error.message);
      return;
    }
    const payload = data as { success: boolean; error?: string } | null;
    if (!payload?.success) {
      setErrorMsg(payload?.error ?? "Could not submit request.");
      return;
    }

    setSuccessMsg("Request submitted. Admin will review it shortly.");
    setAmountInput("");
    fetchData();
  }

  if (loading) {
    return <div className="p-6 text-sm text-gray-500">Loading…</div>;
  }

  if (errorState === "no_player" || !myPlayer) {
    return (
      <div className="p-6 text-sm text-gray-500">
        No player record linked to this account.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 py-6">
      <div className="px-1 pt-2 pb-1">
        <p className="text-sm text-gray-500">Withdrawals</p>
        <p className="mt-2 font-mono text-3xl font-semibold tracking-tight text-gray-900">
          {fmt(availableTotal)}
        </p>
        <p className="mt-2 font-mono text-xs text-gray-500">
          {lockedAmount > 0
            ? `${fmt(lockedAmount)} locked in pending requests`
            : debitTotal > 0
              ? `${fmt(debitTotal)} loss share absorbed`
              : "Cleared and ready to request"}
        </p>
      </div>

      {outstandingCarry > 0 && (
        <div className="rounded-lg border border-danger-100 bg-danger-50 p-4">
          <div className="flex items-baseline justify-between">
            <span className="text-xs font-medium text-danger-700">
              Outstanding loss carry
            </span>
            <span className="font-mono text-sm font-semibold text-danger-700">
              {fmt(outstandingCarry)}
            </span>
          </div>
          <p className="mt-1 text-xs text-danger-600">
            Still to be offset by future commissions.
          </p>
        </div>
      )}

      {/* Request form */}
      <div className="rounded-2xl bg-white p-6 shadow-[0_2px_8px_rgba(0,0,0,0.06),0_1px_3px_rgba(0,0,0,0.04)]">
        <h2 className="text-base font-medium text-gray-900">Request a withdrawal</h2>

        {maxWithdrawable < MIN_WITHDRAWAL ? (
          <p className="mt-3 text-sm text-gray-500">
            You need at least RM {MIN_WITHDRAWAL + MIN_BALANCE_RESERVE} cleared
            to request a withdrawal (RM {MIN_BALANCE_RESERVE} is reserved).
            Available: {fmt(availableTotal)}.
          </p>
        ) : (
          <div className="mt-4 flex flex-col gap-3">
            <div className="flex items-end gap-3">
              <div className="flex-1">
                <label className="text-xs font-medium uppercase tracking-wide text-gray-500">
                  Amount (RM)
                </label>
                <Input
                  type="number"
                  inputMode="decimal"
                  min={MIN_WITHDRAWAL}
                  step="0.01"
                  placeholder={String(Math.max(MIN_WITHDRAWAL, maxWithdrawable))}
                  value={amountInput}
                  onChange={(e) => setAmountInput(e.target.value)}
                  className="mt-1 font-mono"
                />
              </div>
              <Button
                type="button"
                variant="outline"
                onClick={() => setAmountInput(String(maxWithdrawable))}
              >
                Max
              </Button>
              <Button
                type="button"
                onClick={handleSubmit}
                disabled={submitting || !amountInput}
              >
                {submitting ? "Submitting…" : "Submit request"}
              </Button>
            </div>
            <p className="text-xs text-gray-500">
              RM {MIN_BALANCE_RESERVE} minimum balance is required to keep your account active.
            </p>
            {errorMsg && (
              <p className="text-sm text-danger-700">{errorMsg}</p>
            )}
            {successMsg && (
              <p className="text-sm text-success-700">{successMsg}</p>
            )}
          </div>
        )}
      </div>

      {/* Loss Share History — only shown if the player has any debit history */}
      {monthlyStatement.length > 0 && debitTotal > 0 && (
        <div className="rounded-lg border border-gray-200 bg-white px-5 py-1">
          <SectionHeader
            title="Loss Share History"
            open={statementOpen}
            onToggle={() => setStatementOpen((o) => !o)}
            badge={
              lifetimeCarry > 0
                ? { label: `Carry ${fmt(lifetimeCarry)}`, color: "danger" }
                : { label: "Settled", color: "success" }
            }
          />
          {statementOpen && (
            <div className="pb-4 pt-1">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-[9px]">Month</TableHead>
                    <TableHead className="text-right text-[9px]">
                      Commissions
                    </TableHead>
                    <TableHead className="text-right text-[9px]">
                      Loss Share
                    </TableHead>
                    <TableHead className="text-right text-[9px]">Net</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {monthlyStatement.map((row) => (
                    <TableRow key={row.month}>
                      <TableCell className="text-xs font-medium text-gray-800">
                        {fmtMonth(row.month)}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs text-brand-600">
                        {fmt(row.commissions)}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs text-danger-600">
                        {row.debits > 0 ? `(${fmt(row.debits)})` : "—"}
                      </TableCell>
                      <TableCell
                        className={cn(
                          "text-right font-mono text-xs font-medium",
                          row.net >= 0 ? "text-success-600" : "text-danger-600"
                        )}
                      >
                        {row.net < 0
                          ? `(${fmt(Math.abs(row.net))})`
                          : fmt(row.net)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <p className="mt-3 text-[10px] text-gray-500">
                Loss share you absorbed on cost-overrun POs, grouped by the
                month they cleared. Any outstanding carry is offset by your
                future commissions before new amounts become withdrawable.
              </p>
            </div>
          )}
        </div>
      )}

      {/* History */}
      <div className="rounded-lg border border-gray-200 bg-white px-5 py-1">
        <SectionHeader
          title="History"
          open={historyOpen}
          onToggle={() => setHistoryOpen((o) => !o)}
          badge={
            withdrawals.length > 0
              ? { label: String(withdrawals.length), color: "brand" }
              : undefined
          }
        />
        {historyOpen && (
          <div className="pb-4 pt-1">
            {withdrawals.length === 0 ? (
              <p className="text-sm text-gray-500">
                No withdrawal requests yet.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Requested</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Paid</TableHead>
                    <TableHead>Admin notes</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {withdrawals.map((w) => (
                    <TableRow key={w.id}>
                      <TableCell className="text-sm text-gray-700">
                        {fmtDate(w.requested_at)}
                      </TableCell>
                      <TableCell className="text-right font-mono text-sm">
                        {fmt(w.amount)}
                      </TableCell>
                      <TableCell>
                        <StatusPill status={w.status} />
                      </TableCell>
                      <TableCell className="text-sm text-gray-700">
                        {fmtDate(w.paid_at)}
                      </TableCell>
                      <TableCell className="max-w-xs truncate text-sm text-gray-500">
                        {w.admin_notes ?? "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
