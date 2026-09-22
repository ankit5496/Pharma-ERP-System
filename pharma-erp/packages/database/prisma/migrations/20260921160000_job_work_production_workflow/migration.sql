-- The rest of the job-work production workflow: issue, batch, release.
--
-- New tables alongside the internal ones, never in place of them. Nothing in
-- this migration reads or writes `material_issues`, `material_issue_lines`,
-- `batches` or `batch_packing_records`; Production & Quality Gate is untouched.
--
-- MATERIAL IS REFERENCED, NOT COPIED. An issue line points at the stock lot the
-- principal's receipt created, and at the receipt line behind it, so a batch
-- traces back to the challan without any of it being written down twice.

CREATE TABLE "job_work_material_issues" (
  "id"                           UUID           NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id"                    UUID           NOT NULL,
  "job_work_production_order_id" UUID           NOT NULL,
  "issue_number"                 VARCHAR(32)    NOT NULL,
  "issued_at"                    TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "issued_by_id"                 UUID,
  "notes"                        VARCHAR(500),
  "created_at"                   TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"                   TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deleted_at"                   TIMESTAMPTZ(6),

  CONSTRAINT "job_work_material_issues_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "job_work_material_issue_lines" (
  "id"              UUID           NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id"       UUID           NOT NULL,
  "issue_id"        UUID           NOT NULL,
  "item_id"         UUID           NOT NULL,
  "lot_id"          UUID           NOT NULL,
  "receipt_line_id" UUID,
  "quantity_issued" DECIMAL(14, 3) NOT NULL,
  "created_at"      TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "job_work_material_issue_lines_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "job_work_batches" (
  "id"                           UUID           NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id"                    UUID           NOT NULL,
  "job_work_production_order_id" UUID           NOT NULL,
  "batch_number"                 VARCHAR(32)    NOT NULL,
  "manufactured_on"              DATE           NOT NULL,
  "expiry_date"                  DATE           NOT NULL,
  "planned_quantity"             DECIMAL(14, 3) NOT NULL,
  "actual_quantity"              DECIMAL(14, 3),
  "packed_quantity"              DECIMAL(14, 3),
  "rejected_quantity"            DECIMAL(14, 3) NOT NULL DEFAULT 0,
  "pack_variant"                 VARCHAR(128),
  "packed_on"                    DATE,
  "release_status"               "BatchReleaseStatus" NOT NULL DEFAULT 'PENDING',
  "release_decided_at"           TIMESTAMPTZ(6),
  "release_decided_by_id"        UUID,
  "release_notes"                TEXT,
  "notes"                        VARCHAR(1000),
  "recorded_by_id"               UUID,
  "created_at"                   TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"                   TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deleted_at"                   TIMESTAMPTZ(6),

  CONSTRAINT "job_work_batches_pkey" PRIMARY KEY ("id")
);

-- ---------------------------------------------------------------------------
-- Keys
-- ---------------------------------------------------------------------------

ALTER TABLE "job_work_material_issues"
  ADD CONSTRAINT "job_work_material_issues_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "job_work_material_issues_production_order_fkey"
    FOREIGN KEY ("job_work_production_order_id") REFERENCES "job_work_production_orders"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "job_work_material_issues_issued_by_id_fkey"
    FOREIGN KEY ("issued_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "job_work_material_issue_lines"
  ADD CONSTRAINT "job_work_material_issue_lines_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "job_work_material_issue_lines_issue_id_fkey"
    FOREIGN KEY ("issue_id") REFERENCES "job_work_material_issues"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "job_work_material_issue_lines_item_id_fkey"
    FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "job_work_material_issue_lines_lot_id_fkey"
    FOREIGN KEY ("lot_id") REFERENCES "stock_lots"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "job_work_material_issue_lines_receipt_line_id_fkey"
    FOREIGN KEY ("receipt_line_id") REFERENCES "job_work_material_receipt_lines"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "job_work_batches"
  ADD CONSTRAINT "job_work_batches_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "job_work_batches_production_order_fkey"
    FOREIGN KEY ("job_work_production_order_id") REFERENCES "job_work_production_orders"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "job_work_batches_recorded_by_id_fkey"
    FOREIGN KEY ("recorded_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "job_work_batches_release_decided_by_id_fkey"
    FOREIGN KEY ("release_decided_by_id") REFERENCES "users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE UNIQUE INDEX "job_work_material_issues_tenant_id_issue_number_key"
  ON "job_work_material_issues" ("tenant_id", "issue_number");
CREATE INDEX "job_work_material_issues_tenant_id_production_order_idx"
  ON "job_work_material_issues" ("tenant_id", "job_work_production_order_id");

CREATE INDEX "job_work_material_issue_lines_tenant_id_issue_id_idx"
  ON "job_work_material_issue_lines" ("tenant_id", "issue_id");
CREATE INDEX "job_work_material_issue_lines_tenant_id_lot_id_idx"
  ON "job_work_material_issue_lines" ("tenant_id", "lot_id");

CREATE UNIQUE INDEX "job_work_batches_tenant_id_batch_number_key"
  ON "job_work_batches" ("tenant_id", "batch_number");
CREATE INDEX "job_work_batches_tenant_id_production_order_idx"
  ON "job_work_batches" ("tenant_id", "job_work_production_order_id");
CREATE INDEX "job_work_batches_tenant_id_release_status_idx"
  ON "job_work_batches" ("tenant_id", "release_status");

-- ---------------------------------------------------------------------------
-- Tenant isolation, and no hard deletes: all three are manufacturing record.
-- ---------------------------------------------------------------------------

DO $rls$
DECLARE
  v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'job_work_material_issues',
    'job_work_material_issue_lines',
    'job_work_batches'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', v_table);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', v_table);

    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public' AND tablename = v_table
        AND policyname = v_table || '_tenant_isolation'
    ) THEN
      EXECUTE format(
        'CREATE POLICY %I ON %I FOR ALL '
        'USING ("tenant_id" = public.current_tenant_id()) '
        'WITH CHECK ("tenant_id" = public.require_tenant_id())',
        v_table || '_tenant_isolation',
        v_table
      );
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_trigger
      WHERE tgrelid = v_table::regclass AND tgname = v_table || '_no_hard_delete'
    ) THEN
      EXECUTE format(
        'CREATE TRIGGER %I BEFORE DELETE ON %I '
        'FOR EACH ROW EXECUTE FUNCTION public.prevent_hard_delete()',
        v_table || '_no_hard_delete',
        v_table
      );
    END IF;
  END LOOP;
END
$rls$;

-- An issue LINE is deleted by its parent's cascade when an issue is corrected,
-- so it carries no delete guard of its own; the guard above would make that
-- cascade impossible. Dropped immediately after creation rather than skipped in
-- the loop, so the loop stays one readable rule.
DROP TRIGGER IF EXISTS "job_work_material_issue_lines_no_hard_delete"
  ON "job_work_material_issue_lines";

DO $grants$
DECLARE
  v_table text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pharma_app') THEN
    RAISE NOTICE 'Role pharma_app not present; skipping runtime grants.';
    RETURN;
  END IF;

  FOREACH v_table IN ARRAY ARRAY[
    'job_work_material_issues',
    'job_work_material_issue_lines',
    'job_work_batches'
  ] LOOP
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE %I TO %I', v_table, 'pharma_app');
  END LOOP;
END
$grants$;
