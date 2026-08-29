import { FastifyRequest } from 'fastify';
import { ROLES } from './types';
import { ForbiddenError } from './errors';

export function getCurrentRole(request: FastifyRequest): ROLES {
  const role = request.headers['x-role'] as string;
  if (!role || !Object.values(ROLES).includes(role as ROLES)) {
    return ROLES.GTM; // 默认GTM，和现有原型一致
  }
  return role as ROLES;
}

export function getCurrentUserId(request: FastifyRequest): string {
  return (request.headers['x-user-id'] as string) || 'local-user';
}

export function requireRole(request: FastifyRequest, allowedRoles: ROLES[]) {
  const role = getCurrentRole(request);
  if (!allowedRoles.includes(role)) {
    throw new ForbiddenError('当前角色无权限执行此操作');
  }
}
