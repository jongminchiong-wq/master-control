@AGENTS.md

# Master Control (Next.js 16 app)

The repo root one level up has the build plan (`../PLAN.md`, historical) and shared instructions (`../CLAUDE.md`). This file covers what's actually built here.

## Critical: Next.js 16 differences

- The middleware file is `src/proxy.ts`, **not** `src/middleware.ts`. The exported function is `proxy`, not `middleware`.
- Tailwind is v4 — CSS-first config in `src/app/globals.css`. There is no `tailwind.config.ts`.
- Always read `node_modules/next/dist/docs/` before using a Next.js API. Training-data assumptions are often wrong here.

## Commands

All commands run from `master-control/`:

- `npm run dev` — Next dev server
- `npm run build` — production build
- `npm run lint` — eslint
- `npx tsx src/lib/business-logic/__tests__/<file>.ts` — run a business-logic test directly (no Jest configured)
- `npx supabase gen types typescript --project-id <id> > src/lib/supabase/types.ts` — regenerate DB types after schema changes

## Routes (live)

- `(admin)/`: `/players`, `/po-cycle`, `/investors`, `/entity`, `/simulation`, `/approvals`
- `(player)/`: `/dashboard`, `/simulator`
- `(investor)/`: `/portfolio`, `/returns`, `/wallet` (note: no `/dashboard`)
- Public: `/login`, `/legal/*`, `/security/*`
- Default redirects from `proxy.ts`: admin → `/players`, investor → `/portfolio`, player → `/dashboard`

## Business logic

All in `src/lib/business-logic/`. Beyond the original extract from the prototype, the live app adds:

- `capital-events.ts` — investor capital deposits/withdrawals over time
- `compounding.ts` — return reinvestment
- `credit.ts` — credit/risk scoring
- `funding-status.ts` — per-PO funding state
- `deployment.ts` — investor capital allocation across POs (large; the heart of the investor side)

The waterfall formula in `waterfall.ts` is still the locked core — do not change without explicit ask.

## Database

- Migrations: `src/lib/supabase/migrations/` (apply via Supabase CLI or dashboard)
- Seed data: `src/lib/supabase/seed.sql`
- One-off SQL fixes: `../sql/` (e.g. `fix-player-rls-recruits.sql`)
- Generated types: `src/lib/supabase/types.ts` — never hand-edit
- Row-Level Security on every table; admin = full CRUD, player/investor = read own data only

## UI stack notes

- shadcn/ui components live in `src/components/ui/` — generated, don't hand-edit
- `@base-ui/react` (Radix-style primitives) is also installed; prefer shadcn wrappers when both options exist
- Lucide icons via `lucide-react`
- Fonts: `font-sans` (DM Sans) for text, `font-mono` (IBM Plex Mono) for numbers
- No emoji in UI; no inline styles, no CSS modules — Tailwind utility classes only
