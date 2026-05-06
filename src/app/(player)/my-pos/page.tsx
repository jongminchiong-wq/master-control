"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

import { calcPOWaterfall } from "@/lib/business-logic/waterfall";
import { getTier, getEUTiers } from "@/lib/business-logic/tiers";
import { PO_EU_C, type Tier } from "@/lib/business-logic/constants";
import { fmt, fmtSigned, getMonth } from "@/lib/business-logic/formatters";
import { getCommissionStatus } from "@/lib/business-logic/commission-status";

import { ChannelBadge } from "@/components/channel-badge";
import { StatusBadge } from "@/components/status-badge";
import { CommissionStatusBadge } from "@/components/commission-status-badge";
import { MonthPicker } from "@/components/month-picker";
import { TierCard } from "@/components/tier-card";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";

import {
  type DBPlayer,
  type DBPO,
  toWaterfallPlayer,
  toWaterfallPO,
  getPOStatus,
  getDOStatus,
  DOStatusBadge,
  deliveryLabel,
  PayoutTimeline,
  DOProgressBar,
  SimplifiedCommission,
} from "../_shared";
import { usePlayerSelectedMonth } from "../_month-context";

type POData = {
  po: DBPO;
  waterfall: ReturnType<typeof calcPOWaterfall>;
  poStatus: ReturnType<typeof getPOStatus>;
  commStatus: ReturnType<typeof getCommissionStatus>;
};

