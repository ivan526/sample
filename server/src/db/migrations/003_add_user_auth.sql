-- 用户认证相关字段迁移
-- 用户角色字段，关联ROLES枚举
ALTER TABLE app_user ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'REGIONAL_OWNER';
-- 密码哈希字段
ALTER TABLE app_user ADD COLUMN IF NOT EXISTS password_hash TEXT NOT NULL DEFAULT '';
-- 最后登录时间
ALTER TABLE app_user ADD COLUMN IF NOT EXISTS last_login_at TEXT;
-- 工号唯一索引，防止重复创建
CREATE UNIQUE INDEX IF NOT EXISTS idx_app_user_employee_no ON app_user(employee_no);
