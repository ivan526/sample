import { FastifyInstance } from 'fastify';
import { collectionService } from './service.js';
import { requireRole, getCurrentUserId, getCurrentRole } from '../../shared/auth.js';
import { ROLES } from '../../shared/types.js';

export async function collectionRoutes(app: FastifyInstance) {
  // 获取计划列表
  app.get('/collection/plans', async (request, reply) => {
    const role = getCurrentRole(request);
    const userId = getCurrentUserId(request);
    const { keyword, status, productId, regionId } = request.query as {
      keyword?: string;
      status?: string;
      productId?: string;
      regionId?: string;
    };
    const plans = await collectionService.listPlans(role, userId, keyword, status, productId, regionId);
    return reply.send({
      code: 'OK',
      message: 'success',
      data: plans,
      requestId: request.id,
    });
  });

  // 创建计划
  app.post('/collection/plans', async (request, reply) => {
    requireRole(request, [ROLES.GTM, ROLES.ADMIN]);
    const userId = getCurrentUserId(request);
    const plan = await collectionService.createPlan(request.body, userId);
    return reply.code(201).send({
      code: 'OK',
      message: '计划创建成功',
      data: plan,
      requestId: request.id,
    });
  });

  // 获取计划详情
  app.get('/collection/plans/:planId', async (request, reply) => {
    const { planId } = request.params as { planId: string };
    const plan = await collectionService.getPlan(planId);
    if (!plan) {
      return reply.code(404).send({
        code: 'NOT_FOUND',
        message: '收集计划不存在',
        requestId: request.id,
      });
    }
    return reply.send({
      code: 'OK',
      message: 'success',
      data: plan,
      requestId: request.id,
    });
  });

  // 下发计划
  app.post('/collection/plans/:planId/release', async (request, reply) => {
    requireRole(request, [ROLES.GTM, ROLES.ADMIN]);
    const userId = getCurrentUserId(request);
    const { planId } = request.params as { planId: string };
    const { version } = request.body as { version?: number };
    const plan = await collectionService.releasePlan(planId, userId, version);
    return reply.send({
      code: 'OK',
      message: '计划下发成功',
      data: plan,
      requestId: request.id,
    });
  });

  // 保存区域草稿
  app.put('/collection/plans/:planId/regions/:regionId/draft', async (request, reply) => {
    requireRole(request, [ROLES.MSS_DOMAIN_OWNER, ROLES.REGIONAL_OWNER]);
    const userId = getCurrentUserId(request);
    const { planId, regionId } = request.params as { planId: string; regionId: string };
    const draft = await collectionService.saveDraft(planId, regionId, request.body, userId);
    return reply.send({
      code: 'OK',
      message: '草稿保存成功',
      data: draft,
      requestId: request.id,
    });
  });

  // 获取区域草稿
  app.get('/collection/plans/:planId/regions/:regionId/draft', async (request, reply) => {
    requireRole(request, [ROLES.MSS_DOMAIN_OWNER, ROLES.REGIONAL_OWNER, ROLES.GTM]);
    const { planId, regionId } = request.params as { planId: string; regionId: string };
    const draft = await collectionService.getDraft(planId, regionId);
    return reply.send({
      code: 'OK',
      message: 'success',
      data: draft,
      requestId: request.id,
    });
  });

  // 提交区域需求
  app.post('/collection/plans/:planId/regions/:regionId/submit', async (request, reply) => {
    requireRole(request, [ROLES.MSS_DOMAIN_OWNER, ROLES.REGIONAL_OWNER, ROLES.ADMIN]);
    const userId = getCurrentUserId(request);
    const { planId, regionId } = request.params as { planId: string; regionId: string };
    const { version } = request.body as { version?: number };
    const plan = await collectionService.submitRegion(planId, regionId, userId, version);
    return reply.send({
      code: 'OK',
      message: '需求提交成功',
      data: plan,
      requestId: request.id,
    });
  });

  // 提交领域反馈
  app.post('/collection/plans/:planId/domain-feedback', async (request, reply) => {
    requireRole(request, [ROLES.MSS_DOMAIN_OWNER, ROLES.ADMIN]);
    const userId = getCurrentUserId(request);
    const { planId } = request.params as { planId: string };
    const plan = await collectionService.submitDomainFeedback(planId, request.body, userId);
    return reply.send({
      code: 'OK',
      message: '领域反馈提交成功',
      data: plan,
      requestId: request.id,
    });
  });

  // 导出排产
  app.post('/collection/plans/:planId/export', async (request, reply) => {
    requireRole(request, [ROLES.GTM, ROLES.ADMIN]);
    const userId = getCurrentUserId(request);
    const { planId } = request.params as { planId: string };
    const exportResult = await collectionService.createExport(planId, userId);
    return reply.send({
      code: 'OK',
      message: '导出成功',
      data: exportResult,
      requestId: request.id,
    });
  });
}
