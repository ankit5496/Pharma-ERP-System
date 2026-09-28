-- =============================================================================
-- Item presentation fields, and the party's PAN
-- =============================================================================
-- US-MD-01 adds Dosage Form, Colour and Flavour to the item master. The gap was
-- found by comparing the form against a real customer sales order, which prints
-- all three per line and could not be filled from the item record.
--
-- FREE TEXT rather than enums. "Softgel Capsule", "Sugar-coated tablet" and
-- "Dry syrup" are a longer list than anyone can close, and a dropdown that has
-- to be extended for every new presentation is worse than a typed name.
--
-- US-MD-02 adds PAN to the party. It is the same ten characters that sit inside
-- a GSTIN, captured separately because a party with no GST registration still
-- has one, and TDS is deducted against the PAN rather than the GSTIN.
--
-- ALL FOUR NULLABLE, with no default and no backfill. A raw material has no
-- flavour, a carton has no dosage form, and inventing a value for either would
-- put data on a record that nobody entered. Existing rows are left exactly as
-- they are.
--
-- No RLS dance here, unlike the seeding migrations: ALTER TABLE is DDL and runs
-- as the table owner regardless of `app.current_tenant_id`. Row-level security
-- constrains DML only.
-- =============================================================================

ALTER TABLE "items"
  ADD COLUMN "dosage_form" VARCHAR(120),
  ADD COLUMN "colour"      VARCHAR(60),
  ADD COLUMN "flavour"     VARCHAR(60);

ALTER TABLE "parties"
  ADD COLUMN "pan_number" VARCHAR(10);
