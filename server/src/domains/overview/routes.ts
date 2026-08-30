import { FastifyInstance } from 'fastify';
import { overviewService } from './service.js';
import { getCurrentRole, getCurrentUserId } from '../../shared/auth.js';

export async function overviewRoutes(app: FastifyInstance) {
  app.get('/overview', async (request, reply) => {
    const { productId } = request.query as { productId?: string };
    const overview = await overviewService.getOverview(productId || 'all', { role: getCurrentRole(request), userId: getCurrentUserId(request) });
    return reply.send({
      code: 'OK',
      message: 'success',
      data: overview,
      requestId: request.id,
    });
  });
}
