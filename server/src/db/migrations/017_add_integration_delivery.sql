-- 外部系统增量同步流水；事实、流水与审计在同一事务中提交。
CREATE TABLE IF NOT EXISTS integration_delivery (
  id TEXT PRIMARY KEY,
  actor_id TEXT NOT NULL REFERENCES app_user(id),
  idempotency_key VARCHAR(128) NOT NULL,
  request_hash VARCHAR(64) NOT NULL,
  request_payload TEXT NOT NULL,
  response_payload TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (now()),
  UNIQUE (actor_id, idempotency_key)
);
