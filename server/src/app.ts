import Fastify from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import { randomUUID } from 'node:crypto';
import { AppError, ForbiddenError, UnauthorizedError } from './shared/errors.js';
import { configRoutes } from './domains/config/routes.js';
import { collectionRoutes } from './domains/collection/routes.js';
import { executionRoutes } from './domains/execution/routes.js';
import { overviewRoutes } from './domains/overview/routes.js';

export async function buildApp() {
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL || 'info',
      transport: {
        target: 'pino-pretty',
        options: {
          translateTime: 'HH:MM:ss Z',
          ignore: 'pid,hostname',
        },
      },
    },
    genReqId: (request) => request.headers['x-request-id'] as string || randomUUID(),
  });

  // 注册JWT插件
  await app.register(jwt, {
    secret: process.env.JWT_SECRET || 'mss-stocking-platform-prod-secret-2026',
    sign: {
      expiresIn: '2h', // Token2小时过期
    },
  });

  // 注册CORS
  await app.register(cors, {
    origin: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id', 'Idempotency-Key', 'If-Match'],
    credentials: true,
  });

  // 认证白名单：不需要登录就能访问的接口
  const AUTH_WHITELIST = [
    '/api/v1/auth/login',
    '/api/v1/healthz',
  ];

  // 全局认证钩子
  app.addHook('onRequest', async (request, reply) => {
    // 白名单接口直接放行
    if (AUTH_WHITELIST.some(path => request.url.startsWith(path))) {
      return;
    }
    try {
      // 验证JWT Token
      const payload = await request.jwtVerify<{
        userId: string;
        employeeNo: string;
        role: string;
        displayName: string;
      }>();
      // 将用户信息挂载到request上，后续接口直接使用
      request.user = payload;
    } catch (error) {
      return reply.code(401).send({
        code: 'UNAUTHORIZED',
        message: '登录已过期或未登录，请重新登录',
        requestId: request.id,
      });
    }
  });

  // 全局错误处理
  app.setErrorHandler((error, request, reply) => {
    request.log.error(error);

    if (error instanceof AppError) {
      return reply.code(error.status).send({
        code: error.code,
        message: error.message,
        details: error.details,
        requestId: request.id,
      });
    }

    // Zod验证错误
    if (error.validation) {
      return reply.code(422).send({
        code: 'VALIDATION_ERROR',
        message: '请求参数校验失败',
        details: error.validation.map((v: any) => v.message),
        requestId: request.id,
      });
    }

    return reply.code(500).send({
      code: 'INTERNAL_ERROR',
      message: '服务暂时不可用',
      requestId: request.id,
    });
  });

  // API v1 路由前缀
  app.register(async (apiRoutes) => {
    await apiRoutes.register(configRoutes);
    await apiRoutes.register(collectionRoutes);
    await apiRoutes.register(executionRoutes);
    await apiRoutes.register(overviewRoutes);
  }, { prefix: '/api/v1' });

  return app;
}
