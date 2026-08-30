import { FastifyInstance } from 'fastify';
import { getCurrentUserId, getCurrentRole, requireRole } from '../../shared/auth.js';
import { ROLES } from '../../shared/types.js';
import { inventoryService } from './service.js';

export async function inventoryRoutes(app: FastifyInstance) {
  app.get('/inventory', async (request, reply) => {
    requireRole(request, [ROLES.STOCKING_OWNER, ROLES.ADMIN]);
    const data = await inventoryService.list(request.query, {
      role: getCurrentRole(request),
      userId: getCurrentUserId(request),
    });
    return reply.send({ code: 'OK', message: 'success', data, requestId: request.id });
  });

  app.put('/inventory/:id/check', async (request, reply) => {
    requireRole(request, [ROLES.STOCKING_OWNER, ROLES.ADMIN]);
    const { id } = request.params as { id: string };
    const data = await inventoryService.check(id, request.body, {
      role: getCurrentRole(request),
      userId: getCurrentUserId(request),
    });
    return reply.send({ code: 'OK', message: '库存核对已完成', data, requestId: request.id });
  });
}
