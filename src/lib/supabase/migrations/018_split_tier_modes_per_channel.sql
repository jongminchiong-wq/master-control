-- Split single-mode columns into per-channel modes so admins can set
-- different Proxy and Grid behavior independently for the same player.
-- Safe to drop: players table is empty (verified before migration).

ALTER TABLE public.players
  DROP COLUMN IF EXISTS eu_tier_mode,
  DROP COLUMN IF EXISTS intro_tier_mode;

ALTER TABLE public.players
  ADD COLUMN eu_tier_mode_proxy text NOT NULL DEFAULT 'A'
    CHECK (eu_tier_mode_proxy = ANY (ARRAY['A'::text, 'A_PLUS'::text, 'B'::text])),
  ADD COLUMN eu_tier_mode_grid text NOT NULL DEFAULT 'A'
    CHECK (eu_tier_mode_grid = ANY (ARRAY['A'::text, 'B'::text])),
  ADD COLUMN intro_tier_mode_proxy text NOT NULL DEFAULT 'B'
    CHECK (intro_tier_mode_proxy = ANY (ARRAY['A'::text, 'B'::text])),
  ADD COLUMN intro_tier_mode_grid text NOT NULL DEFAULT 'A'
    CHECK (intro_tier_mode_grid = ANY (ARRAY['A'::text, 'B'::text]));
