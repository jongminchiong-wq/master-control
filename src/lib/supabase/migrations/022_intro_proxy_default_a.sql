-- 022_intro_proxy_default_a.sql
-- Flip players.intro_tier_mode_proxy default from 'B' to 'A' so both
-- intro tier mode columns default to 'A'. No data backfill: the players
-- table was emptied before this migration was applied.
ALTER TABLE public.players
  ALTER COLUMN intro_tier_mode_proxy SET DEFAULT 'A';
