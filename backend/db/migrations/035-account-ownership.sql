-- 035: Account ownership — map contacts to their sales rep
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS owner_id UUID REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS owner_email TEXT;
ALTER TABLE opportunities ADD COLUMN IF NOT EXISTS crm_owner_id TEXT; -- Pipedrive user ID of the owner

CREATE INDEX IF NOT EXISTS idx_opportunities_owner ON opportunities(owner_id) WHERE owner_id IS NOT NULL;

-- Product lines / verticals (multi-product support)
CREATE TABLE IF NOT EXISTS product_lines (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  icon TEXT, -- emoji or short label
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_product_lines_team ON product_lines(team_id);

-- Many-to-many: opportunity <> product_line
CREATE TABLE IF NOT EXISTS opportunity_product_lines (
  opportunity_id UUID NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  product_line_id UUID NOT NULL REFERENCES product_lines(id) ON DELETE CASCADE,
  PRIMARY KEY (opportunity_id, product_line_id)
);
