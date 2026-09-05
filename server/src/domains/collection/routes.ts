import { FastifyInstance } from 'fastify';
import { collectionService } from './service.js';
import { requireRole, getCurrentUserId, getCurrentRole } from '../../shared/auth.js';
import { ROLES } from '../../shared/types.js';

export async function collectionRoutes(app: FastifyInstance) {
  // 获取计划列表
  app.get('/collection/plans', async (request, reply) => {
    const role = getCurrentRole(request);
    const userId = getCurrentUserId(request);
    const { keyword, status, productId, regionId, page, pageSize, sortBy, sortOrder, includeArchived } = request.query as {
      keyword?: string;
      status?: string;
      productId?: string;
      regionId?: string;
      page?: string;
      pageSize?: string;
      sortBy?: 'createdAt' | 'deadline' | 'updatedAt' | 'demand' | 'progress';
      sortOrder?: 'asc' | 'desc';
      includeArchived?: string;
    };
    const usePagination = Boolean(page);
    const plans = await collectionService.listPlans(role, userId, keyword, status, productId, regionId, usePagination ? {
      page: Math.max(1, Number(page) || 1), pageSize: Math.min(100, Math.max(1, Number(pageSize) || 20)),
      sortBy, sortOrder, includeArchived: includeArchived === 'true',
    } : undefined);
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
    const plan = await collectionService.createPlan(request.body, userId, getCurrentRole(request));
    return reply.code(201).send({
      code: 'OK',
      message: '计划创建成功',
      data: plan,
      requestId: request.id,
    });
  });

  // 获取计划详情
  app.get('/collection/plans/:planId', async (request, reply) => {
    const role = getCurrentRole(request);
    const userId = getCurrentUserId(request);
    const { planId } = request.params as { planId: string };
    const { domainTaskId } = request.query as { domainTaskId?: string };
    const plan = await collectionService.getPlan(planId, role, userId, domainTaskId);
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

  // MSS领域接口人选择型号和区域，将领域任务下发给区域接口人。
  app.post('/collection/domain-tasks/:taskId/dispatch', async (request, reply) => {
    requireRole(request, [ROLES.MSS_DOMAIN_OWNER, ROLES.ADMIN]);
    const { taskId } = request.params as { taskId: string };
    const plan = await collectionService.dispatchDomainTask(taskId, request.body, getCurrentUserId(request), getCurrentRole(request));
    return reply.send({ code: 'OK', message: '领域任务下发成功', data: plan, requestId: request.id });
  });

  // 下发计划
  app.post('/collection/plans/:planId/release', async (request, reply) => {
    requireRole(request, [ROLES.GTM, ROLES.ADMIN]);
    const userId = getCurrentUserId(request);
    const { planId } = request.params as { planId: string };
    const { version } = request.body as { version?: number };
    const plan = await collectionService.releasePlan(planId, userId, getCurrentRole(request), version);
    return reply.send({
      code: 'OK',
      message: '计划下发成功',
      data: plan,
      requestId: request.id,
    });
  });

  app.delete('/collection/plans/:planId', async (request, reply) => {
    requireRole(request, [ROLES.GTM, ROLES.ADMIN]);
    const { planId } = request.params as { planId: string };
    await collectionService.deletePlan(planId, getCurrentUserId(request), getCurrentRole(request));
    return reply.send({ code: 'OK', message: '计划已删除', data: { id: planId }, requestId: request.id });
  });

  app.post('/collection/plans/:planId/cancel', async (request, reply) => {
    requireRole(request, [ROLES.GTM, ROLES.ADMIN]);
    const { planId } = request.params as { planId: string };
    const plan = await collectionService.cancelPlan(planId, getCurrentUserId(request), getCurrentRole(request));
    return reply.send({ code: 'OK', message: '计划已取消', data: plan, requestId: request.id });
  });

  app.post('/collection/plans/:planId/archive', async (request, reply) => {
    requireRole(request, [ROLES.GTM, ROLES.ADMIN]);
    const { planId } = request.params as { planId: string };
    const result = await collectionService.archivePlan(planId, getCurrentUserId(request), getCurrentRole(request));
    return reply.send({ code: 'OK', message: '计划已归档', data: result, requestId: request.id });
  });

  // 保存区域草稿
  app.put('/collection/plans/:planId/regions/:regionId/draft', async (request, reply) => {
    requireRole(request, [ROLES.MSS_DOMAIN_OWNER, ROLES.REGIONAL_OWNER]);
    const userId = getCurrentUserId(request);
    const role = getCurrentRole(request);
    const { planId, regionId } = request.params as { planId: string; regionId: string };
    const { domainTaskId } = request.query as { domainTaskId?: string };
    const draft = await collectionService.saveDraft(planId, regionId, domainTaskId, request.body, userId, role);
    return reply.send({
      code: 'OK',
      message: '草稿保存成功',
      data: draft,
      requestId: request.id,
    });
  });

  // 获取区域草稿
  app.get('/collection/plans/:planId/regions/:regionId/draft', async (request, reply) => {
    requireRole(request, [ROLES.MSS_DOMAIN_OWNER, ROLES.REGIONAL_OWNER, ROLES.GTM, ROLES.ADMIN]);
    const role = getCurrentRole(request);
    const userId = getCurrentUserId(request);
    const { planId, regionId } = request.params as { planId: string; regionId: string };
    const { domainTaskId } = request.query as { domainTaskId?: string };
    const draft = await collectionService.getDraft(planId, regionId, userId, role, domainTaskId);
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
    const role = getCurrentRole(request);
    const { planId, regionId } = request.params as { planId: string; regionId: string };
    const { version } = request.body as { version?: number };
    const { domainTaskId } = request.query as { domainTaskId?: string };
    const plan = await collectionService.submitRegion(planId, regionId, domainTaskId, userId, role, version);
    return reply.send({
      code: 'OK',
      message: '需求提交成功',
      data: plan,
      requestId: request.id,
    });
  });

  // 区域提交后发起撤回/变更。截止前且领域未反馈时立即重新开放，其余阶段进入MSS审批。
  app.post('/collection/plans/:planId/regions/:regionId/change-request', async (request, reply) => {
    requireRole(request, [ROLES.REGIONAL_OWNER]);
    const { planId, regionId } = request.params as { planId: string; regionId: string };
    const { domainTaskId } = request.query as { domainTaskId?: string };
    const result = await collectionService.requestRegionChange(planId, regionId, domainTaskId, request.body, getCurrentUserId(request), getCurrentRole(request));
    return reply.send({
      code: 'OK',
      message: result.mode === 'REOPENED' ? '区域需求已撤回，可继续修改' : '变更申请已提交，等待领域接口人审批',
      data: result,
      requestId: request.id,
    });
  });

  // MSS领域接口人审批截止后、领域反馈后或导出后的区域变更申请。
  app.post('/collection/change-requests/:requestId/decision', async (request, reply) => {
    requireRole(request, [ROLES.MSS_DOMAIN_OWNER, ROLES.ADMIN]);
    const { requestId } = request.params as { requestId: string };
    const plan = await collectionService.decideRegionChange(requestId, request.body, getCurrentUserId(request), getCurrentRole(request));
    return reply.send({ code: 'OK', message: '变更申请已处理', data: plan, requestId: request.id });
  });

  app.post('/collection/plans/:planId/regions/:regionId/return', async (request, reply) => {
    requireRole(request, [ROLES.MSS_DOMAIN_OWNER, ROLES.ADMIN]);
    const { planId, regionId } = request.params as { planId: string; regionId: string };
    const { domainTaskId } = request.query as { domainTaskId?: string };
    const plan = await collectionService.returnRegion(planId, regionId, domainTaskId, request.body, getCurrentUserId(request), getCurrentRole(request));
    return reply.send({ code: 'OK', message: '区域需求已退回修改', data: plan, requestId: request.id });
  });

  app.post('/collection/domain-tasks/:taskId/feedback', async (request, reply) => {
    requireRole(request, [ROLES.MSS_DOMAIN_OWNER, ROLES.ADMIN]);
    const { taskId } = request.params as { taskId: string };
    const plan = await collectionService.submitDomainFeedback(taskId, request.body, getCurrentUserId(request), getCurrentRole(request));
    return reply.send({ code: 'OK', message: '领域反馈提交成功', data: plan, requestId: request.id });
  });

  // 提交领域反馈
  app.post('/collection/plans/:planId/domain-feedback', async (request, reply) => {
    requireRole(request, [ROLES.MSS_DOMAIN_OWNER, ROLES.ADMIN]);
    const userId = getCurrentUserId(request);
    const role = getCurrentRole(request);
    const { domainTaskId } = request.body as { domainTaskId?: string };
    if (!domainTaskId) return reply.code(400).send({ code: 'VALIDATION_ERROR', message: '领域任务ID不能为空', requestId: request.id });
    const plan = await collectionService.submitDomainFeedback(domainTaskId, request.body, userId, role);
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
    const role = getCurrentRole(request);
    const { planId } = request.params as { planId: string };
    const exportResult = await collectionService.createExport(planId, userId, role);
    return reply.send({
      code: 'OK',
      message: '导出成功',
      data: exportResult,
      requestId: request.id,
    });
  });
}
