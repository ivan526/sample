-- 用户可按角色关联一个或多个产品品类或MSS业务领域。
CREATE TABLE user_scope_assignment (
  user_id TEXT NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  scope_type VARCHAR(32) NOT NULL CHECK (scope_type IN ('PRODUCT_DOMAIN', 'MSS_DOMAIN')),
  scope_id TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, scope_type, scope_id)
);

CREATE INDEX idx_user_scope_assignment_scope
ON user_scope_assignment(scope_type, scope_id);

-- 升级已有数据：从当前责任人配置回填用户负责范围。
INSERT INTO user_scope_assignment (user_id, scope_type, scope_id)
SELECT gtm_owner_id, 'PRODUCT_DOMAIN', id FROM product_domain WHERE gtm_owner_id IS NOT NULL
UNION
SELECT stocking_owner_id, 'PRODUCT_DOMAIN', id FROM product_domain WHERE stocking_owner_id IS NOT NULL
UNION
SELECT mss_owner_id, 'MSS_DOMAIN', id FROM mss_domain WHERE mss_owner_id IS NOT NULL
UNION
SELECT DISTINCT owner_id, 'MSS_DOMAIN', 'mss-mkt' FROM org_node
WHERE owner_id IS NOT NULL AND node_type IN ('REGION', 'OFFICE');
