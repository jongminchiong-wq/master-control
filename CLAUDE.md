@AGENTS.md

# Master Control (Next.js 16 app)

The repo root one level up has the build plan (`../PLAN.md`, historical) and shared instructions (`../CLAUDE.md`). This file covers what's actually built here.

## Critical: Next.js 16 differences

- The middleware file is `src/proxy.ts`, **not** `src/middleware.ts`. The exported function is `proxy`, not `middleware`.
- Tailwind is v4 — CSS-first config in `src/app/globals.css`. There is no `tailwind.config.ts`.
- Always read `node_modules/next/dist/docs/` before using a Next.js API. Training-data assumptions are often wrong here.

## Supabase SSR auth

On the server, always use `supabase.auth.getUser()` to read the current user. Never use `getSession()` — it reads cookies without validating the JWT, so a forged cookie would pass. See `src/proxy.ts` for the canonical setup.

## Commands

All commands run from `master-control/`:

- `npm run dev` — Next dev server
- `npm run build` — production build
- `npm run start` — serve the production build (after `npm run build`)
- `npm run lint` — eslint
- `npm run lint 2>&1 | grep <file>` — filter; pre-existing `react-hooks/set-state-in-effect` warnings exist in several pages. Ignore unless your change introduces a new one.
- `npx tsc --noEmit 2>&1 | grep <file>` — filter; only pre-existing errors are `.ts` import extensions in `business-logic/__tests__/*` (test files run via `tsx`, outside the `next build` graph). Treat anything else as a regression — Vercel `next build` runs full tsc and will block deploy.
- `npx tsx src/lib/business-logic/__tests__/<file>.ts` — run a business-logic test directly (no Jest configured). Available test files: `waterfall.test.ts`, `funding-status.test.ts`, `capital-events.test.ts`, `introducer-credits.test.ts`, `deployment.test.ts`, `reconciliation.ts`.
- `npx tsx --env-file=.env.local src/lib/business-logic/__tests__/reconciliation.ts` — reconciliation reads live Supabase; needs the env-file flag or it errors with "Missing NEXT_PUBLIC_SUPABASE_URL"
- `npx supabase gen types typescript --project-id <id> > src/lib/supabase/types.ts` — regenerate DB types after schema changes
- Supabase MCP tools (when available): `mcp__supabase__apply_migration` for DDL, `mcp__supabase__generate_typescript_types` for type regen, `mcp__supabase__execute_sql` for DML/DQL. Save the migration SQL locally as `src/lib/supabase/migrations/NNN_description.sql` for source tracking.
- `mcp__supabase__list_tables` reports `pg_class.reltuples` (a stale planner estimate). For accurate counts, use `SELECT COUNT(*)`.

## Environment

Create `master-control/.env.local` with:

```
NEXT_PUBLIC_SUPABASE_URL=<supabase project URL>
NEXT_PUBLIC_SUPABASE_ANON_KEY=<supabase anon/publishable key>
```

No `.env.example` is checked in. These two are the only vars the app reads at runtime.

## Routes (live)

- `(admin)/`: `/players`, `/po-cycle`, `/investors`, `/entity`, `/simulation`, `/approvals`
- `(player)/`: `/dashboard`, `/simulator`, `/withdrawals`
- `(investor)/`: `/portfolio`, `/returns`, `/wallet` (note: no `/dashboard`)
- Public: `/login`, `/legal/*`, `/security/*`
- Default redirects from `proxy.ts`: admin → `/players`, investor → `/portfolio`, player → `/dashboard`

Note: `proxy.ts` currently does **not** include `/approvals` in `ADMIN_PATHS` or `/wallet` in `INVESTOR_PATHS`. These routes render but rely on the page itself for auth checks. Add them to `proxy.ts` if you want middleware-level gating.

## Business logic

All in `src/lib/business-logic/`. Beyond the original extract from the prototype, the live app adds:

- `capital-events.ts` — investor capital deposits/withdrawals over time
- `compounding.ts` — return reinvestment
- `commission-status.ts` — derives per-PO commission status (`"cleared" | "payable" | "pending"`) from `commissions_cleared` and DO `buyer_paid` flags
- `constants.ts` — source of truth for all 9 tier tables (`PO_EU_A`/`A_PLUS`/`B`/`C`/`C_EXCLUSIVE`, `PO_INTRO`/`_EXCLUSIVE`/`_B`, `GEP_INTRO_B`), `INV_TIERS`, `INV_INTRO_TIERS`, `INV_RATE` (5%), plus risk-buffer tables (`BUFFER_TABLE`, `URGENCY`, `DELIVERY_MODES`, `RB_PO_TIERS`). Anything tier-related lives here — don't redefine.
- `credit.ts` — credit/risk scoring
- `funding-status.ts` — per-PO funding state
- `risk-buffer.ts` — `calcBufferPct(supplierCost, delivery, urgency)` and the `getRBTierId` / `getDeliveryIdx` helpers it composes
- `deployment.ts` — investor capital allocation across POs (large; the heart of the investor side)

