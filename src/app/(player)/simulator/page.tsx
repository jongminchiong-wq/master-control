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
  PO_INTRO_A_PLUS,
  PO_INTRO_B,
  GEP_INTRO_B,
  GEP_INTRO_A_PLUS,
} from "@/lib/business-logic/constants";
import { getTier } from "@/lib/business-logic/tiers";
import { fmt } from "@/lib/business-logic/formatters";

type EUProxyMode = "A" | "A_PLUS" | "B";
type EUGridMode = "A" | "B";
type IntroMode = "A" | "A_PLUS" | "B";

const PUNCHOUT_EU_TABLES: Record<EUProxyMode, Tier[]> = {
  A: PO_EU_A,
  A_PLUS: PO_EU_A_PLUS,
  B: PO_EU_B,
};

const PUNCHOUT_INTRO_TABLES: Record<IntroMode, Tier[]> = {
  A: PO_INTRO,
  A_PLUS: PO_INTRO_A_PLUS,
  B: PO_INTRO_EXCLUSIVE,
};

const GEP_INTRO_TABLES: Record<IntroMode, Tier[]> = {
  A: PO_INTRO_B,
  A_PLUS: GEP_INTRO_A_PLUS,
  B: GEP_INTRO_B,
};

// Shared components
import { MetricCard } from "@/components/metric-card";
import { Slider } from "@/components/ui/slider";
import { TierCard } from "@/components/tier-card";

