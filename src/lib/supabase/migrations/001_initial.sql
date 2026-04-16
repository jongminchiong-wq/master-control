-- ============================================================
-- Master Control — Initial Schema
-- 6 tables: users, players, investors, purchase_orders,
--           delivery_orders, opex
-- ============================================================

-- Users (linked to Supabase Auth)
create table users (
  id uuid primary key references auth.users(id),
  email text not null,
  name text not null,
  role text not null check (role in ('admin', 'player', 'investor')),
  created_at timestamptz default now()
);

-- Players (end-users who bring POs)
create table players (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id),
  name text not null,
  eu_tier_mode text default 'A' check (eu_tier_mode in ('A', 'B')),
  intro_tier_mode text default 'A' check (intro_tier_mode in ('A', 'B')),
  introduced_by uuid references players(id),
  created_at timestamptz default now()
);

-- Investors
create table investors (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id),
  name text not null,
  capital decimal not null default 0,
  date_joined date,
  introduced_by uuid references investors(id),
  created_at timestamptz default now()
);

-- Purchase Orders
create table purchase_orders (
  id uuid primary key default gen_random_uuid(),
  ref text not null unique,
  channel text not null check (channel in ('punchout', 'gep')),
  end_user_id uuid not null references players(id),
  po_date date not null,
  po_amount decimal not null default 0,
  commissions_cleared date,
  created_at timestamptz default now()
);

-- Delivery Orders (children of POs — cascade delete)
create table delivery_orders (
  id uuid primary key default gen_random_uuid(),
  po_id uuid not null references purchase_orders(id) on delete cascade,
  ref text not null,
  description text,
  amount decimal not null default 0,
  delivery text default 'local' check (delivery in ('local', 'sea', 'international')),
  urgency text default 'normal' check (urgency in ('normal', 'urgent', 'rush')),
  supplier_paid date,
  delivered date,
  invoiced date,
  buyer_paid date,
  created_at timestamptz default now()
);

-- Monthly OPEX
create table opex (
  id uuid primary key default gen_random_uuid(),
  month text not null unique,
  rental decimal default 0,
  salary decimal default 0,
  utilities decimal default 0,
  others decimal default 0,
  created_at timestamptz default now()
);
