CREATE TABLE IF NOT EXISTS inventory_balance (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  product_id TEXT NOT NULL REFERENCES product(id),
  product_sku_id TEXT NOT NULL REFERENCES product_sku(id),
  warehouse VARCHAR(256) NOT NULL,
  system_quantity INTEGER NOT NULL DEFAULT 0,
  actual_quantity INTEGER NOT NULL DEFAULT 0,
  locked_quantity INTEGER NOT NULL DEFAULT 0,
  available_quantity INTEGER NOT NULL DEFAULT 0,
  reason VARCHAR(512),
  checked_by TEXT REFERENCES app_user(id),
  checked_at TEXT,
  enabled BOOLEAN NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  version INTEGER NOT NULL DEFAULT 1,
  UNIQUE(product_sku_id, warehouse)
);

CREATE INDEX IF NOT EXISTS idx_inventory_balance_product ON inventory_balance(product_id, product_sku_id, enabled);
