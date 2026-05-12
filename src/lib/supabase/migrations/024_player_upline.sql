-- Dual-introducer support: every player who acts as an introducer
-- may have a single upline introducer above them. When set, the
-- player-introducer commission chunk is split using the same tier
-- rate that already sizes it (Bob keeps introRate%, Alice gets the
-- remaining 1 − introRate%). Chain is exactly two introducers deep.
--
-- Cycle prevention is enforced in the application layer (admin UI).

ALTER TABLE public.players
  ADD COLUMN IF NOT EXISTS upline_id uuid
    REFERENCES public.players(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS players_upline_id_idx
  ON public.players(upline_id);
