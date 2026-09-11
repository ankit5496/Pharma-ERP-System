-- =============================================================================
-- Purchase order and invoice statuses, as the specification names them
-- =============================================================================
-- US-PUR-02 gives the purchase order exactly three working states —
-- Open, Partially Received, Closed — driven entirely by goods receipts. The
-- earlier enum carried six, two of which (DRAFT, ISSUED) described an issuing
-- step the specification does not have, and FULLY_RECEIVED duplicated what
-- CLOSED means there.
--
-- US-PUR-05 does the same for the invoice: Booked, Partially Paid, Paid, all
-- automatic from payment progress. The earlier DRAFT/APPROVED pair described
-- an approval step the specification does not have, and left payment progress
-- to a separate derived field that the status column then contradicted.
--
-- WHY DDL AND NOT UPDATE. Every value is remapped inside ALTER TABLE ... USING
-- rather than by a preparatory UPDATE. That is not a style preference: these
-- tables are FORCE ROW LEVEL SECURITY, so an UPDATE issued by a migration —
-- which runs with no tenant set — matches ZERO rows and reports success. DDL
-- is not subject to row-level security, so the USING clause reaches every row
-- whatever tenant owns it.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Purchase order: Open -> Partially Received -> Closed
-- -----------------------------------------------------------------------------
-- DRAFT and ISSUED both become OPEN: a purchase order raised from an approved
-- requisition is open for receipt immediately, and the specification has no
-- separate issuing gate. FULLY_RECEIVED becomes CLOSED, which is what
-- US-PUR-03 calls the state once the ordered quantity has all arrived.

BEGIN;

CREATE TYPE "PurchaseOrderStatus_new" AS ENUM ('OPEN', 'PARTIALLY_RECEIVED', 'CLOSED', 'CANCELLED');

ALTER TABLE "purchase_orders" ALTER COLUMN "status" DROP DEFAULT;

ALTER TABLE "purchase_orders"
  ALTER COLUMN "status" TYPE "PurchaseOrderStatus_new"
  USING (
    CASE "status"::text
      WHEN 'DRAFT'           THEN 'OPEN'
      WHEN 'ISSUED'          THEN 'OPEN'
      WHEN 'FULLY_RECEIVED'  THEN 'CLOSED'
      ELSE "status"::text
    END
  )::"PurchaseOrderStatus_new";

ALTER TYPE "PurchaseOrderStatus" RENAME TO "PurchaseOrderStatus_old";
ALTER TYPE "PurchaseOrderStatus_new" RENAME TO "PurchaseOrderStatus";
DROP TYPE "PurchaseOrderStatus_old";

ALTER TABLE "purchase_orders" ALTER COLUMN "status" SET DEFAULT 'OPEN';

COMMIT;

-- `issued_at` loses its meaning with the issuing step gone. Kept rather than
-- dropped: it records when existing orders were released to their vendor, and
-- dropping a column to tidy up a rename destroys history that cost nothing to
-- keep.
COMMENT ON COLUMN "purchase_orders"."issued_at" IS
  'When the order was released to the vendor under the earlier draft/issued workflow. Retained for historic orders; not set by the current flow, where an order is Open from creation.';

-- -----------------------------------------------------------------------------
-- 2. Purchase invoice: Booked -> Partially Paid -> Paid
-- -----------------------------------------------------------------------------
-- The status now IS the payment progress, updated by the payment service, so
-- there is one answer to "has this been paid" rather than a stored status and
-- a derived one that can disagree.

BEGIN;

CREATE TYPE "PurchaseInvoiceStatus_new" AS ENUM ('BOOKED', 'PARTIALLY_PAID', 'PAID', 'CANCELLED');

ALTER TABLE "purchase_invoices" ALTER COLUMN "status" DROP DEFAULT;

ALTER TABLE "purchase_invoices"
  ALTER COLUMN "status" TYPE "PurchaseInvoiceStatus_new"
  USING (
    CASE "status"::text
      WHEN 'DRAFT'    THEN 'BOOKED'
      WHEN 'APPROVED' THEN 'BOOKED'
      ELSE "status"::text
    END
  )::"PurchaseInvoiceStatus_new";

ALTER TYPE "PurchaseInvoiceStatus" RENAME TO "PurchaseInvoiceStatus_old";
ALTER TYPE "PurchaseInvoiceStatus_new" RENAME TO "PurchaseInvoiceStatus";
DROP TYPE "PurchaseInvoiceStatus_old";

ALTER TABLE "purchase_invoices" ALTER COLUMN "status" SET DEFAULT 'BOOKED';

COMMIT;

-- -----------------------------------------------------------------------------
-- 3. Re-derive invoice status from payments already recorded
-- -----------------------------------------------------------------------------
-- Everything above mapped an old invoice to BOOKED regardless of what had been
-- paid against it. This corrects that from the payments themselves.
--
-- It is a DO block running a single UPDATE, and the RLS caveat at the top of
-- this file applies: with no tenant set the UPDATE would match nothing. So it
-- loops the tenants and sets the tenant context for each, which is the only
-- way a migration can legitimately touch tenant-scoped rows.

DO $repair$
DECLARE
  v_tenant uuid;
  v_updated int;
  v_total int := 0;
BEGIN
  FOR v_tenant IN SELECT id FROM tenants LOOP
    PERFORM set_config('app.current_tenant_id', v_tenant::text, true);

    UPDATE "purchase_invoices" i
    SET "status" = CASE
      WHEN paid.amount >= i."total_amount" THEN 'PAID'::"PurchaseInvoiceStatus"
      WHEN paid.amount > 0                 THEN 'PARTIALLY_PAID'::"PurchaseInvoiceStatus"
      ELSE 'BOOKED'::"PurchaseInvoiceStatus"
    END
    FROM (
      SELECT p."purchase_invoice_id" AS invoice_id, COALESCE(SUM(p."amount"), 0) AS amount
      FROM "vendor_payments" p
      GROUP BY p."purchase_invoice_id"
    ) paid
    WHERE paid.invoice_id = i."id"
      AND i."status" <> 'CANCELLED';

    GET DIAGNOSTICS v_updated = ROW_COUNT;
    v_total := v_total + v_updated;
  END LOOP;

  RAISE NOTICE 'Re-derived payment status on % invoice(s) with payments.', v_total;
END
$repair$;
