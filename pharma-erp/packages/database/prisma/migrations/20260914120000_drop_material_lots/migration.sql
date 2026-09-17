-- =============================================================================
-- Drop `material_lots`
-- =============================================================================
-- The follow-up 20260914100000_production_uses_real_stock deliberately left
-- for later.
--
-- That migration repointed material issue at `stock_lots`, which is the table
-- a goods receipt actually writes to. `material_lots` was Production's own
-- stock table, modelled before the two modules met, and no request path has
-- ever inserted into it — its rows came from scripts/seed-production-demo.mjs
-- alone. That seeder now builds the real chain instead (vendor, purchase
-- order, goods receipt, stock lot), so nothing in the repository reads or
-- writes this table any more.
--
-- WHY DROP IT RATHER THAN LEAVE IT. A second stock table is not inert. It
-- shows up in the schema a developer reads, in `prisma studio`, and in every
-- "where is stock kept?" answer — and the next person to add a stock feature
-- has to work out which of the two is real. Worse, it carries a `status` of
-- USABLE on rows nothing keeps current: material that looks issuable and is
-- not, in a system whose whole job is knowing what may be dispensed.
--
-- WHAT IS LOST. The demo lots seeded before today. Nothing else: no invoice,
-- batch record, issue line or QC result references this table, so no audit
-- trail points into it. `pnpm seed:production --tenant <slug>` restores an
-- equivalent, better-formed demo in seconds.
--
-- The FK from `material_issue_lines.lot_id` was already repointed at
-- `stock_lots` by 20260914100000, so this drop has no dependents. CASCADE is
-- deliberately NOT used: if something still referenced the table the drop
-- should fail loudly, which is the check this migration wants.
-- =============================================================================

DROP TABLE IF EXISTS "material_lots";

-- The enum went with it. `stock_lots` uses "StockLotStatus", which has the same
-- three values plus ON_HOLD and CONSUMED, so nothing needs migrating across.
DROP TYPE IF EXISTS "MaterialLotStatus";
