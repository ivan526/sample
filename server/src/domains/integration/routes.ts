import type { FastifyInstance } from 'fastify';
import { requireRole, getCurrentRole, getCurrentUserId } from '../../shared/auth.js';
import { ValidationError } from '../../shared/errors.js';
import { ROLES } from '../../shared/types.js';
import { DemandQuerySchema, ShipmentIncrementSchema } from './schemas.js';
import { appendShipment, getStockingDemand } from './repository.js';
export async function integrationRoutes(app: FastifyInstance) {
  app.get('/integrations/stocking-demands', async (request, reply) => {
    requireRole(request, [ROLES.STOCKING_OWNER]);
    const parsed = DemandQuerySchema.safeParse(request.query);
    if (!parsed.success) throw new ValidationError('请检查查询参数：型号、BOM必填，组织维度可空', parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`));
    const data = await getStockingDemand(parsed.data, { role: getCurrentRole(request), userId: getCurrentUserId(request) });
    return reply.send({ code: 'OK', message: '查询成功', data, requestId: request.id });
  });
  app.post('/integrations/shipments', async (request, reply) => {
    requireRole(request, [ROLES.STOCKING_OWNER]);
    const parsed = ShipmentIncrementSchema.safeParse(request.body);
    if (!parsed.success) throw new ValidationError('请检查更新参数：六个维度必填，shippedQuantity为正整数，最大2147483647', parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`));
    const key = request.headers['idempotency-key'];
    if (typeof key !== 'string' || !key.trim() || key.trim().length > 128) throw new ValidationError('请提供不超过128字符的Idempotency-Key业务流水号');
    const data = await appendShipment(parsed.data, key.trim(), { role: getCurrentRole(request), userId: getCurrentUserId(request) }, request.id);
    return reply.send({ code: 'OK', message: data.replayed ? '重复请求，已返回原更新结果' : '更新成功', data, requestId: request.id });
  });
}
