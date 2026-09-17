-- DRAFT purchase orders.
--
-- Converting an approved requisition used to create a live purchase order in
-- one step: the buyer typed a rate into a small form and an order existed,
-- receivable and invoiceable immediately. There was nowhere to put a
-- half-finished order — one where the vendor is chosen but the freight terms
-- are still being negotiated — so the choice was to invent the missing figures
-- or not to start.
--
-- DRAFT is that place. It sits before OPEN and is deliberately inert: not
-- receivable, not invoiceable, editable in full. Submitting it is what makes
-- it a real order, and that is the moment the requisition is marked converted.
--
-- Ordered FIRST in the enum because it precedes every other state, and enum
-- order is what `ORDER BY status` uses.

CREATE TYPE "PurchaseOrderStatus_new" AS ENUM (
  'DRAFT',
  'OPEN',
  'APPROVED',
  'PARTIALLY_RECEIVED',
  'CLOSED',
  'CANCELLED'
);

ALTER TABLE "purchase_orders"
  ALTER COLUMN "status" DROP DEFAULT;

-- Every existing value maps to itself: this migration only ADDS a state, and
-- no order currently in the database is a draft.
ALTER TABLE "purchase_orders"
  ALTER COLUMN "status" TYPE "PurchaseOrderStatus_new"
  USING ("status"::text)::"PurchaseOrderStatus_new";

-- The default stays OPEN. A draft is created deliberately, never by omission —
-- an order that became a draft because nobody said otherwise would sit
-- invisible to receiving and nobody would know why.
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
  v_default TEXT;
BEGIN
  SELECT string_agg(e.enumlabel, ',' ORDER BY e.enumsortorder)
    INTO v_labels
    FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
   WHERE t.typname = 'PurchaseOrderStatus';

  IF v_labels IS DISTINCT FROM 'DRAFT,OPEN,APPROVED,PARTIALLY_RECEIVED,CLOSED,CANCELLED' THEN
    RAISE EXCEPTION 'PurchaseOrderStatus is %, expected DRAFT,OPEN,APPROVED,PARTIALLY_RECEIVED,CLOSED,CANCELLED', v_labels;
  END IF;

  SELECT column_default INTO v_default
    FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'purchase_orders' AND column_name = 'status';

  IF v_default IS NULL OR v_default NOT LIKE '%OPEN%' THEN
    RAISE EXCEPTION 'purchase_orders.status default is %, expected OPEN', v_default;
  END IF;
END
$verify$;
