-- ══════════════════════════════════════════════════════════════
-- 007_compound_log_shared_read.sql
--
-- The investor deployment allocator reads every investor's
-- compound_log to defer reinvested returns to their actual date
-- (instead of retroactively inflating allocations on prior POs).
-- Without visibility into sibling rows, the portfolio page would
-- compute the same pre-fix numbers an admin sees post-fix.
--
-- Precedent: `investor_read_all_investors`, `investor_read_all_pos`,
-- and `investor_read_all_dos` in 002_rls.sql already expose the same
-- class of shared pool data to every logged-in investor. Capital
-- history is no more sensitive than current capital (already visible).
-- ══════════════════════════════════════════════════════════════

CREATE POLICY "investor_read_all_compound_log" ON compound_log FOR SELECT
  USING (EXISTS (SELECT 1 FROM users WHERE id = auth.uid() AND role = 'investor'));
