-- TSMP正式导出字段增加MSS业务领域，并将领域维度固化到发货原始行和执行事实。
ALTER TABLE tsmp_shipment_raw ADD COLUMN raw_mss_domain VARCHAR(256);
ALTER TABLE execution_fact ADD COLUMN mss_domain_id TEXT REFERENCES mss_domain(id);

CREATE INDEX IF NOT EXISTS idx_execution_fact_mss_dimensions
  ON execution_fact(mss_domain_id, product_sku_id, region_id, office_id, country_id, source_type);

-- 新版确认需求以领域任务ID作为source_id，可安全补齐领域维度。
UPDATE execution_fact
SET mss_domain_id = (
  SELECT task.mss_domain_id
  FROM collection_plan_domain_task task
  WHERE task.id = execution_fact.source_id
)
WHERE source_type = 'CONFIRMED_DEMAND'
  AND mss_domain_id IS NULL
  AND EXISTS (
    SELECT 1 FROM collection_plan_domain_task task WHERE task.id = execution_fact.source_id
  );

PRAGMA optimize;
