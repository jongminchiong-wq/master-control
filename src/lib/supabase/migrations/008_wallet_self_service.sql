-- ============================================================
-- Master Control — Investor Wallet (Self-Service)
-- Adds: deposit_requests table (investor requests admin approval)
--        submit_deposit_request / approve_deposit_request / reject_deposit_request RPCs
--        Extends submit_withdrawal with a 'capital' branch (min RM 5,000, debits capital immediately)
--        Adds approve/reject capital withdrawal RPCs that refund capital on rejection
--
-- Design notes:
-- - Capital debits on submit (not on approve) so a second submission can't
--   double-spend the same idle capital while the first is in 'pending'.
-- - Rejection refunds capital atomically.
-- - Idle is derived, not stored — the client soft-caps by the allocator's
--   idle number; the RPC enforces amount <= capital as a coarser floor.
--   Admin re-validates true idle at approval time before sending the bank
--   transfer.
-- ============================================================

-- ─── 1. deposit_requests table ──────────────────────────────

CREATE TABLE deposit_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  investor_id uuid NOT NULL REFERENCES investors(id) ON DELETE CASCADE,
  amount decimal NOT NULL CHECK (amount >= 5000),
  method text,
  reference text,
  notes text,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'completed')),
  requested_at timestamptz DEFAULT now(),
  reviewed_at timestamptz,
  reviewed_by uuid REFERENCES users(id),
  processed_at timestamptz,
  deposited_at date,
  deposit_id uuid REFERENCES deposits(id),
  admin_notes text,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX idx_deposit_requests_investor ON deposit_requests(investor_id);
CREATE INDEX idx_deposit_requests_status ON deposit_requests(status);

-- ─── 2. RLS ─────────────────────────────────────────────────

ALTER TABLE deposit_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admin_full_deposit_requests" ON deposit_requests FOR ALL
  USING (EXISTS (SELECT 1 FROM users WHERE id = (select auth.uid()) AND role = 'admin'));

CREATE POLICY "investor_read_own_deposit_requests" ON deposit_requests FOR SELECT
  USING (investor_id IN (SELECT id FROM investors WHERE user_id = (select auth.uid())));

-- Investors go through the RPC (SECURITY DEFINER) so they do not need a
-- direct INSERT policy. Enforcing inserts via RPC keeps amount + ownership
-- validation server-side.

-- ─── 3. submit_deposit_request ──────────────────────────────
-- Investor-callable. Inserts pending row. Enforces ownership and
-- amount >= 5000. No capital change until admin approves.

