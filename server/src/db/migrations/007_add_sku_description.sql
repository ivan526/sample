-- Add description field to product_sku table for SKU product description
-- 2026-09-01: 支持SKU产品描述字段存储
ALTER TABLE product_sku ADD COLUMN IF NOT EXISTS description TEXT;
-- Add comment for field
COMMENT ON COLUMN product_sku.description IS '产品型号描述/配置规格说明';
