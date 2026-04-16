-- ============================================================
-- Master Control — Row-Level Security Policies
-- Admin: full CRUD on all tables
-- Player: SELECT only on own data
-- Investor: SELECT only on own data
-- ============================================================

-- Enable RLS on all tables
alter table users enable row level security;
alter table players enable row level security;
alter table investors enable row level security;
alter table purchase_orders enable row level security;
alter table delivery_orders enable row level security;
alter table opex enable row level security;

-- ─── Admin: full access to everything ───────────────────────

create policy "admin_full_users" on users for all
  using (exists (select 1 from users where id = auth.uid() and role = 'admin'));

create policy "admin_full_players" on players for all
  using (exists (select 1 from users where id = auth.uid() and role = 'admin'));

create policy "admin_full_investors" on investors for all
  using (exists (select 1 from users where id = auth.uid() and role = 'admin'));

create policy "admin_full_purchase_orders" on purchase_orders for all
  using (exists (select 1 from users where id = auth.uid() and role = 'admin'));

create policy "admin_full_delivery_orders" on delivery_orders for all
  using (exists (select 1 from users where id = auth.uid() and role = 'admin'));

create policy "admin_full_opex" on opex for all
  using (exists (select 1 from users where id = auth.uid() and role = 'admin'));

-- ─── Player: read own data only ─────────────────────────────

-- Players can read their own player record
create policy "player_read_self" on players for select
  using (user_id = auth.uid());

-- Players can read POs where they are the end-user
create policy "player_read_own_pos" on purchase_orders for select
  using (
    end_user_id in (
      select id from players where user_id = auth.uid()
    )
  );

-- Players can read DOs that belong to their POs
create policy "player_read_own_dos" on delivery_orders for select
  using (
    po_id in (
      select id from purchase_orders
      where end_user_id in (
        select id from players where user_id = auth.uid()
      )
    )
  );

-- ─── Investor: read own data only ───────────────────────────

-- Investors can read their own investor record
create policy "investor_read_self" on investors for select
  using (user_id = auth.uid());

-- Investors can read all investor records (needed for proportional deployment calculation)
create policy "investor_read_all_investors" on investors for select
  using (exists (select 1 from users where id = auth.uid() and role = 'investor'));

-- Investors can read all purchase orders (needed for deployment calculation)
create policy "investor_read_all_pos" on purchase_orders for select
  using (exists (select 1 from users where id = auth.uid() and role = 'investor'));

-- Investors can read all delivery orders (needed for cycle completion status)
create policy "investor_read_all_dos" on delivery_orders for select
  using (exists (select 1 from users where id = auth.uid() and role = 'investor'));
