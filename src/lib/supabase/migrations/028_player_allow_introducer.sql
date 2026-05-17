-- Per-player switch: when FALSE, the player UI hides the Introducer Commission
-- tab and the simulator hides the Introducer Network + Downline Network cards.
-- Display-only — does not affect commission math, deployment, or any waterfall
-- output. Admin and investor views always render full data regardless.
ALTER TABLE public.players
  ADD COLUMN allow_introducer BOOLEAN NOT NULL DEFAULT FALSE;

-- Backfill existing players to TRUE so nobody's UI changes the day this ships.
-- New players added after this migration default to FALSE.
UPDATE public.players SET allow_introducer = TRUE;
