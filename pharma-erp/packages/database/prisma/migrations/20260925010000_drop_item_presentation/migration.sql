-- =============================================================================
-- Withdraw the item presentation fields
-- =============================================================================
-- `20260925000000_item_presentation_and_party_pan` added Dosage Form, Colour
-- and Flavour to the item master for US-MD-01. They are withdrawn at the
-- product owner's request; the party PAN from the same migration stays.
--
-- A NEW MIGRATION rather than an edit to the applied one. The original has
-- already run against the shared database and is recorded in
-- `_prisma_migrations`; rewriting it would leave every other environment
-- believing it had applied something different from what it actually did.
-- Forward-only is the whole point of a migration history.
--
-- NO DATA IS LOST. All three columns were verified empty across every tenant
-- before this was written — the fields reached the form but nothing was ever
-- typed into them. Were that not so, this would need a export first, since
-- DROP COLUMN is not recoverable.
--
-- `IF EXISTS` so this is safe on an environment that never received the
-- original: the three columns are simply not there, and the statement is a
-- no-op rather than an error that blocks every later migration.
-- =============================================================================

ALTER TABLE "items"
  DROP COLUMN IF EXISTS "dosage_form",
  DROP COLUMN IF EXISTS "colour",
  DROP COLUMN IF EXISTS "flavour";
