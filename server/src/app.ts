import Fastify from 'fastify';
import cors from '@fastify/cors';
import { randomUUID } from 'node:crypto';
import { AppError } from './shared/errors.js';
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

  // 注册CORS
  await app.register(cors, {
    origin: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'X-Role', 'X-User-Id', 'X-Region-Id', 'X-Request-Id', 'Idempotency-Key', 'If-Match'],
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
