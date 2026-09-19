-- The quality gate records three outcomes, not two.
--
-- BLOCKED collapsed two different quality decisions into one word. A batch held
-- pending a repeat assay and a batch rejected outright are not the same: the
-- first may be released next week, the second never will be, and a quality
-- record that cannot tell them apart cannot answer either question at an
-- inspection.
--
-- BLOCKED IS NOT REMOVED. Rows already decided under it keep it -- a quality
-- decision that has been taken must not be rewritten by a schema change. It is
-- simply no longer offered: the DTO accepts RELEASED, ON_HOLD and REJECTED.
--
-- Dispatch is unaffected. Its guard is a whitelist (releaseStatus must equal
-- RELEASED), so adding values to this enum cannot widen what may leave the site.
ALTER TYPE "BatchReleaseStatus" ADD VALUE IF NOT EXISTS 'ON_HOLD';
ALTER TYPE "BatchReleaseStatus" ADD VALUE IF NOT EXISTS 'REJECTED';
