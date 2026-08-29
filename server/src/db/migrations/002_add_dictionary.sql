-- 新增数据字典表，支持各种基础配置项
CREATE TABLE IF NOT EXISTS data_dictionary (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  dict_type VARCHAR(64) NOT NULL, -- 字典类型：SAMPLE_STAGE/MSS_DOMAIN/DEMAND_BASIS等
  code VARCHAR(64) NOT NULL,
  name VARCHAR(128) NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  description TEXT,
  enabled BOOLEAN NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  version INTEGER NOT NULL DEFAULT 1,
  UNIQUE(dict_type, code)
);
CREATE INDEX IF NOT EXISTS idx_dict_type ON data_dictionary(dict_type, enabled, sort_order);

-- 插入默认字典数据
INSERT OR IGNORE INTO data_dictionary (dict_type, code, name, sort_order) VALUES
-- 样机阶段
('SAMPLE_STAGE', 'EVT', '工程样机（EVT）', 1),
('SAMPLE_STAGE', 'DVT', '测试样机（DVT）', 2),
('SAMPLE_STAGE', 'PVT', '试生产样机（PVT）', 3),
('SAMPLE_STAGE', 'VN1', '验证样机（VN1）', 4),
('SAMPLE_STAGE', 'VN2', '测试样机（VN2）', 5),
-- MSS领域
('MSS_DOMAIN', 'CONSUMER', '消费类产品', 1),
('MSS_DOMAIN', 'COMMERCIAL', '商用产品', 2),
('MSS_DOMAIN', 'INDUSTRIAL', '行业产品', 3),
('MSS_DOMAIN', 'WEARABLE', '穿戴产品', 4),
('MSS_DOMAIN', 'IOT', 'IoT生态产品', 5),
-- 需求依据
('DEMAND_BASIS', 'PROJECT_BID', '项目投标', 1),
('DEMAND_BASIS', 'CUSTOMER_DEMO', '客户演示', 2),
('DEMAND_BASIS', 'MARKETING_ACTIVITY', '营销活动', 3),
('DEMAND_BASIS', 'LAB_TEST', '实验室测试', 4),
('DEMAND_BASIS', 'CHANNEL_PREVIEW', '渠道预览', 5),
('DEMAND_BASIS', 'OTHER', '其他', 99);
