import { FastifyRequest } from 'fastify';
import { ROLES } from './types';
import { ForbiddenError } from './errors';
import { query } from '../config/db.js';

// 角色对应的默认用户ID（开发演示用，生产环境从token中解析）
const ROLE_DEFAULT_USER: Record<ROLES, string> = {
  [ROLES.GTM]: 'wanglu', // 王璐
  [ROLES.MSS_DOMAIN_OWNER]: 'zhaomin', // 赵敏（穿戴领域备货接口人/领域接口人）
  [ROLES.REGIONAL_OWNER]: 'aaa', // 欧洲MKT接口人
  [ROLES.STOCKING_OWNER]: 'chentao', // 陈涛
};

export async function getCurrentUserId(request: FastifyRequest): Promise<string> {
  const headerUserId = (request.headers['x-user-id'] as string) || 'local-user';
  // 开发模式：如果是默认local-user，按角色返回对应默认用户
  if (headerUserId === 'local-user') {
    const role = getCurrentRole(request);
    const employeeNo = ROLE_DEFAULT_USER[role] || 'wanglu';
    const { rows } = await query('SELECT id FROM app_user WHERE employee_no = $1', [employeeNo]);
    return rows[0]?.id || headerUserId;
  }
  return headerUserId;
}

export function getCurrentRole(request: FastifyRequest): ROLES {
  const role = request.headers['x-role'] as string;
  // 兼容前端中文名传参
  const roleMap: Record<string, ROLES> = {
    'GTM': ROLES.GTM,
    'MSS领域接口人': ROLES.MSS_DOMAIN_OWNER,
    '区域/代表处接口人': ROLES.REGIONAL_OWNER,
    '备货接口人': ROLES.STOCKING_OWNER,
  };
  if (roleMap[role]) return roleMap[role];
  if (!role || !Object.values(ROLES).includes(role as ROLES)) {
    return ROLES.GTM; // 默认GTM，和现有原型一致
  }
  return role as ROLES;
}

export function requireRole(request: FastifyRequest, allowedRoles: ROLES[]) {
  const role = getCurrentRole(request);
  if (!allowedRoles.includes(role)) {
    throw new ForbiddenError('当前角色无权限执行此操作');
  }
}
