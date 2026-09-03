-- 样机阶段属于一次需求收集计划，而不是产品主数据。
-- 保留 product.sample_stage 作为历史兼容字段，已有计划优先继承原产品阶段。
ALTER TABLE collection_plan
ADD COLUMN sample_stage VARCHAR(64) NOT NULL DEFAULT '工程样机（EVT）';

UPDATE collection_plan
SET sample_stage = COALESCE(
  (SELECT p.sample_stage FROM product p WHERE p.id = collection_plan.product_id),
  sample_stage
);

CREATE INDEX IF NOT EXISTS idx_collection_plan_product_stage_status
ON collection_plan(product_id, sample_stage, status);
