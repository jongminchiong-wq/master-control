-- ============================================================
-- Master Control — Seed Data
-- 4 players, 10 POs, 2-3 DOs each, 3 investors, 1 month OPEX
-- ============================================================

-- ─── Users (role mapping for auth) ─────────────────────────
-- IMPORTANT: Replace the UUID below with your actual Supabase Auth user ID.
-- Find it in Supabase Dashboard → Authentication → Users → copy the user's UUID.
--
-- Without this row, login will succeed (auth works) but the proxy
-- cannot determine your role, so you get redirected back to /login.

-- insert into users (id, email, name, role) values
--   ('REPLACE-WITH-YOUR-AUTH-USER-UUID', 'your@email.com', 'Your Name', 'admin');

-- ─── Players ────────────────────────────────────────────────
-- Player 1: Ahmad (no introducer, tier mode A/A)
-- Player 2: Siti (no introducer, tier mode B/A)
-- Player 3: Rajan (introduced by Ahmad, tier mode A/B)
-- Player 4: Mei Ling (introduced by Siti, tier mode A/A)

insert into players (id, name, eu_tier_mode, intro_tier_mode, introduced_by) values
  ('a1000000-0000-0000-0000-000000000001', 'Ahmad bin Ismail',   'A', 'A', null),
  ('a1000000-0000-0000-0000-000000000002', 'Siti Nurhaliza',     'B', 'A', null),
  ('a1000000-0000-0000-0000-000000000003', 'Rajan Krishnan',     'A', 'B', 'a1000000-0000-0000-0000-000000000001'),
  ('a1000000-0000-0000-0000-000000000004', 'Mei Ling Tan',       'A', 'A', 'a1000000-0000-0000-0000-000000000002');


-- ─── Purchase Orders ────────────────────────────────────────
-- 10 POs across 2 months (2026-03 and 2026-04)
-- Mix of Punchout and GEP channels

-- March 2026 POs (6 POs)
insert into purchase_orders (id, ref, channel, end_user_id, po_date, po_amount, commissions_cleared) values
  ('b2000000-0000-0000-0000-000000000001', 'PPO-001', 'punchout', 'a1000000-0000-0000-0000-000000000001', '2026-03-03', 85000,  '2026-04-05'),
  ('b2000000-0000-0000-0000-000000000002', 'GEP-002', 'gep',      'a1000000-0000-0000-0000-000000000001', '2026-03-10', 120000, null),
  ('b2000000-0000-0000-0000-000000000003', 'PPO-003', 'punchout', 'a1000000-0000-0000-0000-000000000002', '2026-03-05', 95000,  null),
  ('b2000000-0000-0000-0000-000000000004', 'GEP-004', 'gep',      'a1000000-0000-0000-0000-000000000003', '2026-03-12', 72000,  null),
  ('b2000000-0000-0000-0000-000000000005', 'PPO-005', 'punchout', 'a1000000-0000-0000-0000-000000000004', '2026-03-18', 110000, null),
  ('b2000000-0000-0000-0000-000000000006', 'PPO-006', 'punchout', 'a1000000-0000-0000-0000-000000000002', '2026-03-25', 65000,  null);

-- April 2026 POs (4 POs)
insert into purchase_orders (id, ref, channel, end_user_id, po_date, po_amount, commissions_cleared) values
  ('b2000000-0000-0000-0000-000000000007', 'GEP-007', 'gep',      'a1000000-0000-0000-0000-000000000001', '2026-04-02', 145000, null),
  ('b2000000-0000-0000-0000-000000000008', 'PPO-008', 'punchout', 'a1000000-0000-0000-0000-000000000003', '2026-04-05', 88000,  null),
  ('b2000000-0000-0000-0000-000000000009', 'PPO-009', 'punchout', 'a1000000-0000-0000-0000-000000000004', '2026-04-08', 130000, null),
  ('b2000000-0000-0000-0000-000000000010', 'GEP-010', 'gep',      'a1000000-0000-0000-0000-000000000002', '2026-04-10', 97000,  null);


-- ─── Delivery Orders ───────────────────────────────────────
-- 2-3 DOs per PO at different lifecycle stages

