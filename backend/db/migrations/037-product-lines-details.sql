-- 037: Add detail fields to product_lines for project profiles
ALTER TABLE product_lines ADD COLUMN IF NOT EXISTS target_sectors TEXT;
ALTER TABLE product_lines ADD COLUMN IF NOT EXISTS value_prop TEXT;
ALTER TABLE product_lines ADD COLUMN IF NOT EXISTS pain_points TEXT;
