"use client";

import { useState, useMemo } from "react";
import { cn } from "@/lib/utils";

// Business logic
import {
  INV_TIERS,
  PO_EU_A,
  PO_EU_A_PLUS,
  PO_EU_B,
  PO_EU_C,
  PO_EU_C_EXCLUSIVE,
  PO_INTRO,
  PO_INTRO_EXCLUSIVE,
  PO_INTRO_B,
  GEP_INTRO_B,
  INV_INTRO_TIERS,
  type Tier,
} from "@/lib/business-logic/constants";
import { getTier, getInvIntroTier } from "@/lib/business-logic/tiers";
import { fmt } from "@/lib/business-logic/formatters";

type EUProxyMode = "A" | "A_PLUS" | "B";
type EUGridMode = "A" | "B";
type IntroMode = "A" | "B";

const PUNCHOUT_EU_TABLES: Record<EUProxyMode, Tier[]> = {
  A: PO_EU_A,
  A_PLUS: PO_EU_A_PLUS,
  B: PO_EU_B,
};

const ratesLabel = (tiers: Tier[]) =>
  tiers.map((t) => t.rate).join(" / ") + "%";

// Shared components
import { MetricCard } from "@/components/metric-card";
import { TierCard } from "@/components/tier-card";
import { HealthCheck } from "@/components/health-check";
import { WaterfallTable } from "@/components/waterfall-table";

// UI components
import { Slider } from "@/components/ui/slider";
import { Input } from "@/components/ui/input";

// ── Card chrome (matches MetricCard / player simulator) ────

const CARD =
  "rounded-2xl bg-white p-6 shadow-[0_2px_8px_rgba(0,0,0,0.06),0_1px_3px_rgba(0,0,0,0.04)]";

// ── Segmented control (single toggle pattern) ──────────────

type SegOption<T extends string> = {
  value: T;
  label: string;
  sublabel?: string;
  meta?: string;
  activeText: string;
};

