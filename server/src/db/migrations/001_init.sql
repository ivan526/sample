-- 兼容SQLite和PostgreSQL的初始化Schema
-- 主键统一用TEXT存储UUID，SQLite自动兼容，PG也支持TEXT主键

-- 应用用户表
CREATE TABLE IF NOT EXISTS app_user (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))) /* PostgreSQL: gen_random_uuid() */,
  employee_no VARCHAR(64) NOT NULL UNIQUE,
  display_name VARCHAR(128) NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')) /* PostgreSQL: NOW() */,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')) /* PostgreSQL: NOW() */,
  version INTEGER NOT NULL DEFAULT 1
);

-- 产品领域表
CREATE TABLE IF NOT EXISTS product_domain (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  code VARCHAR(64) NOT NULL UNIQUE,
  name VARCHAR(128) NOT NULL UNIQUE,
  description TEXT,
  gtm_owner_id TEXT NOT NULL REFERENCES app_user(id),
  stocking_owner_id TEXT NOT NULL REFERENCES app_user(id),
  enabled BOOLEAN NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  version INTEGER NOT NULL DEFAULT 1
);

-- 产品表
CREATE TABLE IF NOT EXISTS product (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  code VARCHAR(64) NOT NULL UNIQUE,
  name VARCHAR(256) NOT NULL,
  domain_id TEXT NOT NULL REFERENCES product_domain(id),
  sample_stage VARCHAR(64),
  supply_time_text VARCHAR(256),
  default_deadline_text VARCHAR(128),
  enabled BOOLEAN NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  version INTEGER NOT NULL DEFAULT 1
);

-- 产品SKU表
CREATE TABLE IF NOT EXISTS product_sku (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  product_id TEXT NOT NULL REFERENCES product(id),
  model VARCHAR(256) NOT NULL,
  bom_code VARCHAR(128),
  enabled BOOLEAN NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  version INTEGER NOT NULL DEFAULT 1,
  UNIQUE(product_id, model)
);

