-- Expose downlines and their recruits to the upline player, so the
-- upline's pages (dashboard hero + introducer-commission downline card)
-- can load the right rows for the client-side waterfall.
--
-- Does NOT expose anyone's own upline. Player B (downline) must remain
-- unable to see Player A (B's upline). The dual-introducer split is
-- triggered by the introducer's own `upline_id` field, which B can read
-- via the existing `player_read_self` policy — no upline visibility
-- needed for the math.

-- ── Helper: my downlines + my downlines' recruits ───────────────────
CREATE OR REPLACE FUNCTION public.get_my_downline_chain_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH me AS (
    SELECT id FROM players WHERE user_id = auth.uid()
  )
  -- my downlines (players who have me as their upline)
  SELECT p.id FROM players p
  WHERE p.upline_id IN (SELECT id FROM me)
  UNION
  -- my downlines' recruits (people my downlines introduced)
  SELECT p.id FROM players p
  WHERE p.introduced_by IN (
    SELECT d.id FROM players d WHERE d.upline_id IN (SELECT id FROM me)
  );
$$;

-- ── players: see your downline chain ────────────────────────────────
CREATE POLICY "player_read_downline_chain" ON public.players FOR SELECT
USING (id IN (SELECT public.get_my_downline_chain_ids()));

-- ── purchase_orders: see POs from your downlines' recruits ──────────
CREATE POLICY "player_read_downline_recruit_pos"
ON public.purchase_orders FOR SELECT
USING (
  end_user_id IN (
    SELECT p.id FROM public.players p
    WHERE p.introduced_by IN (
      SELECT d.id FROM public.players d
      WHERE d.upline_id IN (
        SELECT id FROM public.players WHERE user_id = (select auth.uid())
      )
    )
  )
);

-- ── delivery_orders: see DOs of the same POs ────────────────────────
CREATE POLICY "player_read_downline_recruit_dos"
ON public.delivery_orders FOR SELECT
USING (
  po_id IN (
    SELECT po.id FROM public.purchase_orders po
    WHERE po.end_user_id IN (
      SELECT p.id FROM public.players p
      WHERE p.introduced_by IN (
        SELECT d.id FROM public.players d
        WHERE d.upline_id IN (
          SELECT id FROM public.players WHERE user_id = (select auth.uid())
        )
      )
    )
  )
);
