-- 样机阶段统一为V3/V4/VN1/VN2；MSS业务领域已由mss_domain主数据独立维护。
DELETE FROM data_dictionary WHERE dict_type IN ('SAMPLE_STAGE', 'MSS_DOMAIN');

INSERT INTO data_dictionary (dict_type, code, name, sort_order, description, enabled) VALUES
('SAMPLE_STAGE', 'V3', 'V3', 1, 'V3阶段样机', true),
('SAMPLE_STAGE', 'V4', 'V4', 2, 'V4阶段样机', true),
('SAMPLE_STAGE', 'VN1', 'VN1', 3, 'VN1阶段样机', true),
('SAMPLE_STAGE', 'VN2', 'VN2', 4, 'VN2阶段样机', true);

UPDATE collection_plan
SET sample_stage = CASE sample_stage
  WHEN '工程样机（EVT）' THEN 'V3'
  WHEN '测试样机（DVT）' THEN 'V4'
  WHEN '试生产样机（PVT）' THEN 'VN1'
  WHEN '验证样机（VN1）' THEN 'VN1'
  WHEN '测试样机（VN2）' THEN 'VN2'
  WHEN '量产样机（MP）' THEN 'VN2'
  ELSE sample_stage
END;
