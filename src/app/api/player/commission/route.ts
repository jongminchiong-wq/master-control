import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  calcPOWaterfall,
  type Player as WaterfallPlayer,
  type PurchaseOrder as WaterfallPO,
} from "@/lib/business-logic/waterfall";

type DatasetPlayer = {
  id: string;
  name: string | null;
  introduced_by: string | null;
  upline_id: string | null;
  eu_tier_mode_proxy: string;
  eu_tier_mode_grid: string;
  intro_tier_mode_proxy: string;
  intro_tier_mode_grid: string;
  visible: boolean;
};

type DatasetDO = {
  id?: string;
  po_id?: string;
  ref?: string | null;
  description?: string | null;
  amount: number;
  delivery: string | null;
  supplier_paid?: string | null;
  delivered?: string | null;
  invoiced?: string | null;
  buyer_paid?: string | null;
};

type DatasetPO = {
  id: string;
  end_user_id: string;
  channel: string;
  po_date: string;
  po_amount: number;
  other_cost: number;
  ref: string | null;
  commissions_cleared: string | null;
  visible: boolean;
  delivery_orders: DatasetDO[];
};

type Dataset = {
  me_id?: string;
  players?: DatasetPlayer[];
  purchase_orders?: DatasetPO[];
  error?: string;
};

function toWaterfallPlayer(p: DatasetPlayer): WaterfallPlayer {
  return {
    id: p.id,
    euTierModeProxy: p.eu_tier_mode_proxy,
    euTierModeGrid: p.eu_tier_mode_grid,
    introTierModeProxy: p.intro_tier_mode_proxy,
    introTierModeGrid: p.intro_tier_mode_grid,
    introducedBy: p.introduced_by,
    uplineId: p.upline_id,
  };
}

function toWaterfallPO(po: DatasetPO): WaterfallPO {
  return {
    id: po.id,
    endUserId: po.end_user_id,
    poAmount: po.po_amount,
    poDate: po.po_date,
    channel: po.channel,
    dos: po.delivery_orders.map((d) => ({
      amount: d.amount,
      delivery: d.delivery ?? "local",
    })),
    otherCost: po.other_cost,
  };
}

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "not_authenticated" }, { status: 401 });
  }

  const { data, error } = await supabase.rpc("get_my_commission_dataset");
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  const dataset = (data ?? {}) as Dataset;
  if (dataset.error === "no_player") {
    return NextResponse.json({ error: "no_player" }, { status: 404 });
  }

  const me_id = dataset.me_id!;
  const allPlayers = dataset.players ?? [];
  const allPOs = dataset.purchase_orders ?? [];

  const visiblePlayers = allPlayers.filter((p) => p.visible);
  const me = visiblePlayers.find((p) => p.id === me_id);
  if (!me) {
    return NextResponse.json({ error: "no_player" }, { status: 404 });
  }

  const wPlayers = allPlayers.map(toWaterfallPlayer);
  const wAllPOs = allPOs.map(toWaterfallPO);

  // Categorize visible players relative to me.
  const recruits = visiblePlayers
    .filter((p) => p.introduced_by === me_id)
    .map((p) => ({ id: p.id, name: p.name ?? "" }));
  const downlines = visiblePlayers
    .filter((p) => p.upline_id === me_id)
    .map((p) => ({ id: p.id, name: p.name ?? "" }));
  const downlineIds = new Set(downlines.map((d) => d.id));
  const downlineRecruits = visiblePlayers
    .filter((p) => p.introduced_by && downlineIds.has(p.introduced_by))
    .map((p) => ({
      id: p.id,
      name: p.name ?? "",
      downlineId: p.introduced_by!,
    }));

  // Run the waterfall server-side per visible PO. The full dataset
  // (including anonymized upline stubs) feeds the math; the response
  // ships only DTOs.
  const visiblePOs = allPOs.filter((po) => po.visible);
  const pos = visiblePOs.map((po) => {
    const w = calcPOWaterfall(
      toWaterfallPO(po),
      wPlayers,
      wAllPOs,
      po.po_amount
    );
    return {
      po: {
        id: po.id,
        ref: po.ref,
        channel: po.channel,
        end_user_id: po.end_user_id,
        po_date: po.po_date,
        po_amount: po.po_amount,
        other_cost: po.other_cost,
        commissions_cleared: po.commissions_cleared,
        delivery_orders: po.delivery_orders.map((d) => ({
          id: d.id ?? "",
          po_id: d.po_id ?? po.id,
          ref: d.ref ?? null,
          description: d.description ?? null,
          amount: d.amount,
          delivery: d.delivery ?? null,
          supplier_paid: d.supplier_paid ?? null,
          delivered: d.delivered ?? null,
          invoiced: d.invoiced ?? null,
          buyer_paid: d.buyer_paid ?? null,
        })),
      },
      waterfall: {
        channel: w.channel,
        poAmount: w.poAmount,
        euTier: { name: w.euTier.name, rate: w.euTier.rate },
        euAmt: w.euAmt,
        playerLossShare: w.playerLossShare,
        gross: w.gross,
        platformFee: w.platformFee,
        investorFee: w.investorFee,
        pool: w.pool,
        introAmt: w.introAmt,
        introRate: w.introRate,
        introTier: w.introTier
          ? { name: w.introTier.name, rate: w.introTier.rate }
          : null,
        introducerLossShare: w.introducerLossShare,
        uplineAmt: w.uplineAmt,
        uplineLossShare: w.uplineLossShare,
        entityShare: w.entityShare,
        entityLossShare: w.entityLossShare,
        monthlyCumulative: w.monthlyCumulative,
        effectiveCogsPct: w.effectiveCogsPct,
        rawLoss: w.rawLoss,
        supplierTotal: w.supplierTotal,
        riskAdjustedCogs: w.riskAdjustedCogs,
        otherCost: w.otherCost,
        totalDeployed: w.totalDeployed,
      },
    };
  });

  return NextResponse.json({
    me: { id: me.id, name: me.name ?? "" },
    recruits,
    downlines,
    downlineRecruits,
    pos,
  });
}
