// creditIntroducerCommissions tests — zero-dep, run with:
//   npx tsx src/lib/business-logic/__tests__/introducer-credits.test.ts
//
// Locks in the screenshot scenario from the user's question:
//   - A introduces B
//   - PRX-001 cleared, B funded RM 10,000 and earned RM 200
//   - A's introducer commission must land at 21% × 200 = RM 42
//
// Plus a couple of guard tests: idempotency via alreadyCredited, no-op for
// investors without an introducer, and the tier-rate snapshot at credit time.

import assert from "node:assert/strict";
import {
  creditIntroducerCommissions,
  type CreditIntroducerCommissionsArgs,
} from "../credit.ts";
import type { CapitalEvent } from "../deployment.ts";

// ── Mock supabase that records every RPC call ──────────────
interface RpcCall {
  fn: string;
  args: Record<string, unknown>;
}

function makeMockSupabase(rpcResponse: { data: unknown; error: null | { message: string } } = { data: { success: true, credit_id: "mock-id", new_capital: 0 }, error: null }) {
  const calls: RpcCall[] = [];
  const supabase = {
    rpc: async (fn: string, args: Record<string, unknown>) => {
      calls.push({ fn, args });
      return rpcResponse;
    },
  };
  return { supabase, calls };
}

// ── Fixtures ──────────────────────────────────────────────
const investorA = {
  id: "A",
  name: "A",
  capital: 10200,
  dateJoined: "2026-02-01",
};
const investorB = {
  id: "B",
  name: "B",
  capital: 10200,
  dateJoined: "2026-02-02",
};

const prx001 = {
  id: "PRX-001",
  ref: "PRX-001",
  poDate: "2026-02-04",
  poAmount: 10000,
  channel: "Proxy",
  // Pass-1 only fills B because A and B both have 10,200 — but the PO is
  // 10k, so each can fund. Fixture matches the screenshot: PO funded equally
  // by A and B from a single 10k slot.
  dos: [{ buyerPaid: "2026-02-05" }],
  commissionsCleared: "2026-02-06",
};

// Capital events: each investor's initial deposit. Without these, the
// allocator's `remaining` seed for B would be 10200, and pass 1 would
// allocate that whole amount to PRX-001 — leaving A unallocated. Since
// the screenshot shows both A and B funding equally, we model two
// 10,000 deposits and let the allocator split.
const capitalEvents: CapitalEvent[] = [
  { investorId: "A", date: "2026-02-01", delta: 10000 },
  { investorId: "A", date: "2026-02-06", delta: 200 }, // return reinvest
  { investorId: "B", date: "2026-02-02", delta: 10000 },
  { investorId: "B", date: "2026-02-06", delta: 200 },
];

const baseArgs: Omit<CreditIntroducerCommissionsArgs, "supabase"> = {
  poId: "PRX-001",
  clearDate: "2026-02-06",
  investors: [investorA, investorB],
  introducedBy: new Map([
    ["A", null],
    ["B", "A"],
  ]),
  capitalById: new Map([
    ["A", 10200],
    ["B", 10200],
  ]),
  poolPOs: [prx001],
  capitalEvents,
};

async function main() {
// ── Test 1: A earns 21% of B's RM 200 ────────────────────
{
  const { supabase, calls } = makeMockSupabase();
  const result = await creditIntroducerCommissions({
    ...baseArgs,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    supabase: supabase as any,
  });

  assert.equal(result.errors.length, 0, "no errors expected");
  assert.equal(calls.length, 1, "exactly one RPC fired (only B has an introducer)");

  const call = calls[0];
  assert.equal(call.fn, "credit_introducer_commission");
  assert.equal(call.args.p_introducer_id, "A");
  assert.equal(call.args.p_introducee_id, "B");
  assert.equal(call.args.p_po_id, "PRX-001");
  assert.equal(call.args.p_tier_rate, 21);
  assert.equal(call.args.p_base_return, 200);
  // 21% of 200 = 42
  assert.equal(call.args.p_amount, 42);
  assert.equal(
    call.args.p_credit_date,
    "2026-02-06T00:00:00Z",
    "credit date is the PO clear date"
  );

  console.log("✓ A earns RM 42 (21% × B's RM 200) when PRX-001 clears");
}

// ── Test 2: alreadyCredited skips the round-trip ────────
{
  const { supabase, calls } = makeMockSupabase();
  const result = await creditIntroducerCommissions({
    ...baseArgs,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    supabase: supabase as any,
    alreadyCredited: new Set(["A:B:PRX-001"]),
  });

  assert.equal(calls.length, 0, "no RPC fired when already-credited");
  assert.equal(result.duplicates, 1, "duplicate was counted");
  console.log("✓ alreadyCredited Set skips the RPC round-trip");
}

// ── Test 3: investors without introducers produce no credits ─
{
  const { supabase, calls } = makeMockSupabase();
  await creditIntroducerCommissions({
    ...baseArgs,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    supabase: supabase as any,
    introducedBy: new Map([
      ["A", null],
      ["B", null], // no introducer this time
    ]),
  });

  assert.equal(calls.length, 0, "no RPC fired when no introducees on the PO");
  console.log("✓ No introducer → no credit (root investors only)");
}

// ── Test 4: tier rate climbs with capital introduced ─────
// At RM 60,000 introduced, A is in Builder tier (24%). 24% of 200 = 48.
{
  const { supabase, calls } = makeMockSupabase();
  await creditIntroducerCommissions({
    ...baseArgs,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    supabase: supabase as any,
    capitalById: new Map([
      ["A", 10200],
      ["B", 60000], // A's only introducee crosses Builder threshold
    ]),
  });

  assert.equal(calls[0].args.p_tier_rate, 24);
  assert.equal(calls[0].args.p_amount, 48);
  console.log("✓ Tier snapshots at credit time (Builder 24% when introducee >= 50k)");
}

// ── Test 5: self-introduction guard ──────────────────────
{
  const { supabase, calls } = makeMockSupabase();
  await creditIntroducerCommissions({
    ...baseArgs,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    supabase: supabase as any,
    introducedBy: new Map([
      ["A", null],
      ["B", "B"], // B introduced themselves — defensive guard
    ]),
  });

  assert.equal(calls.length, 0, "self-introduction is never credited");
  console.log("✓ Self-introduction skipped (introducer == introducee)");
}

console.log("\nAll introducer-credits tests passed.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
