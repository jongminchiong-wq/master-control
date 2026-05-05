ALTER TABLE purchase_orders
  ADD COLUMN other_cost numeric NOT NULL DEFAULT 0,
  ADD COLUMN other_cost_reason text;
