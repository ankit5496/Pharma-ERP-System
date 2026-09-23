-- A job-work invoice can now bill either kind of batch.
--
-- Job Work grew its own production workflow, so the batch a principal gets back
-- is a `job_work_batches` row rather than a `batches` one. The invoice pointed
-- only at the latter, which is why a batch released under Production to batch
-- release never reached Outward dispatch.
--
-- EXACTLY ONE OF THE TWO, enforced by a CHECK — the same shape
-- `stock_lots_has_one_source` already uses for a lot that came from either a
-- purchase or a principal. A row naming both, or neither, is unstorable.

ALTER TABLE "job_work_invoices"
  ALTER COLUMN "batch_id" DROP NOT NULL,
  ADD COLUMN "job_work_batch_id" UUID;

ALTER TABLE "job_work_invoices"
  ADD CONSTRAINT "job_work_invoices_job_work_batch_id_fkey"
    FOREIGN KEY ("job_work_batch_id") REFERENCES "job_work_batches"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE INDEX "job_work_invoices_tenant_id_job_work_batch_id_idx"
  ON "job_work_invoices" ("tenant_id", "job_work_batch_id");

-- Every existing row names an internal batch, so the constraint is satisfiable
-- as it stands; added NOT VALID first would be the cautious route, but there is
-- nothing here that can fail it.
ALTER TABLE "job_work_invoices"
  ADD CONSTRAINT "job_work_invoices_has_one_batch"
    CHECK (num_nonnulls("batch_id", "job_work_batch_id") = 1);
