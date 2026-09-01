-- Add office_id to demand_item to support office-level demand collection
-- 2026-09-01: 支持需求填报细化到代表处级
-- SQLite兼容：ALTER TABLE ADD COLUMN不支持IF NOT EXISTS，迁移仅执行一次无需判断
ALTER TABLE demand_item ADD COLUMN office_id VARCHAR(64);
-- 外键约束仅PostgreSQL支持，SQLite不支持ALTER TABLE ADD CONSTRAINT，代码层已做数据校验无需数据库层外键
-- ALTER TABLE demand_item ADD CONSTRAINT fk_demand_item_office FOREIGN KEY (office_id) REFERENCES org_node(id) ON DELETE SET NULL;
-- Create index for faster queries by office
CREATE INDEX IF NOT EXISTS idx_demand_item_office ON demand_item(office_id);
