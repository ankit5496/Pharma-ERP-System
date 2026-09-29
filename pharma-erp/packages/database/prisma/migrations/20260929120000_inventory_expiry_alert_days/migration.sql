-- =============================================================================
-- US-INV-03 — near-expiry alert windows
-- =============================================================================
-- One column on "tenants": the day thresholds the near-expiry report and the
-- dashboard bucket batches by. Existing tenants pick up the specified default
-- (90/60/30), so the report works for them without anyone configuring it.
--
-- Written to be re-runnable, like the other tenant-setting migrations.
-- =============================================================================

ALTER TABLE "tenants"
  ADD COLUMN IF NOT EXISTS "expiry_alert_days" INTEGER[] NOT NULL DEFAULT ARRAY[90, 60, 30];

-- Between one and five windows, each 1–730 days. An empty list would silently
-- switch the alert off; the upper bound stops a typo (900 instead of 90) from
-- flagging every batch on the shelf. Distinctness is checked by the API, which
-- can say which value was repeated.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tenants_expiry_alert_days_sane') THEN
    ALTER TABLE "tenants" ADD CONSTRAINT "tenants_expiry_alert_days_sane"
      CHECK (
        cardinality("expiry_alert_days") BETWEEN 1 AND 5
        AND 1 <= ALL ("expiry_alert_days")
        AND 730 >= ALL ("expiry_alert_days")
      );
  END IF;
END
$$;
