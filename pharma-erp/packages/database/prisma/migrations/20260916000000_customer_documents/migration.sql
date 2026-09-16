-- =============================================================================
-- Customer documents
-- =============================================================================
-- A customer's paperwork — drug licence, GST certificate, purchase agreement —
-- held against the party it belongs to.
--
-- WHY THE BYTES LIVE IN POSTGRES. The obvious alternative is a folder on the
-- API's filesystem, and on this deployment that silently loses everything: the
-- hosted service declares no persistent disk, so the container's filesystem is
-- destroyed on every deploy and every restart. A document uploaded on Monday
-- would be gone on Tuesday, and nothing would say so — the row would still be
-- there, pointing at a path that no longer resolves.
--
-- Storing the bytes in a `bytea` column means the documents are in the same
-- backups as everything else, and — the part that matters here — the same
-- row-level security. A document is tenant-scoped like every other row, so one
-- company physically cannot read another's paperwork. A filesystem path has no
-- such property; it is a string, and anyone who can guess it can read the file.
--
-- WHAT THIS IS NOT FOR. Every read pulls the whole file through the database
-- connection, and against a cross-region database that connection is already
-- the slow part of the system. The service caps an upload at 5 MB, which is
-- generous for a scanned certificate and nowhere near enough to make this a
-- general file store. If large documents are ever needed, object storage is the
-- answer and this table becomes a pointer — but that is a different problem
-- from the one being solved, which is "where does the licence PDF go".
--
-- CUSTOMERS ONLY is enforced in the service, not here. Whether a party is a
-- customer is `parties.party_type`, and a CHECK constraint cannot read another
-- table. A trigger could, but it would fire on a column this table does not own
-- and would have to be kept in step with every legitimate reason a party's type
-- changes — a rule that is easier to state in SQL than to live with.
-- =============================================================================

CREATE TABLE "customer_documents" (
  "id"           UUID         NOT NULL DEFAULT gen_random_uuid(),
  "tenant_id"    UUID         NOT NULL,
  "party_id"     UUID         NOT NULL,

  -- As the person uploading it named it, kept verbatim so a downloaded file
  -- arrives with the name it was sent with.
  "file_name"    VARCHAR(255) NOT NULL,
  -- The MIME type, whitelisted by the service. Stored so a download can set
  -- the right Content-Type rather than guessing from the extension.
  "content_type" VARCHAR(127) NOT NULL,
  "size_bytes"   INTEGER      NOT NULL,
  "content"      BYTEA        NOT NULL,

  -- What the document IS, in the uploader's words. Free text rather than an
  -- enum: the set of documents a customer might be asked for is not fixed, and
  -- an enum would need a migration every time somebody was asked for a new one.
  "label"        VARCHAR(255),

  "uploaded_by_id" UUID       NOT NULL,
  "created_at"   TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "updated_at"   TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "deleted_at"   TIMESTAMPTZ(6),

  CONSTRAINT "customer_documents_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "customer_documents"
  ADD CONSTRAINT "customer_documents_tenant_id_fkey"
  FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "customer_documents"
  ADD CONSTRAINT "customer_documents_party_id_fkey"
  FOREIGN KEY ("party_id") REFERENCES "parties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "customer_documents"
  ADD CONSTRAINT "customer_documents_uploaded_by_id_fkey"
  FOREIGN KEY ("uploaded_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 5 MB, matching the service's own limit. Stated here as well because the
-- service is not the only thing that can insert a row, and a byte count that
-- disagrees with the bytes is worse than no limit at all.
ALTER TABLE "customer_documents"
  ADD CONSTRAINT "customer_documents_size_within_limit"
  CHECK ("size_bytes" > 0 AND "size_bytes" <= 5242880);

-- The stored length has to match what was actually stored, or `size_bytes`
-- becomes a number somebody believes.
ALTER TABLE "customer_documents"
  ADD CONSTRAINT "customer_documents_size_matches_content"
  CHECK ("size_bytes" = length("content"));

ALTER TABLE "customer_documents"
  ADD CONSTRAINT "customer_documents_file_name_not_blank"
  CHECK (btrim("file_name") <> '');

-- The listing query: one party's documents, newest first.
CREATE INDEX "customer_documents_tenant_id_party_id_deleted_at_idx"
  ON "customer_documents" ("tenant_id", "party_id", "deleted_at");

-- -----------------------------------------------------------------------------
-- Row-level security
-- -----------------------------------------------------------------------------
-- ENABLE and FORCE, so the table owner is bound by the policy too. Without
-- FORCE, the owner reads every company's documents.

ALTER TABLE "customer_documents" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "customer_documents" FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'customer_documents'
      AND policyname = 'customer_documents_tenant_isolation'
  ) THEN
    CREATE POLICY "customer_documents_tenant_isolation" ON "customer_documents"
      FOR ALL
      USING ("tenant_id" = public.current_tenant_id())
      WITH CHECK ("tenant_id" = public.require_tenant_id());
  END IF;
END
$$;

-- -----------------------------------------------------------------------------
-- No hard deletes
-- -----------------------------------------------------------------------------
-- A licence that made a customer eligible to be sold to is evidence that the
-- sale was lawful at the time. Removing the document removes the evidence, so
-- "delete" stamps `deleted_at` and the row — bytes included — stays.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'customer_documents'::regclass
      AND tgname = 'customer_documents_no_hard_delete'
  ) THEN
    CREATE TRIGGER "customer_documents_no_hard_delete"
      BEFORE DELETE ON "customer_documents"
      FOR EACH ROW EXECUTE FUNCTION public.prevent_hard_delete();
  END IF;
END
$$;

-- -----------------------------------------------------------------------------
-- Privileges for the runtime role
-- -----------------------------------------------------------------------------
-- DELETE is granted even though the trigger refuses every hard delete: the
-- grant is what the trigger gets the chance to refuse, and without it the
-- failure is a permissions error rather than the written explanation
-- prevent_hard_delete() raises.

DO $grants$
DECLARE
  v_role text := 'pharma_app';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = v_role) THEN
    RAISE NOTICE 'Role % not present; skipping runtime grants.', v_role;
    RETURN;
  END IF;

  EXECUTE format(
    'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE "customer_documents" TO %I',
    v_role
  );
END
$grants$;
