import type { FastifyInstance } from 'fastify';
import { getCurrentRole, getCurrentUserId, requireRole } from '../../shared/auth.js';
import { ROLES } from '../../shared/types.js';
import { approvalService } from './service.js';

export async function approvalRoutes(app: FastifyInstance) {
  app.post('/shipment-approval/check', async (request, reply) => {
    requireRole(request, [ROLES.STOCKING_OWNER, ROLES.ADMIN]);
    const data = await approvalService.check(request.body, {
      role: getCurrentRole(request),
      userId: getCurrentUserId(request),
    });
    return reply.send({ code: 'OK', message: '核对完成', data, requestId: request.id });
  });
}
