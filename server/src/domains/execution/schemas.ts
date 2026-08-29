import { z } from 'zod';

// TSMP发货行
export const TsmpShipmentRowSchema = z.object({
  externalKey: z.string().optional(),
  applicationNo: z.string().optional(),
  sku: z.string().min(1, 'SKU不能为空'),
  bomCode: z.string().optional(),
  region: z.string().min(1, '区域不能为空'),
  office: z.string().min(1, '代表处不能为空'),
  country: z.string().optional(),
  shippedQty: z.number().int().min(1, '发货数量必须大于0'),
  shippedAt: z.string().datetime().optional(),
});

export type TsmpShipmentRowInput = z.infer<typeof TsmpShipmentRowSchema>;

// 导入请求
export const ImportRequestSchema = z.object({
  fileName: z.string().min(1, '文件名不能为空'),
  rows: z.array(TsmpShipmentRowSchema).default([]),
});

export type ImportRequestInput = z.infer<typeof ImportRequestSchema>;

// 执行查询参数
export const ExecutionQuerySchema = z.object({
  productId: z.string().optional().default('all'),
  regionId: z.string().optional().default(''),
  officeId: z.string().optional().default(''),
  country: z.string().optional().default(''),
  keyword: z.string().optional().default(''),
});

export type ExecutionQueryInput = z.infer<typeof ExecutionQuerySchema>;
