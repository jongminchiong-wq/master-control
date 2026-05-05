-- ============================================================
-- Master Control — Player Commission Ledger + Withdrawal Flow
--
-- Adds a persistent ledger for player commissions (EU + Intro) so that
-- a player can request a monthly withdrawal of cleared earnings, and
-- adds the request/approve/pay lifecycle parallel to the investor
-- withdrawal flow in 008.
--
-- Tables:
--   1. player_commissions   — one row per (player, PO, type) when a PO clears
--   2. player_withdrawals   — pending → approved → paid (or rejected)
--
-- RPCs (mirror the investor pattern in 008/010/012):
--   - credit_player_commission        (admin-only, idempotent)
--   - submit_player_withdrawal         (player-callable, once per month)
--   - approve_player_withdrawal        (admin-only)
--   - mark_player_withdrawal_paid      (admin-only, links commission rows FIFO)
--   - reject_player_withdrawal         (admin-only)
--
-- Backfill is NOT run inline. Mirroring the full waterfall (tier tables,
-- risk-adjusted COGS, channel-specific platform fee) in plain SQL would
-- duplicate ~150 lines of TS and drift over time. Existing cleared POs
-- will have no ledger rows after this migration; run scripts/backfill-
-- player-commissions.ts (npx tsx) to populate them using calcPOWaterfall.
-- New PO clears via the admin UI fire credit_player_commission inline.
-- ============================================================

-- ─── 1. player_commissions table ─────────────────────────────

CREATE TABLE IF NOT EXISTS player_commissions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id       uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  po_id           uuid NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  type            text NOT NULL CHECK (type IN ('eu', 'intro')),
  amount          decimal NOT NULL CHECK (amount >= 0),
  tier_rate       decimal NOT NULL,
  base_amount     decimal,
  withdrawal_id   uuid,
  is_split        boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_player_commissions_player
  ON player_commissions(player_id);
CREATE INDEX IF NOT EXISTS idx_player_commissions_po
  ON player_commissions(po_id);
CREATE INDEX IF NOT EXISTS idx_player_commissions_unlinked
  ON player_commissions(player_id) WHERE withdrawal_id IS NULL;

-- Uniqueness only applies to original credit rows. Split-on-payout rows
-- (is_split = true) carry the leftover amount when a commission row over-
-- covers a withdrawal, and intentionally re-use (player_id, po_id, type).
CREATE UNIQUE INDEX IF NOT EXISTS player_commissions_unique_credit
  ON player_commissions (player_id, po_id, type)
  WHERE NOT is_split;

-- ─── 2. player_withdrawals table ─────────────────────────────

CREATE TABLE IF NOT EXISTS player_withdrawals (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id     uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  amount        decimal NOT NULL CHECK (amount > 0),
  status        text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'paid', 'rejected')),
  requested_at  timestamptz NOT NULL DEFAULT now(),
  reviewed_at   timestamptz,
  reviewed_by   uuid REFERENCES users(id),
  paid_at       timestamptz,
  notes         text,
  admin_notes   text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_player_withdrawals_player
  ON player_withdrawals(player_id);
CREATE INDEX IF NOT EXISTS idx_player_withdrawals_status
  ON player_withdrawals(status);

-- FK from commissions → withdrawals can only be added now that both exist.
ALTER TABLE player_commissions
  ADD CONSTRAINT player_commissions_withdrawal_id_fkey
  FOREIGN KEY (withdrawal_id) REFERENCES player_withdrawals(id) ON DELETE SET NULL;

-- ─── 3. RLS ─────────────────────────────────────────────────

ALTER TABLE player_commissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE player_withdrawals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin_full_player_commissions" ON player_commissions FOR ALL
  USING (EXISTS (SELECT 1 FROM users WHERE id = (select auth.uid()) AND role = 'admin'));

CREATE POLICY "player_read_own_commissions" ON player_commissions FOR SELECT
  USING (player_id IN (SELECT id FROM players WHERE user_id = (select auth.uid())));

CREATE POLICY "admin_full_player_withdrawals" ON player_withdrawals FOR ALL
  USING (EXISTS (SELECT 1 FROM users WHERE id = (select auth.uid()) AND role = 'admin'));

CREATE POLICY "player_read_own_withdrawals" ON player_withdrawals FOR SELECT
  USING (player_id IN (SELECT id FROM players WHERE user_id = (select auth.uid())));

