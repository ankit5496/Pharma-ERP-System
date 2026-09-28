-- =============================================================================
-- The revised Master Data stories: BOM, packaging and delivery addresses
-- =============================================================================
-- US-MD-03 (BOM), US-MD-06 (packaging) and US-MD-02 (delivery addresses).
--
-- EVERY ADDITION IS NULLABLE OR DEFAULTED, so no existing row changes meaning.
-- That matters most for the two overage columns: a formulation written before
-- this must go on consuming exactly what it always did, so the header default
-- is 0 and a line's own figure is null. A batch made yesterday and repeated
-- tomorrow draws the same quantity.
--
-- NULL AND ZERO DIFFER on `bom_lines.overage_percent`. Null means "use the
-- BOM's default"; zero means "no overage on this line, whatever the default
-- says". A NOT NULL DEFAULT 0 would have collapsed the two and made the
-- header default unreachable per line.
--
-- `boms.approved_by_id` has NO foreign key to `users`, matching `created_by_id`
-- on the same table: the users table is owned by the platform schema and the
-- master-data migrations have never referenced it. The service resolves the
-- name; an id that no longer matches a user reads as blank rather than
-- blocking the delete of a departed employee.
--
-- The delivery-address table carries FORCE ROW LEVEL SECURITY like every other
-- tenant-scoped table, through the same `current_tenant_id()` /
-- `require_tenant_id()` helpers, and grants the runtime role the same rights.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- US-MD-03: BOM approval, change control, and overage
-- ---------------------------------------------------------------------------

ALTER TABLE "boms"
  ADD COLUMN "approved_by_id"          UUID,
  ADD COLUMN "approved_at"             TIMESTAMPTZ(6),
  ADD COLUMN "change_control_id"       VARCHAR(64),
  ADD COLUMN "default_overage_percent" DECIMAL(5, 2) NOT NULL DEFAULT 0;

ALTER TABLE "bom_lines"
  ADD COLUMN "is_mandatory"        BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN "manufacturing_stage" VARCHAR(120),
  ADD COLUMN "overage_percent"     DECIMAL(5, 2);

-- Overage is a percentage of a quantity, so a negative figure would mean
-- consuming less than the recipe states — which is a different thing entirely
-- and not what this column is for. Bounded above at 100 because doubling a
-- charge is a typo, not an allowance.
ALTER TABLE "boms"
  ADD CONSTRAINT "boms_default_overage_in_range"
  CHECK ("default_overage_percent" >= 0 AND "default_overage_percent" <= 100);

ALTER TABLE "bom_lines"
  ADD CONSTRAINT "bom_lines_overage_in_range"
  CHECK ("overage_percent" IS NULL OR ("overage_percent" >= 0 AND "overage_percent" <= 100));

-- Approval is recorded as a PAIR. Half of it — a date with nobody's name, or a
-- name with no date — is not a record anybody can act on at an inspection.
ALTER TABLE "boms"
  ADD CONSTRAINT "boms_approval_is_whole"
  CHECK (("approved_by_id" IS NULL) = ("approved_at" IS NULL));

-- ---------------------------------------------------------------------------
-- US-MD-06: MRP per pack variant
-- ---------------------------------------------------------------------------

ALTER TABLE "packaging_requirements"
  ADD COLUMN "mrp" DECIMAL(12, 2);

ALTER TABLE "packaging_requirements"
  ADD CONSTRAINT "packaging_requirements_mrp_positive"
  CHECK ("mrp" IS NULL OR "mrp" > 0);

-- ---------------------------------------------------------------------------
-- US-MD-02: repeatable delivery addresses
-- ---------------------------------------------------------------------------

CREATE TABLE "party_delivery_addresses" (
  "id"         UUID         NOT NULL,
  "tenant_id"  UUID         NOT NULL,
  "party_id"   UUID         NOT NULL,
  "label"      VARCHAR(120) NOT NULL,
  "line1"      VARCHAR(255) NOT NULL,
  "line2"      VARCHAR(255),
  "city"       VARCHAR(120) NOT NULL,
  "state"      VARCHAR(120) NOT NULL,
  "pin"        VARCHAR(10)  NOT NULL,
  "is_default" BOOLEAN      NOT NULL DEFAULT FALSE,
  "notes"      VARCHAR(1000),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  "deleted_at" TIMESTAMPTZ(6),

  CONSTRAINT "party_delivery_addresses_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "party_delivery_addresses"
  ADD CONSTRAINT "party_delivery_addresses_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants" ("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- CASCADE from the party, unlike the tenant: an address has no meaning apart
-- from the party it belongs to, and parties are soft-deleted anyway, so this
-- only fires if one is ever truly removed.
ALTER TABLE "party_delivery_addresses"
  ADD CONSTRAINT "party_delivery_addresses_party_id_fkey"
  FOREIGN KEY ("party_id") REFERENCES "parties" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- One label per party. Two rows both called "Depot" is a list nobody can
-- choose from.
CREATE UNIQUE INDEX "party_delivery_addresses_tenant_id_party_id_label_key"
  ON "party_delivery_addresses" ("tenant_id", "party_id", "label");

CREATE INDEX "party_delivery_addresses_tenant_id_party_id_deleted_at_idx"
  ON "party_delivery_addresses" ("tenant_id", "party_id", "deleted_at");

-- Tenant isolation, in the shape every other table here uses. FORCE so it
-- applies to the table owner too, not only to ordinary roles.
--
-- THROUGH THE HELPER FUNCTIONS, not a raw `current_setting`: `USING` reads
-- with `current_tenant_id()`, which returns null when no tenant is set and so
-- matches nothing, while `WITH CHECK` writes with `require_tenant_id()`, which
-- RAISES. Reading outside a tenant context is a query that finds nothing;
-- WRITING outside one would file a row under no tenant at all, and must fail
-- loudly rather than quietly.
ALTER TABLE "party_delivery_addresses" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "party_delivery_addresses" FORCE ROW LEVEL SECURITY;

DO $rls$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'party_delivery_addresses'
      AND policyname = 'party_delivery_addresses_tenant_isolation'
  ) THEN
    CREATE POLICY "party_delivery_addresses_tenant_isolation"
      ON "party_delivery_addresses" FOR ALL
      USING ("tenant_id" = public.current_tenant_id())
      WITH CHECK ("tenant_id" = public.require_tenant_id());
  END IF;
END
$rls$;

-- The runtime role, which is NOT the owner: without this the application can
-- see the table and touch nothing in it.
--
-- DELETE included, matching customer_licences: an address recorded against the
-- wrong party is a typo to withdraw rather than a historical fact to keep. The
-- service soft deletes regardless.
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
    'party_delivery_addresses', v_role
  );
END
$grants$;
