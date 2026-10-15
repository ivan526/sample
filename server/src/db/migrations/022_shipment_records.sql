-- Immutable business metadata belongs to one successful shipment fact.
CREATE TABLE IF NOT EXISTS shipment_record (
  fact_id TEXT PRIMARY KEY REFERENCES execution_fact(id) ON DELETE CASCADE,
  handler_user_id TEXT REFERENCES app_user(id),
  caller_user_id TEXT NOT NULL REFERENCES app_user(id),
  metadata TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (now())
);
CREATE INDEX IF NOT EXISTS idx_shipment_record_handler ON shipment_record(handler_user_id);
CREATE TABLE IF NOT EXISTS integration_shipment_call (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL,
  actor_id TEXT NOT NULL REFERENCES app_user(id),
  handler_user_id TEXT REFERENCES app_user(id),
  product_id TEXT REFERENCES product(id),
  delivery_id TEXT REFERENCES integration_delivery(id),
  outcome TEXT NOT NULL CHECK (outcome IN ('SUCCESS','REPLAY','FAILURE')),
  quantity_added INTEGER NOT NULL DEFAULT 0,
  code TEXT NOT NULL,
  message TEXT NOT NULL,
  snapshot TEXT NOT NULL,
  received_at TEXT NOT NULL DEFAULT (now())
);
CREATE INDEX IF NOT EXISTS idx_shipment_call_scope ON integration_shipment_call(handler_user_id, product_id, received_at);
CREATE INDEX IF NOT EXISTS idx_shipment_fact_scope ON execution_fact(source_type,product_id,occurred_at);
