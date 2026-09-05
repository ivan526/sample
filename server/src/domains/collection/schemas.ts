import { z } from 'zod';

// 需求项校验
export const DemandItemSchema = z.object({
  productItemKey: z.string().min(1, '产品项ID不能为空'),
  quantity: z.number().int().min(0, '数量不能为负数'),
  basis: z.string().optional().nullable(),
  plannedUseDate: z.string().optional().nullable(),
  note: z.string().max(500, '备注最多500字').optional().nullable(),
  officeId: z.string().optional().nullable(),
});

export type DemandItemInput = z.infer<typeof DemandItemSchema>;

// 区域草稿保存
export const DraftSaveSchema = z.object({
  version: z.number().int().optional(),
  items: z.array(DemandItemSchema).min(1, '至少需要一个需求项'),
});

export type DraftSaveInput = z.infer<typeof DraftSaveSchema>;

// 区域提交
export const RegionSubmitSchema = z.object({
  version: z.number().int().optional(),
});

export type RegionSubmitInput = z.infer<typeof RegionSubmitSchema>;

// 区域提交后的撤回/变更申请。是否需要领域审批由计划所处阶段决定。
export const RegionChangeRequestSchema = z.object({
  reason: z.string().trim().min(1, '修改原因不能为空').max(500, '修改原因最多500字'),
  version: z.number().int().optional(),
});

export type RegionChangeRequestInput = z.infer<typeof RegionChangeRequestSchema>;

// MSS领域接口人审批截止后、领域反馈后或导出后的变更申请。
export const RegionChangeDecisionSchema = z.object({
  approved: z.boolean(),
  note: z.string().trim().min(1, '审批意见不能为空').max(500, '审批意见最多500字'),
  version: z.number().int().optional(),
});

export type RegionChangeDecisionInput = z.infer<typeof RegionChangeDecisionSchema>;

// 新建收集计划
export const CreatePlanSchema = z.object({
  productId: z.string().min(1, '产品ID不能为空'),
  stage: z.string().trim().min(1, '样机阶段不能为空'),
  deadline: z.string().datetime('截止时间格式不正确'),
  note: z.string().max(500, '说明最多500字').optional(),
});

export type CreatePlanInput = z.infer<typeof CreatePlanSchema>;

// MSS领域接口人二次下发：选择本领域需要收集的型号和区域。
export const DomainDispatchSchema = z.object({
  productSkuIds: z.array(z.string().min(1)),
  regionIds: z.array(z.string().min(1)).min(1, '至少选择一个区域'),
  version: z.number().int().optional(),
});

export type DomainDispatchInput = z.infer<typeof DomainDispatchSchema>;

// 领域反馈
export const DomainFeedbackSchema = z.object({
  confirmed: z.literal(true, { message: '请确认检查清单' }),
  note: z.string().min(1, '反馈说明不能为空').max(1000, '反馈说明最多1000字'),
  version: z.number().int().optional(),
});

export type DomainFeedbackInput = z.infer<typeof DomainFeedbackSchema>;