CREATE OR REPLACE FUNCTION submit_deposit_request(
  p_investor_id uuid,
  p_amount decimal,
  p_method text DEFAULT NULL,
  p_reference text DEFAULT NULL,
  p_notes text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_request_id uuid;
BEGIN
  -- Verify caller owns the investor record
  IF NOT EXISTS (
    SELECT 1 FROM investors
    WHERE id = p_investor_id AND user_id = auth.uid()
  ) THEN
    RETURN json_build_object('success', false, 'error', 'Investor not found or not yours');
  END IF;

  IF p_amount IS NULL OR p_amount < 5000 THEN
    RETURN json_build_object('success', false, 'error', 'Minimum deposit is RM 5,000');
  END IF;

  INSERT INTO deposit_requests (investor_id, amount, method, reference, notes, status)
    VALUES (p_investor_id, p_amount, p_method, p_reference, p_notes, 'pending')
    RETURNING id INTO v_request_id;

  RETURN json_build_object(
    'success', true,
    'request_id', v_request_id
  );
END;
$$;

-- ─── 4. approve_deposit_request ─────────────────────────────
-- Admin-only. Atomically: flip status to 'completed', insert into deposits,
-- bump investors.capital. The inserted deposit row feeds v_investor_ledger.

CREATE OR REPLACE FUNCTION approve_deposit_request(
  p_request_id uuid,
  p_deposited_at date DEFAULT NULL,
  p_admin_notes text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_request deposit_requests%ROWTYPE;
  v_deposit_id uuid;
  v_new_capital decimal;
  v_effective_date date;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin') THEN
    RETURN json_build_object('success', false, 'error', 'Admin only');
  END IF;

  SELECT * INTO v_request
    FROM deposit_requests
    WHERE id = p_request_id
    FOR UPDATE;

  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'Deposit request not found');
  END IF;

  IF v_request.status <> 'pending' THEN
    RETURN json_build_object('success', false, 'error', 'Request is not pending');
  END IF;

  v_effective_date := COALESCE(p_deposited_at, CURRENT_DATE);

  -- Insert a deposit row (this is what the ledger view reads)
  INSERT INTO deposits (investor_id, amount, method, reference, notes, deposited_at, recorded_by)
    VALUES (
      v_request.investor_id,
      v_request.amount,
      v_request.method,
      v_request.reference,
      COALESCE(p_admin_notes, v_request.notes),
      v_effective_date,
      auth.uid()
    )
    RETURNING id INTO v_deposit_id;

  -- Bump capital
  UPDATE investors
    SET capital = capital + v_request.amount
    WHERE id = v_request.investor_id
    RETURNING capital INTO v_new_capital;

  -- Mark the request as completed
  UPDATE deposit_requests
    SET status = 'completed',
        reviewed_at = now(),
        reviewed_by = auth.uid(),
        processed_at = now(),
        deposited_at = v_effective_date,
        deposit_id = v_deposit_id,
        admin_notes = COALESCE(p_admin_notes, admin_notes)
    WHERE id = p_request_id;

  RETURN json_build_object(
    'success', true,
    'deposit_id', v_deposit_id,
    'new_capital', v_new_capital
  );
END;
$$;

-- ─── 5. reject_deposit_request ──────────────────────────────
-- Admin-only. No capital change — request never resulted in a deposit.

CREATE OR REPLACE FUNCTION reject_deposit_request(
  p_request_id uuid,
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
    FROM deposit_requests
    WHERE id = p_request_id
    FOR UPDATE;

  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'Deposit request not found');
  END IF;

  IF v_status <> 'pending' THEN
    RETURN json_build_object('success', false, 'error', 'Request is not pending');
  END IF;

  UPDATE deposit_requests
    SET status = 'rejected',
        reviewed_at = now(),
        reviewed_by = auth.uid(),
        admin_notes = p_admin_notes
    WHERE id = p_request_id;

  RETURN json_build_object('success', true);
END;
$$;

-- ─── 6. Extend submit_withdrawal with a 'capital' branch ────
-- The 'returns' branch is unchanged (debits cash_balance).
-- The 'capital' branch enforces min RM 5,000 and debits capital atomically.
-- CREATE OR REPLACE keeps the function signature identical so existing
-- client calls continue to work.

CREATE OR REPLACE FUNCTION submit_withdrawal(
  p_investor_id uuid,
  p_amount decimal,
  p_type text DEFAULT 'returns'
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_investor investors%ROWTYPE;
  v_withdrawal_id uuid;
BEGIN
  SELECT * INTO v_investor
    FROM investors
    WHERE id = p_investor_id
      AND user_id = auth.uid()
    FOR UPDATE;

  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'Investor not found or not yours');
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RETURN json_build_object('success', false, 'error', 'Amount must be positive');
  END IF;

  IF p_type = 'capital' THEN
    IF p_amount < 5000 THEN
      RETURN json_build_object('success', false, 'error', 'Minimum capital withdrawal is RM 5,000');
    END IF;

    IF p_amount > v_investor.capital THEN
      RETURN json_build_object('success', false, 'error', 'Amount exceeds your capital');
    END IF;

    INSERT INTO withdrawals (investor_id, amount, type, status)
      VALUES (p_investor_id, p_amount, 'capital', 'pending')
      RETURNING id INTO v_withdrawal_id;

    -- Debit capital immediately so the same idle can't be double-claimed
    UPDATE investors
      SET capital = capital - p_amount
      WHERE id = p_investor_id;

    RETURN json_build_object(
      'success', true,
      'withdrawal_id', v_withdrawal_id,
      'new_capital', v_investor.capital - p_amount
    );
  ELSE
    -- Existing returns branch
    IF p_amount > v_investor.cash_balance THEN
      RETURN json_build_object('success', false, 'error', 'Insufficient cash balance');
    END IF;

    INSERT INTO withdrawals (investor_id, amount, type, status)
      VALUES (p_investor_id, p_amount, 'returns', 'pending')
      RETURNING id INTO v_withdrawal_id;

    UPDATE investors
      SET cash_balance = cash_balance - p_amount
      WHERE id = p_investor_id;

    RETURN json_build_object(
      'success', true,
      'withdrawal_id', v_withdrawal_id,
      'new_balance', v_investor.cash_balance - p_amount
    );
  END IF;
END;
$$;

-- ─── 7. approve_withdrawal ──────────────────────────────────
-- Admin-only. Flips status to 'completed'. No balance change — the balance
-- was already debited at submit time. Sets processed_at so the ledger view
-- picks up the withdrawal (v_investor_ledger filters to status='completed').

CREATE OR REPLACE FUNCTION approve_withdrawal(
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
    FROM withdrawals
    WHERE id = p_withdrawal_id
    FOR UPDATE;

  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'Withdrawal not found');
  END IF;

  IF v_status NOT IN ('pending', 'approved') THEN
    RETURN json_build_object('success', false, 'error', 'Withdrawal already finalised');
  END IF;

  UPDATE withdrawals
    SET status = 'completed',
        reviewed_at = COALESCE(reviewed_at, now()),
        reviewed_by = COALESCE(reviewed_by, auth.uid()),
        processed_at = now(),
        notes = COALESCE(p_admin_notes, notes)
    WHERE id = p_withdrawal_id;

  RETURN json_build_object('success', true);
END;
$$;

-- ─── 8. reject_withdrawal ───────────────────────────────────
-- Admin-only. Refunds the debited balance (capital or cash_balance) and
-- marks the withdrawal rejected. Idempotent via the status check.

CREATE OR REPLACE FUNCTION reject_withdrawal(
  p_withdrawal_id uuid,
  p_admin_notes text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_withdrawal withdrawals%ROWTYPE;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin') THEN
    RETURN json_build_object('success', false, 'error', 'Admin only');
  END IF;

  SELECT * INTO v_withdrawal
    FROM withdrawals
    WHERE id = p_withdrawal_id
    FOR UPDATE;

  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'Withdrawal not found');
  END IF;

  IF v_withdrawal.status <> 'pending' AND v_withdrawal.status <> 'approved' THEN
    RETURN json_build_object('success', false, 'error', 'Withdrawal already finalised');
  END IF;

  -- Refund the debited balance
  IF v_withdrawal.type = 'capital' THEN
    UPDATE investors
      SET capital = capital + v_withdrawal.amount
      WHERE id = v_withdrawal.investor_id;
  ELSE
    UPDATE investors
      SET cash_balance = cash_balance + v_withdrawal.amount
      WHERE id = v_withdrawal.investor_id;
  END IF;

  UPDATE withdrawals
    SET status = 'rejected',
        reviewed_at = now(),
        reviewed_by = auth.uid(),
        notes = COALESCE(p_admin_notes, notes)
    WHERE id = p_withdrawal_id;

  RETURN json_build_object('success', true);
END;
$$;

-- ─── 9. Grants ──────────────────────────────────────────────

GRANT EXECUTE ON FUNCTION submit_deposit_request(uuid, decimal, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION approve_deposit_request(uuid, date, text) TO authenticated;
GRANT EXECUTE ON FUNCTION reject_deposit_request(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION approve_withdrawal(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION reject_withdrawal(uuid, text) TO authenticated;
