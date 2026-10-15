-- Preserve historical office-level entries and add optional country detail.
ALTER TABLE collection_plan_domain_demand_item ADD COLUMN country_id TEXT REFERENCES org_node(id);
ALTER TABLE execution_fact ADD COLUMN collection_plan_id TEXT REFERENCES collection_plan(id);
CREATE INDEX idx_domain_demand_geography ON collection_plan_domain_demand_item(submission_id, office_id, product_sku_id, provisional_item_key, country_id);
CREATE INDEX idx_fact_collection_plan ON execution_fact(collection_plan_id, product_sku_id, mss_domain_id, office_id, country_id);
UPDATE execution_fact SET collection_plan_id = (
  SELECT task.plan_id FROM collection_plan_domain_task task WHERE task.id = execution_fact.source_id
) WHERE source_type = 'CONFIRMED_DEMAND';
-- Historical fulfilment without provenance is attributed only when there is one
-- unambiguous formal plan for that SKU/domain/office; otherwise keep it unassigned.
UPDATE execution_fact SET collection_plan_id = (
  SELECT MIN(d.collection_plan_id) FROM execution_fact d
  WHERE d.source_type = 'CONFIRMED_DEMAND' AND d.product_sku_id = execution_fact.product_sku_id
    AND d.mss_domain_id = execution_fact.mss_domain_id AND d.office_id = execution_fact.office_id
  HAVING COUNT(DISTINCT d.collection_plan_id) = 1
) WHERE source_type <> 'CONFIRMED_DEMAND' AND collection_plan_id IS NULL;
