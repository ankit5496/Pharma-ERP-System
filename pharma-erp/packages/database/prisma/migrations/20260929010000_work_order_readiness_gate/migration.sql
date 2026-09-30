-- =============================================================================
-- US-PROD-06: the Work Order Readiness Gate
-- =============================================================================
-- "A Work Order remains Planned until all of its required materials have
-- actually been received and reserved, and only moves to Ready to Start once
-- the full material requirement is satisfied, so that production is never
-- scheduled to begin on paper before the physical material exists."
--
-- WHY A NEW STATE AT ALL. Under the old stock-driven model, sufficient stock
-- was the default assumption: a work order could be raised only when material
-- was already on the shelf, so its existence and its ability to start were the
-- same fact. Order-driven production separates them — the order is raised when
-- a customer commits, and the material is bought afterwards — and two facts
-- need two states.
--
-- PLACED BETWEEN PLANNED AND MATERIAL_ISSUED, which is where it belongs in the
-- workflow and therefore where the status filter should show it. Postgres
-- appends a new enum label at the end by default; BEFORE 'MATERIAL_ISSUED'
-- puts it in process order instead, so a list sorted by the enum reads down
-- the workflow rather than by when each state was invented.
--
-- NOTHING BELOW MAY REFERENCE THE NEW LABEL. PostgreSQL refuses to USE an enum
-- label in the transaction that added it, and Prisma runs a migration in one.
-- No existing row changes: every work order stays in whatever state it is in,
-- and readiness is evaluated from now on.
-- =============================================================================

ALTER TYPE "ProductionOrderStatus"
  ADD VALUE IF NOT EXISTS 'READY_TO_START' BEFORE 'MATERIAL_ISSUED';
