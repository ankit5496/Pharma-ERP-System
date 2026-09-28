-- Sales Order header terms and the order-level processing charge.
--
-- SALES ORDER DATA, NOT MASTER DATA. Every column here describes ONE order:
-- the customer's own PO number for it, the terms agreed for it, and a charge
-- levied on it. None of them belongs on the party or the item, and no master
-- table is touched by this migration.
--
-- ADDITIVE AND NULLABLE, so every order already recorded stays valid and the
-- allocation, dispatch, invoice, receipt and return flows read the same rows
-- they always did.

ALTER TABLE "sales_orders"
  -- The customer's reference for this order. Quoted back to them on the
  -- invoice, so it is text as they gave it rather than a lookup.
  ADD COLUMN "customer_po_number" VARCHAR(64),
  ADD COLUMN "shipping_terms"     VARCHAR(255),
  ADD COLUMN "insurance"          VARCHAR(255),
  ADD COLUMN "transport_name"     VARCHAR(255),

  -- Charged on the order and taxed with the goods: goods value + processing
  -- charges = taxable amount. NOT NULL DEFAULT 0 because it enters the
  -- arithmetic, and a null in a total is a silent wrong answer. Every existing
  -- order therefore keeps exactly the totals it has.
  ADD COLUMN "processing_charges" DECIMAL(14,2) NOT NULL DEFAULT 0;

-- Non-negative, matching how every other money column on this table is
-- constrained. A negative charge would be a discount, which the order lines
-- already express through their own discount fields.
ALTER TABLE "sales_orders"
  ADD CONSTRAINT "sales_orders_processing_charges_non_negative"
  CHECK ("processing_charges" >= 0);
