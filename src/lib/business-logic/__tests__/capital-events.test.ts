// buildCapitalEvents tests — zero-dep, run with:
//   npx tsx src/lib/business-logic/__tests__/capital-events.test.ts
//
// Focus: the Feb-cleared PO + April-dated return_credit scenario that broke
// Total = Deployed + Idle on the admin Investors page. Locks in that the
// capital-event date is sourced from po.commissions_cleared (authoritative)
// rather than rc.created_at (drifts if a row bypasses the 6-arg RPC).

import assert from "node:assert/strict";
import { buildCapitalEvents } from "../capital-events.ts";
import {
  calcSharedDeployments,
  type DeploymentInvestor,
  type DeploymentPO,
} from "../deployment.ts";

// The generated Supabase types are strict; tests build fixtures with only
// the fields buildCapitalEvents actually reads and cast through `unknown`.
// Keeps the test file independent of the auto-generated types file.
type ArgsOf<T> = T extends (args: infer A) => unknown ? A : never;
type Args = ArgsOf<typeof buildCapitalEvents>;
const asArgs = (x: {
  deposits?: unknown[];
  withdrawals?: unknown[];
  adminAdjustments?: unknown[];
  returnCredits: unknown[];
  introducerCredits?: unknown[];
  pos: unknown[];
}): Args =>
  ({
    deposits: x.deposits ?? [],
    withdrawals: x.withdrawals ?? [],
    adminAdjustments: x.adminAdjustments ?? [],
    returnCredits: x.returnCredits,
    introducerCredits: x.introducerCredits ?? [],
    pos: x.pos,
  } as unknown as Args);

// ── Test 1: commissions_cleared overrides a wrong created_at ────────────
// Reproduces the user's screenshot: PO cleared Feb 5, return_credit row
// was written with now() (April) because migration 010 hadn't applied.
// buildCapitalEvents must still date the event Feb 5.

{
  const events = buildCapitalEvents(
    asArgs({
      returnCredits: [
        {
          investor_id: "A",
          po_id: "prx-001",
          amount: 40,
          // Wrong timestamp — pre-010 rows look like this.
          created_at: "2026-04-24T10:30:00+00:00",
        },
      ],
      pos: [
        {
          id: "prx-001",
          commissions_cleared: "2026-02-05",
        },
      ],
    })
  );
  assert.equal(events.length, 1, "expected 1 capital event");
  assert.equal(
    events[0].date,
    "2026-02-05",
    `event date should come from commissions_cleared, got ${events[0].date}`
  );
  console.log("✓ buildCapitalEvents prefers po.commissions_cleared over rc.created_at");
}

// ── Test 2: falls back to created_at when the PO isn't cleared yet ──────
// Shouldn't happen in practice (credit rows only exist once a PO is cleared),
// but defending against partial data.

{
  const events = buildCapitalEvents(
    asArgs({
      returnCredits: [
        {
          investor_id: "A",
          po_id: "prx-002",
          amount: 40,
          created_at: "2026-02-05T00:00:00+00:00",
        },
      ],
      pos: [
        {
          id: "prx-002",
          commissions_cleared: null,
        },
      ],
    })
  );
  assert.equal(events[0].date, "2026-02-05", "fallback to created_at");
  console.log("✓ buildCapitalEvents falls back to created_at when PO uncleared");
}

// ── Test 3: Total = Deployed + Idle for the screenshot scenario ─────────
// End-to-end: feed the bad-timestamp row through buildCapitalEvents, then
// run the allocator for Feb view, and verify the invariant holds.
//
// Scenario: investor A joined Feb 1 with RM 10,000. PRX-001 (RM 1,000)
// dated Feb 2, buyer-paid Feb 4, commissions_cleared Feb 5. The RM 40
// return bumped capital to RM 10,040. return_credits.created_at is stored
// as April 24 (pre-010 state). Feb view must show the 40 as in-horizon.

{
  const investors: DeploymentInvestor[] = [
    { id: "A", name: "A", capital: 10_040, dateJoined: "2026-02-01" },
  ];
  const febPO: DeploymentPO = {
    id: "prx-001",
    ref: "PRX-001",
    poDate: "2026-02-02",
    poAmount: 1000,
    channel: "proxy",
    dos: [{ buyerPaid: "2026-02-04" }],
    commissionsCleared: "2026-02-05",
  };
  const capitalEvents = buildCapitalEvents(
    asArgs({
      returnCredits: [
        {
          investor_id: "A",
          po_id: "prx-001",
          amount: 40,
          created_at: "2026-04-24T10:30:00+00:00",
        },
      ],
      pos: [{ id: "prx-001", commissions_cleared: "2026-02-05" }],
    })
  );

  const { remaining } = calcSharedDeployments(
    [febPO],
    investors,
    capitalEvents,
    "2026-02"
  );

  // Mirror the admin Investors page math:
  //   capitalAtHorizon = inv.capital - sum(events dated > end-of-month)
  //   idle             = max(0, remaining[inv])
  //   deployed         = max(0, capitalAtHorizon - idle)
  //   Invariant        = capitalAtHorizon === idle + deployed
  const endOfHorizon = "2026-02-31";
  const futureDelta = capitalEvents
    .filter((ev) => ev.date > endOfHorizon && ev.investorId === "A")
    .reduce((s, ev) => s + ev.delta, 0);
  const capitalAtHorizon = 10_040 - futureDelta;
  const idle = Math.max(0, remaining.A ?? capitalAtHorizon);
  const deployed = Math.max(0, capitalAtHorizon - idle);

  assert.equal(
    capitalAtHorizon,
    10_040,
    `capitalAtHorizon should be 10,040 (reinvest is in-horizon), got ${capitalAtHorizon}`
  );
  assert.equal(idle, 10_040, `idle should be 10,040, got ${idle}`);
  assert.equal(deployed, 0, `deployed should be 0, got ${deployed}`);
  assert.equal(
    capitalAtHorizon,
    idle + deployed,
    "invariant Total = Deployed + Idle must hold for Feb horizon"
  );
  console.log("✓ Total = Deployed + Idle holds for the screenshot scenario");
}

console.log("\nAll capital-events tests passed.");
