-- Short-closing a purchase order, and telling "everything arrived" apart from
-- "we stopped waiting for the rest".
--
-- THE PROBLEM THIS SOLVES. A purchase order's outstanding quantity was
-- ordered minus received, with no way to record that the remainder will never
-- arrive. Closing such an order by hand was the only option, and it removed the
-- order from the goods-receipt picker while its lines still showed a pending
-- quantity — so material that genuinely did turn up could not be booked, and
-- nothing recorded why.
--
-- Two additions, both minimal:
--
--   1. `purchase_order_lines.quantity_cancelled` — the part of the line the
--      buyer has given up on. Pending becomes ordered - received - cancelled,
--      so a short-closed line reaches zero pending WITHOUT anyone pretending it
--      was received. There is nowhere else this could live: the received
--      quantity is what arrived and must not absorb it.
--
--   2. `FULLY_RECEIVED` on the status enum. CLOSED had been carrying two
--      meanings — every unit arrived, and we short-closed the shortfall — which
--      are different facts about the vendor and cannot be distinguished after
--      the event.

-- -----------------------------------------------------------------------------
-- 1. The cancelled quantity
-- -----------------------------------------------------------------------------

ALTER TABLE "purchase_order_lines"
  ADD COLUMN IF NOT EXISTS "quantity_cancelled" NUMERIC(18, 4) NOT NULL DEFAULT 0;

COMMENT ON COLUMN "purchase_order_lines"."quantity_cancelled" IS
  'Quantity the buyer has short-closed and no longer expects. Pending = quantity - quantity_received - quantity_cancelled.';

-- -----------------------------------------------------------------------------
-- 2. FULLY_RECEIVED
-- -----------------------------------------------------------------------------
-- ADD VALUE rather than recreating the type. PostgreSQL refuses to USE a new
-- enum label in the transaction that added it, so nothing here may reference
-- FULLY_RECEIVED — the backfill that does lives in the next migration, which
-- runs in a transaction of its own.

ALTER TYPE "PurchaseOrderStatus" ADD VALUE IF NOT EXISTS 'FULLY_RECEIVED';

-- -----------------------------------------------------------------------------
-- 3. Assertion
-- -----------------------------------------------------------------------------

DO $verify$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'purchase_order_lines'
       AND column_name = 'quantity_cancelled'
  ) THEN
    RAISE EXCEPTION 'quantity_cancelled was not added to purchase_order_lines';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e
      JOIN pg_type t ON t.oid = e.enumtypid
     WHERE t.typname = 'PurchaseOrderStatus'
       AND e.enumlabel = 'FULLY_RECEIVED'
  ) THEN
    RAISE EXCEPTION 'FULLY_RECEIVED was not added to PurchaseOrderStatus';
  END IF;
END
$verify$;
