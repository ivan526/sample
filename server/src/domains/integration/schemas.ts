import { z } from 'zod';
const required = z.string().trim().min(1).max(256);
const optional = z.preprocess((value) => typeof value === 'string' && !value.trim() ? undefined : value, required.optional());
export const DemandQuerySchema = z.object({
  productModel: required, bomCode: required,
  mssDomain: optional, region: optional, office: optional, country: optional,
}).strict();
export const ShipmentIncrementSchema = z.object({
  productModel: required, bomCode: required,
  mssDomain: required, region: required, office: required, country: required,
  stockedQuantity: z.number().int().min(0).max(2147483647),
  shippedQuantity: z.number().int().min(0).max(2147483647),
}).strict().refine((value) => value.stockedQuantity + value.shippedQuantity > 0, '备货数量和发货数量不能同时为0');
export type DemandQuery = z.infer<typeof DemandQuerySchema>;
export type ShipmentIncrement = z.infer<typeof ShipmentIncrementSchema>;
