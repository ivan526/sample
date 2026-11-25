-- Preserve existing contact-based access when upgrading. Never delete shared assignments.
-- After this one-time backfill, scope assignments (not the default contact) authorize access.
INSERT INTO user_scope_assignment(user_id,scope_type,scope_id)
SELECT pd.gtm_owner_id,'PRODUCT_DOMAIN',pd.id FROM product_domain pd JOIN app_user u ON u.id=pd.gtm_owner_id
WHERE u.role='GTM' AND u.enabled=true
ON CONFLICT(user_id,scope_type,scope_id) DO NOTHING;
INSERT INTO user_scope_assignment(user_id,scope_type,scope_id)
SELECT pd.stocking_owner_id,'PRODUCT_DOMAIN',pd.id FROM product_domain pd JOIN app_user u ON u.id=pd.stocking_owner_id
WHERE u.role='STOCKING_OWNER' AND u.enabled=true
ON CONFLICT(user_id,scope_type,scope_id) DO NOTHING;
INSERT INTO user_scope_assignment(user_id,scope_type,scope_id)
SELECT md.mss_owner_id,'MSS_DOMAIN',md.id FROM mss_domain md JOIN app_user u ON u.id=md.mss_owner_id
WHERE u.role='MSS_DOMAIN_OWNER' AND u.enabled=true
ON CONFLICT(user_id,scope_type,scope_id) DO NOTHING;
