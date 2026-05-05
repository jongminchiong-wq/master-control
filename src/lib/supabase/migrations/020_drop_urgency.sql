-- Drop urgency from delivery_orders.
-- Risk buffer now depends only on PO size + delivery destination.
-- Removes both the column and its check constraint.

alter table public.delivery_orders drop column urgency;
