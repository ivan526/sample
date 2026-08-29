import { FastifyInstance } from 'fastify';
import { configService } from './service';
import { requireRole, getCurrentRole } from '../../shared/auth';
import { ROLES } from '../../shared/types';

export async function configRoutes(app: FastifyInstance) {
  // 获取全量catalog
  app.get('/config/catalog', async (request, reply) => {
    const catalog = await configService.getCatalog();
    return reply.send({
      code: 'OK',
      message: 'success',
      data: catalog,
      requestId: request.id,
    });
  });

  // 创建产品
  app.post('/config/products', async (request, reply) => {
    requireRole(request, [ROLES.GTM]);
    const product = await configService.createProduct(request.body);
    return reply.code(201).send({
      code: 'OK',
      message: '产品创建成功',
      data: product,
      requestId: request.id,
    });
  });

  // 更新产品
  app.put('/config/products/:productId', async (request, reply) => {
    requireRole(request, [ROLES.GTM]);
    const { productId } = request.params as { productId: string };
    const product = await configService.updateProduct(productId, request.body);
    return reply.send({
      code: 'OK',
      message: '产品更新成功',
      data: product,
      requestId: request.id,
    });
  });

  // 创建领域
  app.post('/config/domains', async (request, reply) => {
    requireRole(request, [ROLES.GTM]);
    const domain = await configService.createDomain(request.body);
    return reply.code(201).send({
      code: 'OK',
      message: '领域创建成功',
      data: domain,
      requestId: request.id,
    });
  });

  // 更新领域
  app.put('/config/domains/:domainId', async (request, reply) => {
    requireRole(request, [ROLES.GTM]);
    const { domainId } = request.params as { domainId: string };
    const domain = await configService.updateDomain(domainId, request.body);
    return reply.send({
      code: 'OK',
      message: '领域更新成功',
      data: domain,
      requestId: request.id,
    });
  });

  // 创建组织（区域）
  app.post('/config/organizations', async (request, reply) => {
    requireRole(request, [ROLES.GTM]);
    const organization = await configService.createOrganization(request.body);
    return reply.code(201).send({
      code: 'OK',
      message: '组织创建成功',
      data: organization,
      requestId: request.id,
    });
  });

  // 更新组织（区域）
  app.put('/config/organizations/:regionId', async (request, reply) => {
    requireRole(request, [ROLES.GTM]);
    const { regionId } = request.params as { regionId: string };
    const organization = await configService.updateOrganization(regionId, request.body);
    return reply.send({
      code: 'OK',
      message: '组织更新成功',
      data: organization,
      requestId: request.id,
    });
  });

  // 元数据接口（角色、状态等）
  app.get('/meta', async (request, reply) => {
    return reply.send({
      code: 'OK',
      message: 'success',
      data: {
        roles: {
          GTM: 'GTM',
          MSS_DOMAIN_OWNER: 'MSS领域接口人',
          REGIONAL_OWNER: '区域/代表处接口人',
          STOCKING_OWNER: '备货接口人',
        },
        planStatuses: {
          PRODUCT_DRAFT: '产品建档',
          READY_TO_RELEASE: '待下发',
          COLLECTING: '收集中',
          DOMAIN_REVIEW: '待领域反馈',
          GTM_CLOSURE: '待GTM收口',
          EXPORTED: '已导出',
        },
      },
      requestId: request.id,
    });
  });

  // 健康检查
  app.get('/healthz', async (request, reply) => {
    return reply.send({ status: 'ok', timestamp: new Date().toISOString() });
  });
}
