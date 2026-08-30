-- 给产品领域表添加MSS领域接口人字段
ALTER TABLE product_domain ADD COLUMN domain_owner_id TEXT REFERENCES app_user(id);

-- 现有数据默认设置domain_owner_id和stocking_owner_id相同，后续可通过管理界面调整
UPDATE product_domain SET domain_owner_id = stocking_owner_id WHERE domain_owner_id IS NULL;
