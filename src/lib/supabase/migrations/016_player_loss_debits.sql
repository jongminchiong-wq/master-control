-- ============================================================
-- Master Control — Player Loss Debits + Carry-Forward
--
-- Phase 2 of loss-sharing for PO cost overruns. When a PO clears
-- with supplier cost > PO amount, the raw cost overrun is split
-- among Player, Entity, and Introducer using the same tier
-- percentages they would have earned on profit (mirror split).
-- The player and introducer shares are stored as DEBITS in
-- player_loss_debits and treated as a permanent reduction in
-- the player's available withdrawal balance — they "carry
-- forward" until enough future commissions accumulate to cover
-- them. Players never go cash-negative on the platform.
--
-- The schema mirrors player_commissions intentionally: same
-- (player, PO, type) uniqueness, same admin-only credit RPC,
-- same RLS shape. Kept separate so existing per-PO uniqueness,
-- withdrawal linkage, and is_split logic on player_commissions
-- stay untouched.
--
-- This migration also REPLACES submit_player_withdrawal so that
-- available balance subtracts open loss debits. The mark_paid
-- RPC does not change: linking commission rows to a withdrawal
-- is unrelated to debit accounting; the withdrawal amount itself
-- already had debits subtracted at submit time.
--
-- Backfill is NOT run inline. Cleared loss POs from before this
-- migration will not have debit rows. Run a tsx backfill script
-- after deploying if historical losses need to be ledgered.
-- ============================================================

-- ─── 1. player_loss_debits table ─────────────────────────────

CREATE TABLE IF NOT EXISTS player_loss_debits (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id       uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  po_id           uuid NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  type            text NOT NULL CHECK (type IN ('eu', 'intro')),
  amount          decimal NOT NULL CHECK (amount > 0),
  tier_rate       decimal NOT NULL,
  base_amount     decimal,
  introducee_id   uuid REFERENCES players(id) ON DELETE SET NULL,
  cleared_at      timestamptz NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_player_loss_debits_player
  ON player_loss_debits(player_id);
CREATE INDEX IF NOT EXISTS idx_player_loss_debits_po
  ON player_loss_debits(po_id);

CREATE UNIQUE INDEX IF NOT EXISTS player_loss_debits_unique
  ON player_loss_debits (player_id, po_id, type);

-- ─── 2. RLS ─────────────────────────────────────────────────

ALTER TABLE player_loss_debits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin_full_player_loss_debits" ON player_loss_debits FOR ALL
  USING (EXISTS (SELECT 1 FROM users WHERE id = (select auth.uid()) AND role = 'admin'));

CREATE POLICY "player_read_own_loss_debits" ON player_loss_debits FOR SELECT
  USING (player_id IN (SELECT id FROM players WHERE user_id = (select auth.uid())));

-- Inserts go through the SECURITY DEFINER RPC — no direct INSERT policy needed.

-- ─── 3. credit_player_loss_debit RPC ─────────────────────────
-- Admin-only, fires when a PO clears with cost > PO amount.
-- Idempotent on (player, po, type) via ON CONFLICT DO NOTHING,
-- matching credit_player_commission's pattern.

CREATE OR REPLACE FUNCTION credit_player_loss_debit(
  p_player_id uuid,
  p_po_id uuid,
  p_type text,
  p_amount decimal,
  p_tier_rate decimal,
  p_base_amount decimal DEFAULT NULL,
  p_introducee_id uuid DEFAULT NULL,
  p_cleared_at timestamptz DEFAULT now()
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_debit_id uuid;
BEGIN
  IF NOT (
    EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin')
    OR current_user = 'postgres'
  ) THEN
    RETURN json_build_object('success', false, 'error', 'Admin only');
  END IF;

  IF p_type NOT IN ('eu', 'intro') THEN
    RETURN json_build_object('success', false, 'error', 'Invalid type');
  END IF;

  -- Skip zero-or-negative debits — they would just clutter the ledger.
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RETURN json_build_object('success', true, 'skipped', true);
  END IF;

  INSERT INTO player_loss_debits (
    player_id, po_id, type, amount, tier_rate, base_amount,
    introducee_id, cleared_at
  )
  VALUES (
    p_player_id, p_po_id, p_type, p_amount, p_tier_rate, p_base_amount,
    p_introducee_id, p_cleared_at
  )
  ON CONFLICT (player_id, po_id, type) DO NOTHING
  RETURNING id INTO v_debit_id;

  IF v_debit_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Already debited', 'duplicate', true);
  END IF;

  RETURN json_build_object('success', true, 'debit_id', v_debit_id);
END;
$$;

-- ─── 4. submit_player_withdrawal — subtract loss debits ──────
-- Replaces the migration-015 version. Behavior change: loss debits
-- are subtracted from the available balance as a permanent
-- reduction. A player must earn enough commissions to cover their
-- accumulated debits before any new amount becomes withdrawable.

CREATE OR REPLACE FUNCTION submit_player_withdrawal(
  p_player_id uuid,
  p_amount decimal,
  p_notes text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_withdrawal_id uuid;
  v_available decimal;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM players
    WHERE id = p_player_id AND user_id = auth.uid()
  ) THEN
    RETURN json_build_object('success', false, 'error', 'Player not found or not yours');
  END IF;

  IF p_amount IS NULL OR p_amount < 100 THEN
    RETURN json_build_object('success', false, 'error', 'Minimum withdrawal is RM 100');
  END IF;

  -- Available = unlinked commissions − loss debits − amounts locked
  -- in pending/approved withdrawals. A player with zero rows in
  -- player_loss_debits gets the same number as before this migration.
  SELECT
    COALESCE((
      SELECT SUM(amount) FROM player_commissions
       WHERE player_id = p_player_id AND withdrawal_id IS NULL
    ), 0)
    -
    COALESCE((
      SELECT SUM(amount) FROM player_loss_debits
       WHERE player_id = p_player_id
    ), 0)
    -
    COALESCE((
      SELECT SUM(amount) FROM player_withdrawals
       WHERE player_id = p_player_id AND status IN ('pending', 'approved')
    ), 0)
    INTO v_available;

  IF p_amount > v_available THEN
    RETURN json_build_object(
      'success', false,
      'error', 'Amount exceeds available balance',
      'available', v_available
    );
  END IF;

  INSERT INTO player_withdrawals (player_id, amount, status, notes)
    VALUES (p_player_id, p_amount, 'pending', p_notes)
    RETURNING id INTO v_withdrawal_id;

  RETURN json_build_object('success', true, 'withdrawal_id', v_withdrawal_id);
END;
$$;

-- ─── 5. Grants ──────────────────────────────────────────────

GRANT EXECUTE ON FUNCTION credit_player_loss_debit(uuid, uuid, text, decimal, decimal, decimal, uuid, timestamptz) TO authenticated;
