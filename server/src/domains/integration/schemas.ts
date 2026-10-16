import { z } from 'zod';
const required = z.string().trim().min(1).max(256);
const optional = z.preprocess((value) => typeof value === 'string' && !value.trim() ? undefined : value, required.optional());
export const DemandQuerySchema = z.object({
  productModel: required, bomCode: required,
  mssDomain: optional, region: optional, office: optional, country: optional, stage: optional,
}).strict();
export const ShipmentIncrementSchema = z.object({
  productModel: required, bomCode: required,
  mssDomain: required, region: required, office: required, country: required, stage: optional,
  applicationNo: optional, applicantName: optional, applicantEmployeeNo: optional, shipmentNo: optional,
  handlerName: optional, handlerEmployeeNo: optional, sourceSystem: optional, note: z.string().trim().max(2000).optional(),
  appliedAt: z.iso.datetime({ offset: true }).optional(), handledAt: z.iso.datetime({ offset: true }).optional(),
  shippedAt: z.iso.datetime({ offset: true }).optional(),
  shippedQuantity: z.number().int().min(1, '发货数量必须为正整数').max(2147483647),
}).strict();
export type DemandQuery = z.infer<typeof DemandQuerySchema>;
export type ShipmentIncrement = z.infer<typeof ShipmentIncrementSchema>;

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v => !Number.isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0,10) === v, '日期无效').optional();
export const ShipmentReadSchema = z.object({
  productId: optional, skuId: optional, handlerId: optional, mssDomainId: optional,
  regionId: optional, officeId: optional, countryId: optional, stage: optional,
  handler: z.string().trim().max(512).optional(), sourceSystem: optional, applicationNo: optional, keyword: z.string().trim().max(256).optional(),
  from: date, to: date, outcome: z.enum(['SUCCESS','REPLAY','FAILURE']).optional(),
  groupBy: z.enum(['region','office','country','sku','domain','stage','handler','product','application']).default('region'),
  groupValue: z.string().max(512).optional(),
  page: z.coerce.number().int().min(1).max(1000000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  tab: z.enum(['details','summary','logs']).default('details'),
}).strict().refine(v => !v.from || !v.to || v.from <= v.to, '开始日期不能晚于结束日期');
export type ShipmentRead = z.infer<typeof ShipmentReadSchema>;
