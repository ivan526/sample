-- Add MSS business domain dimension to support role permission separation
-- 2026-09-01: 新增MSS业务领域维度，GTM按产品品类隔离，MSS按业务领域隔离（跨产品品类）
-- 兼容SQLite和PostgreSQL语法，无需重命名字段/表，兼容现有数据

-- 1. 新建MSS业务领域表
CREATE TABLE IF NOT EXISTS mss_domain (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  code VARCHAR(64) NOT NULL UNIQUE,
  name VARCHAR(256) NOT NULL,
  description TEXT,
  mss_owner_id TEXT REFERENCES app_user(id),
  enabled BOOLEAN NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  version INTEGER NOT NULL DEFAULT 1
);

-- 2. 产品表增加MSS领域关联字段（每个产品归属一个MSS业务领域）
ALTER TABLE product ADD COLUMN mss_domain_id TEXT REFERENCES mss_domain(id);

-- 3. 插入默认MSS业务领域种子数据
INSERT OR IGNORE INTO mss_domain (id, code, name, description, mss_owner_id, enabled) VALUES
('mss-mkt', 'mkt', 'MKT领域', '市场线需求，覆盖上市营销、展会、发布会等场景', (SELECT id FROM app_user WHERE employee_no = 'zhaomin' LIMIT 1), 1),
('mss-retail', 'retail', '零售领域', '零售门店、线下渠道需求', (SELECT id FROM app_user WHERE employee_no = 'sunyue' LIMIT 1), 1),
('mss-service', 'service', '服务领域', '售后服务、维修、客户服务场景需求', NULL, 1),
('mss-ecommerce', 'ecommerce', '电商领域', '线上电商渠道需求', NULL, 1);

-- 4. 现有产品默认关联到MKT领域（兼容历史数据）
UPDATE product SET mss_domain_id = 'mss-mkt' WHERE mss_domain_id IS NULL;

-- 5. 收集计划表增加mss_domain_id字段，自动继承产品的MSS领域
ALTER TABLE collection_plan ADD COLUMN mss_domain_id TEXT REFERENCES mss_domain(id);
UPDATE collection_plan cp SET mss_domain_id = (SELECT p.mss_domain_id FROM product p WHERE p.id = cp.product_id) WHERE mss_domain_id IS NULL;
