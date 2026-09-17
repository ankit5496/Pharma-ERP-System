-- The purchase order status vocabulary the business actually uses.
--
--   Open               raised, not yet approved
--   Approved           authorised to send to the vendor
--   Partially Received some of it has arrived
--   Closed             fully received, OR short closed with the balance cancelled
--   Cancelled          abandoned
--
-- TWO CHANGES, and the second undoes something I added a migration ago.
--
--   1. APPROVED is new. A purchase order was raised and immediately
--      receivable, with no step in between, so "has anyone authorised this?"
--      had no answer.
--
--   2. FULLY_RECEIVED is REMOVED. 20260916000000 split it out of CLOSED on the
--      reading that "every unit arrived" and "we cancelled the shortfall" are
--      different facts. They are, but the business wants one word for "this
--      order is finished" — Closed — and the distinction is already recoverable
--      from the lines, where a short-closed order carries a cancelled quantity
--      and a fully received one does not. Keeping a status nobody asked for
--      would be two names for one state.
--
-- Rows are remapped inside the ALTER TABLE ... USING clause rather than by a
-- preparatory UPDATE. These tables are FORCE ROW LEVEL SECURITY, so an UPDATE
-- issued here — with no tenant set — matches ZERO rows and reports success. DDL
-- is not subject to row-level security, so the USING conversion reaches every
-- row of every tenant, which is exactly what a vocabulary change must do.

CREATE TYPE "PurchaseOrderStatus_new" AS ENUM (
  'OPEN',
  'APPROVED',
  'PARTIALLY_RECEIVED',
  'CLOSED',
  'CANCELLED'
);

ALTER TABLE "purchase_orders"
  ALTER COLUMN "status" DROP DEFAULT;

ALTER TABLE "purchase_orders"
  ALTER COLUMN "status" TYPE "PurchaseOrderStatus_new"
  USING (
    CASE "status"::text
      WHEN 'FULLY_RECEIVED' THEN 'CLOSED'
      ELSE "status"::text
    END
  )::"PurchaseOrderStatus_new";

ALTER TABLE "purchase_orders"
  ALTER COLUMN "status" SET DEFAULT 'OPEN';

DROP TYPE "PurchaseOrderStatus";

ALTER TYPE "PurchaseOrderStatus_new" RENAME TO "PurchaseOrderStatus";

-- -----------------------------------------------------------------------------
-- Assertion
-- -----------------------------------------------------------------------------

DO $verify$
DECLARE
  v_labels TEXT;
BEGIN
  SELECT string_agg(e.enumlabel, ',' ORDER BY e.enumsortorder)
    INTO v_labels
    FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
   WHERE t.typname = 'PurchaseOrderStatus';

  IF v_labels IS DISTINCT FROM 'OPEN,APPROVED,PARTIALLY_RECEIVED,CLOSED,CANCELLED' THEN
    RAISE EXCEPTION 'PurchaseOrderStatus is %, expected OPEN,APPROVED,PARTIALLY_RECEIVED,CLOSED,CANCELLED', v_labels;
  END IF;
END
$verify$;
