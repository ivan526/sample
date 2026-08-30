import { z } from 'zod';

export const InventoryQuerySchema = z.object({
  productId: z.string().optional().default('all'),
  keyword: z.string().optional().default(''),
  onlyDiff: z.union([z.boolean(), z.string()]).optional().transform((value) => value === true || value === 'true'),
});

export const InventoryCheckSchema = z.object({
  actualQuantity: z.number().int().min(0),
  reason: z.string().trim().min(1, '请填写核对说明').max(512),
  version: z.number().int().positive(),
});
