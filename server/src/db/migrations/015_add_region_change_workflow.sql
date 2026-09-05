-- 区域需求提交后的撤回、变更申请、版本快照及领域反馈失效历史。
ALTER TABLE collection_plan_domain_submission ADD COLUMN revision_no INTEGER NOT NULL DEFAULT 0;
ALTER TABLE collection_plan_domain_submission ADD COLUMN change_pending BOOLEAN NOT NULL DEFAULT 0;
ALTER TABLE collection_plan_domain_submission ADD COLUMN reopened_by TEXT REFERENCES app_user(id);
ALTER TABLE collection_plan_domain_submission ADD COLUMN reopened_at TEXT;
ALTER TABLE collection_plan_domain_submission ADD COLUMN reopen_reason TEXT;
ALTER TABLE collection_plan_domain_submission ADD COLUMN reopen_type VARCHAR(32);

-- 升级前已经提交的数据视为第1版；尚未提交的数据在首次提交时生成第1版。
UPDATE collection_plan_domain_submission SET revision_no = 1 WHERE status = 'SUBMITTED';

CREATE TABLE IF NOT EXISTS collection_plan_region_change_request (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  submission_id TEXT NOT NULL REFERENCES collection_plan_domain_submission(id) ON DELETE CASCADE,
  request_type TEXT NOT NULL CHECK (request_type IN ('SELF_WITHDRAW', 'REOPEN_REQUEST', 'CHANGE_REQUEST', 'POST_EXPORT_CHANGE', 'MSS_RETURN')),
  status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED', 'APPLIED')),
  reason TEXT NOT NULL,
  source_submission_version INTEGER NOT NULL,
  source_revision_no INTEGER NOT NULL,
  source_plan_status VARCHAR(32) NOT NULL,
  source_snapshot TEXT NOT NULL DEFAULT '{}',
  requested_by TEXT NOT NULL REFERENCES app_user(id),
  requested_at TEXT NOT NULL DEFAULT (datetime('now')),
  decided_by TEXT REFERENCES app_user(id),
  decided_at TEXT,
  decision_note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  version INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_region_change_submission ON collection_plan_region_change_request(submission_id, requested_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_region_change_pending ON collection_plan_region_change_request(submission_id) WHERE status = 'PENDING';

CREATE TABLE IF NOT EXISTS collection_plan_domain_submission_revision (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  submission_id TEXT NOT NULL REFERENCES collection_plan_domain_submission(id) ON DELETE CASCADE,
  revision_no INTEGER NOT NULL,
  data_snapshot TEXT NOT NULL DEFAULT '{}',
  submitted_by TEXT NOT NULL REFERENCES app_user(id),
  submitted_at TEXT NOT NULL DEFAULT (datetime('now')),
  change_request_id TEXT REFERENCES collection_plan_region_change_request(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(submission_id, revision_no)
);
CREATE INDEX IF NOT EXISTS idx_submission_revision_submission ON collection_plan_domain_submission_revision(submission_id, revision_no);

CREATE TABLE IF NOT EXISTS collection_plan_domain_feedback_history (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  original_feedback_id TEXT NOT NULL,
  domain_task_id TEXT NOT NULL REFERENCES collection_plan_domain_task(id) ON DELETE CASCADE,
  note TEXT NOT NULL,
  total_quantity INTEGER NOT NULL,
  summary_snapshot TEXT NOT NULL DEFAULT '{}',
  confirmed_by TEXT NOT NULL REFERENCES app_user(id),
  confirmed_at TEXT NOT NULL,
  feedback_version INTEGER NOT NULL,
  invalidated_by TEXT NOT NULL REFERENCES app_user(id),
  invalidated_at TEXT NOT NULL DEFAULT (datetime('now')),
  invalidation_reason TEXT NOT NULL,
  change_request_id TEXT REFERENCES collection_plan_region_change_request(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_feedback_history_task ON collection_plan_domain_feedback_history(domain_task_id, invalidated_at);

PRAGMA optimize;
