-- Where material sits, which QC decision put it there, and who it is held for.
--
-- Three changes that belong together, because they are three halves of one
-- story: a QC decision now writes a ledger record whatever its verdict, that
-- record says which bucket and which physical place the material moved to, and
-- an acceptance reserves the material for the sales order it was bought to
-- serve.

-- ---------------------------------------------------------------------------
-- 1. Where the material physically is.
--
-- A separate fact from `status`, though they move together: a rejected drum is
-- under lock in the rejected area precisely BECAUSE it is rejected. Free text
-- and nullable — there is no location master to point at, and inventing one to
-- hold three strings would be a register nobody maintains.
-- ---------------------------------------------------------------------------

-- ALREADY ON THE LIVE DATABASE, added outside Prisma; the schema file was the
-- half that was missing. `IF NOT EXISTS` so this migration is true of both a
-- database that has it and one built from scratch.
ALTER TABLE "stock_lots"
  ADD COLUMN IF NOT EXISTS "storage_location" VARCHAR(120);

ALTER TABLE "stock_ledger_entries"
  ADD COLUMN IF NOT EXISTS "storage_location" VARCHAR(120),
  -- The bucket this movement put the material in. `affects_usable_stock`
  -- answers one question and cannot tell quarantine from rejected from held,
  -- which are three places with three consequences.
  ADD COLUMN IF NOT EXISTS "resulting_status" "StockLotStatus",
  -- The decision that caused it, pointed at rather than copied.
  ADD COLUMN IF NOT EXISTS "qc_result_id" UUID;

ALTER TABLE "stock_ledger_entries"
  ADD CONSTRAINT "stock_ledger_entries_qc_result_id_fkey"
    FOREIGN KEY ("qc_result_id") REFERENCES "qc_results"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- 2. Usable material spoken for by the sales order it was bought to serve.
--
-- Not the same thing as `batch_allocations`, which reserves FINISHED goods for
-- dispatch. This reserves the RAW and PACKING material bought to make them.
-- ---------------------------------------------------------------------------

CREATE TABLE "stock_reservations" (
  "id"                  UUID           NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id"           UUID           NOT NULL,
  "stock_lot_id"        UUID           NOT NULL,
  "sales_order_id"      UUID           NOT NULL,
  "sales_order_item_id" UUID           NOT NULL,
  "quantity"            DECIMAL(18, 4) NOT NULL,
  "reference"           VARCHAR(64),
  "notes"               VARCHAR(500),
  -- Set rather than deleted when the hold ends: a reservation that vanishes
  -- takes its own history with it, and "who held this drum in March" is an
  -- audit question.
  "released_at"         TIMESTAMPTZ(6),
  "released_reason"     VARCHAR(255),
  "created_by_id"       UUID,
  "created_at"          TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"          TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "stock_reservations_pkey" PRIMARY KEY ("id"),
  -- A hold for nothing is not a hold.
  CONSTRAINT "stock_reservations_quantity_positive" CHECK ("quantity" > 0)
);

ALTER TABLE "stock_reservations"
  ADD CONSTRAINT "stock_reservations_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "stock_reservations_stock_lot_id_fkey"
    FOREIGN KEY ("stock_lot_id") REFERENCES "stock_lots"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "stock_reservations_sales_order_id_fkey"
    FOREIGN KEY ("sales_order_id") REFERENCES "sales_orders"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "stock_reservations_sales_order_item_id_fkey"
    FOREIGN KEY ("sales_order_item_id") REFERENCES "sales_order_items"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "stock_reservations_tenant_lot_released_idx"
  ON "stock_reservations" ("tenant_id", "stock_lot_id", "released_at");
CREATE INDEX "stock_reservations_tenant_order_released_idx"
  ON "stock_reservations" ("tenant_id", "sales_order_id", "released_at");
CREATE INDEX "stock_reservations_tenant_order_item_released_idx"
  ON "stock_reservations" ("tenant_id", "sales_order_item_id", "released_at");

-- ONE LIVE HOLD per (lot, order line). Accepting the same lot twice tops up
-- the hold rather than adding a second one, and a partial unique index is what
-- makes that true in the database rather than only in the service.
CREATE UNIQUE INDEX "stock_reservations_one_live_per_lot_and_line"
  ON "stock_reservations" ("stock_lot_id", "sales_order_item_id")
  WHERE "released_at" IS NULL;

-- ---------------------------------------------------------------------------
-- Tenant isolation, on the same terms as every other table here.
-- ---------------------------------------------------------------------------

ALTER TABLE "stock_reservations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "stock_reservations" FORCE ROW LEVEL SECURITY;

CREATE POLICY "stock_reservations_tenant_isolation"
  ON "stock_reservations" FOR ALL
  USING ("tenant_id" = public.current_tenant_id())
  WITH CHECK ("tenant_id" = public.require_tenant_id());

DO $grants$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pharma_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "stock_reservations" TO "pharma_app";
  ELSE
    RAISE NOTICE 'Role pharma_app not present; skipping runtime grants.';
  END IF;
END
$grants$;
