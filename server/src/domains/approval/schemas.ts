import { z } from 'zod';

export const ShipmentApprovalCheckSchema = z.object({
  applicationNo: z.string().min(1, '申请单号不能为空'),
  applicant: z.string().min(1, '申请人不能为空'),
  sku: z.string().min(1, '产品型号/SKU不能为空'),
  region: z.string().min(1, '发货区域不能为空'),
  office: z.string().min(1, '代表处不能为空'),
  requestedQuantity: z.number().int().positive('申请数量必须大于0'),
});

export type ShipmentApprovalCheckInput = z.infer<typeof ShipmentApprovalCheckSchema>;