The waterfall formula in `waterfall.ts` is still the locked core — do not change without explicit ask.

`calcPOWaterfall`'s 4th arg (`totalDeployed`) drives `investorFee = deployed × 5%` — this is the B1 fix, pinned by `__tests__/waterfall.test.ts` (T3) and `__tests__/reconciliation.ts`. Do not revert. Three call-site conventions exist by design:
- `credit.ts` and `(admin)/players/page.tsx` (and other player-facing breakdowns) pass `po.po_amount` — funding-timing-agnostic preview that matches what cleared POs eventually pay out.
- `(admin)/entity/page.tsx` `poData` runs **two** waterfall passes per PO: a snapshot pass with month-horizon `funded` (feeds the spread reconciliation panel + deployments table) AND a payable pass with `po_amount` (feeds `payableEuAmt`, `payableIntroAmt`, `payablePlayerLossShare`, `payableIntroducerLossShare` → Commission Payables, `playerPayables`, **and the Monthly P&L card**). The Monthly P&L card is cash-grounded: it uses payable-pass numbers on `fullyPaidPOs` only, and `cashNetProfit ≡ netCash` from the Cash Position card by construction. Don't collapse the two passes — the snapshot pass still drives spread reconciliation.

The **Entity Cash Position card is the source of truth** for cross-card reconciliation on `/entity`. When P&L, Player page, Investor page, and Cash Position appear to disagree on the same month's number, Cash Position wins.

Channel-aware tier lookups go through `lib/business-logic/tiers.ts` (`getEUTiers(player, channel)`, `getIntroTiers(player, channel)`). Pages that import tier tables directly (e.g. `PO_EU_C`) drift when modes are added — route through the helpers. The `PlayerForTier` shape is consumed by 6 DB→waterfall mappers in `app/(admin)/{entity,po-cycle,players}/page.tsx`, `app/(player)/dashboard/page.tsx`, and `__tests__/{waterfall.test.ts,reconciliation.ts}` — keep them in lockstep.

The admin simulator (`app/(admin)/simulation/page.tsx`) and player simulator (`app/(player)/simulator/page.tsx`) both re-derive the player slice without going through `calcPOWaterfall`. Changes to the waterfall must be replayed in both, or they'll silently disagree.

## Database

- Migrations: `src/lib/supabase/migrations/` (apply via Supabase CLI or dashboard)
- Seed data: `src/lib/supabase/seed.sql`
- Generated types: `src/lib/supabase/types.ts` — never hand-edit
- Hand-rolled type aliases (e.g. view rows like `LedgerRow` from `v_investor_ledger`) live in `src/lib/supabase/types-helpers.ts` so they survive `supabase gen types` regen. Three pages import `LedgerRow` from there: `(admin)/investors`, `(investor)/portfolio`, `(investor)/wallet`.
- Row-Level Security on every table; admin = full CRUD, player/investor = read own data only
- Supabase's generated types reject dynamic-key updates: `update({ [field]: value })` triggers `RejectExcessProperties` (TS2345 "type 'string' is not assignable to type 'never'"). Build a typed `TablesUpdate<"...">` object via an explicit switch on the field literal. Example workarounds: `app/(admin)/players/page.tsx` `handleQuickTierUpdate` and `app/(admin)/po-cycle/page.tsx` `handleUpdatePOMeta`.

## UI stack notes

- shadcn/ui components live in `src/components/ui/` — generated, don't hand-edit
- `@base-ui/react` (Radix-style primitives) is also installed; prefer shadcn wrappers when both options exist
- Lucide icons via `lucide-react`
- Fonts: `font-sans` (DM Sans) for text, `font-mono` (IBM Plex Mono) for numbers
- No emoji in UI; no inline styles, no CSS modules — Tailwind utility classes only
- `TierCard` (`src/components/tier-card.tsx`) supports `variant: "bar" | "table"` (default `"bar"`) and `volumeLabel` for the table column header. Only the player simulator passes `variant="table"`; every other usage keeps the progress bar. Adding new tier displays should reuse these props rather than building a parallel component.
- `WaterfallTable` already wraps its own card container (`rounded-xl bg-white p-5 shadow-sm ring-1`). Don't nest it inside another card div — causes a double-card visual (faint inner border, doubled padding).
