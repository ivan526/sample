import { FastifyInstance } from 'fastify';
import { configService } from './service';
import { requireRole, getCurrentUserId } from '../../shared/auth';
import { ROLES, ROLE_LABELS } from '../../shared/types';

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
    requireRole(request, [ROLES.GTM, ROLES.ADMIN]);
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
    requireRole(request, [ROLES.GTM, ROLES.ADMIN]);
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
    requireRole(request, [ROLES.GTM, ROLES.ADMIN]);
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
    requireRole(request, [ROLES.GTM, ROLES.ADMIN]);
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
    requireRole(request, [ROLES.GTM, ROLES.ADMIN]);
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
    requireRole(request, [ROLES.GTM, ROLES.ADMIN]);
    const { regionId } = request.params as { regionId: string };
    const organization = await configService.updateOrganization(regionId, request.body);
    return reply.send({
      code: 'OK',
      message: '组织更新成功',
      data: organization,
      requestId: request.id,
    });
  });

  // ========== 数据字典接口 ==========
  // 创建字典项
  app.post('/config/dictionaries', async (request, reply) => {
    requireRole(request, [ROLES.GTM, ROLES.ADMIN]);
    const item = await configService.createDictionaryItem(request.body);
    return reply.code(201).send({
      code: 'OK',
      message: '字典项创建成功',
      data: item,
      requestId: request.id,
    });
  });

  // 更新字典项
  app.put('/config/dictionaries/:itemId', async (request, reply) => {
    requireRole(request, [ROLES.GTM, ROLES.ADMIN]);
    const { itemId } = request.params as { itemId: string };
    const item = await configService.updateDictionaryItem(itemId, request.body);
    return reply.send({
      code: 'OK',
      message: '字典项更新成功',
      data: item,
      requestId: request.id,
    });
  });

  // 删除字典项
  app.delete('/config/dictionaries/:itemId', async (request, reply) => {
    requireRole(request, [ROLES.GTM, ROLES.ADMIN]);
    const { itemId } = request.params as { itemId: string };
    await configService.deleteDictionaryItem(itemId);
    return reply.send({
      code: 'OK',
      message: '字典项删除成功',
      requestId: request.id,
    });
  });

  // 元数据接口（角色、状态等）
  app.get('/config/meta', async (request, reply) => {
    return reply.send({
      code: 'OK',
      message: 'success',
      data: {
        roles: {
          ADMIN: '系统管理员',
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

  // ========== 用户/权限接口 ==========
  // 获取当前用户信息（所有角色可访问）
  app.get('/config/auth/me', async (request, reply) => {
    const userId = getCurrentUserId(request);
    const user = await configService.getUserById(userId);
    if (!user || !user.enabled) {
      return reply.code(401).send({
        code: 'UNAUTHORIZED',
        message: '账号已被禁用，请联系管理员',
        requestId: request.id,
      });
    }
    return reply.send({
      code: 'OK',
      message: 'success',
      data: {
        id: user.id,
        employeeNo: user.employeeNo,
        name: user.displayName,
        role: user.role,
        roleLabel: ROLE_LABELS[user.role as ROLES] || user.role,
        permissions: configService.getPermissionsByRole(user.role),
      },
      requestId: request.id,
    });
  });

  // 获取用户列表（管理员可见）
  app.get('/config/users', async (request, reply) => {
    requireRole(request, [ROLES.ADMIN]);
    const users = await configService.getUserList();
    return reply.send({
      code: 'OK',
      message: 'success',
      data: users,
      requestId: request.id,
    });
  });

  // 创建用户
  app.post('/config/users', async (request, reply) => {
    requireRole(request, [ROLES.ADMIN]);
    const { employeeNo, displayName, role, password, enabled } = request.body as {
      employeeNo: string;
      displayName: string;
      role: ROLES;
      password?: string;
      enabled?: boolean;
    };
    if (!employeeNo?.trim() || !displayName?.trim() || !role) {
      return reply.code(400).send({
        code: 'VALIDATION_ERROR',
        message: '工号、姓名、角色为必填项',
        requestId: request.id,
      });
    }
    if (!Object.values(ROLES).includes(role)) {
      return reply.code(400).send({
        code: 'VALIDATION_ERROR',
        message: '无效的角色类型',
        requestId: request.id,
      });
    }
    const user = await configService.createUser({
      employeeNo: employeeNo.trim(),
      displayName: displayName.trim(),
      role,
      password: password?.trim() || '123456', // 默认密码123456
      enabled: enabled !== false,
    });
    return reply.code(201).send({
      code: 'OK',
      message: '用户创建成功，初始密码：123456',
      data: user,
      requestId: request.id,
    });
  });

  // 更新用户
  app.put('/config/users/:userId', async (request, reply) => {
    requireRole(request, [ROLES.ADMIN]);
    const { userId } = request.params as { userId: string };
    const { displayName, role, enabled, password } = request.body as {
      displayName?: string;
      role?: ROLES;
      enabled?: boolean;
      password?: string;
    };
    if (role && !Object.values(ROLES).includes(role)) {
      return reply.code(400).send({
        code: 'VALIDATION_ERROR',
        message: '无效的角色类型',
        requestId: request.id,
      });
    }
    const user = await configService.updateUser(userId, {
      displayName: displayName?.trim(),
      role,
      enabled,
      password: password?.trim(),
    });
    return reply.send({
      code: 'OK',
      message: '用户更新成功',
      data: user,
      requestId: request.id,
    });
  });

}
