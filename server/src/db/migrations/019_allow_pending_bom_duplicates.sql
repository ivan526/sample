-- Only completed model+BOM pairs are unique; pending-BOM rows stay independent.
DROP INDEX IF EXISTS uq_product_sku_model_bom;
CREATE UNIQUE INDEX uq_product_sku_model_bom ON product_sku
  (lower(trim(model)), lower(trim(COALESCE(bom_code,''))))
  WHERE enabled = true AND trim(COALESCE(bom_code,'')) <> '';