-- Inserts go through SECURITY DEFINER RPCs — no direct INSERT policy needed.

-- ─── 4. credit_player_commission RPC ─────────────────────────
-- Admin-only, fires when a PO clears. Idempotent on (player, po, type)
-- via ON CONFLICT DO NOTHING. Mirrors credit_investor_return /
-- credit_introducer_commission.

CREATE OR REPLACE FUNCTION credit_player_commission(
  p_player_id uuid,
  p_po_id uuid,
  p_type text,
  p_amount decimal,
  p_tier_rate decimal,
  p_base_amount decimal DEFAULT NULL,
  p_credit_date timestamptz DEFAULT now()
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_credit_id uuid;
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

  IF p_amount IS NULL OR p_amount < 0 THEN
    RETURN json_build_object('success', false, 'error', 'Amount must be non-negative');
  END IF;

  -- Skip zero-amount credits — they would just clutter the ledger.
  IF p_amount = 0 THEN
    RETURN json_build_object('success', true, 'skipped', true);
  END IF;

  INSERT INTO player_commissions (
    player_id, po_id, type, amount, tier_rate, base_amount, is_split, created_at
  )
  VALUES (
    p_player_id, p_po_id, p_type, p_amount, p_tier_rate, p_base_amount, false, p_credit_date
  )
  ON CONFLICT (player_id, po_id, type) WHERE NOT is_split DO NOTHING
  RETURNING id INTO v_credit_id;

  IF v_credit_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Already credited', 'duplicate', true);
  END IF;

  RETURN json_build_object('success', true, 'credit_id', v_credit_id);
END;
$$;

-- ─── 5. submit_player_withdrawal RPC ─────────────────────────
-- Player-callable. Validates ownership, minimum amount (RM 100), and
-- available balance. Inserts a pending row. Does NOT debit anything —
-- availability is always derived from sum(unlinked commissions minus
-- pending/approved withdrawal amounts). Multiple in-flight requests are
-- allowed; each just locks a slice of the available balance.

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
  -- Verify caller owns the player record.
  IF NOT EXISTS (
    SELECT 1 FROM players
    WHERE id = p_player_id AND user_id = auth.uid()
  ) THEN
    RETURN json_build_object('success', false, 'error', 'Player not found or not yours');
  END IF;

  IF p_amount IS NULL OR p_amount < 100 THEN
    RETURN json_build_object('success', false, 'error', 'Minimum withdrawal is RM 100');
  END IF;

  -- Available = unlinked commissions − amounts locked in pending/approved withdrawals.
  -- (Paid withdrawals link rows via withdrawal_id, so they are already excluded
  -- by the first SUM.)
  SELECT
    COALESCE((
      SELECT SUM(amount) FROM player_commissions
       WHERE player_id = p_player_id AND withdrawal_id IS NULL
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

-- ─── 6. approve_player_withdrawal RPC ────────────────────────
-- Admin-only. pending → approved. No payout yet, no rows linked.

CREATE OR REPLACE FUNCTION approve_player_withdrawal(
  p_withdrawal_id uuid,
  p_admin_notes text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_status text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin') THEN
    RETURN json_build_object('success', false, 'error', 'Admin only');
  END IF;

  SELECT status INTO v_status
    FROM player_withdrawals
    WHERE id = p_withdrawal_id
    FOR UPDATE;

  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'Withdrawal not found');
  END IF;

  IF v_status <> 'pending' THEN
    RETURN json_build_object('success', false, 'error', 'Withdrawal is not pending');
  END IF;

  UPDATE player_withdrawals
    SET status = 'approved',
        reviewed_at = now(),
        reviewed_by = auth.uid(),
        admin_notes = COALESCE(p_admin_notes, admin_notes)
    WHERE id = p_withdrawal_id;

  RETURN json_build_object('success', true);
END;
$$;

-- ─── 7. mark_player_withdrawal_paid RPC ──────────────────────
-- Admin-only. approved → paid. Atomically links commission rows FIFO
-- (oldest unlinked first) until the withdrawal amount is covered. Rows
-- whose amount would overshoot the remaining balance still get linked
-- in full — over-coverage is fine; under-coverage is an error.

CREATE OR REPLACE FUNCTION mark_player_withdrawal_paid(
  p_withdrawal_id uuid,
  p_admin_notes text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_withdrawal player_withdrawals%ROWTYPE;
  v_remaining decimal;
  v_total_linked decimal := 0;
  rec RECORD;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin') THEN
    RETURN json_build_object('success', false, 'error', 'Admin only');
  END IF;

  SELECT * INTO v_withdrawal
    FROM player_withdrawals
    WHERE id = p_withdrawal_id
    FOR UPDATE;

  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'Withdrawal not found');
  END IF;

  IF v_withdrawal.status <> 'approved' THEN
    RETURN json_build_object('success', false, 'error', 'Withdrawal must be approved before marking paid');
  END IF;

  v_remaining := v_withdrawal.amount;

  -- Lock the candidate rows so a concurrent paid-mark can't double-link them.
  -- When a row over-covers the remaining amount, split it: shrink the row
  -- to the exact amount needed (and link it), and insert a new is_split
  -- row carrying the overage so it stays in the player's available balance.
  FOR rec IN
    SELECT id, player_id, po_id, type, amount, tier_rate
      FROM player_commissions
     WHERE player_id = v_withdrawal.player_id
       AND withdrawal_id IS NULL
     ORDER BY created_at ASC, id ASC
     FOR UPDATE
  LOOP
    EXIT WHEN v_remaining <= 0;

    IF rec.amount <= v_remaining THEN
      UPDATE player_commissions
        SET withdrawal_id = p_withdrawal_id
        WHERE id = rec.id;
      v_remaining := v_remaining - rec.amount;
      v_total_linked := v_total_linked + rec.amount;
    ELSE
      INSERT INTO player_commissions (
        player_id, po_id, type, amount, tier_rate, base_amount, is_split, created_at
      ) VALUES (
        rec.player_id, rec.po_id, rec.type,
        rec.amount - v_remaining, rec.tier_rate, NULL, true, now()
      );

      UPDATE player_commissions
        SET amount = v_remaining,
            withdrawal_id = p_withdrawal_id
        WHERE id = rec.id;

      v_total_linked := v_total_linked + v_remaining;
      v_remaining := 0;
    END IF;
  END LOOP;

  IF v_total_linked < v_withdrawal.amount THEN
    -- Defensive: should never happen since submit checked availability,
    -- but if a paid mark races ahead we want to abort cleanly.
    RAISE EXCEPTION 'Insufficient unlinked commissions to cover withdrawal %', p_withdrawal_id;
  END IF;

  UPDATE player_withdrawals
    SET status = 'paid',
        paid_at = now(),
        admin_notes = COALESCE(p_admin_notes, admin_notes)
    WHERE id = p_withdrawal_id;

  RETURN json_build_object('success', true, 'linked_total', v_total_linked);
END;
$$;

-- ─── 8. reject_player_withdrawal RPC ─────────────────────────
-- Admin-only. pending|approved → rejected. No commission rows were
-- linked yet, so nothing to unlink.

CREATE OR REPLACE FUNCTION reject_player_withdrawal(
  p_withdrawal_id uuid,
  p_admin_notes text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_status text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin') THEN
    RETURN json_build_object('success', false, 'error', 'Admin only');
  END IF;

  SELECT status INTO v_status
    FROM player_withdrawals
    WHERE id = p_withdrawal_id
    FOR UPDATE;

  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'Withdrawal not found');
  END IF;

  IF v_status NOT IN ('pending', 'approved') THEN
    RETURN json_build_object('success', false, 'error', 'Withdrawal already finalised');
  END IF;

  UPDATE player_withdrawals
    SET status = 'rejected',
        reviewed_at = now(),
        reviewed_by = auth.uid(),
        admin_notes = COALESCE(p_admin_notes, admin_notes)
    WHERE id = p_withdrawal_id;

  RETURN json_build_object('success', true);
END;
$$;

-- ─── 9. Grants ──────────────────────────────────────────────

GRANT EXECUTE ON FUNCTION credit_player_commission(uuid, uuid, text, decimal, decimal, decimal, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION submit_player_withdrawal(uuid, decimal, text) TO authenticated;
GRANT EXECUTE ON FUNCTION approve_player_withdrawal(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION mark_player_withdrawal_paid(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION reject_player_withdrawal(uuid, text) TO authenticated;
