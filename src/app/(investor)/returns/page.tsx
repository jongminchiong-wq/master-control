"use client";

import { useState } from "react";
import {
  BarChart3,
  TrendingUp,
  Star,
  Wallet,
  Clock,
  PackageCheck,
  ArrowUpRight,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";

// Business logic
import { INV_TIERS, INV_INTRO_TIERS } from "@/lib/business-logic/constants";
import { getTier, getInvIntroTier } from "@/lib/business-logic/tiers";
import { fmt } from "@/lib/business-logic/formatters";

// Shared components
import { MetricCard } from "@/components/metric-card";
import { TierCard } from "@/components/tier-card";
import { Slider } from "@/components/ui/slider";

// ── Tier icon map ──────────────────────────────────────────

const TIER_ICONS: Record<string, (className: string) => React.ReactNode> = {
  Standard: (className) => <BarChart3 className={className} strokeWidth={1.5} />,
  Silver: (className) => <TrendingUp className={className} strokeWidth={1.5} />,
  Gold: (className) => <Star className={className} strokeWidth={1.5} />,
};

// ── Benchmark investments ──────────────────────────────────

const BENCHMARKS = [
  { name: "Fixed Deposit", rate: 3.5 },
  { name: "ASB", rate: 5.0 },
  { name: "REIT", rate: 6.0 },
  { name: "P2P Lending", rate: 13.0 },
];

// ── Format helpers ─────────────────────────────────────────

function fmtPct(n: number): string {
  return n.toFixed(1) + "%";
}

// ── Page component ─────────────────────────────────────────

export default function InvestorSimulatorPage() {
  // Simulator state
  const [simCapital, setSimCapital] = useState(50000);
  const [simCycleDays, setSimCycleDays] = useState(60);
  const [simRecruits, setSimRecruits] = useState(0);
  const [simRecruitCapital, setSimRecruitCapital] = useState(50000);

  // ── Core calculations ──────────────────────────────────────

  const simTier = getTier(simCapital, INV_TIERS);
  const simTierIdx = INV_TIERS.findIndex((t) => t.name === simTier.name);
  const simNextTier =
    simTierIdx < INV_TIERS.length - 1 ? INV_TIERS[simTierIdx + 1] : null;
  const simTierRemaining = simNextTier
    ? Math.max(0, simNextTier.min - simCapital)
    : 0;
  const rate = simTier.rate;

  const returnPerCycle = simCapital * (rate / 100);
  const cyclesPerYear = 365 / simCycleDays;
  const annualReturn = returnPerCycle * cyclesPerYear;
  const annualPct = rate * cyclesPerYear;
  const monthlyReturn = annualReturn / 12;

  // ── Introducer calculations ────────────────────────────────

  const simTotalIntroCapital = simRecruits * simRecruitCapital;
  const simIntroTier = getInvIntroTier(simTotalIntroCapital);
  const simRecruitTier = getTier(simRecruitCapital, INV_TIERS);
  const simRecruitReturn = simRecruitCapital * (simRecruitTier.rate / 100);
  const simTotalRecruitReturns = simRecruits * simRecruitReturn;
  const introPerYear = simTotalRecruitReturns * cyclesPerYear;
  const simIntroCommAnnual = introPerYear * (simIntroTier.rate / 100);
  const simIntroCommMonthly = simIntroCommAnnual / 12;

  const totalMonthly = monthlyReturn + simIntroCommMonthly;
  const totalAnnual = annualReturn + simIntroCommAnnual;

  // ── Benchmark chart data ───────────────────────────────────

  const allBars = [
    ...BENCHMARKS.map((b) => ({ ...b, isMC: false })),
    { name: "Master Control", rate: annualPct, isMC: true },
  ].sort((a, b) => a.rate - b.rate);
  const maxRate = Math.max(...allBars.map((b) => b.rate), 1);

  return (
    <div className="space-y-6">
      {/* ── Header ──────────────────────────────────────────── */}
      <h1 className="text-base font-medium text-gray-800">
        Return Simulator
      </h1>

      {/* ── Summary MetricCards ─────────────────────────────── */}
      <div
        className={cn(
          "grid gap-3",
          simRecruits > 0 ? "grid-cols-4" : "grid-cols-3"
        )}
      >
        <MetricCard
          label="Annual Return"
          value={fmt(annualReturn)}
          subtitle={`${fmtPct(annualPct)} p.a.`}
          color="brand"
        />
        <MetricCard
          label="Per Cycle"
          value={fmt(returnPerCycle)}
          subtitle={`${rate}% of ${fmt(simCapital)}`}
          color="success"
        />
        <MetricCard
          label="Monthly Average"
          value={fmt(monthlyReturn)}
          subtitle={`${simCycleDays}-day cycles`}
          color="default"
        />
        {simRecruits > 0 && (
          <MetricCard
            label="Intro Commission"
            value={fmt(simIntroCommMonthly)}
            subtitle={`${fmt(simIntroCommAnnual)}/year`}
            color="purple"
          />
        )}
      </div>

      {/* ── Tier context info bar ──────────────────────────── */}
      <div className="rounded-lg border border-gray-200 bg-white px-5 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs text-gray-500">
            {TIER_ICONS[simTier.name]?.("size-3.5 text-brand-600")}
            <span>
              {simTier.name} tier &middot; {rate}% per cycle &middot;{" "}
              {cyclesPerYear.toFixed(1)} cycles/year
            </span>
          </div>
          {simRecruits > 0 && (
            <div className="flex items-center gap-1.5 text-xs text-gray-500">
              <Users className="size-3.5 text-purple-600" strokeWidth={1.5} />
              <span>+ {fmt(simIntroCommAnnual)} introducer/year</span>
            </div>
          )}
        </div>
      </div>

      {/* ── Adjust Inputs ──────────────────────────────────── */}
      <div className="rounded-lg border border-gray-200 bg-white px-5 py-4">
        <p className="mb-4 text-xs font-medium uppercase tracking-wide text-gray-500">
          Adjust Inputs
        </p>

        <div className="space-y-6">
          {/* Capital invested */}
          <div className="space-y-4">
            <p className="text-xs text-gray-500">Capital invested</p>
            <div className="flex flex-wrap items-baseline gap-4">
              <span className="font-mono text-xl font-medium tracking-tight text-brand-600">
                {fmt(simCapital)}
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-gray-200 bg-gray-50 px-3 py-1.5 text-xs font-medium text-gray-600">
                {TIER_ICONS[simTier.name]?.("size-3.5 text-brand-600")}
                {simTier.name}
                <span className="font-mono text-brand-600">{rate}%</span>
              </span>
            </div>
            <Slider
              value={[simCapital]}
              onValueChange={(v) => setSimCapital(Array.isArray(v) ? v[0] : v)}
              min={5000}
              max={500000}
              step={5000}
            />

            {/* Tier pills */}
            <div className="flex gap-2">
              {INV_TIERS.map((t, i) => {
                const active = i === simTierIdx;
                return (
                  <span
                    key={t.name}
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs",
                      active
                        ? "border border-brand-600 bg-brand-50 font-medium text-brand-600"
                        : "border border-gray-200 text-gray-500"
                    )}
                  >
                    {TIER_ICONS[t.name]?.(
                      cn("size-3", active ? "text-brand-600" : "text-gray-500")
                    )}
                    {t.name} &middot; {t.rate}%
                  </span>
                );
              })}
            </div>

            {simNextTier && (
              <p className="flex items-center gap-1 text-xs text-gray-500">
                <span className="font-mono font-medium text-gray-600">
                  {fmt(simTierRemaining)}
                </span>
                <span>more to reach</span>
                {TIER_ICONS[simNextTier.name]?.("size-3 text-gray-500")}
                <span>
                  {simNextTier.name} ({simNextTier.rate}%)
                </span>
              </p>
            )}
          </div>

          {/* PO cycle length */}
          <div className="space-y-3">
            <div className="flex items-baseline justify-between">
              <span className="text-xs text-gray-500">PO cycle length</span>
              <span className="font-mono text-sm font-medium text-gray-800">
                {simCycleDays} days
              </span>
            </div>
            <Slider
              value={[simCycleDays]}
              onValueChange={(v) =>
                setSimCycleDays(Array.isArray(v) ? v[0] : v)
              }
              min={15}
              max={90}
              step={5}
            />
          </div>

          {/* ── Introducer section ────────────────────────────── */}
          <div className="space-y-6 border-t border-gray-200 pt-6">
            <p className="text-xs font-medium uppercase tracking-wide text-purple-600">
              Introduce Other Investors
            </p>

            {/* Number of recruits */}
            <div className="space-y-3">
              <div className="flex items-baseline justify-between">
                <span className="text-xs text-gray-500">
                  Investors I introduce
                </span>
                <span className="font-mono text-sm font-medium text-gray-800">
                  {simRecruits}
                </span>
              </div>
              <Slider
                value={[simRecruits]}
                onValueChange={(v) =>
                  setSimRecruits(Array.isArray(v) ? v[0] : v)
                }
                min={0}
                max={10}
                step={1}
              />
            </div>

            {/* Avg capital per recruit */}
            {simRecruits > 0 && (
              <>
                <div className="space-y-3">
                  <div className="flex items-baseline justify-between">
                    <span className="text-xs text-gray-500">
                      Avg capital per recruit
                    </span>
                    <span className="font-mono text-sm font-medium text-gray-800">
                      {fmt(simRecruitCapital)}
                    </span>
                  </div>
                  <Slider
                    value={[simRecruitCapital]}
                    onValueChange={(v) =>
                      setSimRecruitCapital(Array.isArray(v) ? v[0] : v)
                    }
                    min={5000}
                    max={200000}
                    step={5000}
                  />
                  <p className="text-[11px] text-gray-500">
                    {simRecruits} x {fmt(simRecruitCapital)} ={" "}
                    {fmt(simTotalIntroCapital)} total introduced
                  </p>
                </div>

                {/* Intro tier summary */}
                <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-xs leading-relaxed text-gray-600">
                  Your tier:{" "}
                  <span className="font-mono font-medium text-purple-600">
                    {simIntroTier.name} ({simIntroTier.rate}%)
                  </span>{" "}
                  &mdash; you earn{" "}
                  <span className="font-mono font-medium text-brand-600">
                    {fmt(simIntroCommMonthly)}/month
                  </span>{" "}
                  from your recruits&apos; returns.
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* ── Total monthly earnings (only if recruits > 0) ──── */}
      {simRecruits > 0 && (
        <div className="rounded-lg border border-gray-200 bg-white px-5 py-4">
          <p className="mb-3 text-xs font-medium uppercase tracking-wide text-gray-500">
            Total Estimated Earnings
          </p>
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-2xl bg-white px-5 py-4 shadow-[0_2px_8px_rgba(0,0,0,0.06),0_1px_3px_rgba(0,0,0,0.04)]">
              <p className="text-xs font-medium uppercase tracking-wide text-brand-600">
                Monthly Total
              </p>
              <p className="mt-1.5 font-mono text-lg font-medium text-brand-600">
                {fmt(totalMonthly)}
              </p>
              <p className="mt-1 text-xs text-gray-500">
                {fmt(totalAnnual)}/year
              </p>
            </div>
            <div className="rounded-2xl bg-white px-5 py-4 shadow-[0_2px_8px_rgba(0,0,0,0.06),0_1px_3px_rgba(0,0,0,0.04)]">
              <p className="text-xs font-medium uppercase tracking-wide text-success-600">
                Investment
              </p>
              <p className="mt-1.5 font-mono text-lg font-medium text-success-600">
                {fmt(monthlyReturn)}
              </p>
              <p className="mt-1 text-xs text-gray-500">
                {fmt(annualReturn)}/year
              </p>
            </div>
            <div className="rounded-2xl bg-white px-5 py-4 shadow-[0_2px_8px_rgba(0,0,0,0.06),0_1px_3px_rgba(0,0,0,0.04)]">
              <p className="text-xs font-medium uppercase tracking-wide text-purple-600">
                Introducer
              </p>
              <p className="mt-1.5 font-mono text-lg font-medium text-purple-600">
                {fmt(simIntroCommMonthly)}
              </p>
              <p className="mt-1 text-xs text-gray-500">
                {fmt(simIntroCommAnnual)}/year
              </p>
            </div>
          </div>
        </div>
      )}

      {/* ── Investor Tier ──────────────────────────────────── */}
      <div className="rounded-lg border border-brand-100 bg-white p-5">
        <p className="mb-3 text-xs font-medium uppercase tracking-wide text-brand-600">
          Investor Tier
        </p>
        <TierCard
          tier={simTier}
          tiers={INV_TIERS}
          volume={simCapital}
          color="brand"
          label="per cycle"
        />
      </div>

      {/* Introducer tier (conditional) */}
      {simRecruits > 0 && (
        <div className="rounded-lg border border-purple-100 bg-white p-5">
          <p className="mb-3 text-xs font-medium uppercase tracking-wide text-purple-600">
            Introducer Tier
          </p>
          <TierCard
            tier={simIntroTier}
            tiers={INV_INTRO_TIERS}
            volume={simTotalIntroCapital}
            color="purple"
            label="of investor return"
          />
        </div>
      )}

      {/* ── Comparison chart ─────────────────────────────────── */}
      <div className="rounded-lg border border-gray-200 bg-white p-5 space-y-5">
        <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
          Compared to Malaysian Investments
        </p>

        <div className="space-y-5">
          {allBars.map((bar) => {
            const barW = Math.min((bar.rate / maxRate) * 100, 100);
            return (
              <div key={bar.name}>
                <div className="mb-2 flex items-baseline justify-between">
                  <span
                    className={cn(
                      "text-sm",
                      bar.isMC
                        ? "font-medium text-gray-800"
                        : "text-gray-500"
                    )}
                  >
                    {bar.name}
                  </span>
                  <span
                    className={cn(
                      "font-mono text-sm font-medium",
                      bar.isMC ? "text-brand-600" : "text-gray-600"
                    )}
                  >
                    {fmtPct(bar.rate)}
                  </span>
                </div>
                <div
                  className={cn(
                    "overflow-hidden rounded-sm bg-gray-100",
                    bar.isMC ? "h-2" : "h-0.5"
                  )}
                >
                  <div
                    className={cn(
                      "h-full rounded-sm transition-all duration-500",
                      bar.isMC ? "bg-brand-600" : "bg-gray-300"
                    )}
                    style={{ width: `${barW}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>

        <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm leading-relaxed text-gray-600">
          At a {simCycleDays}-day cycle, Master Control delivers{" "}
          <span className="font-mono font-medium text-brand-600">
            {fmtPct(annualPct)} p.a.
          </span>{" "}
          &#8212;{" "}
          {annualPct > 12
            ? "significantly outperforming"
            : annualPct > 5
              ? "comfortably beating"
              : "competitive with"}{" "}
          most options.
        </div>
      </div>

      {/* ── How one cycle works ──────────────────────────────── */}
      <div className="rounded-lg border border-gray-200 bg-white p-5">
        <p className="mb-4 text-xs font-medium uppercase tracking-wide text-gray-500">
          How One Cycle Works
        </p>

        <div className="divide-y divide-gray-100">
          {[
            {
              icon: (
                <Wallet className="size-4 text-gray-600" strokeWidth={1.5} />
              ),
              label: "You invest",
              sub: `${simTier.name} tier`,
              detail: fmt(simCapital),
              accent: false,
            },
            {
              icon: (
                <Clock className="size-4 text-gray-600" strokeWidth={1.5} />
              ),
              label: "Capital deployed",
              sub: "PO cycle runs",
              detail: `${simCycleDays} days`,
              accent: false,
            },
            {
              icon: (
                <PackageCheck
                  className="size-4 text-gray-600"
                  strokeWidth={1.5}
                />
              ),
              label: "Buyer pays",
              sub: "PO clears",
              detail: "Capital returns",
              accent: false,
            },
            {
              icon: (
                <ArrowUpRight
                  className="size-4 text-brand-600"
                  strokeWidth={1.5}
                />
              ),
              label: "You earn",
              sub: `${rate}% of capital`,
              detail: fmt(returnPerCycle),
              accent: true,
            },
          ].map((step) => (
            <div
              key={step.label}
              className={cn(
                "flex items-center gap-4 px-3 py-3.5",
                step.accent && "rounded-lg bg-brand-50"
              )}
            >
              <div
                className={cn(
                  "flex size-8 shrink-0 items-center justify-center rounded-full",
                  step.accent
                    ? "border border-brand-200 bg-brand-50"
                    : "border border-gray-200 bg-white"
                )}
              >
                {step.accent ? (
                  <ArrowUpRight
                    className="size-4 text-brand-600"
                    strokeWidth={1.5}
                  />
                ) : (
                  step.icon
                )}
              </div>
              <div className="flex-1">
                <p className="text-sm font-medium text-gray-800">
                  {step.label}
                </p>
                <p className="text-[11px] text-gray-500">{step.sub}</p>
              </div>
              <span
                className={cn(
                  "font-mono text-sm font-medium whitespace-nowrap",
                  step.accent ? "text-brand-600" : "text-gray-600"
                )}
              >
                {step.detail}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* ── Footer disclaimer ────────────────────────────────── */}
      <div className="rounded-lg border border-gray-200 bg-gray-50 px-5 py-4">
        <p className="text-[10px] leading-relaxed text-gray-500">
          Returns are estimates based on consistent cycle deployment. Actual
          returns may vary depending on deal availability and PO clearance
          times.
        </p>
      </div>
    </div>
  );
}
