-- 收集计划取消/归档使用独立生命周期字段，保留原业务流程状态和完整审计链路。
ALTER TABLE collection_plan ADD COLUMN cancelled_at TEXT;
ALTER TABLE collection_plan ADD COLUMN cancelled_by TEXT REFERENCES app_user(id);
ALTER TABLE collection_plan ADD COLUMN archived_at TEXT;
ALTER TABLE collection_plan ADD COLUMN archived_by TEXT REFERENCES app_user(id);

CREATE INDEX IF NOT EXISTS idx_collection_plan_lifecycle
  ON collection_plan(archived_at, cancelled_at, updated_at);

PRAGMA optimize;