function ChannelPOCard({
  channel,
  data,
  total,
  euComm,
  tier,
  tiers,
  expandedPOId,
  setExpandedPOId,
  tierOpen,
  onTierToggle,
}: {
  channel: "punchout" | "gep";
  data: POData[];
  total: number;
  euComm: number;
  tier: Tier;
  tiers: Tier[];
  expandedPOId: string | null;
  setExpandedPOId: (id: string | null) => void;
  tierOpen: boolean;
  onTierToggle: () => void;
}) {
  const tierColor = channel === "gep" ? "brand" : "accent";
  const refColor = channel === "gep" ? "text-brand-600" : "text-accent-600";

  const tierIdx = tiers.findIndex((t) => t.name === tier.name);
  const nextTier = tierIdx < tiers.length - 1 ? tiers[tierIdx + 1] : null;
  const remaining = nextTier ? Math.max(0, nextTier.min - total) : 0;

  return (
    <div className="rounded-2xl bg-white p-6 shadow-[0_2px_8px_rgba(0,0,0,0.06),0_1px_3px_rgba(0,0,0,0.04)]">
      <div className="mb-4">
        <button
          type="button"
          aria-expanded={tierOpen}
          onClick={onTierToggle}
          className="flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left hover:bg-gray-50"
        >
          <ChannelBadge channel={channel} />
          <span className={cn("text-sm font-medium", refColor)}>
            {tier.name}
          </span>
          {nextTier ? (
            <span className="ml-auto font-mono text-xs text-gray-500">
              <span className="font-medium text-gray-700">
                {fmt(remaining)}
              </span>{" "}
              to {nextTier.name}
            </span>
          ) : (
            <span className="ml-auto text-xs text-gray-500">Max tier</span>
          )}
          <ChevronDown
            className={cn(
              "size-4 text-gray-400 transition-transform",
              tierOpen && "rotate-180"
            )}
          />
        </button>

        {tierOpen && (
          <div className="mt-4 border-t border-gray-100 pt-4">
            <TierCard
              tier={tier}
              tiers={tiers}
              volume={total}
              color={tierColor}
              label="of pool"
            />
          </div>
        )}
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-6 text-[10px]" />
            <TableHead className="text-[10px] uppercase tracking-wide">Ref</TableHead>
            <TableHead className="text-[10px] uppercase tracking-wide">Date</TableHead>
            <TableHead className="text-right text-[10px] uppercase tracking-wide">
              PO Amount
            </TableHead>
            <TableHead className="text-right text-[10px] uppercase tracking-wide">
              Commission
            </TableHead>
            <TableHead className="text-[10px] uppercase tracking-wide">PO Status</TableHead>
            <TableHead className="text-[10px] uppercase tracking-wide">Comm Status</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {data.map(({ po, waterfall: w, poStatus, commStatus }) => {
            const isExpanded = expandedPOId === po.id;
            const dos = po.delivery_orders ?? [];
            return (
              <Fragment key={po.id}>
                <TableRow
                  className={cn(
                    "cursor-pointer",
                    isExpanded && "bg-brand-50/30"
                  )}
                  onClick={() => setExpandedPOId(isExpanded ? null : po.id)}
                >
                  <TableCell className="w-6 pr-0">
                    {isExpanded ? (
                      <ChevronDown
                        className="size-3.5 text-gray-500"
                        strokeWidth={2}
                      />
                    ) : (
                      <ChevronRight
                        className="size-3.5 text-gray-500"
                        strokeWidth={2}
                      />
                    )}
                  </TableCell>
                  <TableCell
                    className={cn("font-mono text-xs font-medium", refColor)}
                  >
                    {po.ref}
                  </TableCell>
                  <TableCell className="text-xs text-gray-500">
                    {po.po_date}
                  </TableCell>
                  <TableCell className="text-right font-mono text-xs font-medium">
                    {fmt(po.po_amount)}
                  </TableCell>
                  <TableCell
                    className={cn(
                      "text-right font-mono text-xs font-medium",
                      w.euAmt - w.playerLossShare < 0
                        ? "text-danger-600"
                        : "text-brand-600"
                    )}
                  >
                    {fmtSigned(w.euAmt - w.playerLossShare)}
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={poStatus} />
                  </TableCell>
                  <TableCell>
                    <CommissionStatusBadge status={commStatus} />
                  </TableCell>
                </TableRow>

                {isExpanded && (
                  <TableRow
                    key={`${po.id}_detail`}
                    className="hover:bg-transparent"
                  >
                    <TableCell
                      colSpan={7}
                      className="border-b border-gray-200 bg-brand-50/15 px-2 pb-4 pt-0"
                    >
                      <div className="rounded-lg border border-gray-200 bg-white p-4">
                        {po.note && po.note.trim() && (
                          <div className="mb-3 rounded-md border border-amber-200 border-l-[3px] border-l-amber-500 bg-amber-50 px-3 py-2.5">
                            <div className="mb-1 text-[9px] font-semibold uppercase tracking-wider text-amber-700">
                              Note from admin
                            </div>
                            <div className="whitespace-pre-wrap text-xs leading-snug text-gray-800">
                              {po.note}
                            </div>
                          </div>
                        )}

                        <DOProgressBar dos={dos} />

                        {dos.length > 0 ? (
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead className="text-[10px] uppercase tracking-wide">
                                  DO
                                </TableHead>
                                <TableHead className="text-[10px] uppercase tracking-wide">
                                  Items
                                </TableHead>
                                <TableHead className="text-[10px] uppercase tracking-wide">
                                  Delivery
                                </TableHead>
                                <TableHead className="text-[10px] uppercase tracking-wide">
                                  Status
                                </TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {dos.map((d) => (
                                <TableRow key={d.id}>
                                  <TableCell
                                    className={cn(
                                      "font-mono text-[11px] font-semibold",
                                      refColor
                                    )}
                                  >
                                    {d.ref}
                                  </TableCell>
                                  <TableCell className="text-[11px] text-gray-600">
                                    {d.description || "—"}
                                  </TableCell>
                                  <TableCell className="text-[11px] text-gray-500">
                                    {deliveryLabel[d.delivery ?? "local"] ??
                                      d.delivery}
                                  </TableCell>
                                  <TableCell>
                                    <DOStatusBadge status={getDOStatus(d)} />
                                  </TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        ) : (
                          <p className="py-4 text-center text-[11px] text-gray-400">
                            Delivery orders will appear here once your PO is
                            processed.
                          </p>
                        )}

                        {po.po_amount > 0 && (
                          <div className="mt-4">
                            <SimplifiedCommission
                              poAmount={po.po_amount}
                              pool={w.pool}
                              commission={w.euAmt - w.playerLossShare}
                              tierName={w.euTier.name}
                              tierRate={w.euTier.rate}
                            />
                          </div>
                        )}

                        <PayoutTimeline po={po} />
                      </div>
                    </TableCell>
                  </TableRow>
                )}
              </Fragment>
            );
          })}
          <TableRow className="border-t-2 border-gray-300">
            <TableCell />
            <TableCell
              colSpan={2}
              className="text-xs font-medium text-gray-800"
            >
              Total
            </TableCell>
            <TableCell className="text-right font-mono text-xs font-medium text-gray-800">
              {fmt(total)}
            </TableCell>
            <TableCell
              className={cn(
                "text-right font-mono text-xs font-medium",
                euComm < 0 ? "text-danger-600" : "text-brand-600"
              )}
            >
              {fmtSigned(euComm)}
            </TableCell>
            <TableCell colSpan={2} />
          </TableRow>
        </TableBody>
      </Table>
    </div>
  );
}

export default function PlayerMyPOsPage() {
  const supabase = useMemo(() => createClient(), []);

  const [myPlayer, setMyPlayer] = useState<DBPlayer | null>(null);
  const [allPlayers, setAllPlayers] = useState<DBPlayer[]>([]);
  const [allPOs, setAllPOs] = useState<DBPO[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorState, setErrorState] = useState<
    "not_authenticated" | "no_player" | null
  >(null);

  const [expandedPOId, setExpandedPOId] = useState<string | null>(null);
  const [openTier, setOpenTier] = useState<"punchout" | "gep" | null>(null);

  const openPO = (id: string | null) => {
    setExpandedPOId(id);
    if (id) setOpenTier(null);
  };

  const toggleTier = (channel: "punchout" | "gep") => {
    const isOpening = openTier !== channel;
    setOpenTier(isOpening ? channel : null);
    if (isOpening) setExpandedPOId(null);
  };

  const now = new Date();
  const currentMonth =
    now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0");
  const [selectedMonth, setSelectedMonth] = usePlayerSelectedMonth();

  const fetchData = useCallback(async () => {
    setLoading(true);

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      setErrorState("not_authenticated");
      setLoading(false);
      return;
    }

    const { data: playerData } = await supabase
      .from("players")
      .select("*")
      .eq("user_id", user.id)
      .single();

    if (!playerData) {
      setErrorState("no_player");
      setLoading(false);
      return;
    }

    setMyPlayer(playerData);

    const [playersRes, posRes] = await Promise.all([
      supabase
        .from("players")
        .select("*")
        .order("created_at", { ascending: true }),
      supabase
        .from("purchase_orders")
        .select("*, delivery_orders(*)")
        .order("po_date", { ascending: true }),
    ]);

    if (playersRes.data) setAllPlayers(playersRes.data);
    if (posRes.data) setAllPOs(posRes.data as DBPO[]);
    setLoading(false);
  }, [supabase]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const availableMonths = useMemo(() => {
    const poMonths = allPOs
      .map((po) => getMonth(po.po_date))
      .filter((m): m is string => Boolean(m));
    const anchors = [...poMonths, currentMonth];
    const earliest = anchors.reduce((a, b) => (a < b ? a : b));
    const latest = anchors.reduce((a, b) => (a > b ? a : b));

    const months: string[] = [];
    let [y, m] = earliest.split("-").map(Number);
    const [ly, lm] = latest.split("-").map(Number);
    while (y < ly || (y === ly && m <= lm)) {
      months.push(`${y}-${String(m).padStart(2, "0")}`);
      m++;
      if (m > 12) {
        m = 1;
        y++;
      }
    }
    return months.reverse();
  }, [allPOs, currentMonth]);

  const wPlayers = useMemo(
    () => allPlayers.map(toWaterfallPlayer),
    [allPlayers]
  );
  const wAllPOs = useMemo(() => allPOs.map(toWaterfallPO), [allPOs]);

  const myMonthPOs = useMemo(() => {
    if (!myPlayer) return [];
    return allPOs.filter(
      (po) =>
        po.end_user_id === myPlayer.id &&
        getMonth(po.po_date) === selectedMonth
    );
  }, [allPOs, myPlayer, selectedMonth]);

  const myPOData = useMemo(() => {
    return myMonthPOs.map((po) => {
      const wPO = toWaterfallPO(po);
      const w = calcPOWaterfall(wPO, wPlayers, wAllPOs, po.po_amount);
      const poStatus = getPOStatus(po);
      const commStatus = getCommissionStatus(po);
      return { po, waterfall: w, poStatus, commStatus };
    });
  }, [myMonthPOs, wPlayers, wAllPOs]);

  const myTotalPO = useMemo(
    () => myMonthPOs.reduce((s, po) => s + po.po_amount, 0),
    [myMonthPOs]
  );

  const myEUComm = useMemo(
    () =>
      myPOData.reduce(
        (s, d) => s + d.waterfall.euAmt - d.waterfall.playerLossShare,
        0
      ),
    [myPOData]
  );

  const gepData = useMemo(
    () => myPOData.filter((d) => d.po.channel === "gep"),
    [myPOData]
  );
  const punchData = useMemo(
    () => myPOData.filter((d) => d.po.channel === "punchout"),
    [myPOData]
  );

  const gepTotal = gepData.reduce((s, d) => s + d.po.po_amount, 0);
  const punchTotal = punchData.reduce((s, d) => s + d.po.po_amount, 0);

  const gepEUComm = gepData.reduce(
    (s, d) => s + d.waterfall.euAmt - d.waterfall.playerLossShare,
    0
  );
  const punchEUComm = punchData.reduce(
    (s, d) => s + d.waterfall.euAmt - d.waterfall.playerLossShare,
    0
  );

  const tierModes = myPlayer
    ? {
        euTierModeProxy: myPlayer.eu_tier_mode_proxy,
        euTierModeGrid: myPlayer.eu_tier_mode_grid,
        introTierModeProxy: myPlayer.intro_tier_mode_proxy,
        introTierModeGrid: myPlayer.intro_tier_mode_grid,
      }
    : null;
  const gepTiers = tierModes ? getEUTiers(tierModes, "gep") : PO_EU_C;
  const punchTiers = tierModes ? getEUTiers(tierModes, "punchout") : PO_EU_C;
  const gepTier = getTier(gepTotal, gepTiers);
  const punchTier = getTier(punchTotal, punchTiers);

  if (loading) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <p className="text-sm text-gray-500">Loading...</p>
      </div>
    );
  }

  if (errorState === "not_authenticated") {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <p className="text-sm text-gray-500">
          You are not authenticated. Please log in.
        </p>
      </div>
    );
  }

  if (errorState === "no_player" || !myPlayer) {
    return (
      <div className="flex min-h-[400px] items-center justify-center">
        <div className="text-center">
          <p className="text-sm font-medium text-gray-700">
            No player record found
          </p>
          <p className="mt-1 text-xs text-gray-500">
            Your account is not linked to a player record. Contact your
            administrator.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex justify-end">
        <MonthPicker
          months={availableMonths}
          value={selectedMonth}
          onChange={setSelectedMonth}
          color="brand"
        />
      </div>

      <div className="px-1 pt-2 pb-1">
        <p className="text-sm text-gray-500">My POs</p>
        <p className="mt-2 font-mono text-3xl font-semibold tracking-tight text-gray-900">
          {fmt(myTotalPO)}
        </p>
        <p className="mt-2 font-mono text-xs text-gray-500">
          <span className="font-medium text-gray-700">
            {myMonthPOs.length} PO{myMonthPOs.length !== 1 ? "s" : ""}
          </span>{" "}
          this month
          {myEUComm !== 0 && (
            <>
              <span className="text-gray-400"> · </span>
              <span
                className={cn(
                  "font-medium",
                  myEUComm < 0 ? "text-danger-600" : "text-brand-600"
                )}
              >
                {fmtSigned(myEUComm)} commission
              </span>
            </>
          )}
        </p>
      </div>

      {punchTotal === 0 && gepTotal === 0 ? (
        <div className="rounded-2xl bg-white p-6 shadow-[0_2px_8px_rgba(0,0,0,0.06),0_1px_3px_rgba(0,0,0,0.04)]">
          <p className="py-6 text-center text-xs text-gray-500">
            No POs this month.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4">
          {punchTotal > 0 && (
            <ChannelPOCard
              channel="punchout"
              data={punchData}
              total={punchTotal}
              euComm={punchEUComm}
              tier={punchTier}
              tiers={punchTiers}
              expandedPOId={expandedPOId}
              setExpandedPOId={openPO}
              tierOpen={openTier === "punchout"}
              onTierToggle={() => toggleTier("punchout")}
            />
          )}
          {gepTotal > 0 && (
            <ChannelPOCard
              channel="gep"
              data={gepData}
              total={gepTotal}
              euComm={gepEUComm}
              tier={gepTier}
              tiers={gepTiers}
              expandedPOId={expandedPOId}
              setExpandedPOId={openPO}
              tierOpen={openTier === "gep"}
              onTierToggle={() => toggleTier("gep")}
            />
          )}
        </div>
      )}

    </div>
  );
}
