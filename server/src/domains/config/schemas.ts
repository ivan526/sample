import { z } from 'zod';

export const SkuInputSchema = z.object({
  id: z.string().optional(),
  model: z.string().min(1, 'SKU型号不能为空'),
  bomCode: z.string().optional().default(''),
});

export const ProductInputSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1, '产品名称不能为空'),
  domainId: z.string().min(1, '所属领域不能为空'),
  stage: z.string().optional(),
  supplyTimeText: z.string().optional(),
  defaultDeadline: z.string().nullable().optional(),
  enabled: z.boolean().optional().default(true),
  skus: z.array(SkuInputSchema).optional().default([]),
  version: z.number().int().optional(),
});

export type ProductInput = z.infer<typeof ProductInputSchema>;

export const DomainInputSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1, '领域名称不能为空'),
  description: z.string().optional().default(''),
  gtmOwner: z.string().min(1, 'GTM接口人不能为空'),
  domainOwner: z.string().min(1, 'MSS领域接口人不能为空'),
  stockingOwner: z.string().min(1, '领域备货接口人不能为空'),
  enabled: z.boolean().optional().default(true),
  version: z.number().int().optional(),
});

export type DomainInput = z.infer<typeof DomainInputSchema>;

export const OfficeInputSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1, '代表处名称不能为空'),
  owner: z.string().min(1, '代表处接口人不能为空'),
  enabled: z.boolean().optional().default(true),
  countries: z.array(z.string()).optional().default([]),
});

export const OrganizationInputSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1, '区域名称不能为空'),
  owner: z.string().min(1, '区域接口人不能为空'),
  enabled: z.boolean().optional().default(true),
  offices: z.array(OfficeInputSchema).optional().default([]),
  version: z.number().int().optional(),
});

export type OrganizationInput = z.infer<typeof OrganizationInputSchema>;

// 字典项输入（创建和更新共用，更新时仅传需要修改的字段）
export const DictionaryItemInputSchema = z.object({
  id: z.string().optional(),
  dictType: z.string().min(1, '字典类型不能为空').optional(),
  code: z.string().min(1, '字典编码不能为空').optional(),
  name: z.string().min(1, '字典名称不能为空').optional(),
  sortOrder: z.number().int().optional(),
  description: z.string().nullable().optional().transform(v => v || ''),
  enabled: z.union([z.boolean(), z.number()]).transform(v => typeof v === 'number' ? Boolean(v) : v).optional(),
  version: z.number().int().optional(),
});

export type DictionaryItemInput = z.infer<typeof DictionaryItemInputSchema>;

// 国家节点输入
export const CountryInputSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1, '国家名称不能为空'),
  enabled: z.boolean().optional().default(true),
});
