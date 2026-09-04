-- GTM计划下发给全部MSS领域后，由各领域接口人选择型号和区域进行二次下发。
CREATE TABLE IF NOT EXISTS collection_plan_domain_task (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  plan_id TEXT NOT NULL REFERENCES collection_plan(id),
  mss_domain_id TEXT NOT NULL REFERENCES mss_domain(id),
  status TEXT NOT NULL DEFAULT 'PENDING_DISPATCH' CHECK (status IN ('PENDING_DISPATCH', 'COLLECTING', 'READY_TO_FEEDBACK', 'FEEDBACK_SUBMITTED')),
  dispatched_by TEXT REFERENCES app_user(id),
  dispatched_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  version INTEGER NOT NULL DEFAULT 1,
  UNIQUE(plan_id, mss_domain_id)
);
CREATE INDEX IF NOT EXISTS idx_domain_task_plan_status ON collection_plan_domain_task(plan_id, status);
CREATE INDEX IF NOT EXISTS idx_domain_task_mss_status ON collection_plan_domain_task(mss_domain_id, status);

CREATE TABLE IF NOT EXISTS collection_plan_domain_task_sku (
  domain_task_id TEXT NOT NULL REFERENCES collection_plan_domain_task(id) ON DELETE CASCADE,
  product_sku_id TEXT NOT NULL REFERENCES product_sku(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY(domain_task_id, product_sku_id)
);

CREATE TABLE IF NOT EXISTS collection_plan_domain_scope (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  domain_task_id TEXT NOT NULL REFERENCES collection_plan_domain_task(id) ON DELETE CASCADE,
  region_id TEXT NOT NULL REFERENCES org_node(id),
  region_name_snapshot VARCHAR(256) NOT NULL,
  region_owner_snapshot VARCHAR(128),
  office_country_snapshot TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  version INTEGER NOT NULL DEFAULT 1,
  UNIQUE(domain_task_id, region_id)
);
CREATE INDEX IF NOT EXISTS idx_domain_scope_region ON collection_plan_domain_scope(region_id, domain_task_id);

CREATE TABLE IF NOT EXISTS collection_plan_domain_submission (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  domain_scope_id TEXT NOT NULL UNIQUE REFERENCES collection_plan_domain_scope(id) ON DELETE CASCADE,
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

CREATE TABLE IF NOT EXISTS collection_plan_domain_demand_item (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  submission_id TEXT NOT NULL REFERENCES collection_plan_domain_submission(id) ON DELETE CASCADE,
  product_sku_id TEXT REFERENCES product_sku(id),
  provisional_item_key VARCHAR(256),
  office_id TEXT REFERENCES org_node(id),
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
CREATE INDEX IF NOT EXISTS idx_domain_demand_item_submission ON collection_plan_domain_demand_item(submission_id);

CREATE TABLE IF NOT EXISTS collection_plan_domain_feedback (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  domain_task_id TEXT NOT NULL UNIQUE REFERENCES collection_plan_domain_task(id) ON DELETE CASCADE,
  note TEXT NOT NULL,
  total_quantity INTEGER NOT NULL CHECK (total_quantity >= 0),
  summary_snapshot TEXT NOT NULL DEFAULT '{}',
  confirmed_by TEXT NOT NULL REFERENCES app_user(id),
  confirmed_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  version INTEGER NOT NULL DEFAULT 1
);

-- 将升级前“一计划一领域”的数据转换成领域任务，历史数据可继续查询和导出。
INSERT INTO collection_plan_domain_task (id, plan_id, mss_domain_id, status, dispatched_by, dispatched_at, created_at, updated_at, version)
SELECT 'domain-task-' || cp.id || '-' || cp.mss_domain_id, cp.id, cp.mss_domain_id,
  CASE
    WHEN cp.status = 'READY_TO_RELEASE' THEN 'PENDING_DISPATCH'
    WHEN cp.status = 'DOMAIN_REVIEW' THEN 'READY_TO_FEEDBACK'
    WHEN cp.status IN ('GTM_CLOSURE', 'EXPORTED') THEN 'FEEDBACK_SUBMITTED'
    ELSE 'COLLECTING'
  END,
  cp.released_by, cp.released_at, cp.created_at, cp.updated_at, cp.version
FROM collection_plan cp
WHERE cp.mss_domain_id IS NOT NULL
ON CONFLICT(plan_id, mss_domain_id) DO NOTHING;

INSERT INTO collection_plan_domain_task_sku (domain_task_id, product_sku_id)
SELECT 'domain-task-' || cp.id || '-' || cp.mss_domain_id, ps.id
FROM collection_plan cp
JOIN product_sku ps ON ps.product_id = cp.product_id AND ps.enabled = true
WHERE cp.mss_domain_id IS NOT NULL
ON CONFLICT(domain_task_id, product_sku_id) DO NOTHING;

INSERT INTO collection_plan_domain_scope (id, domain_task_id, region_id, region_name_snapshot, region_owner_snapshot, office_country_snapshot, created_at, updated_at, version)
SELECT 'domain-' || cps.id, 'domain-task-' || cp.id || '-' || cp.mss_domain_id, cps.region_id,
  cps.region_name_snapshot, cps.region_owner_snapshot, cps.office_country_snapshot, cps.created_at, cps.updated_at, cps.version
FROM collection_plan_scope cps
JOIN collection_plan cp ON cp.id = cps.plan_id
WHERE cp.mss_domain_id IS NOT NULL
ON CONFLICT(domain_task_id, region_id) DO NOTHING;

INSERT INTO collection_plan_domain_submission (id, domain_scope_id, status, saved_by, saved_at, submitted_by, submitted_at, returned_by, returned_at, return_reason, created_at, updated_at, version)
SELECT 'domain-' || ds.id, 'domain-' || ds.plan_scope_id, ds.status, ds.saved_by, ds.saved_at,
  ds.submitted_by, ds.submitted_at, ds.returned_by, ds.returned_at, ds.return_reason, ds.created_at, ds.updated_at, ds.version
FROM demand_submission ds
JOIN collection_plan_scope cps ON cps.id = ds.plan_scope_id
JOIN collection_plan cp ON cp.id = cps.plan_id
WHERE cp.mss_domain_id IS NOT NULL
ON CONFLICT(domain_scope_id) DO NOTHING;

INSERT INTO collection_plan_domain_demand_item (id, submission_id, product_sku_id, provisional_item_key, office_id, quantity, demand_basis, planned_use_date, note, created_at, updated_at, version)
SELECT 'domain-' || di.id, 'domain-' || di.submission_id, di.product_sku_id, di.provisional_item_key,
  di.office_id, di.quantity, di.demand_basis, di.planned_use_date, di.note, di.created_at, di.updated_at, di.version
FROM demand_item di
JOIN demand_submission ds ON ds.id = di.submission_id
JOIN collection_plan_scope cps ON cps.id = ds.plan_scope_id
JOIN collection_plan cp ON cp.id = cps.plan_id
WHERE cp.mss_domain_id IS NOT NULL;

INSERT INTO collection_plan_domain_feedback (id, domain_task_id, note, total_quantity, summary_snapshot, confirmed_by, confirmed_at, created_at, updated_at, version)
SELECT 'domain-' || df.id, 'domain-task-' || cp.id || '-' || cp.mss_domain_id, df.note,
  df.total_quantity, df.summary_snapshot, df.confirmed_by, df.confirmed_at, df.created_at, df.updated_at, df.version
FROM domain_feedback df
JOIN collection_plan cp ON cp.id = df.plan_id
WHERE cp.mss_domain_id IS NOT NULL
ON CONFLICT(domain_task_id) DO NOTHING;

PRAGMA optimize;