-- PPO-001: Fully paid + cleared (all DOs buyer-paid)
insert into delivery_orders (id, po_id, ref, description, amount, delivery, supplier_paid, delivered, invoiced, buyer_paid) values
  ('c3000000-0000-0000-0000-000000000001', 'b2000000-0000-0000-0000-000000000001', 'DO-0101', '5x mechanical seals, 3x gaskets',         42000, 'local', '2026-03-05', '2026-03-08', '2026-03-10', '2026-03-28'),
  ('c3000000-0000-0000-0000-000000000002', 'b2000000-0000-0000-0000-000000000001', 'DO-0102', '2x flange sets, 10x bolt packs',           28000, 'local', '2026-03-06', '2026-03-09', '2026-03-11', '2026-03-30'),
  ('c3000000-0000-0000-0000-000000000003', 'b2000000-0000-0000-0000-000000000001', 'DO-0103', '1x pressure gauge kit',                     8500, 'sea', '2026-03-07', '2026-03-14', '2026-03-16', '2026-04-02');

-- GEP-002: Partially paid (2 of 3 DOs buyer-paid)
insert into delivery_orders (id, po_id, ref, description, amount, delivery, supplier_paid, delivered, invoiced, buyer_paid) values
  ('c3000000-0000-0000-0000-000000000004', 'b2000000-0000-0000-0000-000000000002', 'DO-0201', '20x pipe fittings, 5x valves',             55000, 'local', '2026-03-12', '2026-03-15', '2026-03-18', '2026-04-01'),
  ('c3000000-0000-0000-0000-000000000005', 'b2000000-0000-0000-0000-000000000002', 'DO-0202', '3x actuator assemblies',                   38000, 'sea', '2026-03-13', '2026-03-20', '2026-03-22', '2026-04-05'),
  ('c3000000-0000-0000-0000-000000000006', 'b2000000-0000-0000-0000-000000000002', 'DO-0203', '1x instrument panel',                      15000, 'local', '2026-03-14', '2026-03-16', '2026-03-18', null);

-- PPO-003: Invoiced, awaiting payment (delivered + invoiced, not buyer-paid)
insert into delivery_orders (id, po_id, ref, description, amount, delivery, supplier_paid, delivered, invoiced, buyer_paid) values
  ('c3000000-0000-0000-0000-000000000007', 'b2000000-0000-0000-0000-000000000003', 'DO-0301', '8x safety valves',                         48000, 'local', '2026-03-07', '2026-03-10', '2026-03-15', null),
  ('c3000000-0000-0000-0000-000000000008', 'b2000000-0000-0000-0000-000000000003', 'DO-0302', '15x PPE kits, 5x fire extinguishers',       32000, 'sea', '2026-03-08', '2026-03-16', '2026-03-20', null);

-- GEP-004: Delivered, not yet invoiced
insert into delivery_orders (id, po_id, ref, description, amount, delivery, supplier_paid, delivered, invoiced, buyer_paid) values
  ('c3000000-0000-0000-0000-000000000009', 'b2000000-0000-0000-0000-000000000004', 'DO-0401', '3x pump impellers',                        35000, 'local', '2026-03-14', '2026-03-18', null,         null),
  ('c3000000-0000-0000-0000-000000000010', 'b2000000-0000-0000-0000-000000000004', 'DO-0402', '1x motor coupling set',                    22000, 'sea', '2026-03-15', '2026-03-22', null,         null);

-- PPO-005: Supplier paid, awaiting delivery
insert into delivery_orders (id, po_id, ref, description, amount, delivery, supplier_paid, delivered, invoiced, buyer_paid) values
  ('c3000000-0000-0000-0000-000000000011', 'b2000000-0000-0000-0000-000000000005', 'DO-0501', '12x stainless steel flanges',               52000, 'international', '2026-03-20', null, null, null),
  ('c3000000-0000-0000-0000-000000000012', 'b2000000-0000-0000-0000-000000000005', 'DO-0502', '6x bearing housings',                       35000, 'sea', '2026-03-21', null, null, null),
  ('c3000000-0000-0000-0000-000000000013', 'b2000000-0000-0000-0000-000000000005', 'DO-0503', '2x shaft sleeves',                          12000, 'local', '2026-03-22', null, null, null);

-- PPO-006: Fresh PO, supplier not yet paid
insert into delivery_orders (id, po_id, ref, description, amount, delivery, supplier_paid, delivered, invoiced, buyer_paid) values
  ('c3000000-0000-0000-0000-000000000014', 'b2000000-0000-0000-0000-000000000006', 'DO-0601', '4x hydraulic hoses',                        28000, 'local', null, null, null, null),
  ('c3000000-0000-0000-0000-000000000015', 'b2000000-0000-0000-0000-000000000006', 'DO-0602', '10x O-ring kits',                           18000, 'local', null, null, null, null);

