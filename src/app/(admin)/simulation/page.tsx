"use client";

import { useState, useMemo } from "react";
import { cn } from "@/lib/utils";

// Business logic
import {
  INV_RATE,
  INV_TIERS,
  PO_EU_A,
  PO_EU_B,
  PO_EU_C,
  PO_INTRO,
  PO_INTRO_B,
  GEP_INTRO_B,
  INV_INTRO_TIERS,
  type Tier,
} from "@/lib/business-logic/constants";
import { getTier, getInvIntroTier } from "@/lib/business-logic/tiers";
import { fmt } from "@/lib/business-logic/formatters";

// Shared components
import { MetricCard } from "@/components/metric-card";
import { TierCard } from "@/components/tier-card";
import { HealthCheck } from "@/components/health-check";
import { WaterfallTable } from "@/components/waterfall-table";

// UI components
import { Slider } from "@/components/ui/slider";
import { Input } from "@/components/ui/input";

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
      <label className="text-[10px] font-medium uppercase tracking-wide text-gray-500">
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

// ── Toggle button pair ─────────────────────────────────────

function ToggleAB({
  mode,
  setMode,
  labelA,
  labelB,
  titleA = "Default",
  titleB = "Exclusive",
  colorClass,
}: {
  mode: "A" | "B";
  setMode: (m: "A" | "B") => void;
  labelA: string;
  labelB: string;
  titleA?: string;
  titleB?: string;
  colorClass: string;
}) {
  const btnClasses = (active: boolean) =>
    cn(
      "flex-1 rounded-lg px-3 py-2.5 text-center text-xs font-medium transition-colors",
      active
        ? `ring-2 ${colorClass} bg-opacity-5`
        : "border border-gray-200 text-gray-500 hover:bg-gray-50"
    );

  return (
    <div className="flex gap-2">
      <button onClick={() => setMode("A")} className={btnClasses(mode === "A")}>
        <p className="text-xs font-medium">{titleA}</p>
        <p className="mt-0.5 text-[9px] opacity-70">{labelA}</p>
      </button>
      <button onClick={() => setMode("B")} className={btnClasses(mode === "B")}>
        <p className="text-xs font-medium">{titleB}</p>
        <p className="mt-0.5 text-[9px] opacity-70">{labelB}</p>
      </button>
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

// ── Investor tier selector ─────────────────────────────────

function InvestorTierSelector({
  selectedIdx,
  onSelect,
}: {
  selectedIdx: number;
  onSelect: (idx: number) => void;
}) {
  return (
    <div className="flex gap-2">
      {INV_TIERS.map((t, i) => {
        const active = i === selectedIdx;
        return (
          <button
            key={t.name}
            onClick={() => onSelect(i)}
            className={cn(
              "flex flex-1 flex-col items-center rounded-lg px-2 py-2.5 text-center transition-colors",
              active
                ? "ring-2 ring-success-400 bg-success-50"
                : "border border-gray-200 text-gray-500 hover:bg-gray-50"
            )}
          >
            <span className="text-xs font-medium">{t.name}</span>
            <span className="mt-0.5 font-mono text-sm font-medium">
              {t.rate}%
            </span>
            <span className="mt-0.5 text-[9px] text-gray-500">
              {t.min === 0 ? "<" : ""}RM{" "}
              {t.max === Infinity
                ? `${t.min / 1000}K+`
                : `${t.min / 1000}K-${t.max / 1000}K`}
            </span>
          </button>
        );
      })}
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

// ═══════════════════════════════════════════════════════════
// SIMULATION PAGE
// ═══════════════════════════════════════════════════════════

export default function SimulationPage() {
  // ── State ──────────────────────────────────────────────────

  // Channel
  const [punchoutOn, setPunchoutOn] = useState(true);

  // EU tier mode (Punchout only)
  const [euTierMode, setEuTierMode] = useState<"A" | "B">("A");

  // Deal variables
  const [monthlyPOVol, setMonthlyPOVol] = useState(100000);
  const [cogsPercent, setCogsPercent] = useState(80);

  // Investor
  const [invTierIdx, setInvTierIdx] = useState(2); // default Gold (5%)

  // End-user network
  const [numEndUsers, setNumEndUsers] = useState(1);

  // EU introducer
  const [introTierMode, setIntroTierMode] = useState<"A" | "B">("A");

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

    // EU tier
    const EU_TIERS: Tier[] = !punchoutOn
      ? PO_EU_C
      : euTierMode === "B"
        ? PO_EU_B
        : PO_EU_A;
    const euTier = getTier(monthlyPOVol, EU_TIERS);
    const endUserRate = euTier.rate;

    // Total group PO
    const totalGroupPO = monthlyPOVol * numEndUsers;

    // EU introducer tier
    const INTRO_TIERS_PO: Tier[] = punchoutOn
      ? PO_INTRO
      : introTierMode === "B"
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
    euTierMode,
    monthlyPOVol,
    cogsPercent,
    invTierIdx,
    numEndUsers,
    introTierMode,
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
          {/* Channel toggle */}
          <div className="space-y-3 rounded-xl bg-white p-5 shadow-sm ring-1 ring-brand-100">
            <p className="text-[10px] font-medium uppercase tracking-wide text-gray-500">
              Channel
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setPunchoutOn(true)}
                className={cn(
                  "flex-1 rounded-full py-2.5 text-center text-xs font-medium transition-colors",
                  punchoutOn
                    ? "bg-accent-600 text-white"
                    : "border border-gray-200 text-gray-500 hover:bg-gray-50"
                )}
              >
                Proxy
              </button>
              <button
                onClick={() => setPunchoutOn(false)}
                className={cn(
                  "flex-1 rounded-full py-2.5 text-center text-xs font-medium transition-colors",
                  !punchoutOn
                    ? "bg-brand-600 text-white"
                    : "border border-gray-200 text-gray-500 hover:bg-gray-50"
                )}
              >
                Grid
              </button>
            </div>

            {/* EU tier mode */}
            <p className="text-[10px] font-medium uppercase tracking-wide text-gray-500">
              End-user tier system
            </p>
            {!punchoutOn ? (
              <div className="rounded-lg border border-brand-100 bg-brand-50 px-3 py-2 text-center text-xs font-medium text-brand-600">
                Fixed at 21 / 24 / 27 / 30% (Grid)
              </div>
            ) : (
              <ToggleAB
                mode={euTierMode}
                setMode={setEuTierMode}
                labelA="24 / 27 / 30 / 33%"
                labelB="33 / 36 / 39 / 42%"
                colorClass="ring-brand-400 text-brand-600 bg-brand-50"
              />
            )}

            {/* EU tier card */}
            <TierCard
              tier={calc.euTier}
              tiers={calc.EU_TIERS}
              volume={monthlyPOVol}
              color="brand"
              label="of pool"
            />
          </div>

          {/* Deal variables */}
          <div className="space-y-5 rounded-xl bg-white p-5 shadow-sm ring-1 ring-gray-200">
            <p className="text-[10px] font-medium uppercase tracking-wide text-gray-500">
              Deal variables
            </p>

            <SliderField
              label="Avg monthly PO per end-user"
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

            {/* Divider */}
            <hr className="border-gray-200" />

            {/* Investor tier */}
            <div className="space-y-2">
              <p className="text-[10px] font-medium uppercase tracking-wide text-gray-500">
                Investor tier (% of PO value)
              </p>
              <InvestorTierSelector
                selectedIdx={invTierIdx}
                onSelect={setInvTierIdx}
              />
              <p className="text-center text-[10px] font-medium text-success-600">
                Investor earns {fmt(calc.investorFee)}/month ({calc.invRate}%
                x {fmt(calc.totalGroupPO)} PO)
              </p>
            </div>

            <hr className="border-gray-200" />

            {/* End-user network */}
            <p className="text-[10px] font-medium uppercase tracking-wide text-gray-500">
              End-user network
            </p>
            <SliderField
              label="Number of end-users"
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

            <hr className="border-gray-200" />

            {/* EU introducer tier */}
            <div className="space-y-2">
              <p className="text-[10px] font-medium uppercase tracking-wide text-gray-500">
                EU introducer tier (auto from group PO)
              </p>
              {punchoutOn ? (
                <div className="rounded-lg border border-purple-100 bg-purple-50 px-3 py-2 text-center text-xs font-medium text-purple-600">
                  Fixed at 9 / 12 / 15 / 18% (Proxy active)
                </div>
              ) : (
                <ToggleAB
                  mode={introTierMode}
                  setMode={setIntroTierMode}
                  labelA="12 / 15 / 18 / 21%"
                  labelB="21 / 24 / 27 / 30%"
                  colorClass="ring-purple-400 text-purple-600 bg-purple-50"
                />
              )}
              <TierCard
                tier={calc.introTier}
                tiers={calc.INTRO_TIERS_PO}
                volume={calc.totalGroupPO}
                color="purple"
                label="of entity's share"
              />
            </div>

            <hr className="border-gray-200" />

            {/* Investor network */}
            <p className="text-[10px] font-medium uppercase tracking-wide text-gray-500">
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

            <hr className="border-gray-200" />

            {/* Investor introducer tier */}
            <div className="space-y-2">
              <p className="text-[10px] font-medium uppercase tracking-wide text-gray-500">
                Inv introducer (auto from capital introduced)
              </p>
              <TierCard
                tier={calc.invIntroTier}
                tiers={INV_INTRO_TIERS}
                volume={calc.totalInvCapital}
                color="amber"
                label="of investor return"
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
              <p className="text-[10px] font-medium uppercase tracking-wide text-gray-500">
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
          {/* Monthly waterfall hero */}
          <div className="space-y-4 rounded-xl bg-white p-5 shadow-sm ring-1 ring-gray-200">
            <p className="text-[10px] font-medium uppercase tracking-wide text-gray-500">
              Monthly waterfall
            </p>

            {/* Top metrics */}
            <div className="grid grid-cols-2 gap-3">
              <MetricCard
                label="Total group PO"
                value={fmt(calc.totalGroupPO)}
                subtitle={`${numEndUsers} end-user${numEndUsers > 1 ? "s" : ""} x ${fmt(monthlyPOVol)}`}
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
                label={`Proxy (3%)`}
                value={fmt(calc.punchoutFee)}
                subtitle={
                  punchoutOn
                    ? `3% x ${fmt(calc.totalGroupPO)} PO`
                    : "Grid — no platform fee"
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
              label={`Pool (Gross${punchoutOn ? " - Proxy" : ""} - Investor)`}
              value={fmt(calc.pool)}
              subtitle={`Split between end-user (${calc.endUserRate}%) and entity (${100 - calc.endUserRate}%)`}
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
                          label: `End user ${calc.endUserRate}%`,
                          pct: euPct,
                          colorClass: "bg-brand-400",
                          dotClass: "bg-brand-400",
                        },
                        {
                          label: "EU introducer",
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
                    label="End user"
                    value={fmt(calc.endUserAmt)}
                    subtitle={`${calc.euTier.name} · ${calc.endUserRate}% of pool`}
                    color="brand"
                  />
                  <MetricCard
                    label="EU introducer"
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

          {/* Yearly estimate */}
          {calc.poolHealthy && (
            <div className="space-y-3 rounded-xl bg-white p-5 shadow-sm ring-1 ring-gray-200">
              <p className="text-[10px] font-medium uppercase tracking-wide text-gray-500">
                Yearly estimate (x12)
              </p>
              <div className="grid grid-cols-4 gap-3">
                <MetricCard
                  label="End user"
                  value={fmt(calc.endUserAmt * 12)}
                  color="brand"
                />
                <MetricCard
                  label="Investor"
                  value={fmt(calc.investorFee * 12)}
                  color="success"
                />
                <MetricCard
                  label="EU introducer"
                  value={fmt(calc.euIntroGross * 12)}
                  color="purple"
                />
                <MetricCard
                  label="Entity (net)"
                  value={fmt(calc.entityNet * 12)}
                  color={calc.entityNet < 0 ? "danger" : "accent"}
                />
              </div>
            </div>
          )}

          {/* Full waterfall table */}
          <WaterfallTable
            title="Cost vs earnings summary (monthly)"
            rows={[
              {
                label: `Total group PO (${numEndUsers} EU x ${fmt(monthlyPOVol)})`,
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
                color: "success",
                bold: true,
              },
              ...(punchoutOn
                ? [
                    {
                      label: "- Proxy (3% of PO)",
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
                color: "accent",
                bold: true,
              },
              {
                label: `- End user (${calc.endUserRate}%)`,
                val: -calc.endUserAmt,
                color: "brand" as const,
              },
              {
                label: "= Entity side",
                val: calc.entityGross,
                color: "accent",
                bold: true,
              },
              {
                label: `- EU introducer (${calc.introducerPct}%)`,
                val: -calc.euIntroGross,
                color: "purple" as const,
              },
              {
                label: `- Inv introducer (${calc.invIntroPct}% x ${fmt(calc.invActualReturn)})`,
                val: -calc.invIntroAmt,
                color: "amber" as const,
              },
              {
                label: "= Entity before OPEX",
                val: calc.entityBeforeOpex,
                color: "accent",
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
                color: (calc.entityNet < 0 ? "danger" : "accent") as "danger" | "accent",
                bold: true,
              },
            ]}
          />
        </div>
      </div>
    </div>
  );
}
