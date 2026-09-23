-- A job-work production order can now be raised under own procurement.
--
-- Under that billing model we buy the material ourselves through Procure-to-Pay,
-- so there is no consignment from the principal and no incoming quality check —
-- the batch draws on company-owned stock like any own-brand batch. The column
-- pointed at a receipt that cannot exist for those orders, which is why the
-- whole model was unreachable from Production to batch release.
--
-- NO CHECK CONSTRAINT. The rule is "set if and only if the JOB-WORK ORDER is
-- pure conversion", and the billing model lives on `job_work_orders` rather
-- than on this row; expressing it here would mean copying that value a third
-- time. JobWorkProductionService.create enforces it, in the same place it
-- checks the receipt is APPROVED.
ALTER TABLE "job_work_production_orders"
  ALTER COLUMN "material_receipt_id" DROP NOT NULL;
