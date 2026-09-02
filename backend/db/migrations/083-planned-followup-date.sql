-- Planned follow-up date for both deal reactivation and upsell candidates.
-- Gates the "Deals à relancer" / "Clients à upseller" lists: while this date is in the
-- future, the opportunity is excluded from the actionable list regardless of staleness.
-- Manually set via "Reporter"; synced from Pipedrive's native next_activity_date where available.

ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS planned_followup_date TIMESTAMPTZ;