export default function PlayerSimulatorPage() {
  const supabase = useMemo(() => createClient(), []);
  const [myPlayer, setMyPlayer] = useState<{
    eu_tier_mode_proxy: EUProxyMode;
    eu_tier_mode_grid: EUGridMode;
    intro_tier_mode_proxy: IntroMode;
    intro_tier_mode_grid: IntroMode;
  } | null>(null);
  const [myUpline, setMyUpline] = useState<{
    intro_tier_mode_proxy: IntroMode;
    intro_tier_mode_grid: IntroMode;
  } | null>(null);
  const [myDownlines, setMyDownlines] = useState<
    Array<{
      intro_tier_mode_proxy: IntroMode;
      intro_tier_mode_grid: IntroMode;
    }>
  >([]);

  useEffect(() => {
    async function fetchPlayer() {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;

      const { data: playerData } = await supabase
        .from("players")
        .select(
          "id, eu_tier_mode_proxy, eu_tier_mode_grid, intro_tier_mode_proxy, intro_tier_mode_grid"
        )
        .eq("user_id", user.id)
        .single();

      if (!playerData) return;

      const narrowProxy = (v: string): EUProxyMode =>
        v === "B" || v === "A_PLUS" ? v : "A";
      const narrowGrid = (v: string): EUGridMode => (v === "B" ? "B" : "A");
      const narrowIntro = (v: string): IntroMode =>
        v === "B" || v === "A_PLUS" ? v : "A";

      setMyPlayer({
        eu_tier_mode_proxy: narrowProxy(playerData.eu_tier_mode_proxy),
        eu_tier_mode_grid: narrowGrid(playerData.eu_tier_mode_grid),
        intro_tier_mode_proxy: narrowIntro(playerData.intro_tier_mode_proxy),
        intro_tier_mode_grid: narrowIntro(playerData.intro_tier_mode_grid),
      });

      // Migration 027 SECURITY DEFINER RPC. types.ts not regenerated yet, so
      // bridge through `unknown`. Returns null when caller has no upline.
      type UplineTiersRpc = {
        intro_tier_mode_proxy: string | null;
        intro_tier_mode_grid: string | null;
      } | null;
      const rpcResult = (await supabase.rpc(
        "get_my_upline_intro_tiers" as never
      )) as unknown as { data: UplineTiersRpc; error: unknown };
      if (rpcResult.data) {
        setMyUpline({
          intro_tier_mode_proxy: narrowIntro(
            rpcResult.data.intro_tier_mode_proxy ?? "A"
          ),
          intro_tier_mode_grid: narrowIntro(
            rpcResult.data.intro_tier_mode_grid ?? "A"
          ),
        });
      }

      // Downlines: rows where upline_id = me. Allowed by existing RLS
      // policy `player_read_downline_chain` (migration 025).
      const { data: downlinesData } = await supabase
        .from("players")
        .select("intro_tier_mode_proxy, intro_tier_mode_grid")
        .eq("upline_id", playerData.id);
      if (downlinesData && downlinesData.length > 0) {
        setMyDownlines(
          downlinesData.map((d) => ({
            intro_tier_mode_proxy: narrowIntro(d.intro_tier_mode_proxy),
            intro_tier_mode_grid: narrowIntro(d.intro_tier_mode_grid),
          }))
        );
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
  const [monthlyPO, setMonthlyPO] = useState(0);
  const [numRecruits, setNumRecruits] = useState(0);
  const [avgRecruitPO, setAvgRecruitPO] = useState(50000);
  const [numDownlineRecruits, setNumDownlineRecruits] = useState(0);
  const [avgDownlineRecruitPO, setAvgDownlineRecruitPO] = useState(50000);

  // ── EU tier + commission ────────────────────────────────────

  const euTiers: Tier[] =
    channel === "gep"
      ? euTierModeGrid === "B"
        ? PO_EU_C_EXCLUSIVE
        : PO_EU_C
      : PUNCHOUT_EU_TABLES[euTierModeProxy];
  const euTier = getTier(monthlyPO, euTiers);

  const cogs = monthlyPO * (cogsPercent / 100);
  const gross = monthlyPO - cogs;
  const platformFee = channel === "punchout" ? monthlyPO * 0.03 : 0;
  const investorFee = monthlyPO * (INV_RATE / 100);
  const pool = gross - platformFee - investorFee;
  const euAmt = Math.max(0, pool * (euTier.rate / 100));

  // ── Introducer tier + commission ────────────────────────────

  const totalRecruitPO = numRecruits * avgRecruitPO;

  const introTiers: Tier[] =
    channel === "punchout"
      ? PUNCHOUT_INTRO_TABLES[introTierModeProxy]
      : GEP_INTRO_TABLES[introTierModeGrid];
  const introTier = getTier(totalRecruitPO, introTiers);

  // Upline sizes the introducer chunk (waterfall.ts dual-introducer model);
  // when no upline, this player keeps the whole chunk at their own rate.
  let chunkRate = introTier.rate / 100;
  if (myUpline) {
    const uplineTiers: Tier[] =
      channel === "punchout"
        ? PUNCHOUT_INTRO_TABLES[myUpline.intro_tier_mode_proxy]
        : GEP_INTRO_TABLES[myUpline.intro_tier_mode_grid];
    const uplineTier = getTier(totalRecruitPO, uplineTiers);
    chunkRate = uplineTier.rate / 100;
  }

  // Per-recruit waterfall
  const recruitTier = getTier(avgRecruitPO, euTiers);
  const recruitCogs = avgRecruitPO * (cogsPercent / 100);
  const recruitGross = avgRecruitPO - recruitCogs;
  const recruitPlatform = channel === "punchout" ? avgRecruitPO * 0.03 : 0;
  const recruitInvFee = avgRecruitPO * (INV_RATE / 100);
  const recruitPool = recruitGross - recruitPlatform - recruitInvFee;
  const recruitEU = Math.max(0, recruitPool * (recruitTier.rate / 100));
  const entityGrossPerRecruit = Math.max(0, recruitPool - recruitEU);

  const bobShareFrac = myUpline ? introTier.rate / 100 : 1;
  const introAmtPerRecruit =
    entityGrossPerRecruit * chunkRate * bobShareFrac;
  const totalIntroAmt = introAmtPerRecruit * numRecruits;

  // ── Downline Network: upline-share earnings from a downline's recruits ──

  const totalDownlineRecruitPO = numDownlineRecruits * avgDownlineRecruitPO;

  // Player's own intro tier sizes the chunk for downline-routed POs.
  // Independent banding from card 1 by design (each card stands alone).
  const downlineCardPlayerTier = getTier(totalDownlineRecruitPO, introTiers);
  const downlineCardChunkRate = downlineCardPlayerTier.rate / 100;

  // Average downline introducer rate at the simulated PO band.
  const downlineRates = myDownlines.map((d) => {
    const dTiers: Tier[] =
      channel === "punchout"
        ? PUNCHOUT_INTRO_TABLES[d.intro_tier_mode_proxy]
        : GEP_INTRO_TABLES[d.intro_tier_mode_grid];
    return getTier(totalDownlineRecruitPO, dTiers).rate;
  });
  const avgDownlineRatePct =
    downlineRates.length > 0
      ? downlineRates.reduce((a, b) => a + b, 0) / downlineRates.length
      : 0;
  const avgDownlineRate = avgDownlineRatePct / 100;

  const dRecruitTier = getTier(avgDownlineRecruitPO, euTiers);
  const dRecruitCogs = avgDownlineRecruitPO * (cogsPercent / 100);
  const dRecruitGross = avgDownlineRecruitPO - dRecruitCogs;
  const dRecruitPlatform =
    channel === "punchout" ? avgDownlineRecruitPO * 0.03 : 0;
  const dRecruitInvFee = avgDownlineRecruitPO * (INV_RATE / 100);
  const dRecruitPool = dRecruitGross - dRecruitPlatform - dRecruitInvFee;
  const dRecruitEU = Math.max(0, dRecruitPool * (dRecruitTier.rate / 100));
  const dEntityGrossPerRecruit = Math.max(0, dRecruitPool - dRecruitEU);

  const downlineAmtPerRecruit =
    dEntityGrossPerRecruit * downlineCardChunkRate * (1 - avgDownlineRate);
  const totalDownlineAmt = downlineAmtPerRecruit * numDownlineRecruits;

  // ── Totals ──────────────────────────────────────────────────

  const totalMonthly = euAmt + totalIntroAmt + totalDownlineAmt;

  return (
    <div className="space-y-5">
      <div className="px-1 pt-2 pb-1">
        <p className="text-sm text-gray-500">Simulator</p>
        <p className="mt-2 font-mono text-3xl font-semibold tracking-tight text-gray-900">
          {fmt(totalMonthly)}
        </p>
        <p className="mt-2 font-mono text-xs text-gray-500">
          Total estimated monthly earnings
        </p>
      </div>

      {/* ── Summary MetricCards ─────────────────────────────── */}
      {(() => {
        const activeCount =
          1 +
          (numRecruits > 0 ? 1 : 0) +
          (numDownlineRecruits > 0 ? 1 : 0);
        const cols =
          activeCount === 3
            ? "grid-cols-3"
            : activeCount === 2
              ? "grid-cols-2"
              : "grid-cols-1";
        return (
          <div className={cn("grid gap-4", cols)}>
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
            {numDownlineRecruits > 0 && (
              <MetricCard
                label="Downline Commission"
                value={fmt(totalDownlineAmt)}
                subtitle={`${numDownlineRecruits} downline recruit${numDownlineRecruits > 1 ? "s" : ""}`}
                color="accent"
              />
            )}
          </div>
        );
      })()}

      {/* ── COGS ────────────────────────────────────────────── */}
      <div className="rounded-2xl bg-white p-6 shadow-[0_2px_8px_rgba(0,0,0,0.06),0_1px_3px_rgba(0,0,0,0.04)]">
        <p className="mb-4 text-xs font-medium uppercase tracking-wide text-brand-600">
          COGS{" "}
          <span className="ml-1 normal-case font-normal text-gray-400">
            (Cost of Goods Sold)
          </span>
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
            min={30}
            max={95}
            step={1}
          />
          <div className="flex justify-between text-[10px] text-gray-400">
            <span>30%</span>
            <span>95%</span>
          </div>
        </div>
      </div>

      {/* ── Channel ─────────────────────────────────────────── */}
      <div className="rounded-2xl bg-white p-6 shadow-[0_2px_8px_rgba(0,0,0,0.06),0_1px_3px_rgba(0,0,0,0.04)]">
        <p className="mb-4 text-xs font-medium uppercase tracking-wide text-brand-600">
          Channel
        </p>
        <div className="inline-flex rounded-md border border-gray-200 bg-gray-50 p-0.5 text-xs">
          {(
            [
              { id: "punchout", label: "P" },
              { id: "gep", label: "G" },
            ] as const
          ).map((ch) => (
            <button
              key={ch.id}
              onClick={() => setChannel(ch.id)}
              className={cn(
                "rounded px-4 py-1.5 font-medium transition-colors",
                channel === ch.id
                  ? "bg-brand-600 text-white shadow-sm"
                  : "text-gray-500 hover:text-gray-700"
              )}
            >
              {ch.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── My PO ───────────────────────────────────────────── */}
      <div className="rounded-2xl bg-white p-6 shadow-[0_2px_8px_rgba(0,0,0,0.06),0_1px_3px_rgba(0,0,0,0.04)]">
        <p className="mb-4 text-xs font-medium uppercase tracking-wide text-brand-600">
          My Purchase Order
        </p>

        <div className="space-y-6">
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

            {monthlyPO > 0 && (
              <TierCard
                tier={euTier}
                tiers={euTiers}
                volume={monthlyPO}
                color="brand"
                variant="table"
                volumeLabel="Monthly PO"
                showHeader={false}
                className="pt-1"
              />
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
                  recruit PO
                </p>
              </div>

              <TierCard
                tier={introTier}
                tiers={introTiers}
                volume={totalRecruitPO}
                color="purple"
                variant="table"
                volumeLabel="Recruit PO"
                showHeader={false}
              />
            </>
          )}
        </div>
      </div>

      {/* ── Downline Network ────────────────────────────────── */}
      {myDownlines.length > 0 && (
        <div className="rounded-2xl bg-white p-6 shadow-[0_2px_8px_rgba(0,0,0,0.06),0_1px_3px_rgba(0,0,0,0.04)]">
          <p className="mb-4 text-xs font-medium uppercase tracking-wide text-accent-600">
            Downline Network
          </p>

          <div className="space-y-6">
            <div className="space-y-3">
              <div className="flex items-baseline justify-between">
                <span className="text-xs text-gray-500">
                  Recruits in downline
                </span>
                <span className="font-mono text-sm font-medium text-gray-800">
                  {numDownlineRecruits}
                </span>
              </div>
              <Slider
                value={[numDownlineRecruits]}
                onValueChange={(v) =>
                  setNumDownlineRecruits(Array.isArray(v) ? v[0] : v)
                }
                min={0}
                max={10}
                step={1}
              />
            </div>

            {numDownlineRecruits > 0 && (
              <>
                <div className="space-y-3">
                  <div className="flex items-baseline justify-between">
                    <span className="text-xs text-gray-500">
                      Avg PO per recruit
                    </span>
                    <span className="font-mono text-sm font-medium text-gray-800">
                      {fmt(avgDownlineRecruitPO)}
                    </span>
                  </div>
                  <Slider
                    value={[avgDownlineRecruitPO]}
                    onValueChange={(v) =>
                      setAvgDownlineRecruitPO(Array.isArray(v) ? v[0] : v)
                    }
                    min={0}
                    max={300000}
                    step={5000}
                  />
                  <p className="text-[11px] text-gray-500">
                    {numDownlineRecruits} x {fmt(avgDownlineRecruitPO)} ={" "}
                    <span className="font-medium text-accent-600">
                      {fmt(totalDownlineRecruitPO)}
                    </span>{" "}
                    downline recruit PO
                  </p>
                  <p className="text-[11px] text-gray-500">
                    Your share: chunk at your{" "}
                    {downlineCardPlayerTier.rate}% × upline split (
                    {((1 - avgDownlineRate) * 100).toFixed(0)}%)
                  </p>
                </div>

                <TierCard
                  tier={downlineCardPlayerTier}
                  tiers={introTiers}
                  volume={totalDownlineRecruitPO}
                  color="accent"
                  variant="table"
                  volumeLabel="Downline Recruit PO"
                  showHeader={false}
                />
              </>
            )}
          </div>
        </div>
      )}

      {/* ── Footnote ─────────────────────────────────────────── */}
      <div className="rounded-xl bg-gray-50 p-4 text-[11px] leading-relaxed text-gray-500">
        Estimates based on typical product margins. Actual earnings depend on
        order values, product mix, and payment completion. Commissions are
        paid once all deliveries on an order are fully paid.
      </div>
    </div>
  );
}
