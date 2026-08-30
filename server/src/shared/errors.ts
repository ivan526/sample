export class AppError extends Error {
  code: string;
  status: number;
  details?: string[];

  constructor(code: string, message: string, status: number = 400, details?: string[]) {
    super(message);
    this.code = code;
    this.status = status;
    this.details = details;
    Object.setPrototypeOf(this, AppError.prototype);
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: string[]) {
    super('VALIDATION_ERROR', message, 422, details);
    Object.setPrototypeOf(this, ValidationError.prototype);
  }
}

export class NotFoundError extends AppError {
  constructor(message: string = '资源不存在') {
    super('NOT_FOUND', message, 404);
    Object.setPrototypeOf(this, NotFoundError.prototype);
  }
}

export class ForbiddenError extends AppError {
  constructor(message: string = '无权限访问') {
    super('FORBIDDEN', message, 403);
    Object.setPrototypeOf(this, ForbiddenError.prototype);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message: string = '未登录或登录已过期') {
    super('UNAUTHORIZED', message, 401);
    Object.setPrototypeOf(this, UnauthorizedError.prototype);
  }
}

export class VersionConflictError extends AppError {
  constructor(message: string = '数据已被他人更新，请刷新后重试') {
    super('VERSION_CONFLICT', message, 409);
    Object.setPrototypeOf(this, VersionConflictError.prototype);
  }
}

export class PlanStateConflictError extends AppError {
  constructor(message: string) {
    super('PLAN_STATE_CONFLICT', message, 409);
    Object.setPrototypeOf(this, PlanStateConflictError.prototype);
  }
}
