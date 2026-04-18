-- ============================================================
-- Master Control — Investor Withdrawals & Compounding
-- Adds: cash_balance + compound_at on investors
--        return_credits (idempotent crediting)
--        withdrawals (request/approval flow)
--        compound_log (audit trail)
-- ============================================================

-- ─── 1. Add columns to investors ────────────────────────────

ALTER TABLE investors
  ADD COLUMN cash_balance decimal NOT NULL DEFAULT 0,
  ADD COLUMN compound_at timestamptz;

-- ─── 2. Return credits (tracks which PO returns have been credited) ──

CREATE TABLE return_credits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  investor_id uuid NOT NULL REFERENCES investors(id) ON DELETE CASCADE,
  po_id uuid NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  amount decimal NOT NULL,
  deployed decimal NOT NULL DEFAULT 0,
  tier_rate decimal NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  UNIQUE(investor_id, po_id)
);

-- ─── 3. Withdrawals (investor request → admin approval) ─────

CREATE TABLE withdrawals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  investor_id uuid NOT NULL REFERENCES investors(id) ON DELETE CASCADE,
  amount decimal NOT NULL CHECK (amount > 0),
  type text NOT NULL CHECK (type IN ('returns', 'capital')),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'completed')),
  requested_at timestamptz DEFAULT now(),
  reviewed_at timestamptz,
  reviewed_by uuid REFERENCES users(id),
  processed_at timestamptz,
  notes text,
  created_at timestamptz DEFAULT now()
);

-- ─── 4. Compound log (audit trail for every compound event) ──

CREATE TABLE compound_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  investor_id uuid NOT NULL REFERENCES investors(id) ON DELETE CASCADE,
  amount decimal NOT NULL,
  source text NOT NULL CHECK (source IN ('auto', 'manual_reinvest', 'admin')),
  capital_before decimal NOT NULL,
  capital_after decimal NOT NULL,
  tier_before text,
  tier_after text,
  created_at timestamptz DEFAULT now()
);

-- ─── 5. RLS ─────────────────────────────────────────────────

ALTER TABLE return_credits ENABLE ROW LEVEL SECURITY;
ALTER TABLE withdrawals ENABLE ROW LEVEL SECURITY;
ALTER TABLE compound_log ENABLE ROW LEVEL SECURITY;

-- Admin: full access to all new tables
CREATE POLICY "admin_full_return_credits" ON return_credits FOR ALL
  USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'));

CREATE POLICY "admin_full_withdrawals" ON withdrawals FOR ALL
  USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'));

CREATE POLICY "admin_full_compound_log" ON compound_log FOR ALL
  USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'admin'));

-- Investor: read own return_credits
CREATE POLICY "investor_read_own_credits" ON return_credits FOR SELECT
  USING (investor_id IN (SELECT id FROM investors WHERE user_id = auth.uid()));

-- Investor: read own withdrawals
CREATE POLICY "investor_read_own_withdrawals" ON withdrawals FOR SELECT
  USING (investor_id IN (SELECT id FROM investors WHERE user_id = auth.uid()));

-- Investor: create own withdrawal requests (pending only)
CREATE POLICY "investor_insert_own_withdrawals" ON withdrawals FOR INSERT
  WITH CHECK (
    investor_id IN (SELECT id FROM investors WHERE user_id = auth.uid())
    AND status = 'pending'
  );

-- Investor: read own compound_log
CREATE POLICY "investor_read_own_compound_log" ON compound_log FOR SELECT
  USING (investor_id IN (SELECT id FROM investors WHERE user_id = auth.uid()));

-- Investor: needs to update own cash_balance (for reinvest)
-- Already covered by existing "investor_read_self" SELECT policy.
-- For UPDATE, we need a new policy:
CREATE POLICY "investor_update_self" ON investors FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
