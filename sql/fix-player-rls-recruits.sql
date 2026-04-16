-- Fix: Allow players to read their recruits' player records and POs
-- Without these policies, the player dashboard cannot show introducer earnings
-- because RLS blocks access to other players' data.
--
-- IMPORTANT: Policies on `players` cannot subquery `players` directly — that
-- causes infinite recursion (ERROR 42P17). We use security-definer helper
-- functions to bypass RLS for the lookup.

-- ── Step 1: Drop any broken policies ────────────────────────
drop policy if exists "player_read_recruits" on players;
drop policy if exists "player_read_recruit_pos" on purchase_orders;
drop policy if exists "player_read_recruit_dos" on delivery_orders;

-- ── Step 2: Helper functions (security definer = bypass RLS) ─
create or replace function get_my_player_ids()
returns setof uuid language sql security definer stable
set search_path = public as $$
  select id from players where user_id = auth.uid();
$$;

create or replace function get_my_recruit_ids()
returns setof uuid language sql security definer stable
set search_path = public as $$
  select id from players
  where introduced_by in (select id from players where user_id = auth.uid());
$$;

-- ── Step 3: Recreate policies using the functions ────────────

-- Let a player see their recruits' player records
create policy "player_read_recruits" on players for select
  using (id in (select get_my_recruit_ids()));

-- Let a player see their recruits' purchase orders
create policy "player_read_recruit_pos" on purchase_orders for select
  using (end_user_id in (select get_my_recruit_ids()));

-- Let a player see their recruits' delivery orders
create policy "player_read_recruit_dos" on delivery_orders for select
  using (
    po_id in (
      select id from purchase_orders
      where end_user_id in (select get_my_recruit_ids())
    )
  );
