-- 新增数据字典表，支持各种基础配置项
CREATE TABLE IF NOT EXISTS data_dictionary (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  dict_type VARCHAR(64) NOT NULL, -- 字典类型：SAMPLE_STAGE/DEMAND_BASIS等
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
('SAMPLE_STAGE', 'V3', 'V3', 1),
('SAMPLE_STAGE', 'V4', 'V4', 2),
('SAMPLE_STAGE', 'VN1', 'VN1', 3),
('SAMPLE_STAGE', 'VN2', 'VN2', 4),
-- 需求依据
('DEMAND_BASIS', 'PROJECT_BID', '项目投标', 1),
('DEMAND_BASIS', 'CUSTOMER_DEMO', '客户演示', 2),
('DEMAND_BASIS', 'MARKETING_ACTIVITY', '营销活动', 3),
('DEMAND_BASIS', 'LAB_TEST', '实验室测试', 4),
('DEMAND_BASIS', 'CHANNEL_PREVIEW', '渠道预览', 5),
('DEMAND_BASIS', 'OTHER', '其他', 99);
