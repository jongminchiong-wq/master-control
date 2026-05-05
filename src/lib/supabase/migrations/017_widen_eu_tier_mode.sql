-- Widen players.eu_tier_mode CHECK constraint to allow 'A_PLUS' (Premium)
-- in addition to the existing 'A' (Default) and 'B' (Exclusive) values.
-- intro_tier_mode is unchanged: 'A'/'B' now also represent Default/Exclusive
-- on the Punchout channel (previously the mode was ignored for Proxy).

ALTER TABLE public.players
  DROP CONSTRAINT IF EXISTS players_eu_tier_mode_check;

ALTER TABLE public.players
  ADD CONSTRAINT players_eu_tier_mode_check
  CHECK (eu_tier_mode = ANY (ARRAY['A'::text, 'A_PLUS'::text, 'B'::text]));
