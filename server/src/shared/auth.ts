import { FastifyRequest } from 'fastify';
import { ROLES } from './types';
import { ForbiddenError } from './errors';

// 扩展FastifyRequest类型，添加user属性
declare module 'fastify' {
  interface FastifyRequest {
    user: {
      userId: string;
      employeeNo: string;
      role: ROLES;
      displayName: string;
    };
  }
}

/**
 * 获取当前登录用户ID（从JWT解析）
 */
export function getCurrentUserId(request: FastifyRequest): string {
  return request.user.userId;
}

/**
 * 获取当前登录用户角色（从JWT解析）
 */
export function getCurrentRole(request: FastifyRequest): ROLES {
  return request.user.role;
}

/**
 * 权限校验：当前用户角色必须在允许列表中，管理员自动放行
 */
export function requireRole(request: FastifyRequest, allowedRoles: ROLES[]) {
  const role = getCurrentRole(request);
  // 系统管理员拥有所有权限，直接放行
  if (role === ROLES.ADMIN) return;
  if (!allowedRoles.includes(role)) {
    throw new ForbiddenError('当前角色无权限执行此操作');
  }
}

/**
 * 获取当前登录用户完整信息
 */
export function getCurrentUser(request: FastifyRequest) {
  return request.user;
}