-- 组织节点表（兼容三级结构：区域/代表处/国家）
CREATE TABLE IF NOT EXISTS org_node (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  code VARCHAR(64) NOT NULL UNIQUE,
  name VARCHAR(256) NOT NULL,
  node_type TEXT NOT NULL CHECK (node_type IN ('REGION', 'OFFICE', 'COUNTRY')),
  parent_id TEXT REFERENCES org_node(id),
  owner_id TEXT REFERENCES app_user(id),
  enabled BOOLEAN NOT NULL DEFAULT 1,
  valid_from TEXT NOT NULL DEFAULT (datetime('now')),
  valid_to TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  version INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_org_node_parent ON org_node(parent_id);

-- 主数据别名表（TSMP数据映射用）
CREATE TABLE IF NOT EXISTS master_data_alias (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  entity_type VARCHAR(32) NOT NULL CHECK (entity_type IN ('SKU', 'REGION', 'OFFICE', 'COUNTRY')),
  entity_id TEXT NOT NULL,
  source_system VARCHAR(32) NOT NULL DEFAULT 'TSMP',
  alias_value VARCHAR(256) NOT NULL,
  normalized_value VARCHAR(256) NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  version INTEGER NOT NULL DEFAULT 1,
  UNIQUE(source_system, entity_type, normalized_value)
);

-- 收集计划表
CREATE TABLE IF NOT EXISTS collection_plan (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  plan_no VARCHAR(64) NOT NULL UNIQUE,
  product_id TEXT NOT NULL REFERENCES product(id),
  domain_id TEXT NOT NULL REFERENCES product_domain(id),
  status TEXT NOT NULL DEFAULT 'READY_TO_RELEASE' CHECK (status IN ('PRODUCT_DRAFT', 'READY_TO_RELEASE', 'COLLECTING', 'DOMAIN_REVIEW', 'GTM_CLOSURE', 'EXPORTED')),
  deadline_at TEXT NOT NULL,
  note TEXT,
  demand_total INTEGER NOT NULL DEFAULT 0,
  released_by TEXT REFERENCES app_user(id),
  released_at TEXT,
  created_by TEXT NOT NULL REFERENCES app_user(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  version INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_collection_plan_product_status ON collection_plan(product_id, status);

-- 计划范围快照表
CREATE TABLE IF NOT EXISTS collection_plan_scope (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  plan_id TEXT NOT NULL REFERENCES collection_plan(id),
  region_id TEXT NOT NULL REFERENCES org_node(id),
  region_name_snapshot VARCHAR(256) NOT NULL,
  region_owner_snapshot VARCHAR(128),
  office_country_snapshot TEXT NOT NULL DEFAULT '[]', -- JSON
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  version INTEGER NOT NULL DEFAULT 1,
  UNIQUE(plan_id, region_id)
);

-- 区域需求提交表
CREATE TABLE IF NOT EXISTS demand_submission (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  plan_scope_id TEXT NOT NULL UNIQUE REFERENCES collection_plan_scope(id),
  status TEXT NOT NULL DEFAULT 'NOT_STARTED' CHECK (status IN ('NOT_STARTED', 'DRAFT', 'SUBMITTED', 'RETURNED')),
  saved_by TEXT REFERENCES app_user(id),
  saved_at TEXT,
  submitted_by TEXT REFERENCES app_user(id),
  submitted_at TEXT,
  returned_by TEXT REFERENCES app_user(id),
  returned_at TEXT,
  return_reason TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  version INTEGER NOT NULL DEFAULT 1
);

-- 需求明细表
CREATE TABLE IF NOT EXISTS demand_item (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  submission_id TEXT NOT NULL REFERENCES demand_submission(id),
  product_sku_id TEXT REFERENCES product_sku(id),
  provisional_item_key VARCHAR(256),
  quantity INTEGER NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  demand_basis VARCHAR(64),
  planned_use_date TEXT,
  note VARCHAR(500),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  version INTEGER NOT NULL DEFAULT 1,
  CHECK (product_sku_id IS NOT NULL OR provisional_item_key IS NOT NULL),
  CHECK (quantity = 0 OR demand_basis IS NOT NULL)
);
-- 唯一性约束由应用层保证，SQLite部分索引兼容性处理
CREATE INDEX IF NOT EXISTS idx_demand_item_sku ON demand_item(submission_id, product_sku_id);
CREATE INDEX IF NOT EXISTS idx_demand_item_provisional ON demand_item(submission_id, provisional_item_key);

-- 领域反馈表
CREATE TABLE IF NOT EXISTS domain_feedback (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  plan_id TEXT NOT NULL UNIQUE REFERENCES collection_plan(id),
  note TEXT NOT NULL,
  total_quantity INTEGER NOT NULL CHECK (total_quantity >= 0),
  summary_snapshot TEXT NOT NULL DEFAULT '{}', -- JSON
  confirmed_by TEXT NOT NULL REFERENCES app_user(id),
  confirmed_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  version INTEGER NOT NULL DEFAULT 1
);

-- 导出记录表
CREATE TABLE IF NOT EXISTS production_export (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  plan_id TEXT NOT NULL REFERENCES collection_plan(id),
  plan_version INTEGER NOT NULL,
  file_name VARCHAR(256) NOT NULL,
  storage_key VARCHAR(512),
  row_count INTEGER NOT NULL,
  data_snapshot TEXT NOT NULL DEFAULT '[]', -- JSON
  exported_by TEXT NOT NULL REFERENCES app_user(id),
  exported_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  version INTEGER NOT NULL DEFAULT 1
);

-- TSMP导入任务表
CREATE TABLE IF NOT EXISTS tsmp_import_job (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  file_name VARCHAR(256) NOT NULL,
  file_hash VARCHAR(128) UNIQUE,
  storage_key VARCHAR(512),
  status TEXT NOT NULL DEFAULT 'UPLOADED' CHECK (status IN ('UPLOADED', 'VALIDATING', 'MATCHING', 'COMPLETED', 'FAILED')),
  total_rows INTEGER NOT NULL DEFAULT 0,
  matched_rows INTEGER NOT NULL DEFAULT 0,
  mapping_required_rows INTEGER NOT NULL DEFAULT 0,
  unmatched_rows INTEGER NOT NULL DEFAULT 0,
  duplicate_rows INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  imported_by TEXT NOT NULL REFERENCES app_user(id),
  started_at TEXT,
  completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  version INTEGER NOT NULL DEFAULT 1
);

-- TSMP原始发货行表
CREATE TABLE IF NOT EXISTS tsmp_shipment_raw (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  import_job_id TEXT NOT NULL REFERENCES tsmp_import_job(id),
  source_row_no INTEGER NOT NULL,
  external_key VARCHAR(256),
  application_no VARCHAR(128),
  raw_sku VARCHAR(256),
  raw_bom VARCHAR(128),
  raw_region VARCHAR(256),
  raw_office VARCHAR(256),
  raw_country VARCHAR(256),
  shipped_quantity INTEGER,
  shipped_at TEXT,
  row_fingerprint VARCHAR(128) NOT NULL UNIQUE,
  raw_payload TEXT NOT NULL DEFAULT '{}', -- JSON
  match_status TEXT NOT NULL CHECK (match_status IN ('MATCHED', 'MAPPING_REQUIRED', 'UNMATCHED', 'DUPLICATE', 'INVALID')),
  match_reason TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  version INTEGER NOT NULL DEFAULT 1
);

-- 执行事实表（聚合后的可查询数据）
CREATE TABLE IF NOT EXISTS execution_fact (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  source_type VARCHAR(32) NOT NULL CHECK (source_type IN ('CONFIRMED_DEMAND', 'PRODUCTION', 'APPLICATION', 'SHIPMENT', 'INVENTORY')),
  source_id TEXT,
  product_id TEXT NOT NULL REFERENCES product(id),
  product_sku_id TEXT REFERENCES product_sku(id),
  region_id TEXT REFERENCES org_node(id),
  office_id TEXT REFERENCES org_node(id),
  country_id TEXT REFERENCES org_node(id),
  quantity INTEGER NOT NULL,
  occurred_at TEXT NOT NULL DEFAULT (datetime('now')),
  dimension_snapshot TEXT NOT NULL DEFAULT '{}', -- JSON
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  version INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_execution_fact_dimensions ON execution_fact(product_id, product_sku_id, region_id, office_id, country_id, source_type);

-- 审计日志表
CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  actor_id TEXT REFERENCES app_user(id),
  action VARCHAR(128) NOT NULL,
  entity_type VARCHAR(64) NOT NULL,
  entity_id TEXT,
  before_data TEXT, -- JSON
  after_data TEXT, -- JSON
  request_id VARCHAR(128),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  version INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_log(entity_type, entity_id, created_at DESC);

-- 迁移记录表
CREATE TABLE IF NOT EXISTS schema_migrations (
  version VARCHAR(255) PRIMARY KEY,
  applied_at TEXT NOT NULL DEFAULT (datetime('now'))
);
