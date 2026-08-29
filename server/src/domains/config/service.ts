import { configRepository, Catalog, Product, Domain, Organization } from './repository';
import { ProductInputSchema, DomainInputSchema, OrganizationInputSchema } from './schemas';
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
};
