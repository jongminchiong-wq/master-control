"use client";

import { useState, useEffect, useMemo } from "react";
import { cn } from "@/lib/utils";

// Supabase
import { createClient } from "@/lib/supabase/client";

// Business logic
import {
  type Tier,
  INV_RATE,
  PO_EU_A,
  PO_EU_A_PLUS,
  PO_EU_B,
  PO_EU_C,
  PO_EU_C_EXCLUSIVE,
  PO_INTRO,
  PO_INTRO_EXCLUSIVE,
  PO_INTRO_B,
  GEP_INTRO_B,
} from "@/lib/business-logic/constants";
import { getTier } from "@/lib/business-logic/tiers";
import { fmt } from "@/lib/business-logic/formatters";

type EUProxyMode = "A" | "A_PLUS" | "B";
type EUGridMode = "A" | "B";
type IntroMode = "A" | "B";

const PUNCHOUT_EU_TABLES: Record<EUProxyMode, Tier[]> = {
  A: PO_EU_A,
  A_PLUS: PO_EU_A_PLUS,
  B: PO_EU_B,
};

// Shared components
import { MetricCard } from "@/components/metric-card";
import { Slider } from "@/components/ui/slider";

export default function PlayerSimulatorPage() {
  const supabase = useMemo(() => createClient(), []);
  const [myPlayer, setMyPlayer] = useState<{
    eu_tier_mode_proxy: EUProxyMode;
    eu_tier_mode_grid: EUGridMode;
    intro_tier_mode_proxy: IntroMode;
    intro_tier_mode_grid: IntroMode;
  } | null>(null);

  useEffect(() => {
    async function fetchPlayer() {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;

      const { data: playerData } = await supabase
        .from("players")
        .select(
          "eu_tier_mode_proxy, eu_tier_mode_grid, intro_tier_mode_proxy, intro_tier_mode_grid"
        )
        .eq("user_id", user.id)
        .single();

      if (playerData) {
        const narrowProxy = (v: string): EUProxyMode =>
          v === "B" || v === "A_PLUS" ? v : "A";
        const narrowGrid = (v: string): EUGridMode => (v === "B" ? "B" : "A");
        const narrowIntro = (v: string): IntroMode => (v === "B" ? "B" : "A");
        setMyPlayer({
          eu_tier_mode_proxy: narrowProxy(playerData.eu_tier_mode_proxy),
          eu_tier_mode_grid: narrowGrid(playerData.eu_tier_mode_grid),
          intro_tier_mode_proxy: narrowIntro(playerData.intro_tier_mode_proxy),
          intro_tier_mode_grid: narrowIntro(playerData.intro_tier_mode_grid),
        });
      }
    }
    fetchPlayer();
  }, [supabase]);

  const euTierModeProxy = myPlayer?.eu_tier_mode_proxy ?? "A";
  const euTierModeGrid = myPlayer?.eu_tier_mode_grid ?? "A";
  const introTierModeProxy = myPlayer?.intro_tier_mode_proxy ?? "A";
  const introTierModeGrid = myPlayer?.intro_tier_mode_grid ?? "A";

  const [channel, setChannel] = useState<"punchout" | "gep">("punchout");
  const [cogsPercent, setCogsPercent] = useState(80);
  const [monthlyPO, setMonthlyPO] = useState(100000);
  const [numRecruits, setNumRecruits] = useState(0);
  const [avgRecruitPO, setAvgRecruitPO] = useState(50000);

  // ── EU tier + commission ────────────────────────────────────

  const euTiers: Tier[] =
    channel === "gep"
      ? euTierModeGrid === "B"
        ? PO_EU_C_EXCLUSIVE
        : PO_EU_C
      : PUNCHOUT_EU_TABLES[euTierModeProxy];
  const euTier = getTier(monthlyPO, euTiers);
  const euTierIdx = euTiers.findIndex((t) => t.name === euTier.name);
  const nextEUTier =
    euTierIdx < euTiers.length - 1 ? euTiers[euTierIdx + 1] : null;
  const euRemaining = nextEUTier
    ? Math.max(0, nextEUTier.min - monthlyPO)
    : 0;

  const cogs = monthlyPO * (cogsPercent / 100);
  const gross = monthlyPO - cogs;
  const platformFee = channel === "punchout" ? monthlyPO * 0.03 : 0;
  const investorFee = monthlyPO * (INV_RATE / 100);
  const pool = gross - platformFee - investorFee;
  const euAmt = Math.max(0, pool * (euTier.rate / 100));

  // ── Introducer tier + commission ────────────────────────────

  const totalRecruitPO = numRecruits * avgRecruitPO;
  const totalGroupPO = monthlyPO + totalRecruitPO;

  const introTiers: Tier[] =
    channel === "punchout"
      ? introTierModeProxy === "B"
        ? PO_INTRO_EXCLUSIVE
        : PO_INTRO
      : introTierModeGrid === "B"
        ? GEP_INTRO_B
        : PO_INTRO_B;
  const introTier = getTier(totalGroupPO, introTiers);
  const introTierIdx = introTiers.findIndex(
    (t) => t.name === introTier.name
  );
  const nextIntroTier =
    introTierIdx < introTiers.length - 1
      ? introTiers[introTierIdx + 1]
      : null;
  const introRemaining = nextIntroTier
    ? Math.max(0, nextIntroTier.min - totalGroupPO)
    : 0;

  // Per-recruit waterfall
  const recruitTier = getTier(avgRecruitPO, euTiers);
  const recruitCogs = avgRecruitPO * (cogsPercent / 100);
  const recruitGross = avgRecruitPO - recruitCogs;
  const recruitPlatform = channel === "punchout" ? avgRecruitPO * 0.03 : 0;
  const recruitInvFee = avgRecruitPO * (INV_RATE / 100);
  const recruitPool = recruitGross - recruitPlatform - recruitInvFee;
  const recruitEU = Math.max(0, recruitPool * (recruitTier.rate / 100));
  const entityGrossPerRecruit = Math.max(0, recruitPool - recruitEU);
  const introAmtPerRecruit =
    entityGrossPerRecruit * (introTier.rate / 100);
  const totalIntroAmt = introAmtPerRecruit * numRecruits;

  // ── Totals ──────────────────────────────────────────────────

  const totalMonthly = euAmt + totalIntroAmt;

  return (
    <div className="space-y-5">
      <MetricCard
        label="Total estimated monthly earnings"
        value={fmt(totalMonthly)}
        color="success"
      >
        {numRecruits > 0 && (
          <div className="mt-1 flex gap-2.5">
            <span className="text-[10px] font-medium text-brand-600">
              Player {fmt(euAmt)}
            </span>
            <span className="text-[10px] font-medium text-purple-600">
              Intro {fmt(totalIntroAmt)}
            </span>
          </div>
        )}
      </MetricCard>

      {/* ── Summary MetricCards ─────────────────────────────── */}
      <div
        className={cn(
          "grid gap-4",
          numRecruits > 0 ? "grid-cols-3" : "grid-cols-2"
        )}
      >
        <MetricCard
          label="My monthly PO"
          value={fmt(monthlyPO)}
          subtitle={`COGS ${cogsPercent}% · ${fmt(cogs)}`}
        />
        <MetricCard
          label="Player Commission"
          value={fmt(euAmt)}
          subtitle={`${euTier.name} · ${euTier.rate}% of pool`}
          color="brand"
        />
        {numRecruits > 0 && (
          <MetricCard
            label="Introducer Commission"
            value={fmt(totalIntroAmt)}
            subtitle={`${numRecruits} recruit${numRecruits > 1 ? "s" : ""}`}
            color="purple"
          />
        )}
      </div>

      {/* ── COGS ────────────────────────────────────────────── */}
      <div className="rounded-2xl bg-white p-6 shadow-[0_2px_8px_rgba(0,0,0,0.06),0_1px_3px_rgba(0,0,0,0.04)]">
        <p className="mb-4 text-xs font-medium uppercase tracking-wide text-brand-600">
          COGS
        </p>
        <div className="space-y-3">
          <div className="flex items-baseline justify-between">
            <span className="text-xs text-gray-500">COGS %</span>
            <span className="font-mono text-sm font-medium text-gray-800">
              {cogsPercent}%
            </span>
          </div>
          <Slider
            value={[cogsPercent]}
            onValueChange={(v) =>
              setCogsPercent(Array.isArray(v) ? v[0] : v)
            }
            min={60}
            max={95}
            step={1}
          />
          <div className="flex justify-between text-[10px] text-gray-400">
            <span>60%</span>
            <span>95%</span>
          </div>
        </div>
      </div>

      {/* ── My Business ─────────────────────────────────────── */}
      <div className="rounded-2xl bg-white p-6 shadow-[0_2px_8px_rgba(0,0,0,0.06),0_1px_3px_rgba(0,0,0,0.04)]">
        <p className="mb-4 text-xs font-medium uppercase tracking-wide text-brand-600">
          My Business
        </p>

        <div className="space-y-6">
          {/* Channel segmented control */}
          <div className="space-y-2">
            <p className="text-xs text-gray-500">Channel</p>
            <div className="inline-flex rounded-md border border-gray-200 bg-gray-50 p-0.5 text-xs">
              {(
                [
                  { id: "punchout", label: "Proxy", color: "accent" },
                  { id: "gep", label: "Grid", color: "brand" },
                ] as const
              ).map((ch) => (
                <button
                  key={ch.id}
                  onClick={() => setChannel(ch.id)}
                  className={cn(
                    "rounded px-4 py-1.5 font-medium transition-colors",
                    channel === ch.id
                      ? ch.color === "accent"
                        ? "bg-white text-accent-600 shadow-sm"
                        : "bg-white text-brand-600 shadow-sm"
                      : "text-gray-500 hover:text-gray-700"
                  )}
                >
                  {ch.label}
                </button>
              ))}
            </div>
          </div>

          {/* Monthly PO slider */}
          <div className="space-y-3">
            <div className="flex items-baseline justify-between">
              <span className="text-xs text-gray-500">My monthly PO</span>
              <span className="font-mono text-sm font-medium text-gray-800">
                {fmt(monthlyPO)}
              </span>
            </div>
            <Slider
              value={[monthlyPO]}
              onValueChange={(v) =>
                setMonthlyPO(Array.isArray(v) ? v[0] : v)
              }
              min={0}
              max={300000}
              step={5000}
            />
            <div className="flex justify-between text-[10px] text-gray-400">
              <span>RM 0</span>
              <span>RM 300K</span>
            </div>

            {/* EU tier pills */}
            <div className="flex flex-wrap gap-2 pt-1">
              {euTiers.map((t, i) => {
                const active = i === euTierIdx;
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
                    {t.name} &middot; {t.rate}%
                  </span>
                );
              })}
            </div>

            {nextEUTier ? (
              <p className="text-xs text-gray-500">
                <span className="font-mono font-medium text-gray-600">
                  {fmt(euRemaining)}
                </span>{" "}
                more to reach {nextEUTier.name} ({nextEUTier.rate}%)
              </p>
            ) : (
              <p className="text-xs font-medium text-brand-600">
                Max tier reached
              </p>
            )}
          </div>

        </div>
      </div>

      {/* ── Introducer Network ──────────────────────────────── */}
      <div className="rounded-2xl bg-white p-6 shadow-[0_2px_8px_rgba(0,0,0,0.06),0_1px_3px_rgba(0,0,0,0.04)]">
        <p className="mb-4 text-xs font-medium uppercase tracking-wide text-purple-600">
          Introducer Network
        </p>

        <div className="space-y-6">
          {/* Number of recruits */}
          <div className="space-y-3">
            <div className="flex items-baseline justify-between">
              <span className="text-xs text-gray-500">Number of recruits</span>
              <span className="font-mono text-sm font-medium text-gray-800">
                {numRecruits}
              </span>
            </div>
            <Slider
              value={[numRecruits]}
              onValueChange={(v) =>
                setNumRecruits(Array.isArray(v) ? v[0] : v)
              }
              min={0}
              max={10}
              step={1}
            />
          </div>

          {numRecruits > 0 && (
            <>
              {/* Avg PO per recruit */}
              <div className="space-y-3">
                <div className="flex items-baseline justify-between">
                  <span className="text-xs text-gray-500">
                    Avg PO per recruit
                  </span>
                  <span className="font-mono text-sm font-medium text-gray-800">
                    {fmt(avgRecruitPO)}
                  </span>
                </div>
                <Slider
                  value={[avgRecruitPO]}
                  onValueChange={(v) =>
                    setAvgRecruitPO(Array.isArray(v) ? v[0] : v)
                  }
                  min={0}
                  max={300000}
                  step={5000}
                />
                <p className="text-[11px] text-gray-500">
                  {numRecruits} x {fmt(avgRecruitPO)} ={" "}
                  <span className="font-medium text-purple-600">
                    {fmt(totalRecruitPO)}
                  </span>{" "}
                  recruit PO &middot; group{" "}
                  <span className="font-medium text-purple-600">
                    {fmt(totalGroupPO)}
                  </span>
                </p>
              </div>

              {/* Intro tier pills */}
              <div className="flex flex-wrap gap-2">
                {introTiers.map((t, i) => {
                  const active = i === introTierIdx;
                  return (
                    <span
                      key={t.name}
                      className={cn(
                        "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs",
                        active
                          ? "border border-purple-600 bg-purple-50 font-medium text-purple-600"
                          : "border border-gray-200 text-gray-500"
                      )}
                    >
                      {t.name} &middot; {t.rate}%
                    </span>
                  );
                })}
              </div>

              {nextIntroTier ? (
                <p className="text-xs text-gray-500">
                  <span className="font-mono font-medium text-gray-600">
                    {fmt(introRemaining)}
                  </span>{" "}
                  more to reach {nextIntroTier.name} ({nextIntroTier.rate}%)
                </p>
              ) : (
                <p className="text-xs font-medium text-purple-600">
                  Max tier reached
                </p>
              )}
            </>
          )}
        </div>
      </div>

      {/* ── Footnote ─────────────────────────────────────────── */}
      <div className="rounded-xl bg-gray-50 p-4 text-[11px] leading-relaxed text-gray-500">
        Estimates based on typical product margins. Actual earnings depend on
        order values, product mix, and payment completion. Commissions are
        paid once all deliveries on an order are fully paid.
      </div>
    </div>
  );
}
