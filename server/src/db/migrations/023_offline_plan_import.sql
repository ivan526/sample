CREATE TABLE IF NOT EXISTS collection_plan_import (
  id TEXT PRIMARY KEY,
  plan_id TEXT NOT NULL UNIQUE REFERENCES collection_plan(id),
  product_id TEXT NOT NULL REFERENCES product(id),
  sample_stage TEXT NOT NULL,
  source_reference TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  file_name TEXT NOT NULL,
  row_count INTEGER NOT NULL,
  imported_by TEXT NOT NULL REFERENCES app_user(id),
  imported_at TEXT NOT NULL DEFAULT (now()),
  request_id TEXT NOT NULL,
  UNIQUE(product_id,sample_stage,source_reference)
);
