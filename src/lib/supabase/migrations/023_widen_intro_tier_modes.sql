-- Widen players.intro_tier_mode_proxy and intro_tier_mode_grid CHECK constraints
-- to allow 'A_PLUS' (Premium 30-39%) alongside 'A' (Default) and 'B' (Exclusive).
-- Superset of the old allowlist; existing rows cannot violate.

ALTER TABLE public.players
  DROP CONSTRAINT IF EXISTS players_intro_tier_mode_proxy_check,
  DROP CONSTRAINT IF EXISTS players_intro_tier_mode_grid_check;

ALTER TABLE public.players
  ADD CONSTRAINT players_intro_tier_mode_proxy_check
    CHECK (intro_tier_mode_proxy = ANY (ARRAY['A'::text, 'A_PLUS'::text, 'B'::text])),
  ADD CONSTRAINT players_intro_tier_mode_grid_check
    CHECK (intro_tier_mode_grid = ANY (ARRAY['A'::text, 'A_PLUS'::text, 'B'::text]));
