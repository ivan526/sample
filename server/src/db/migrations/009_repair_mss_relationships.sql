-- Repair MSS relationships for databases created before seed ownership was available.
CREATE INDEX IF NOT EXISTS idx_collection_plan_mss_domain ON collection_plan(mss_domain_id);

UPDATE mss_domain
SET mss_owner_id = (SELECT id FROM app_user WHERE employee_no = 'zhaomin' LIMIT 1),
    updated_at = NOW()
WHERE id = 'mss-mkt' AND mss_owner_id IS NULL;

UPDATE mss_domain
SET mss_owner_id = (SELECT id FROM app_user WHERE employee_no = 'sunyue' LIMIT 1),
    updated_at = NOW()
WHERE id = 'mss-retail' AND mss_owner_id IS NULL;

UPDATE product
SET mss_domain_id = CASE WHEN domain_id = 'tablet' THEN 'mss-retail' ELSE 'mss-mkt' END,
    updated_at = NOW()
WHERE mss_domain_id IS NULL;

UPDATE collection_plan
SET mss_domain_id = (SELECT p.mss_domain_id FROM product p WHERE p.id = collection_plan.product_id),
    updated_at = NOW()
WHERE mss_domain_id IS NULL;
