-- Expose the caller's direct upline's intro tier modes to the player
-- simulator. The simulator needs these to size the introducer chunk by
-- the upline's tier rate (waterfall.ts dual-introducer model), without
-- weakening the RLS rule that hides the upline's identity from a
-- downline player (see 025_player_downline_visibility.sql).
--
-- Returns intro_tier_mode_proxy and intro_tier_mode_grid only — no id,
-- no name, no other PII. Returns NULL when the caller has no upline.

CREATE OR REPLACE FUNCTION public.get_my_upline_intro_tiers()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT to_jsonb(u)
  FROM (
    SELECT u.intro_tier_mode_proxy, u.intro_tier_mode_grid
    FROM players me
    JOIN players u ON u.id = me.upline_id
    WHERE me.user_id = auth.uid()
  ) u;
$$;

GRANT EXECUTE ON FUNCTION public.get_my_upline_intro_tiers() TO authenticated;
