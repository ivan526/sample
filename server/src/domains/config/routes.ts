import { FastifyInstance } from 'fastify';
import bcrypt from 'bcryptjs';
import { configService } from './service.js';
import { requireRole, getCurrentUserId, getCurrentRole } from '../../shared/auth.js';
import { ROLES, ROLE_LABELS } from '../../shared/types.js';
import { UnauthorizedError } from '../../shared/errors.js';

export async function configRoutes(app: FastifyInstance) {
  // ========== 认证接口 ==========
  // 登录接口（白名单，无需认证）
  app.post('/auth/login', async (request, reply) => {
    const { employeeNo, password } = request.body as { employeeNo: string; password: string };
    if (!employeeNo?.trim() || !password?.trim()) {
      return reply.code(400).send({
        code: 'VALIDATION_ERROR',
        message: '工号和密码为必填项',
        requestId: request.id,
      });
    }

    // 查询用户
    const user = await configService.getUserByEmployeeNo(employeeNo.trim());
    if (!user || !user.enabled) {
      throw new UnauthorizedError('工号或密码错误');
    }

    // 验证密码
    const passwordValid = bcrypt.compareSync(password, user.passwordHash);
    if (!passwordValid) {
      throw new UnauthorizedError('工号或密码错误');
    }

    // 更新最后登录时间
    await configService.updateUserLoginTime(user.id);

    // 生成JWT Token
    const token = app.jwt.sign({
      userId: user.id,
      employeeNo: user.employeeNo,
      role: user.role,
      displayName: user.displayName,
    });

    return reply.send({
      code: 'OK',
      message: '登录成功',
      data: {
        token,
        user: {
          id: user.id,
          employeeNo: user.employeeNo,
          name: user.displayName,
          role: user.role,
          roleLabel: ROLE_LABELS[user.role as ROLES] || user.role,
          permissions: configService.getPermissionsByRole(user.role),
        },
      },
      requestId: request.id,
    });
  });

  // 修改密码接口（所有登录用户可访问）
  app.post('/auth/change-password', async (request, reply) => {
    const userId = getCurrentUserId(request);
    const { oldPassword, newPassword } = request.body as { oldPassword: string; newPassword: string };
    if (!oldPassword?.trim() || !newPassword?.trim() || newPassword.length < 6) {
      return reply.code(400).send({
        code: 'VALIDATION_ERROR',
        message: '旧密码必填，新密码长度不能少于6位',
        requestId: request.id,
      });
    }

    const user = await configService.getUserById(userId);
    if (!user) throw new UnauthorizedError('用户不存在');

    const oldValid = bcrypt.compareSync(oldPassword, user.passwordHash);
    if (!oldValid) throw new UnauthorizedError('原密码错误');

    const newHash = bcrypt.hashSync(newPassword, 10);
    await configService.updateUserPassword(userId, newHash);

    return reply.send({
      code: 'OK',
      message: '密码修改成功',
      requestId: request.id,
    });
  });

  // 获取全量catalog（按角色权限过滤）
  app.get('/config/catalog', async (request, reply) => {
    const role = getCurrentRole(request);
    const userId = getCurrentUserId(request);
    const catalog = await configService.getCatalog(role, userId);
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
    const role = getCurrentRole(request);
    const userId = getCurrentUserId(request);
    const product = await configService.createProduct(request.body, role, userId);
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
    const role = getCurrentRole(request);
    const userId = getCurrentUserId(request);
    const { productId } = request.params as { productId: string };
    const product = await configService.updateProduct(productId, request.body, role, userId);
    return reply.send({
      code: 'OK',
      message: '产品更新成功',
      data: product,
      requestId: request.id,
    });
  });

  // 创建领域
  app.post('/config/domains', async (request, reply) => {
    requireRole(request, [ROLES.ADMIN]);
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
    requireRole(request, [ROLES.ADMIN]);
    const { domainId } = request.params as { domainId: string };
    const domain = await configService.updateDomain(domainId, request.body);
    return reply.send({
      code: 'OK',
      message: '领域更新成功',
      data: domain,
      requestId: request.id,
    });
  });

  // 创建MSS业务领域（仅管理员）
  app.post('/config/mss-domains', async (request, reply) => {
    requireRole(request, [ROLES.ADMIN]);
    const mssDomain = await configService.createMssDomain(request.body);
    return reply.code(201).send({
      code: 'OK',
      message: 'MSS业务领域创建成功',
      data: mssDomain,
      requestId: request.id,
    });
  });

  // 更新MSS业务领域（仅管理员）
  app.put('/config/mss-domains/:mssDomainId', async (request, reply) => {
    requireRole(request, [ROLES.ADMIN]);
    const { mssDomainId } = request.params as { mssDomainId: string };
    const mssDomain = await configService.updateMssDomain(mssDomainId, request.body);
    return reply.send({
      code: 'OK',
      message: 'MSS业务领域更新成功',
      data: mssDomain,
      requestId: request.id,
    });
  });

  // 创建组织（区域）
  app.post('/config/organizations', async (request, reply) => {
    requireRole(request, [ROLES.ADMIN]);
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
    requireRole(request, [ROLES.ADMIN]);
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
    requireRole(request, [ROLES.ADMIN]);
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
    requireRole(request, [ROLES.ADMIN]);
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
    requireRole(request, [ROLES.ADMIN]);
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
    const { employeeNo, displayName, role, password, enabled, productDomainIds, mssDomainIds, organizationNodeIds } = request.body as {
      employeeNo: string;
      displayName: string;
      role: ROLES;
      password?: string;
      enabled?: boolean;
      productDomainIds?: string[];
      mssDomainIds?: string[];
      organizationNodeIds?: string[];
    };
    if (!employeeNo?.trim() || !displayName?.trim() || !role || !password?.trim()) {
      return reply.code(400).send({
        code: 'VALIDATION_ERROR',
        message: '工号、姓名、角色和初始密码为必填项',
        requestId: request.id,
      });
    }
    if (password.trim().length < 8) {
      return reply.code(400).send({ code: 'VALIDATION_ERROR', message: '初始密码至少8位', requestId: request.id });
    }
    if (!Object.values(ROLES).includes(role)) {
      return reply.code(400).send({
        code: 'VALIDATION_ERROR',
        message: '无效的角色类型',
        requestId: request.id,
      });
    }
    if ([ROLES.GTM, ROLES.STOCKING_OWNER].includes(role) && (!Array.isArray(productDomainIds) || productDomainIds.length === 0)) {
      return reply.code(400).send({ code: 'VALIDATION_ERROR', message: '请选择至少一个负责产品品类', requestId: request.id });
    }
    if ([ROLES.MSS_DOMAIN_OWNER, ROLES.REGIONAL_OWNER].includes(role) && (!Array.isArray(mssDomainIds) || mssDomainIds.length === 0)) {
      return reply.code(400).send({ code: 'VALIDATION_ERROR', message: '请选择至少一个MSS业务领域', requestId: request.id });
    }
    if (role === ROLES.REGIONAL_OWNER && (!Array.isArray(organizationNodeIds) || organizationNodeIds.length === 0)) {
      return reply.code(400).send({ code: 'VALIDATION_ERROR', message: '请选择至少一个负责区域或代表处', requestId: request.id });
    }
    const user = await configService.createUser({
      employeeNo: employeeNo.trim(),
      displayName: displayName.trim(),
      role,
      password: password.trim(),
      enabled: enabled !== false,
      productDomainIds,
      mssDomainIds,
      organizationNodeIds,
    });
    return reply.code(201).send({
      code: 'OK',
      message: '用户创建成功',
      data: user,
      requestId: request.id,
    });
  });

  // 更新用户
  app.put('/config/users/:userId', async (request, reply) => {
    requireRole(request, [ROLES.ADMIN]);
    const { userId } = request.params as { userId: string };
    const { displayName, role, enabled, password, productDomainIds, mssDomainIds, organizationNodeIds } = request.body as {
      displayName?: string;
      role?: ROLES;
      enabled?: boolean;
      password?: string;
      productDomainIds?: string[];
      mssDomainIds?: string[];
      organizationNodeIds?: string[];
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
      productDomainIds,
      mssDomainIds,
      organizationNodeIds,
    });
    return reply.send({
      code: 'OK',
      message: '用户更新成功',
      data: user,
      requestId: request.id,
    });
  });

  // 健康检查
  app.get('/healthz', async (request, reply) => {
    return reply.send({ status: 'ok', timestamp: new Date().toISOString() });
  });
}
