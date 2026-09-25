-- Read state for the notification bell (US-COMP-01).
--
-- Additive only: one new, empty table. Nothing existing is altered, moved or
-- backfilled.
--
-- Notifications are NOT stored here. They are derived from live data each
-- time the bell is read; this table only records which of them a person has
-- marked read. A row means read, and marking unread deletes the row — which is
-- why this table, unlike the business tables, has no no-hard-delete trigger.
-- It holds UI state, not a compliance record.

CREATE TABLE "notification_reads" (
  "id"               UUID           NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id"        UUID           NOT NULL,
  "user_id"          UUID           NOT NULL,
  "notification_key" VARCHAR(200)   NOT NULL,
  "read_at"          TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "notification_reads_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "notification_reads"
  ADD CONSTRAINT "notification_reads_tenant_id_fkey"
    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "notification_reads_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- One row per person per notification. Also serves "this person's read keys".
CREATE UNIQUE INDEX "notification_reads_tenant_id_user_id_notification_key_key"
  ON "notification_reads" ("tenant_id", "user_id", "notification_key");

-- ---------------------------------------------------------------------------
-- Tenant isolation, the same as every other table in this schema.
-- ---------------------------------------------------------------------------

ALTER TABLE "notification_reads" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "notification_reads" FORCE ROW LEVEL SECURITY;

CREATE POLICY "notification_reads_tenant_isolation"
  ON "notification_reads" FOR ALL
  USING ("tenant_id" = public.current_tenant_id())
  WITH CHECK ("tenant_id" = public.require_tenant_id());

-- Privileges for the runtime role; a no-op where it does not exist yet.
-- No UPDATE: a read marker is only ever inserted or removed.
DO $grants$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pharma_app') THEN
    RAISE NOTICE 'Role pharma_app not present; skipping runtime grants.';
    RETURN;
  END IF;

  GRANT SELECT, INSERT, DELETE ON TABLE "notification_reads" TO "pharma_app";
END
$grants$;