-- GEP-007: Fully paid (all DOs buyer-paid, commissions not yet cleared)
insert into delivery_orders (id, po_id, ref, description, amount, delivery, supplier_paid, delivered, invoiced, buyer_paid) values
  ('c3000000-0000-0000-0000-000000000016', 'b2000000-0000-0000-0000-000000000007', 'DO-0701', '6x control valves',                         68000, 'local', '2026-04-03', '2026-04-05', '2026-04-07', '2026-04-10'),
  ('c3000000-0000-0000-0000-000000000017', 'b2000000-0000-0000-0000-000000000007', 'DO-0702', '3x pressure transmitters',                  42000, 'sea', '2026-04-04', '2026-04-08', '2026-04-09', '2026-04-12'),
  ('c3000000-0000-0000-0000-000000000018', 'b2000000-0000-0000-0000-000000000007', 'DO-0703', '1x thermocouple set',                       18000, 'local', '2026-04-04', '2026-04-06', '2026-04-08', '2026-04-11');

-- PPO-008: Mixed — 1 DO buyer-paid, 1 invoiced
insert into delivery_orders (id, po_id, ref, description, amount, delivery, supplier_paid, delivered, invoiced, buyer_paid) values
  ('c3000000-0000-0000-0000-000000000019', 'b2000000-0000-0000-0000-000000000008', 'DO-0801', '4x centrifugal pump parts',                 45000, 'local', '2026-04-06', '2026-04-08', '2026-04-10', '2026-04-13'),
  ('c3000000-0000-0000-0000-000000000020', 'b2000000-0000-0000-0000-000000000008', 'DO-0802', '2x impeller shafts',                        28000, 'sea', '2026-04-07', '2026-04-11', '2026-04-12', null);

-- PPO-009: Supplier paid, pending delivery
insert into delivery_orders (id, po_id, ref, description, amount, delivery, supplier_paid, delivered, invoiced, buyer_paid) values
  ('c3000000-0000-0000-0000-000000000021', 'b2000000-0000-0000-0000-000000000009', 'DO-0901', '10x stud bolts, 20x nuts',                  55000, 'international', '2026-04-09', null, null, null),
  ('c3000000-0000-0000-0000-000000000022', 'b2000000-0000-0000-0000-000000000009', 'DO-0902', '5x gasket sheets',                          38000, 'local', '2026-04-10', null, null, null),
  ('c3000000-0000-0000-0000-000000000023', 'b2000000-0000-0000-0000-000000000009', 'DO-0903', '2x expansion joints',                       22000, 'sea', '2026-04-10', null, null, null);

-- GEP-010: Fresh, no supplier payment yet
insert into delivery_orders (id, po_id, ref, description, amount, delivery, supplier_paid, delivered, invoiced, buyer_paid) values
  ('c3000000-0000-0000-0000-000000000024', 'b2000000-0000-0000-0000-000000000010', 'DO-1001', '8x gate valves',                            50000, 'local', null, null, null, null),
  ('c3000000-0000-0000-0000-000000000025', 'b2000000-0000-0000-0000-000000000010', 'DO-1002', '3x check valves',                           28000, 'sea', null, null, null, null);


-- ─── Investors ──────────────────────────────────────────────
-- 3 investors with different capital amounts
-- Investor 1: Tan Sri Razak — Gold tier (RM 150K), no introducer
-- Investor 2: Datin Farah — Silver tier (RM 30K), introduced by Tan Sri Razak
-- Investor 3: James Ong — Standard tier (RM 8K), no introducer

insert into investors (id, name, capital, date_joined, introduced_by) values
  ('d4000000-0000-0000-0000-000000000001', 'Tan Sri Razak',  150000, '2026-01-15', null),
  ('d4000000-0000-0000-0000-000000000002', 'Datin Farah',     30000, '2026-02-01', 'd4000000-0000-0000-0000-000000000001'),
  ('d4000000-0000-0000-0000-000000000003', 'James Ong',        8000, '2026-03-01', null);


-- ─── Monthly OPEX ───────────────────────────────────────────
-- March 2026

insert into opex (month, rental, salary, utilities, others) values
  ('2026-03', 3500, 8500, 1200, 2800);
