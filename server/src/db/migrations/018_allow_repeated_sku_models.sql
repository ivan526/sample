-- Replace the legacy UNIQUE(product_id, model), preserving stable SKU IDs.
CREATE TABLE product_sku_pair_migration (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  product_id TEXT NOT NULL REFERENCES product(id),
  model VARCHAR(256) NOT NULL,
  bom_code VARCHAR(128),
  enabled BOOLEAN NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  version INTEGER NOT NULL DEFAULT 1,
  description TEXT
);
INSERT INTO product_sku_pair_migration (id,product_id,model,bom_code,enabled,created_at,updated_at,version,description)
SELECT id,product_id,model,bom_code,enabled,created_at,updated_at,version,description FROM product_sku;
DROP TABLE product_sku;
ALTER TABLE product_sku_pair_migration RENAME TO product_sku;
CREATE UNIQUE INDEX uq_product_sku_model_bom ON product_sku
  (lower(trim(model)), lower(trim(COALESCE(bom_code,'')))) WHERE enabled = true;
