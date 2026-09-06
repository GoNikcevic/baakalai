-- Data Quality page redesign: generic audit + undo table for every change the page produces
-- (duplicate merges/deletes, single-field enrichment, auto-fixes, archives). Every row captures
-- a full before/after snapshot so undo is one generic operation instead of per-change-type logic.

CREATE TABLE IF NOT EXISTS data_quality_changes (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  group_id        UUID NOT NULL,   -- ties together every row produced by ONE user action
                                    -- (e.g. one 3-way merge = 1 group_id, 3 rows: 1 merge_keep + 2 merge_delete)
  strate          TEXT NOT NULL CHECK (strate IN ('duplicates','deal_quality','client_quality')),
  change_type     TEXT NOT NULL CHECK (change_type IN
                    ('merge_keep','merge_delete','delete','field_update','enrichment',
                     'auto_fix','archive','product_line_assign')),
  provider        TEXT,            -- pipedrive|hubspot|odoo|salesforce|notion|airtable|folk|NULL (local-only change)
  crm_contact_id  TEXT,            -- native provider contact id (string; NULL for provider-less local-only changes)
  opportunity_id  UUID REFERENCES opportunities(id) ON DELETE SET NULL,
  remote_action   TEXT NOT NULL DEFAULT 'none'
                    CHECK (remote_action IN ('none','updated','deleted','archived','manual_required')),
  before_data     JSONB NOT NULL DEFAULT '{}',  -- { crm: {...full normalized snapshot incl. raw...}, local: {...full opportunities row...}, productLineIds: [...] }
  after_data      JSONB NOT NULL DEFAULT '{}',  -- same shape, only the fields that changed (empty for pure deletes)
  status          TEXT NOT NULL DEFAULT 'applied' CHECK (status IN ('applied','undone','undo_failed')),
  undone_at       TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dqc_user_created ON data_quality_changes(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_dqc_group ON data_quality_changes(group_id);
CREATE INDEX IF NOT EXISTS idx_dqc_opportunity ON data_quality_changes(opportunity_id) WHERE opportunity_id IS NOT NULL;