function Segmented<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: SegOption<T>[];
}) {
  return (
    <div className="flex rounded-md border border-gray-200 bg-gray-50 p-0.5">
      {options.map((opt) => {
        const active = value === opt.value;
        return (
          <button
            key={opt.value}
            onClick={() => onChange(opt.value)}
            className={cn(
              "flex-1 rounded px-3 py-1.5 text-center transition-colors",
              active
                ? `bg-white shadow-sm ${opt.activeText}`
                : "text-gray-500 hover:text-gray-700"
            )}
          >
            <span className="block text-xs font-medium">{opt.label}</span>
            {opt.sublabel && (
              <span className="mt-0.5 block text-[9px] font-normal opacity-70">
                {opt.sublabel}
              </span>
            )}
            {opt.meta && (
              <span className="mt-0.5 block text-[9px] font-normal text-gray-500">
                {opt.meta}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

// ── Slider label helper ────────────────────────────────────

function SliderField({
  label,
  rangeLabel,
  value,
  formatValue,
  min,
  max,
  step,
  onChange,
  hint,
  accentClass,
}: {
  label: string;
  rangeLabel: string;
  value: number;
  formatValue: string;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  hint?: string;
  accentClass?: string;
}) {
  return (
    <div className="space-y-2">
      <label className="text-xs font-medium uppercase tracking-wide text-gray-500">
        {label}
      </label>
      <div className="flex items-center justify-between">
        <span className="text-xs text-gray-500">{rangeLabel}</span>
        <span className="font-mono text-sm font-medium text-gray-800">
          {formatValue}
        </span>
      </div>
      <Slider
        min={min}
        max={max}
        step={step}
        value={value}
        onValueChange={(v) => onChange(v as number)}
      />
      {hint && (
        <p
          className={cn(
            "text-center text-[10px] font-medium",
            accentClass ?? "text-brand-600"
          )}
        >
          {hint}
        </p>
      )}
    </div>
  );
}

// ── Pool split bar ─────────────────────────────────────────

function PoolSplitBar({
  segments,
}: {
  segments: { label: string; pct: number; colorClass: string; dotClass: string }[];
}) {
  return (
    <div className="space-y-2">
      <div className="flex h-3.5 gap-0.5 overflow-hidden rounded-full">
        {segments.map((seg) => (
          <div
            key={seg.label}
            className={cn("rounded-full transition-all", seg.colorClass)}
            style={{ width: `${Math.max(seg.pct, 1)}%` }}
          />
        ))}
      </div>
      <div className="flex flex-wrap gap-4 text-xs">
        {segments.map((seg) => (
          <div key={seg.label} className="flex items-center gap-1.5">
            <div className={cn("size-2 rounded-full", seg.dotClass)} />
            <span className="text-gray-600">{seg.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── OPEX input row ─────────────────────────────────────────

function OpexInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-xs font-medium text-gray-600">{label}</span>
      <div className="flex items-center gap-1.5">
        <span className="text-xs text-gray-500">RM</span>
        <Input
          type="number"
          min={0}
          step={100}
          value={value}
          onChange={(e) => onChange(Math.max(0, Number(e.target.value) || 0))}
          className="w-24 text-right font-mono text-sm"
        />
      </div>
    </div>
  );
}

// ── Format tier range (for segmented control meta) ─────────

function rangeMeta(t: Tier): string {
  const fromK = Math.ceil(t.min / 1000);
  if (t.max === Infinity) return `RM ${fromK}K+`;
  const toK = t.max / 1000;
  return t.min === 0 ? `< RM ${toK}K` : `RM ${fromK}K-${toK}K`;
}

// ═══════════════════════════════════════════════════════════
// SIMULATION PAGE
// ═══════════════════════════════════════════════════════════

export default function SimulationPage() {
  // ── State ──────────────────────────────────────────────────

  // Channel
  const [punchoutOn, setPunchoutOn] = useState(true);

  // EU tier modes — independent per channel (DB defaults: Proxy=A, Grid=B)
  const [euTierModeProxy, setEuTierModeProxy] = useState<EUProxyMode>("A");
  const [euTierModeGrid, setEuTierModeGrid] = useState<EUGridMode>("B");

  // Deal variables
  const [monthlyPOVol, setMonthlyPOVol] = useState(100000);
  const [cogsPercent, setCogsPercent] = useState(80);

  // Investor
  const [invTierIdx, setInvTierIdx] = useState(2); // default Gold (5%)

  // End-user network
  const [numEndUsers, setNumEndUsers] = useState(1);

  // EU introducer modes — independent per channel (DB defaults: Proxy=B, Grid=A)
  const [introTierModeProxy, setIntroTierModeProxy] = useState<IntroMode>("B");
  const [introTierModeGrid, setIntroTierModeGrid] = useState<IntroMode>("A");

  // Investor network
  const [numInvestors, setNumInvestors] = useState(1);
  const [avgInvCapital, setAvgInvCapital] = useState(100000);

  // OPEX
  const [opexRental, setOpexRental] = useState(0);
  const [opexSalary, setOpexSalary] = useState(0);
  const [opexUtilities, setOpexUtilities] = useState(0);
  const [opexOthers, setOpexOthers] = useState(2000);

  // ── Derived calculations (same math as prototype Combine) ──

  const calc = useMemo(() => {
    const monthlyOpex = opexRental + opexSalary + opexUtilities + opexOthers;

    // Investor tier
    const invTier = INV_TIERS[invTierIdx];
    const invRate = invTier.rate;

    // EU tier — each channel reads its own mode independently.
    const EU_TIERS: Tier[] = !punchoutOn
      ? euTierModeGrid === "B"
        ? PO_EU_C_EXCLUSIVE
        : PO_EU_C
      : PUNCHOUT_EU_TABLES[euTierModeProxy];
    const euTier = getTier(monthlyPOVol, EU_TIERS);
    const endUserRate = euTier.rate;

    // Total group PO
    const totalGroupPO = monthlyPOVol * numEndUsers;

    // Introducer tier — each channel reads its own mode independently.
    const INTRO_TIERS_PO: Tier[] = punchoutOn
      ? introTierModeProxy === "B"
        ? PO_INTRO_EXCLUSIVE
        : PO_INTRO
      : introTierModeGrid === "B"
        ? GEP_INTRO_B
        : PO_INTRO_B;
    const introTier = getTier(totalGroupPO, INTRO_TIERS_PO);
    const introducerPct = introTier.rate;

    // Investor introducer tier
    const totalInvCapital = avgInvCapital * numInvestors;
    const invIntroTier = getInvIntroTier(totalInvCapital);
    const invIntroPct = invIntroTier.rate;

    // Waterfall math
    const cogs = totalGroupPO * (cogsPercent / 100);
    const grossProfit = totalGroupPO - cogs;
    const punchoutFee = punchoutOn ? totalGroupPO * 0.03 : 0;
    const investorFee = totalGroupPO * (invRate / 100);
    const pool = grossProfit - punchoutFee - investorFee;
    const endUserAmt = pool * (endUserRate / 100);
    const entityGross = pool - endUserAmt;
    const euIntroGross = entityGross * (introducerPct / 100);
    const afterEUIntro = entityGross - euIntroGross;

    // Investor introducer commission
    const capitalAtWork = Math.min(totalInvCapital, totalGroupPO);
    const invActualReturn = capitalAtWork * (invRate / 100);
    const invIntroAmt = invActualReturn * (invIntroPct / 100);

    // Entity net
    const entityBeforeOpex = afterEUIntro - invIntroAmt;
    const entityNet = entityBeforeOpex - monthlyOpex;
    const poolHealthy = pool > 0;

    return {
      monthlyOpex,
      invTier,
      invRate,
      EU_TIERS,
      euTier,
      endUserRate,
      totalGroupPO,
      INTRO_TIERS_PO,
      introTier,
      introducerPct,
      totalInvCapital,
      invIntroTier,
      invIntroPct,
      cogs,
      grossProfit,
      punchoutFee,
      investorFee,
      pool,
      endUserAmt,
      entityGross,
      euIntroGross,
      afterEUIntro,
      capitalAtWork,
      invActualReturn,
      invIntroAmt,
      entityBeforeOpex,
      entityNet,
      poolHealthy,
    };
  }, [
    punchoutOn,
    euTierModeProxy,
    euTierModeGrid,
    monthlyPOVol,
    cogsPercent,
    invTierIdx,
    numEndUsers,
    introTierModeProxy,
    introTierModeGrid,
    numInvestors,
    avgInvCapital,
    opexRental,
    opexSalary,
    opexUtilities,
    opexOthers,
  ]);

  // ── Render ─────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-lg font-medium text-gray-800">Simulation</h1>
        <p className="text-xs text-gray-500">
          Combine calculator — adjust variables to model the profit split
        </p>
      </div>

      {/* Two-column layout */}
      <div className="grid grid-cols-[340px_1fr] gap-6">
        {/* ═══ LEFT PANEL — Controls ═══ */}
        <div className="space-y-4">
          {/* Channel + Player tier system */}
          <div className={cn(CARD, "space-y-6")}>
            <div className="space-y-2">
              <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
                Channel
              </p>
              <Segmented
                value={punchoutOn ? "punchout" : "gep"}
                onChange={(v) => setPunchoutOn(v === "punchout")}
                options={[
                  { value: "punchout", label: "P", activeText: "text-accent-600" },
                  { value: "gep", label: "G", activeText: "text-brand-600" },
                ]}
              />
            </div>

            <div className="space-y-2">
              <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
                Player tier system
              </p>
              {!punchoutOn ? (
                <Segmented
                  value={euTierModeGrid}
                  onChange={setEuTierModeGrid}
                  options={[
                    { value: "A", label: "Default", sublabel: ratesLabel(PO_EU_C), activeText: "text-brand-600" },
                    { value: "B", label: "Exclusive", sublabel: ratesLabel(PO_EU_C_EXCLUSIVE), activeText: "text-brand-600" },
                  ]}
                />
              ) : (
                <Segmented
                  value={euTierModeProxy}
                  onChange={setEuTierModeProxy}
                  options={[
                    { value: "A", label: "Default", sublabel: ratesLabel(PO_EU_A), activeText: "text-brand-600" },
                    { value: "A_PLUS", label: "Premium", sublabel: ratesLabel(PO_EU_A_PLUS), activeText: "text-brand-600" },
                    { value: "B", label: "Exclusive", sublabel: ratesLabel(PO_EU_B), activeText: "text-brand-600" },
                  ]}
                />
              )}
              <TierCard
                tier={calc.euTier}
                tiers={calc.EU_TIERS}
                volume={monthlyPOVol}
                color="brand"
                label="of pool"
                variant="table"
                volumeLabel="Monthly PO"
                showHeader={false}
                className="pt-1"
              />
            </div>
          </div>

          {/* Deal variables */}
          <div className={cn(CARD, "space-y-6")}>
            <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
              Deal variables
            </p>

            <SliderField
              label="Avg monthly PO per player"
              rangeLabel="RM 10K – 300K"
              value={monthlyPOVol}
              formatValue={fmt(monthlyPOVol)}
              min={10000}
              max={300000}
              step={5000}
              onChange={setMonthlyPOVol}
              hint={`${calc.euTier.name} tier (${calc.euTier.rate}%)`}
              accentClass="text-brand-600"
            />

            <SliderField
              label="COGS %"
              rangeLabel="60% – 95%"
              value={cogsPercent}
              formatValue={`${cogsPercent}%`}
              min={60}
              max={95}
              step={1}
              onChange={setCogsPercent}
            />

            <hr className="border-gray-200" />

            {/* Investor tier */}
            <div className="space-y-2">
              <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
                Investor tier (% of PO value)
              </p>
              <Segmented
                value={String(invTierIdx)}
                onChange={(v) => setInvTierIdx(Number(v))}
                options={INV_TIERS.map((t, i) => ({
                  value: String(i),
                  label: t.name,
                  sublabel: `${t.rate}%`,
                  meta: rangeMeta(t),
                  activeText: "text-success-600",
                }))}
              />
              <p className="text-center text-[10px] font-medium text-success-600">
                Investor earns {fmt(calc.investorFee)}/month ({calc.invRate}%
                x {fmt(calc.totalGroupPO)} PO)
              </p>
            </div>

            <hr className="border-gray-200" />

            {/* End-user network */}
            <div className="space-y-2">
              <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
                Player network
              </p>
              <SliderField
                label="Number of players"
                rangeLabel="1 – 10"
                value={numEndUsers}
                formatValue={String(numEndUsers)}
                min={1}
                max={10}
                step={1}
                onChange={setNumEndUsers}
                hint={`${numEndUsers} x ${fmt(monthlyPOVol)} = ${fmt(calc.totalGroupPO)} total group PO`}
                accentClass="text-purple-600"
              />
            </div>

            <hr className="border-gray-200" />

            {/* EU introducer tier */}
            <div className="space-y-2">
              <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
                Player introducer tier (auto from group PO)
              </p>
              {punchoutOn ? (
                <Segmented
                  value={introTierModeProxy}
                  onChange={setIntroTierModeProxy}
                  options={[
                    { value: "A", label: "Default", sublabel: ratesLabel(PO_INTRO), activeText: "text-purple-600" },
                    { value: "B", label: "Exclusive", sublabel: ratesLabel(PO_INTRO_EXCLUSIVE), activeText: "text-purple-600" },
                  ]}
                />
              ) : (
                <Segmented
                  value={introTierModeGrid}
                  onChange={setIntroTierModeGrid}
                  options={[
                    { value: "A", label: "Default", sublabel: ratesLabel(PO_INTRO_B), activeText: "text-purple-600" },
                    { value: "B", label: "Exclusive", sublabel: ratesLabel(GEP_INTRO_B), activeText: "text-purple-600" },
                  ]}
                />
              )}
              <TierCard
                tier={calc.introTier}
                tiers={calc.INTRO_TIERS_PO}
                volume={calc.totalGroupPO}
                color="purple"
                label="of entity's share"
                variant="table"
                volumeLabel="Group PO"
                showHeader={false}
                className="pt-1"
              />
            </div>

            <hr className="border-gray-200" />

            {/* Investor network */}
            <div className="space-y-2">
              <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
                Investor network
              </p>
              <SliderField
                label="Number of investors introduced"
                rangeLabel="1 – 10"
                value={numInvestors}
                formatValue={String(numInvestors)}
                min={1}
                max={10}
                step={1}
                onChange={setNumInvestors}
              />
              <SliderField
                label="Avg capital per investor"
                rangeLabel="RM 5K – 200K"
                value={avgInvCapital}
                formatValue={fmt(avgInvCapital)}
                min={5000}
                max={200000}
                step={5000}
                onChange={setAvgInvCapital}
                hint={`${numInvestors} x ${fmt(avgInvCapital)} = ${fmt(calc.totalInvCapital)} total capital`}
                accentClass="text-amber-600"
              />
            </div>

            <hr className="border-gray-200" />

            {/* Investor introducer tier */}
            <div className="space-y-2">
              <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
                Inv introducer (auto from capital introduced)
              </p>
              <TierCard
                tier={calc.invIntroTier}
                tiers={INV_INTRO_TIERS}
                volume={calc.totalInvCapital}
                color="amber"
                label="of investor return"
                variant="table"
                volumeLabel="Capital introduced"
                showHeader={false}
              />
              <p className="text-center text-[10px] font-medium text-amber-600">
                Earns {fmt(calc.invIntroAmt)}/month ({calc.invIntroPct}% x{" "}
                {fmt(calc.invActualReturn)} investor return)
              </p>
              <p className="text-center text-[9px] text-gray-500">
                Tier from total capital introduced · Paid on{" "}
                {fmt(calc.capitalAtWork)} capital at work
                {calc.totalInvCapital > calc.totalGroupPO
                  ? ` (${fmt(calc.totalInvCapital - calc.totalGroupPO)} idle)`
                  : ""}
              </p>
            </div>

            <hr className="border-gray-200" />

            {/* OPEX */}
            <div className="space-y-3">
              <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
                Monthly OPEX
              </p>
              <OpexInput
                label="Rental"
                value={opexRental}
                onChange={setOpexRental}
              />
              <OpexInput
                label="Salary"
                value={opexSalary}
                onChange={setOpexSalary}
              />
              <OpexInput
                label="Utilities"
                value={opexUtilities}
                onChange={setOpexUtilities}
              />
              <OpexInput
                label="Others"
                value={opexOthers}
                onChange={setOpexOthers}
              />
              <div className="flex items-center justify-between border-t-2 border-gray-200 pt-3">
                <span className="text-xs font-medium text-gray-800">
                  Total OPEX
                </span>
                <span className="font-mono text-sm font-medium text-danger-600">
                  {fmt(calc.monthlyOpex)}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* ═══ RIGHT PANEL — Waterfall Results ═══ */}
        <div className="space-y-4">
          {/* Hero — Entity net */}
          <MetricCard
            label="Entity net (monthly)"
            value={fmt(calc.entityNet)}
            subtitle={`After ${calc.monthlyOpex > 0 ? "OPEX & " : ""}both introducers`}
            color={calc.entityNet < 0 ? "danger" : "success"}
          />

          {/* Monthly waterfall hero */}
          <div className={cn(CARD, "space-y-4")}>
            <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
              Monthly waterfall
            </p>

            {/* Top metrics */}
            <div className="grid grid-cols-2 gap-3">
              <MetricCard
                label="Total group PO"
                value={fmt(calc.totalGroupPO)}
                subtitle={`${numEndUsers} player${numEndUsers > 1 ? "s" : ""} x ${fmt(monthlyPOVol)}`}
              />
              <MetricCard
                label={`COGS (${cogsPercent}%)`}
                value={fmt(calc.cogs)}
              />
            </div>

            {/* Gross profit */}
            <MetricCard
              label="Gross profit"
              value={fmt(calc.grossProfit)}
              color="success"
            />

            {/* Cost deductions */}
            <div className="grid grid-cols-2 gap-3">
              <MetricCard
                label={`P (3%)`}
                value={fmt(calc.punchoutFee)}
                subtitle={
                  punchoutOn
                    ? `3% x ${fmt(calc.totalGroupPO)} PO`
                    : "G — no platform fee"
                }
                color={punchoutOn ? "danger" : "default"}
                className={!punchoutOn ? "opacity-50" : undefined}
              />
              <MetricCard
                label={`Investor (${calc.invRate}%)`}
                value={fmt(calc.investorFee)}
                subtitle={`${calc.invRate}% x ${fmt(calc.totalGroupPO)} PO`}
                color="danger"
              />
            </div>

            {/* Pool */}
            <MetricCard
              label={`Pool (Gross${punchoutOn ? " - P" : ""} - Investor)`}
              value={fmt(calc.pool)}
              subtitle={`Split between player (${calc.endUserRate}%) and entity (${100 - calc.endUserRate}%)`}
              color={calc.pool > 0 ? "accent" : "danger"}
            />

            {!calc.poolHealthy && (
              <HealthCheck entityNet={calc.pool} />
            )}

            {calc.poolHealthy && (
              <>
                {/* Pool split bar */}
                {(() => {
                  const euPct = calc.endUserRate;
                  const euIntroPctBar =
                    (100 - calc.endUserRate) * (calc.introducerPct / 100);
                  const invIntroPctBar =
                    calc.pool > 0
                      ? (calc.invIntroAmt / calc.pool) * 100
                      : 0;
                  const entPctBar =
                    calc.pool > 0
                      ? (Math.max(0, calc.entityNet) / calc.pool) * 100
                      : 0;

                  return (
                    <PoolSplitBar
                      segments={[
                        {
                          label: `Player ${calc.endUserRate}%`,
                          pct: euPct,
                          colorClass: "bg-brand-400",
                          dotClass: "bg-brand-400",
                        },
                        {
                          label: "Player introducer",
                          pct: euIntroPctBar,
                          colorClass: "bg-purple-400",
                          dotClass: "bg-purple-400",
                        },
                        {
                          label: "Inv introducer",
                          pct: invIntroPctBar,
                          colorClass: "bg-amber-400",
                          dotClass: "bg-amber-400",
                        },
                        {
                          label: "Entity",
                          pct: entPctBar,
                          colorClass: "bg-accent-400",
                          dotClass: "bg-accent-400",
                        },
                      ]}
                    />
                  );
                })()}

                {/* Split cards */}
                <div className="grid grid-cols-2 gap-3">
                  <MetricCard
                    label="Player"
                    value={fmt(calc.endUserAmt)}
                    subtitle={`${calc.euTier.name} · ${calc.endUserRate}% of pool`}
                    color="brand"
                  />
                  <MetricCard
                    label="Player introducer"
                    value={fmt(calc.euIntroGross)}
                    subtitle={`${calc.introducerPct}% of entity's share`}
                    color="purple"
                  />
                  <MetricCard
                    label="Inv introducer"
                    value={fmt(calc.invIntroAmt)}
                    subtitle={`${calc.invIntroPct}% x ${fmt(calc.invActualReturn)}`}
                    color="amber"
                  />
                  <MetricCard
                    label="Entity (net)"
                    value={fmt(calc.entityNet)}
                    subtitle={`After both introducers${calc.monthlyOpex > 0 ? " & OPEX" : ""}`}
                    color={calc.entityNet < 0 ? "danger" : "accent"}
                  />
                </div>

                {/* OPEX note */}
                {calc.monthlyOpex > 0 && (
                  <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-2.5 text-xs text-gray-500">
                    Monthly OPEX of{" "}
                    <span className="font-mono font-medium text-gray-800">
                      {fmt(calc.monthlyOpex)}
                    </span>{" "}
                    paid by entity only.
                  </div>
                )}

                {/* Health check */}
                <HealthCheck entityNet={calc.entityNet} />
              </>
            )}
          </div>

          {/* Full waterfall table */}
          <WaterfallTable
            title="Cost vs earnings summary (monthly)"
            className="rounded-2xl p-6 shadow-[0_2px_8px_rgba(0,0,0,0.06),0_1px_3px_rgba(0,0,0,0.04)] ring-0"
            rows={[
              {
                label: `Total group PO (${numEndUsers} Player x ${fmt(monthlyPOVol)})`,
                val: calc.totalGroupPO,
                bold: true,
              },
              {
                label: `COGS (${cogsPercent}%)`,
                val: -calc.cogs,
                color: "danger",
              },
              {
                label: "= Gross profit",
                val: calc.grossProfit,
                bold: true,
              },
              ...(punchoutOn
                ? [
                    {
                      label: "- P (3% of PO)",
                      val: -calc.punchoutFee,
                      color: "danger" as const,
                    },
                  ]
                : []),
              {
                label: `- Investor (${calc.invRate}% of PO)`,
                val: -calc.investorFee,
                color: "danger" as const,
              },
              {
                label: "= Pool (to split)",
                val: calc.pool,
                bold: true,
              },
              {
                label: `- Player (${calc.endUserRate}%)`,
                val: -calc.endUserAmt,
                color: "danger" as const,
              },
              {
                label: "= Entity side",
                val: calc.entityGross,
                bold: true,
              },
              {
                label: `- Player introducer (${calc.introducerPct}%)`,
                val: -calc.euIntroGross,
                color: "danger" as const,
              },
              {
                label: `- Inv introducer (${calc.invIntroPct}% x ${fmt(calc.invActualReturn)})`,
                val: -calc.invIntroAmt,
                color: "danger" as const,
              },
              {
                label: "= Entity before OPEX",
                val: calc.entityBeforeOpex,
              },
              ...(calc.monthlyOpex > 0
                ? [
                    {
                      label: "- OPEX (entity only)",
                      val: -calc.monthlyOpex,
                      color: "danger" as const,
                    },
                  ]
                : []),
              {
                label: "= Entity net",
                val: calc.entityNet,
                color: calc.entityNet < 0 ? ("danger" as const) : undefined,
                bold: true,
              },
            ]}
          />
        </div>
      </div>
    </div>
  );
}
