import { configRepository, Catalog, Product, Domain, Organization, DictionaryItem } from './repository';
import { ProductInputSchema, DomainInputSchema, OrganizationInputSchema, DictionaryItemInputSchema } from './schemas';
import { ValidationError } from '../../shared/errors';
import { fromZodError } from 'zod-validation-error';

export const configService = {
  async getCatalog(): Promise<Catalog> {
    return configRepository.getCatalog();
  },

  async createProduct(input: unknown): Promise<Product> {
    const parsed = ProductInputSchema.safeParse(input);
    if (!parsed.success) {
      throw new ValidationError(fromZodError(parsed.error).message);
    }
    // 确保产品名称和领域必填
    if (!parsed.data.name?.trim() || !parsed.data.domainId?.trim()) {
      throw new ValidationError('产品名称和所属领域为必填项');
    }
    return configRepository.createProduct(parsed.data);
  },

  async updateProduct(productId: string, input: unknown): Promise<Product> {
    const parsed = ProductInputSchema.safeParse(input);
    if (!parsed.success) {
      throw new ValidationError(fromZodError(parsed.error).message);
    }
    if (!parsed.data.name?.trim() || !parsed.data.domainId?.trim()) {
      throw new ValidationError('产品名称和所属领域为必填项');
    }
    return configRepository.updateProduct(productId, parsed.data);
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
  async getCurrentUser(userId: string, role: string): Promise<any> {
    const user = await configRepository.getUserById(userId);
    const roleLabelMap: Record<string, string> = {
      GTM: 'GTM',
      MSS_DOMAIN_OWNER: 'MSS领域接口人',
      REGIONAL_OWNER: '区域/代表处接口人',
      STOCKING_OWNER: '备货接口人',
    };
    return {
      id: userId,
      employeeNo: user?.employeeNo,
      name: user?.displayName || (role === 'GTM' ? '王璐' : role === 'MSS_DOMAIN_OWNER' ? '赵敏' : role === 'STOCKING_OWNER' ? '陈涛' : '接口人'),
      role,
      roleLabel: roleLabelMap[role] || role,
      permissions: this.getPermissionsByRole(role),
    };
  },

  async getUserList(): Promise<any[]> {
    return configRepository.getAllUsers();
  },

  async createUser(input: { employeeNo: string; displayName: string; enabled?: boolean }): Promise<any> {
    return configRepository.createUser(input);
  },

  async updateUser(userId: string, input: { displayName?: string; enabled?: boolean }): Promise<any> {
    return configRepository.updateUser(userId, input);
  },

  // 根据角色返回权限列表
  getPermissionsByRole(role: string): string[] {
    const permissionMap: Record<string, string[]> = {
      GTM: [
        'config:read', 'config:write',
        'plan:create', 'plan:release', 'plan:close', 'plan:export',
        'overview:read', 'execution:read', 'import:tsmp',
      ],
      MSS_DOMAIN_OWNER: [
        'config:read',
        'plan:review', 'feedback:submit',
        'overview:read', 'execution:read',
      ],
      REGIONAL_OWNER: [
        'config:read',
        'demand:save', 'demand:submit',
        'overview:read', 'execution:read',
      ],
      STOCKING_OWNER: [
        'config:read',
        'shipment:approve', 'shipment:import', 'inventory:manage',
        'overview:read', 'execution:write',
      ],
    };
    return permissionMap[role] || [];
  },
};
