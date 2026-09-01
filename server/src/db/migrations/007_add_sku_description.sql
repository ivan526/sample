-- Add description field to product_sku table for SKU product description
-- 2026-09-01: 支持SKU产品描述字段存储
-- SQLite兼容：ALTER TABLE ADD COLUMN不支持IF NOT EXISTS，迁移仅执行一次无需判断
ALTER TABLE product_sku ADD COLUMN description TEXT;
-- 字段注释仅PostgreSQL支持，SQLite自动忽略
-- COMMENT ON COLUMN product_sku.description IS '产品型号描述/配置规格说明';
