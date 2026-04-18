-- ============================================================
-- Master Control — Secure Investor RPCs
-- Fixes: removes broad investor UPDATE policy on investors table
--        and replaces client-side mutations with atomic RPCs
-- ============================================================

-- ─── 1. Drop the dangerous broad UPDATE policy ─────────────
-- This policy let investors update ANY column on their own record
-- (capital, cash_balance, date_joined, introduced_by, etc.)

DROP POLICY IF EXISTS "investor_update_self" ON investors;

-- ─── 2. submit_withdrawal ───────────────────────────────────
-- Atomically: lock row → check balance → insert withdrawal → deduct cash
-- Called by investor from portfolio page

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
  -- Verify the caller owns this investor record
  SELECT * INTO v_investor
    FROM investors
    WHERE id = p_investor_id
      AND user_id = auth.uid()
    FOR UPDATE;

  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'Investor not found or not yours');
  END IF;

  -- Validate amount
  IF p_amount <= 0 THEN
    RETURN json_build_object('success', false, 'error', 'Amount must be positive');
  END IF;

  IF p_amount > v_investor.cash_balance THEN
    RETURN json_build_object('success', false, 'error', 'Insufficient cash balance');
  END IF;

  -- Insert withdrawal request
  INSERT INTO withdrawals (investor_id, amount, type, status)
    VALUES (p_investor_id, p_amount, p_type, 'pending')
    RETURNING id INTO v_withdrawal_id;

  -- Deduct cash_balance atomically
  UPDATE investors
    SET cash_balance = cash_balance - p_amount
    WHERE id = p_investor_id;

  RETURN json_build_object(
    'success', true,
    'withdrawal_id', v_withdrawal_id,
    'new_balance', v_investor.cash_balance - p_amount
  );
END;
$$;

-- ─── 3. reinvest_cash ───────────────────────────────────────
-- Atomically: lock row → move cash_balance into capital → log event
-- Called by investor (manual reinvest) or admin (force compound)

CREATE OR REPLACE FUNCTION reinvest_cash(
  p_investor_id uuid,
  p_source text DEFAULT 'manual_reinvest'
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_investor investors%ROWTYPE;
  v_new_capital decimal;
  v_tier_before text;
  v_tier_after text;
  v_amount decimal;
BEGIN
  -- Lock the investor row
  SELECT * INTO v_investor
    FROM investors
    WHERE id = p_investor_id
    FOR UPDATE;

  IF NOT FOUND THEN
    RETURN json_build_object('success', false, 'error', 'Investor not found');
  END IF;

  -- For non-admin callers, verify ownership
  IF p_source IN ('manual_reinvest', 'auto') THEN
    IF v_investor.user_id != auth.uid() THEN
      RETURN json_build_object('success', false, 'error', 'Not your investor record');
    END IF;
  ELSE
    -- Admin source: verify caller is admin
    IF NOT EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin') THEN
      RETURN json_build_object('success', false, 'error', 'Admin only');
    END IF;
  END IF;

  v_amount := v_investor.cash_balance;

  IF v_amount <= 0 THEN
    RETURN json_build_object('success', false, 'error', 'No cash to reinvest');
  END IF;

  v_new_capital := v_investor.capital + v_amount;

  -- Determine tier names (based on INV_TIERS thresholds)
  v_tier_before := CASE
    WHEN v_investor.capital >= 50000 THEN 'Gold'
    WHEN v_investor.capital >= 10000 THEN 'Silver'
    ELSE 'Standard'
  END;
  v_tier_after := CASE
    WHEN v_new_capital >= 50000 THEN 'Gold'
    WHEN v_new_capital >= 10000 THEN 'Silver'
    ELSE 'Standard'
  END;

  -- Update investor: move cash → capital
  UPDATE investors
    SET capital = v_new_capital,
        cash_balance = 0,
        compound_at = NULL
    WHERE id = p_investor_id;

  -- Write audit log
  INSERT INTO compound_log (investor_id, amount, source, capital_before, capital_after, tier_before, tier_after)
    VALUES (p_investor_id, v_amount, p_source, v_investor.capital, v_new_capital, v_tier_before, v_tier_after);

  RETURN json_build_object(
    'success', true,
    'amount', v_amount,
    'capital_before', v_investor.capital,
    'capital_after', v_new_capital,
    'tier_before', v_tier_before,
    'tier_after', v_tier_after
  );
END;
$$;

-- ─── 4. credit_investor_return ───────────────────────────────
-- Atomically: insert return_credit (skip if duplicate) → increment cash_balance
-- Called by admin from the investors page for each deployment
-- Uses ON CONFLICT to guarantee idempotency

CREATE OR REPLACE FUNCTION credit_investor_return(
  p_investor_id uuid,
  p_po_id uuid,
  p_amount decimal,
  p_deployed decimal,
  p_tier_rate decimal,
  p_compound_window_days int DEFAULT 7
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_credit_id uuid;
  v_new_balance decimal;
BEGIN
  -- Verify caller is admin
  IF NOT EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin') THEN
    RETURN json_build_object('success', false, 'error', 'Admin only');
  END IF;

  -- Try to insert the credit row (skip if already credited)
  INSERT INTO return_credits (investor_id, po_id, amount, deployed, tier_rate)
    VALUES (p_investor_id, p_po_id, p_amount, p_deployed, p_tier_rate)
    ON CONFLICT (investor_id, po_id) DO NOTHING
    RETURNING id INTO v_credit_id;

  -- If the insert was skipped (duplicate), return early
  IF v_credit_id IS NULL THEN
    RETURN json_build_object('success', false, 'error', 'Already credited', 'duplicate', true);
  END IF;

  -- Atomically INCREMENT cash_balance (not overwrite) and set compound_at if not set
  UPDATE investors
    SET cash_balance = cash_balance + p_amount,
        compound_at = COALESCE(compound_at, now() + (p_compound_window_days || ' days')::interval)
    WHERE id = p_investor_id
    RETURNING cash_balance INTO v_new_balance;

  RETURN json_build_object(
    'success', true,
    'credit_id', v_credit_id,
    'new_balance', v_new_balance
  );
END;
$$;

-- ─── 5. Grant execute to authenticated users ────────────────

GRANT EXECUTE ON FUNCTION submit_withdrawal(uuid, decimal, text) TO authenticated;
GRANT EXECUTE ON FUNCTION reinvest_cash(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION credit_investor_return(uuid, uuid, decimal, decimal, decimal, int) TO authenticated;
