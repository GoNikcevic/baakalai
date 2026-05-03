-- 038: CRM field mappings — map CRM custom fields to Baakalai concepts
CREATE TABLE IF NOT EXISTS crm_field_mappings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  crm_provider TEXT NOT NULL, -- pipedrive, hubspot, salesforce
  crm_field TEXT NOT NULL, -- CRM field key (e.g., "abc123_product_line")
  crm_field_name TEXT, -- Human-readable name (e.g., "Product Line")
  baakalai_field TEXT NOT NULL, -- product_line, status, custom
  mapping_values JSONB DEFAULT '{}', -- { "crm_option_id": "baakalai_value" }
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_crm_field_mappings_user ON crm_field_mappings(user_id);
