import { configRepository, Catalog, Product, Domain, MssDomain, Organization, DictionaryItem } from './repository.js';
import { ProductInputSchema, DomainInputSchema, MssDomainInputSchema, OrganizationInputSchema, DictionaryItemInputSchema } from './schemas.js';
import { ValidationError } from '../../shared/errors.js';
import { fromZodError } from 'zod-validation-error';
import { ROLES } from '../../shared/types.js';

export const configService = {
  async getCatalog(role: ROLES, userId: string): Promise<Catalog> {
    return configRepository.getCatalog(role, userId);
  },

  async createProduct(input: unknown, role: ROLES, userId: string): Promise<Product> {
    const parsed = ProductInputSchema.safeParse(input);
    if (!parsed.success) {
      throw new ValidationError(fromZodError(parsed.error).message);
    }
    // 确保产品名称和领域必填
    if (!parsed.data.name?.trim() || !parsed.data.domainId?.trim()) {
      throw new ValidationError('产品名称和所属领域为必填项');
    }
    return configRepository.createProduct(parsed.data, role, userId);
  },

  async updateProduct(productId: string, input: unknown, role: ROLES, userId: string): Promise<Product> {
    const parsed = ProductInputSchema.safeParse(input);
    if (!parsed.success) {
      throw new ValidationError(fromZodError(parsed.error).message);
    }
    if (!parsed.data.name?.trim() || !parsed.data.domainId?.trim()) {
      throw new ValidationError('产品名称和所属领域为必填项');
    }
    return configRepository.updateProduct(productId, parsed.data, role, userId);
  },

  async createDomain(input: unknown): Promise<Domain> {
    const parsed = DomainInputSchema.safeParse(input);
    if (!parsed.success) {
      throw new ValidationError(fromZodError(parsed.error).message);
    }
    return configRepository.createDomain(parsed.data);
  },

  async updateDomain(domainId: string, input: unknown): Promise<Domain> {
    const parsed = DomainInputSchema.safeParse(input);
    if (!parsed.success) {
      throw new ValidationError(fromZodError(parsed.error).message);
    }
    return configRepository.updateDomain(domainId, parsed.data);
  },

  async createMssDomain(input: unknown): Promise<MssDomain> {
    const parsed = MssDomainInputSchema.safeParse(input);
    if (!parsed.success) {
      throw new ValidationError(fromZodError(parsed.error).message);
    }
    if (!parsed.data.name?.trim() || !parsed.data.code?.trim() || !parsed.data.mssOwner?.trim()) {
      throw new ValidationError('领域名称、编码、接口人为必填项');
    }
    return configRepository.createMssDomain(parsed.data);
  },

  async updateMssDomain(mssDomainId: string, input: unknown): Promise<MssDomain> {
    const parsed = MssDomainInputSchema.safeParse(input);
    if (!parsed.success) {
      throw new ValidationError(fromZodError(parsed.error).message);
    }
    return configRepository.updateMssDomain(mssDomainId, parsed.data);
  },

  async createOrganization(input: unknown): Promise<Organization> {
    const parsed = OrganizationInputSchema.safeParse(input);
    if (!parsed.success) {
      throw new ValidationError(fromZodError(parsed.error).message);
    }
    return configRepository.createOrganization(parsed.data);
  },

  async updateOrganization(regionId: string, input: unknown): Promise<Organization> {
    const parsed = OrganizationInputSchema.safeParse(input);
    if (!parsed.success) {
      throw new ValidationError(fromZodError(parsed.error).message);
    }
    return configRepository.updateOrganization(regionId, parsed.data);
  },

  // 字典相关方法
  async createDictionaryItem(input: unknown): Promise<DictionaryItem> {
    const parsed = DictionaryItemInputSchema.safeParse(input);
    if (!parsed.success) {
      throw new ValidationError(fromZodError(parsed.error).message);
    }
    // 创建时必填字段校验
    if (!parsed.data.dictType?.trim() || !parsed.data.code?.trim() || !parsed.data.name?.trim()) {
      throw new ValidationError('字典类型、编码、名称为必填项');
    }
    return configRepository.createDictionaryItem(parsed.data);
  },

  async updateDictionaryItem(id: string, input: unknown): Promise<DictionaryItem> {
    const parsed = DictionaryItemInputSchema.safeParse(input);
    if (!parsed.success) {
      throw new ValidationError(fromZodError(parsed.error).message);
    }
    return configRepository.updateDictionaryItem(id, parsed.data);
  },

  async deleteDictionaryItem(id: string): Promise<void> {
    return configRepository.deleteDictionaryItem(id);
  },

  // 用户相关
  async getUserById(userId: string): Promise<any> {
    return configRepository.getUserById(userId);
  },

  async getUserByEmployeeNo(employeeNo: string): Promise<any> {
    return configRepository.getUserByEmployeeNo(employeeNo);
  },

  async updateUserLoginTime(userId: string): Promise<void> {
    return configRepository.updateUserLoginTime(userId);
  },

  async updateUserPassword(userId: string, passwordHash: string): Promise<void> {
    return configRepository.updateUserPassword(userId, passwordHash);
  },

  async getUserList(): Promise<any[]> {
    return configRepository.getAllUsers();
  },

  async createUser(input: { employeeNo: string; displayName: string; role: string; password: string; enabled?: boolean; productDomainIds?: string[]; mssDomainIds?: string[]; organizationNodeIds?: string[] }): Promise<any> {
    return configRepository.createUser(input);
  },

  async updateUser(userId: string, input: { displayName?: string; role?: string; enabled?: boolean; password?: string; productDomainIds?: string[]; mssDomainIds?: string[]; organizationNodeIds?: string[] }): Promise<any> {
    return configRepository.updateUser(userId, input);
  },

  // 根据角色返回权限列表
  getPermissionsByRole(role: string): string[] {
    const permissionMap: Record<string, string[]> = {
      ADMIN: [
        'config:read', 'config:write', 'user:manage',
        'plan:create', 'plan:release', 'plan:close', 'plan:export', 'plan:review', 'feedback:submit',
        'demand:save', 'demand:submit',
        'shipment:approve', 'shipment:import', 'inventory:manage',
        'overview:read', 'overview:write', 'execution:read', 'execution:write',
        'import:tsmp',
      ],
      GTM: [
        'config:read', 'config:write',
        'plan:create', 'plan:release', 'plan:close', 'plan:export',
        'overview:read', 'execution:read',
      ],
      MSS_DOMAIN_OWNER: [
        'config:read',
        'plan:review', 'feedback:submit', 'demand:save', 'demand:submit',
        'overview:read', 'execution:read',
      ],
      REGIONAL_OWNER: [
        'config:read',
        'demand:save', 'demand:submit',
        'overview:read', 'execution:read',
      ],
      STOCKING_OWNER: [
        'config:read',
        'shipment:approve', 'shipment:import', 'inventory:manage', 'import:tsmp',
        'overview:read', 'execution:read', 'execution:write',
      ],
    };
    return permissionMap[role] || [];
  },
};
