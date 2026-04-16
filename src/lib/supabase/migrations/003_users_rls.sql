-- ============================================================
-- Fix: Add missing RLS policy for the users table
--
-- The users table has RLS enabled (002_rls.sql) but no policy
-- allowing users to read their own row. This breaks the proxy's
-- role lookup — authenticated users can't read their own role.
--
-- Run this AFTER 002_rls.sql.
-- ============================================================

-- Allow every authenticated user to read their own row
create policy "users_read_own" on users
  for select
  using (id = auth.uid());
