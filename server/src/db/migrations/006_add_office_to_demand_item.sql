-- Add office_id to demand_item to support office-level demand collection
-- 2026-09-01: 支持需求填报细化到代表处级
ALTER TABLE demand_item ADD COLUMN IF NOT EXISTS office_id VARCHAR(64);
-- Add foreign key constraint to org_node (offices are org nodes with type OFFICE)
ALTER TABLE demand_item ADD CONSTRAINT fk_demand_item_office FOREIGN KEY (office_id) REFERENCES org_node(id) ON DELETE SET NULL;
-- Create index for faster queries by office
CREATE INDEX IF NOT EXISTS idx_demand_item_office ON demand_item(office_id);
