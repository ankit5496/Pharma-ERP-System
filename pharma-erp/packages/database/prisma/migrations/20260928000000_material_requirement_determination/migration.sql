-- =============================================================================
-- US-MD-07: Material Requirement Determination
-- =============================================================================
-- What a confirmed sales order needs, what exists, and what has to be bought.
--
-- WHY IT IS PERSISTED rather than computed on demand, which is what
-- `materialShortages()` already does today. Three reasons, and each one is a
-- question the transient version cannot answer:
--
--   1. US-PROD-06's readiness gate asks "was there a shortfall, and has it been
--      satisfied yet". A figure computed and discarded cannot be compared to
--      anything later.
--   2. A requisition raised from a shortfall has to point back at the shortfall
--      that caused it, or nobody can explain why the system ordered 200kg.
--   3. The determination is evidence. What was known about stock at the moment
--      an order was confirmed is exactly the sort of thing an auditor asks
--      about, and recomputing it next month gives next month's answer.
--
-- TRIGGERED BY SALES ORDER CONFIRMATION, per the revised US-PROD-01: "the
-- Sales Order that caused it". A run is stamped with the order it was made for
-- and the moment it was made.
--
-- NOTHING IS RESERVED HERE. `quantityAvailable` on this table is free stock as
-- the system currently understands it — total usable stock, with no notion of
-- another order having a claim on it. Raw-material reservation is the next
-- step, and when it lands this figure becomes net of it. The column is named
-- for what it holds rather than for what it will eventually mean, so the two
-- readings are never silently confused.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- A third way a requisition comes to exist
-- ---------------------------------------------------------------------------
-- AUTO_REORDER is deliberately NOT retired here. It answers a different
-- question — "this shared consumable is below its safety level" — which no
-- order-driven determination asks, and it is what the Low Stock card on the
-- dashboard reports. Retiring it is a separate decision, to be taken once this
-- has been seen working on real orders.
--
-- NOTHING BELOW MAY REFERENCE THE NEW LABEL. PostgreSQL refuses to USE an enum
-- label in the transaction that added it, and Prisma runs a migration in one.
-- The service writes PRODUCTION_SHORTFALL at runtime, long after this has
-- committed, so the rule is kept simply by not mentioning it again here.
ALTER TYPE "RequisitionTriggerType" ADD VALUE IF NOT EXISTS 'PRODUCTION_SHORTFALL';

-- ---------------------------------------------------------------------------
-- The determination itself
-- ---------------------------------------------------------------------------

