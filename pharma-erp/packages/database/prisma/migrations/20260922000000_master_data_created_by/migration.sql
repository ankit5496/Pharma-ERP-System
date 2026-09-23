-- =============================================================================
-- Who created each master-data record
-- =============================================================================
-- The six Master Data registers show a "Created by" column and filter, and
-- none of the six tables recorded it. Production, Procure-to-Pay, Order-to-Cash
-- and Job Work all carry `created_by_id`; Master Data was the gap.
--
-- NULLABLE, and that is not a compromise. A record created before this column
-- existed has no honest answer, and inventing one — attributing it to whoever
-- runs the migration — would put a name in an audit column that never earned
-- it. All six tables are empty on this database, so nothing is actually
-- unattributed today; the nullability is for the general case.
--
-- NO FOREIGN KEY AND NO PRISMA RELATION, following the convention the schema
-- header states: user attribution is a UUID column, because eight named
-- back-relation arrays on User would make that model unreadable and nobody
-- navigates "everything this person created" from the user side. Integrity
-- holds because users are soft-deleted only — `prevent_hard_delete` means a
-- referenced id cannot vanish.
--
-- Indexed per tenant, since "created by" is a filter the registers offer and
-- an unindexed one would scan the table on every use.
-- =============================================================================

ALTER TABLE "items" ADD COLUMN IF NOT EXISTS "created_by_id" UUID;
ALTER TABLE "parties" ADD COLUMN IF NOT EXISTS "created_by_id" UUID;
ALTER TABLE "boms" ADD COLUMN IF NOT EXISTS "created_by_id" UUID;
ALTER TABLE "licences" ADD COLUMN IF NOT EXISTS "created_by_id" UUID;
ALTER TABLE "job_work_agreements" ADD COLUMN IF NOT EXISTS "created_by_id" UUID;
ALTER TABLE "packaging_requirements" ADD COLUMN IF NOT EXISTS "created_by_id" UUID;

CREATE INDEX IF NOT EXISTS "items_tenant_created_by_idx"
  ON "items"("tenant_id", "created_by_id");
CREATE INDEX IF NOT EXISTS "parties_tenant_created_by_idx"
  ON "parties"("tenant_id", "created_by_id");
CREATE INDEX IF NOT EXISTS "boms_tenant_created_by_idx"
  ON "boms"("tenant_id", "created_by_id");
CREATE INDEX IF NOT EXISTS "licences_tenant_created_by_idx"
  ON "licences"("tenant_id", "created_by_id");
CREATE INDEX IF NOT EXISTS "job_work_agreements_tenant_created_by_idx"
  ON "job_work_agreements"("tenant_id", "created_by_id");
CREATE INDEX IF NOT EXISTS "packaging_requirements_tenant_created_by_idx"
  ON "packaging_requirements"("tenant_id", "created_by_id");
