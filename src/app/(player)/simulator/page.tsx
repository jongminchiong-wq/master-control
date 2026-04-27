"use client";

import { useState, useEffect, useMemo } from "react";
import { Users } from "lucide-react";
import { cn } from "@/lib/utils";

// Supabase
import { createClient } from "@/lib/supabase/client";

// Business logic
import {
  type Tier,
  INV_RATE,
  PO_EU_A,
  PO_EU_B,
  PO_EU_C,
  PO_INTRO,
  PO_INTRO_B,
  GEP_INTRO_B,
} from "@/lib/business-logic/constants";
import { getTier } from "@/lib/business-logic/tiers";
import { fmt } from "@/lib/business-logic/formatters";

// Shared components
import { MetricCard } from "@/components/metric-card";
import { TierCard } from "@/components/tier-card";
import { Slider } from "@/components/ui/slider";

export default function PlayerSimulatorPage() {
  const supabase = useMemo(() => createClient(), []);
  const [myPlayer, setMyPlayer] = useState<{
    eu_tier_mode: "A" | "B" | null;
    intro_tier_mode: "A" | "B" | null;
  } | null>(null);

  useEffect(() => {
    async function fetchPlayer() {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;

      const { data: playerData } = await supabase
        .from("players")
        .select("eu_tier_mode, intro_tier_mode")
        .eq("user_id", user.id)
        .single();

      if (playerData) {
        // DB columns are CHECK-constrained to 'A' | 'B' but Supabase's
        // generated types widen them to string; narrow at the boundary.
        const narrow = (v: string | null): "A" | "B" | null =>
          v === "A" || v === "B" ? v : null;
        setMyPlayer({
          eu_tier_mode: narrow(playerData.eu_tier_mode),
          intro_tier_mode: narrow(playerData.intro_tier_mode),
        });
      }
    }
    fetchPlayer();
  }, [supabase]);

  const euTierMode = myPlayer?.eu_tier_mode ?? "A";
  const introTierMode = myPlayer?.intro_tier_mode ?? "A";

  const [channel, setChannel] = useState<"punchout" | "gep">("punchout");
  const [cogsPercent, setCogsPercent] = useState(80);
  const [monthlyPO, setMonthlyPO] = useState(100000);
  const [numRecruits, setNumRecruits] = useState(0);
  const [avgRecruitPO, setAvgRecruitPO] = useState(50000);

  // ── EU tier + commission ────────────────────────────────────

  const euTiers: Tier[] =
    channel === "gep" ? PO_EU_C : euTierMode === "B" ? PO_EU_B : PO_EU_A;
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
      ? PO_INTRO
      : introTierMode === "B"
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
    <div className="grid grid-cols-1 gap-7 pb-12 lg:grid-cols-[320px_1fr]">
      {/* ════════════════════════════════════════════════════════
          LEFT COLUMN — Controls
          ════════════════════════════════════════════════════════ */}
      <div className="space-y-4">
        {/* Disclaimer */}
        <div className="rounded-lg border border-purple-100 bg-purple-50/30 p-4">
          <p className="text-xs text-gray-500">
            Estimated earnings. Actual amounts depend on real COGS and deal
            terms.
          </p>
        </div>

        {/* Channel toggle */}
        <section className="space-y-3">
          <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
            Channel
          </p>
          <div className="flex gap-2">
            {(
              [
                { id: "punchout", label: "Proxy" },
                { id: "gep", label: "Grid" },
              ] as const
            ).map((ch) => (
              <button
                key={ch.id}
                onClick={() => setChannel(ch.id)}
                className={cn(
                  "flex-1 rounded-full border-2 px-4 py-2.5 text-xs font-medium transition-colors",
                  channel === ch.id
                    ? "border-brand-400 bg-brand-400 text-white"
                    : "border-gray-200 bg-white text-gray-500 hover:border-gray-300"
                )}
              >
                {ch.label}
              </button>
            ))}
          </div>
        </section>

        {/* Deal Variables */}
        <section className="space-y-5">
          <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
            Deal variables
          </p>

          {/* COGS slider */}
          <div className="space-y-2">
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

          {/* Monthly PO slider */}
          <div className="space-y-2">
            <div className="flex items-baseline justify-between">
              <span className="text-xs text-gray-500">
                My monthly PO
              </span>
              <span className="font-mono text-sm font-medium text-gray-800">
                {fmt(monthlyPO)}
              </span>
            </div>
            <Slider
              value={[monthlyPO]}
              onValueChange={(v) =>
                setMonthlyPO(Array.isArray(v) ? v[0] : v)
              }
              min={10000}
              max={300000}
              step={5000}
            />
            <div className="flex justify-between text-[10px] text-gray-400">
              <span>RM 10K</span>
              <span>RM 300K</span>
            </div>
            <p className="text-center text-[11px] font-medium text-brand-600">
              {euTier.name} tier ({euTier.rate}%)
            </p>
          </div>
        </section>

        {/* Divider */}
        <hr className="border-gray-200" />

        {/* Introducer Network */}
        <section className="space-y-5">
          <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
            Introducer network
          </p>

          {/* Number of recruits */}
          <div className="space-y-2">
            <div className="flex items-baseline justify-between">
              <span className="text-xs text-gray-500">
                Number of recruits
              </span>
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
              <div className="space-y-2">
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
                  min={10000}
                  max={300000}
                  step={5000}
                />
                <p className="text-center text-[11px] text-gray-400">
                  {numRecruits} x {fmt(avgRecruitPO)} ={" "}
                  <span className="font-medium text-purple-600">
                    {fmt(totalRecruitPO)}
                  </span>{" "}
                  total recruit PO
                </p>
              </div>
            </>
          )}
        </section>
      </div>

      {/* ════════════════════════════════════════════════════════
          RIGHT COLUMN — Results
          ════════════════════════════════════════════════════════ */}
      <div className="space-y-6">
        {/* My Earnings Breakdown */}
        <div className="space-y-3">
          <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
            My earnings breakdown
          </p>

          {/* PO + COGS row */}
          <div className="grid grid-cols-2 gap-3">
            <MetricCard label="My monthly PO" value={fmt(monthlyPO)} />
            <MetricCard label={`COGS (${cogsPercent}%)`} value={fmt(cogs)} />
          </div>

          {/* Total Estimated Monthly Earnings */}
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
        </div>

        {/* My EU Commission (commission sub-card + tier progress) */}
        <div className="space-y-4 rounded-lg border border-brand-100 bg-white p-5">
          {/* Commission sub-card */}
          <div className="rounded-lg border border-brand-100 bg-gray-50 px-5 py-4">
            <p className="text-xs font-medium uppercase tracking-wide text-brand-600">
              My Player commission
            </p>
            <p className="mt-1 font-mono text-xl font-medium text-brand-600">
              {fmt(euAmt)}
            </p>
            <p className="mt-0.5 text-xs text-gray-500">
              {euTier.name} · {euTier.rate}% of pool
            </p>
          </div>

          <TierCard
            tier={euTier}
            tiers={euTiers}
            volume={monthlyPO}
            color="brand"
            label="of pool"
          />
        </div>

        {/* Introducer Earnings (if recruits > 0) */}
        {numRecruits > 0 && (
          <div className="space-y-4 rounded-lg border border-purple-100 bg-white p-5">
            <p className="text-xs text-gray-500">
              Group PO (mine + recruits):{" "}
              <span className="font-mono font-medium text-purple-600">
                {fmt(totalGroupPO)}
              </span>
            </p>

            {/* Introducer commission card */}
            <div className="rounded-lg border border-purple-100 bg-gray-50 px-5 py-4">
              <div className="flex items-center gap-2">
                <Users
                  className="size-4 text-purple-600"
                  strokeWidth={1.5}
                />
                <p className="text-xs font-medium uppercase tracking-wide text-purple-600">
                  My introducer commission
                </p>
              </div>
              <p className="mt-1 font-mono text-xl font-medium text-purple-600">
                {fmt(totalIntroAmt)}
              </p>
              <p className="mt-0.5 text-xs text-gray-500">
                {introTier.rate}% of entity&rsquo;s share x {numRecruits}{" "}
                recruit{numRecruits > 1 ? "s" : ""}
              </p>
            </div>

            <TierCard
              tier={introTier}
              tiers={introTiers}
              volume={totalGroupPO}
              color="purple"
              label="of entity&rsquo;s share"
            />
          </div>
        )}

        {/* Disclaimer */}
        <footer className="border-t border-gray-200 pt-4">
          <p className="text-[11px] leading-relaxed text-gray-400">
            Estimates based on typical product margins. Actual earnings
            depend on order values, product mix, and payment completion.
            Commissions are paid once all deliveries on an order are fully
            paid.
          </p>
        </footer>
      </div>
    </div>
  );
}
