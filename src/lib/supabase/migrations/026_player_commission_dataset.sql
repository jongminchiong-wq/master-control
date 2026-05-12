-- Server-side commission dataset for player pages.
--
-- The client-side waterfall in (player)/introducer-commission and
-- (player)/dashboard underreports a player's intro commission when the
-- player's upline (e.g. Player A above Player B) is RLS-hidden. The
-- waterfall keys the chunk split off `intro.upline_id` (which B can read
-- on their own row) but sizes the chunk by looking up the upline player
-- object — which returns null under RLS, so chunkRate silently falls back
-- to the introducer's own tier rate instead of the upline's.
--
-- Fix: a SECURITY DEFINER function that returns the full math scope for
-- the caller — visible network (self, recruits, downlines, downlines'
-- recruits) PLUS the upline chain and each upline's full subtree. The
-- Next.js Route Handler runs `calcPOWaterfall` server-side against this
-- dataset and ships only the resulting numbers to the browser.
--
-- Privacy: math-only player rows are returned with `name` and `ref`
-- nulled out. Only id + tier-mode fields needed by the waterfall are
-- exposed. PII columns (email, phone, user_id) are never returned for
-- any row. The function is callable by `authenticated` only.

CREATE OR REPLACE FUNCTION public.get_my_commission_dataset()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  me_id uuid;
  visible_ids uuid[];
  math_ids uuid[];
  result jsonb;
BEGIN
  SELECT id INTO me_id FROM players WHERE user_id = auth.uid();
  IF me_id IS NULL THEN
    RETURN jsonb_build_object('error', 'no_player');
  END IF;

  -- Browser-visible network: self, my recruits, my downlines, my
  -- downlines' recruits. Mirrors the existing RLS policies on `players`.
  visible_ids := ARRAY(
    SELECT me_id
    UNION
    SELECT id FROM players WHERE introduced_by = me_id
    UNION
    SELECT id FROM players WHERE upline_id = me_id
    UNION
    SELECT id FROM players WHERE introduced_by IN (
      SELECT id FROM players WHERE upline_id = me_id
    )
  );

  -- Math scope: visible network + every player in the upline chain
  -- (me.upline_id, that player's upline_id, ...) and each upline's full
  -- descendant subtree (everyone reachable via introduced_by or upline_id
  -- at any depth). subtreeTotalPO in the waterfall needs every PO from
  -- this scope.
  WITH RECURSIVE upline_chain AS (
    SELECT p.upline_id AS id
    FROM players p
    WHERE p.id = me_id AND p.upline_id IS NOT NULL
    UNION
    SELECT p.upline_id
    FROM players p
    JOIN upline_chain uc ON p.id = uc.id
    WHERE p.upline_id IS NOT NULL
  ),
  upline_subtree AS (
    SELECT id FROM upline_chain
    UNION
    SELECT p.id FROM players p
    JOIN upline_subtree us ON p.introduced_by = us.id OR p.upline_id = us.id
  )
  SELECT ARRAY(
    SELECT unnest(visible_ids)
    UNION
    SELECT id FROM upline_subtree
  ) INTO math_ids;

  SELECT jsonb_build_object(
    'me_id', me_id,
    'players', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', p.id,
        -- Names only for the browser-visible network. Upline chain
        -- players and their subtree members are exposed as anonymous
        -- math stubs (id + tier modes + edges only).
        'name', CASE WHEN p.id = ANY(visible_ids) THEN p.name ELSE NULL END,
        'introduced_by', p.introduced_by,
        'upline_id', p.upline_id,
        'eu_tier_mode_proxy', p.eu_tier_mode_proxy,
        'eu_tier_mode_grid', p.eu_tier_mode_grid,
        'intro_tier_mode_proxy', p.intro_tier_mode_proxy,
        'intro_tier_mode_grid', p.intro_tier_mode_grid,
        'visible', p.id = ANY(visible_ids)
      ))
      FROM players p WHERE p.id = ANY(math_ids)
    ), '[]'::jsonb),
    'purchase_orders', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', po.id,
        'end_user_id', po.end_user_id,
        'channel', po.channel,
        'po_date', po.po_date,
        'po_amount', po.po_amount,
        'other_cost', po.other_cost,
        'visible', po.end_user_id = ANY(visible_ids),
        -- Display fields only on visible POs.
        'ref', CASE WHEN po.end_user_id = ANY(visible_ids) THEN po.ref ELSE NULL END,
        'commissions_cleared', CASE
          WHEN po.end_user_id = ANY(visible_ids) THEN po.commissions_cleared
          ELSE NULL
        END,
        'delivery_orders', COALESCE((
          SELECT jsonb_agg(
            CASE WHEN po.end_user_id = ANY(visible_ids) THEN
              jsonb_build_object(
                'id', d.id,
                'po_id', d.po_id,
                'ref', d.ref,
                'description', d.description,
                'amount', d.amount,
                'delivery', d.delivery,
                'supplier_paid', d.supplier_paid,
                'delivered', d.delivered,
                'invoiced', d.invoiced,
                'buyer_paid', d.buyer_paid
              )
            ELSE
              -- Math-only DO: amount + delivery feed the COGS calc.
              -- Status fields stay hidden.
              jsonb_build_object(
                'amount', d.amount,
                'delivery', d.delivery
              )
            END
          )
          FROM delivery_orders d WHERE d.po_id = po.id
        ), '[]'::jsonb)
      ))
      FROM purchase_orders po
      WHERE po.end_user_id = ANY(math_ids)
    ), '[]'::jsonb)
  ) INTO result;

  RETURN result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_my_commission_dataset() TO authenticated;