CREATE TABLE "material_requirements" (
  "id"        UUID NOT NULL,
  "tenant_id" UUID NOT NULL,

  -- The order whose confirmation caused this run.
  "sales_order_id" UUID NOT NULL,

  -- The material, and the formulation the figure was derived through. The BOM
  -- is recorded because a requirement of 200kg is only explicable alongside
  -- the recipe that produced it, and formulations are superseded.
  "item_id" UUID NOT NULL,
  "bom_id"  UUID,

  -- Overage-adjusted, per US-MD-03 — the figure the material issue will
  -- actually consume, not the bare BOM quantity. The two differ by the
  -- overage percent, and procuring against the smaller one buys short.
  "quantity_required" DECIMAL(14, 3) NOT NULL,

  -- Usable stock at the moment of the run. A SNAPSHOT, not a live figure:
  -- this is what was known when the decision was taken.
  "quantity_available" DECIMAL(14, 3) NOT NULL,

  -- required - available, floored at zero. Stored rather than derived so the
  -- shortfall that justified a requisition cannot drift away from it.
  "quantity_short" DECIMAL(14, 3) NOT NULL,

  -- The requisition raised to cover this shortfall, once one exists. NULL
  -- when there was no shortfall, and also when there was one but the
  -- requisition has not been raised yet — the two are told apart by
  -- `quantity_short`.
  "requisition_id" UUID,

  "determined_at"   TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "determined_by_id" UUID,

  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,

  CONSTRAINT "material_requirements_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "material_requirements"
  ADD CONSTRAINT "material_requirements_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CASCADE from the order: a determination has no meaning apart from the order
-- it was made for. Sales orders are cancelled rather than deleted, so this
-- only fires if one is ever truly removed.
ALTER TABLE "material_requirements"
  ADD CONSTRAINT "material_requirements_sales_order_id_fkey"
  FOREIGN KEY ("sales_order_id") REFERENCES "sales_orders" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "material_requirements"
  ADD CONSTRAINT "material_requirements_item_id_fkey"
  FOREIGN KEY ("item_id") REFERENCES "items" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- RESTRICT, and nullable: the formulation a requirement was derived through is
-- part of the record, and a BOM that has been superseded is still the one this
-- figure came from.
ALTER TABLE "material_requirements"
  ADD CONSTRAINT "material_requirements_bom_id_fkey"
  FOREIGN KEY ("bom_id") REFERENCES "boms" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- SET NULL rather than RESTRICT: a requisition that is deleted takes its link
-- with it, leaving a shortfall that reads as "not yet covered" — which is then
-- true, and is the state that lets it be covered again.
ALTER TABLE "material_requirements"
  ADD CONSTRAINT "material_requirements_requisition_id_fkey"
  FOREIGN KEY ("requisition_id") REFERENCES "purchase_requisitions" ("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- A quantity cannot be negative, and a shortfall is floored at zero rather
-- than going negative when stock exceeds the requirement — "short by -50" is
-- not a reading anybody should have to do arithmetic on.
ALTER TABLE "material_requirements"
  ADD CONSTRAINT "material_requirements_quantities_not_negative"
  CHECK (
    "quantity_required"  >= 0 AND
    "quantity_available" >= 0 AND
    "quantity_short"     >= 0
  );

-- One row per material per run. The same item appearing twice for one order
-- is two answers to one question.
CREATE UNIQUE INDEX "material_requirements_tenant_id_sales_order_id_item_id_key"
  ON "material_requirements" ("tenant_id", "sales_order_id", "item_id");

-- The readiness question, asked per order: is anything still short?
CREATE INDEX "material_requirements_tenant_id_sales_order_id_short_idx"
  ON "material_requirements" ("tenant_id", "sales_order_id", "quantity_short");

-- The reverse question: which determinations is this requisition covering?
CREATE INDEX "material_requirements_tenant_id_requisition_id_idx"
  ON "material_requirements" ("tenant_id", "requisition_id");

-- ---------------------------------------------------------------------------
-- Tenant isolation, in the shape every other table here uses
-- ---------------------------------------------------------------------------
-- FORCE so it applies to the table owner too. USING reads through
-- `current_tenant_id()`, which returns null outside a tenant context and so
-- matches nothing; WITH CHECK writes through `require_tenant_id()`, which
-- RAISES. Reading outside a tenant is a query that finds nothing; WRITING
-- outside one would file a row under no tenant at all.

ALTER TABLE "material_requirements" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "material_requirements" FORCE ROW LEVEL SECURITY;

DO $rls$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'material_requirements'
      AND policyname = 'material_requirements_tenant_isolation'
  ) THEN
    CREATE POLICY "material_requirements_tenant_isolation"
      ON "material_requirements" FOR ALL
      USING ("tenant_id" = public.current_tenant_id())
      WITH CHECK ("tenant_id" = public.require_tenant_id());
  END IF;
END
$rls$;

-- The runtime role, which is NOT the owner: without this the application can
-- see the table and touch nothing in it.
--
-- DELETE included: re-confirming an order replaces its determination, which is
-- a correction to a working figure rather than a historical fact to preserve.
DO $grants$
DECLARE
  v_role text := 'pharma_app';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = v_role) THEN
    RAISE NOTICE 'Role % not present; skipping runtime grants.', v_role;
    RETURN;
  END IF;

  EXECUTE format(
    'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE %I TO %I',
    'material_requirements', v_role
  );
END
$grants$;
