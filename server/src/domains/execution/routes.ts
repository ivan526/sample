import { FastifyInstance } from 'fastify';
import { executionService } from './service.js';
import { requireRole, getCurrentUserId } from '../../shared/auth.js';
import { ROLES } from '../../shared/types.js';

export async function executionRoutes(app: FastifyInstance) {
  // 创建TSMP导入任务
  app.post('/execution/imports', async (request, reply) => {
    requireRole(request, [ROLES.STOCKING_OWNER, ROLES.GTM]);
    const userId = await getCurrentUserId(request);
    const job = await executionService.importTsmpData(request.body, userId);
    return reply.code(202).send({
      code: 'OK',
      message: '导入任务已提交',
      data: job,
      requestId: request.id,
    });
  });

  // 获取执行数据
  app.get('/execution', async (request, reply) => {
    const { productId, regionId, officeId, country, keyword } = request.query as {
      productId?: string;
      regionId?: string;
      officeId?: string;
      country?: string;
      keyword?: string;
    };
    const executionView = await executionService.getExecutionView({
      productId,
      regionId,
      officeId,
      country,
      keyword,
    });
    return reply.send({
      code: 'OK',
      message: 'success',
      data: executionView,
      requestId: request.id,
    });
  });

  // 获取最近导入任务
  app.get('/execution/imports', async (request, reply) => {
    const jobs = await executionService.getLatestImportJobs();
    return reply.send({
      code: 'OK',
      message: 'success',
      data: jobs,
      requestId: request.id,
    });
  });
}
