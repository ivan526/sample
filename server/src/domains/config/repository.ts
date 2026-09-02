import { query, getClient } from '../../config/db.js';
import type { DbClient } from '../../config/db.js';
import { NotFoundError, VersionConflictError, ValidationError, ForbiddenError } from '../../shared/errors.js';
import { ROLES } from '../../shared/types.js';
import type { ProductInput, DomainInput, MssDomainInput, OrganizationInput } from './schemas.js';

export interface Domain {
  id: string;
  name: string;
  description: string;
  gtmOwner: string;
  domainOwner: string;
  stockingOwner: string;
  enabled: boolean;
  version: number;
  productCount?: number;
}

export interface MssDomain {
  id: string;
  code: string;
  name: string;
  description: string;
  mssOwner: string;
  enabled: boolean;
  version: number;
  productCount?: number;
}

export interface ProductSku {
  id: string;
  model: string;
  bomCode: string;
  description?: string;
}

export interface Product {
  id: string;
  name: string;
  domainId: string;
  mssDomainId?: string;
  domain?: string;
  gtm?: string;
  domainOwner?: string;
  mssOwner?: string;
  stockingOwner?: string;
  stage?: string;
  supplyTimeText?: string;
  defaultDeadline?: string | null;
  enabled: boolean;
  version: number;
  skus: ProductSku[];
}

export interface Office {
  id: string;
  name: string;
  owner: string;
  enabled: boolean;
  countries: string[];
}

export interface Organization {
  id: string;
  name: string;
  owner: string;
  enabled: boolean;
  version: number;
  offices: Office[];
}

export interface DictionaryItem {
  id: string;
  dictType: string;
  code: string;
  name: string;
  sortOrder: number;
  description: string;
  enabled: boolean;
  version: number;
}

export interface Catalog {
  domains: Domain[];
  mssDomains: MssDomain[];
  products: Product[];
  organizations: Organization[];
  dictionaries: Record<string, DictionaryItem[]>;
}

export const configRepository = {
  async getCatalog(role: ROLES, userId: string): Promise<Catalog> {
    let domainWhere = '';
    const domainParams: any[] = [];
    // GTM角色只能看到自己负责的产品品类
    if (role === ROLES.GTM) {
      domainParams.push(userId);
      domainWhere = 'WHERE pd.gtm_owner_id = $1';
    }

    // 获取产品品类（原领域，绑定GTM/备货负责人）
    const { rows: domains } = await query<Domain & { gtm_owner_id: string; domain_owner_id: string; stocking_owner_id: string }>(`
      SELECT pd.*, COALESCE(gu.display_name, '待配置') as "gtmOwner", COALESCE(du.display_name, gu.display_name, '待配置') as "domainOwner", COALESCE(su.display_name, '待配置') as "stockingOwner",
        (SELECT COUNT(*) FROM product p WHERE p.domain_id = pd.id AND p.enabled = true) as "productCount"
      FROM product_domain pd
      LEFT JOIN app_user gu ON pd.gtm_owner_id = gu.id
      LEFT JOIN app_user du ON pd.domain_owner_id = du.id
      LEFT JOIN app_user su ON pd.stocking_owner_id = su.id
      ${domainWhere}
      ORDER BY pd.name
    `, domainParams);

    let mssWhere = '';
    const mssParams: any[] = [];
    // MSS领域负责人只能看到自己负责的MSS领域
    if (role === ROLES.MSS_DOMAIN_OWNER) {
      mssParams.push(userId);
      mssWhere = 'WHERE md.enabled = true AND md.mss_owner_id = $1';
    } else {
      mssWhere = 'WHERE md.enabled = true';
    }

    // 获取MSS业务领域（绑定MSS负责人，跨品类）
    const { rows: mssDomains } = await query<MssDomain & { mss_owner_id: string }>(`
      SELECT md.*, mu.display_name as "mssOwner",
        (SELECT COUNT(*) FROM product p WHERE p.mss_domain_id = md.id AND p.enabled = true) as "productCount"
      FROM mss_domain md
      LEFT JOIN app_user mu ON md.mss_owner_id = mu.id
      ${mssWhere}
      ORDER BY md.name
    `, mssParams);

    // 产品按角色过滤
    let productWhere = '';
    const productParams: any[] = [];
    if (role === ROLES.GTM) {
      productParams.push(userId);
      productWhere = 'WHERE pd.gtm_owner_id = $1';
    } else if (role === ROLES.MSS_DOMAIN_OWNER) {
      productParams.push(userId);
      productWhere = 'WHERE md.mss_owner_id = $1';
    } else if (role === ROLES.STOCKING_OWNER) {
      productParams.push(userId);
      productWhere = 'WHERE pd.stocking_owner_id = $1';
    }

    // 获取产品和SKU
    const { rows: products } = await query<Product & { domain_id: string; mss_domain_id: string }>(`
      SELECT p.*, pd.name as domain, md.name as "mssDomain", COALESCE(gu.display_name, '待配置') as gtm, COALESCE(du.display_name, gu.display_name, '待配置') as "domainOwner", COALESCE(mu.display_name, '待配置') as "mssOwner", COALESCE(su.display_name, '待配置') as "stockingOwner"
      FROM product p
      JOIN product_domain pd ON p.domain_id = pd.id
      LEFT JOIN mss_domain md ON p.mss_domain_id = md.id
      LEFT JOIN app_user gu ON pd.gtm_owner_id = gu.id
      LEFT JOIN app_user du ON pd.domain_owner_id = du.id
      LEFT JOIN app_user mu ON md.mss_owner_id = mu.id
      LEFT JOIN app_user su ON pd.stocking_owner_id = su.id
      ${productWhere}
      ORDER BY p.created_at DESC
    `, productParams);

    // 如果是GTM，只查询自己品类下的SKU；否则查所有可见产品的SKU
    const visibleProductIds = products.map(p => p.id);
    let skuWhere = '';
    const skuParams: any[] = [];
    if (visibleProductIds.length > 0 && role !== ROLES.ADMIN) {
      const placeholders = visibleProductIds.map((_, i) => `$${i + 1}`).join(',');
      skuParams.push(...visibleProductIds);
      skuWhere = `WHERE enabled = true AND product_id IN (${placeholders})`;
    } else {
      skuWhere = 'WHERE enabled = true';
    }
    const { rows: skus } = await query<ProductSku & { product_id: string }>(`
      SELECT id, product_id, model, bom_code as "bomCode", description FROM product_sku ${skuWhere} ORDER BY created_at
    `, skuParams);

    const productsWithSkus = products.map(product => ({
      ...product,
      domainId: product.domain_id,
      mssDomainId: product.mss_domain_id,
      skus: skus.filter(s => s.product_id === product.id).map(s => ({ id: s.id, model: s.model, bomCode: s.bomCode, description: s.description || '' })),
    }));

    // 获取组织树
    const { rows: orgNodes } = await query<{
      id: string; name: string; node_type: string; parent_id: string | null;
      owner_id: string | null; enabled: boolean; version: number; display_name: string | null;
    }>(`
      SELECT n.*, u.display_name
      FROM org_node n
      LEFT JOIN app_user u ON n.owner_id = u.id
      WHERE n.enabled = true
      ORDER BY n.node_type, n.name
    `);

    const regions = orgNodes.filter(n => n.node_type === 'REGION').map(region => {
      const offices = orgNodes.filter(n => n.node_type === 'OFFICE' && n.parent_id === region.id).map(office => {
        const countries = orgNodes.filter(n => n.node_type === 'COUNTRY' && n.parent_id === office.id).map(c => c.name);
        return {
          id: office.id,
          name: office.name,
          owner: office.display_name || '待配置',
          enabled: office.enabled,
          countries,
        };
      });
      return {
        id: region.id,
        name: region.name,
        owner: region.display_name || '待配置',
        enabled: region.enabled,
        version: region.version,
        offices,
      };
    });

    // 获取字典数据
    const dictionaries = await this.getAllDictionaries();

    return {
      domains: domains.map(d => ({
        id: d.id,
        name: d.name,
        description: d.description || '',
        gtmOwner: d.gtmOwner,
        domainOwner: d.domainOwner || d.gtmOwner,
        stockingOwner: d.stockingOwner,
        enabled: d.enabled,
        version: d.version,
        productCount: Number(d.productCount) || 0,
      })),
      mssDomains: mssDomains.map(d => ({
        id: d.id,
        code: d.code,
        name: d.name,
        description: d.description || '',
        mssOwner: d.mssOwner || '待配置',
        enabled: d.enabled,
        version: d.version,
        productCount: Number(d.productCount) || 0,
      })),
      products: productsWithSkus as Product[],
      organizations: regions as Organization[],
      dictionaries,
    };
  },

  async createProduct(input: ProductInput, role: ROLES, userId: string): Promise<Product> {
    const client = await getClient();
    try {
      await client.query('BEGIN');

      // 检查领域是否存在
      const { rows: domainCheck } = await client.query('SELECT id, gtm_owner_id FROM product_domain WHERE id = $1 AND enabled = true', [input.domainId]);
      if (domainCheck.length === 0) {
        throw new ValidationError('所属产品品类不存在或已停用');
      }

      // GTM角色只能创建自己负责品类下的产品
      if (role === ROLES.GTM && domainCheck[0].gtm_owner_id !== userId) {
        throw new ForbiddenError('无权在其他产品品类下创建产品');
      }

      // 检查MSS领域是否存在（如果指定了）
      let mssDomainId = input.mssDomainId;
      if (mssDomainId) {
        const { rows: mssCheck } = await client.query('SELECT id FROM mss_domain WHERE id = $1 AND enabled = true', [mssDomainId]);
        if (mssCheck.length === 0) {
          throw new ValidationError('所属MSS业务领域不存在或已停用');
        }
      } else {
        // 默认归属MKT领域
        mssDomainId = 'mss-mkt';
      }

      // 生成产品ID和code
      const productId = input.id || `product-${Date.now()}`;
      const productCode = input.id || `prod-${Date.now()}`;

      const { rows: productRows } = await client.query<Product>(
        `INSERT INTO product (id, code, name, domain_id, mss_domain_id, sample_stage, supply_time_text, default_deadline_text, enabled)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING id, name, domain_id as "domainId", mss_domain_id as "mssDomainId", sample_stage as stage, supply_time_text as "supplyTimeText",
                   default_deadline_text as "defaultDeadline", enabled, version`,
        [productId, productCode, input.name.trim(), input.domainId, mssDomainId, input.stage || '工程样机（EVT）',
         input.supplyTimeText || '待产品线确认', input.defaultDeadline || null, input.enabled !== false]
      );

      const product = productRows[0];

      // 插入SKU
      const skus: ProductSku[] = [];
      for (const skuInput of input.skus || []) {
        if (!skuInput.model?.trim()) continue;
        const skuId = skuInput.id || `sku-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
        const { rows: skuRows } = await client.query<ProductSku>(
          `INSERT INTO product_sku (id, product_id, model, bom_code, description) VALUES ($1, $2, $3, $4, $5)
           RETURNING id, model, bom_code as "bomCode", description`,
          [skuId, productId, skuInput.model.trim(), skuInput.bomCode || '', skuInput.description || '']
        );
        skus.push(skuRows[0]);
      }

      await client.query('COMMIT');

      // 获取完整产品信息（带领域责任人）
      const { rows: fullProduct } = await client.query<Product & { domain: string; mssDomain: string; gtm: string; mssOwner: string; stockingOwner: string }>(
        `SELECT p.*, pd.name as domain, md.name as "mssDomain", gu.display_name as gtm, mu.display_name as "mssOwner", su.display_name as "stockingOwner"
         FROM product p
         JOIN product_domain pd ON p.domain_id = pd.id
         LEFT JOIN mss_domain md ON p.mss_domain_id = md.id
         JOIN app_user gu ON pd.gtm_owner_id = gu.id
         LEFT JOIN app_user mu ON md.mss_owner_id = mu.id
         JOIN app_user su ON pd.stocking_owner_id = su.id
         WHERE p.id = $1`,
        [productId]
      );

      return { ...fullProduct[0], domainId: input.domainId, mssDomainId, skus };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  },

  async updateProduct(productId: string, input: ProductInput, role: ROLES, userId: string): Promise<Product> {
    const client = await getClient();
    try {
      await client.query('BEGIN');

      // 检查产品存在和版本
      const { rows: existing } = await client.query('SELECT p.*, pd.gtm_owner_id FROM product p JOIN product_domain pd ON p.domain_id = pd.id WHERE p.id = $1', [productId]);
      if (existing.length === 0) {
        throw new NotFoundError('产品不存在');
      }
      if (input.version !== undefined && Number(existing[0].version) !== Number(input.version)) {
        throw new VersionConflictError();
      }

      // GTM角色只能修改自己负责品类下的产品，且不能转移到其他品类
      if (role === ROLES.GTM) {
        if (existing[0].gtm_owner_id !== userId) {
          throw new ForbiddenError('无权修改其他品类下的产品');
        }
        if (input.domainId && input.domainId !== existing[0].domain_id) {
          throw new ForbiddenError('不能将产品转移到其他品类');
        }
      }

      // 检查领域是否存在
      if (input.domainId) {
        const { rows: domainCheck } = await client.query('SELECT id FROM product_domain WHERE id = $1', [input.domainId]);
        if (domainCheck.length === 0) {
          throw new ValidationError('所属领域不存在');
        }
      }

      // 更新产品
      const { rows: productRows } = await client.query<Product>(
        `UPDATE product
         SET name = COALESCE($1, name),
             domain_id = COALESCE($2, domain_id),
             sample_stage = COALESCE($3, sample_stage),
             supply_time_text = COALESCE($4, supply_time_text),
             default_deadline_text = COALESCE($5, default_deadline_text),
             enabled = COALESCE($6, enabled),
             version = version + 1,
             updated_at = NOW()
         WHERE id = $7
         RETURNING id, name, domain_id as "domainId", sample_stage as stage, supply_time_text as "supplyTimeText",
                   default_deadline_text as "defaultDeadline", enabled, version`,
        [input.name?.trim(), input.domainId, input.stage, input.supplyTimeText,
         input.defaultDeadline, input.enabled, productId]
      );

      const product = productRows[0];

      // 处理SKU：简单起见，先删除旧SKU再插入新的（Sprint1简化处理，后续可以优化成增量更新）
      if (input.skus) {
        await client.query('DELETE FROM product_sku WHERE product_id = $1', [productId]);
        const skus: ProductSku[] = [];
        for (const skuInput of input.skus) {
          if (!skuInput.model?.trim()) continue;
          const skuId = skuInput.id || `sku-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
          const { rows: skuRows } = await client.query<ProductSku>(
            `INSERT INTO product_sku (id, product_id, model, bom_code, description) VALUES ($1, $2, $3, $4, $5)
             RETURNING id, model, bom_code as "bomCode", description`,
            [skuId, productId, skuInput.model.trim(), skuInput.bomCode || '', skuInput.description || '']
          );
          skus.push(skuRows[0]);
        }
        product.skus = skus;
      } else {
        // 保留现有SKU
        const { rows: existingSkus } = await client.query<ProductSku>(
          'SELECT id, model, bom_code as "bomCode", description FROM product_sku WHERE product_id = $1 AND enabled = true',
          [productId]
        );
        product.skus = existingSkus;
      }

      await client.query('COMMIT');

      // 获取完整产品信息
      const { rows: fullProduct } = await client.query<Product & { domain: string; gtm: string; stockingOwner: string }>(
        `SELECT p.*, pd.name as domain, COALESCE(gu.display_name, '待配置') as gtm, COALESCE(su.display_name, '待配置') as "stockingOwner"
         FROM product p
         JOIN product_domain pd ON p.domain_id = pd.id
         LEFT JOIN app_user gu ON pd.gtm_owner_id = gu.id
         LEFT JOIN app_user su ON pd.stocking_owner_id = su.id
         WHERE p.id = $1`,
        [productId]
      );

      return { ...fullProduct[0], ...product, skus: product.skus };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  },

  async createDomain(input: DomainInput): Promise<Domain> {
    const client = await getClient();
    try {
      await client.query('BEGIN');

      // 查找或创建用户（Sprint1简化：如果用户名不存在，创建一个测试用户，后续接入SSO后替换）
      const gtmUserId = await this.ensureUser(client, input.gtmOwner);
      const domainUserId = input.domainOwner ? await this.ensureUser(client, input.domainOwner) : gtmUserId;
      const stockingUserId = await this.ensureUser(client, input.stockingOwner);

      const domainId = input.id || `domain-${Date.now()}`;
      const domainCode = input.id || `dom-${Date.now()}`;

      const { rows } = await client.query<Domain>(
        `INSERT INTO product_domain (id, code, name, description, gtm_owner_id, domain_owner_id, stocking_owner_id, enabled)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING id, name, description, enabled, version`,
        [domainId, domainCode, input.name.trim(), input.description || '', gtmUserId, domainUserId, stockingUserId, input.enabled !== false]
      );

      await client.query('COMMIT');

      return {
        ...rows[0],
        gtmOwner: input.gtmOwner,
        domainOwner: input.domainOwner || input.gtmOwner,
        stockingOwner: input.stockingOwner,
        productCount: 0,
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  },

  async updateDomain(domainId: string, input: DomainInput): Promise<Domain> {
    const client = await getClient();
    try {
      await client.query('BEGIN');

      // 检查存在和版本
      const { rows: existing } = await client.query('SELECT * FROM product_domain WHERE id = $1', [domainId]);
      if (existing.length === 0) {
        throw new NotFoundError('产品领域不存在');
      }
      if (input.version !== undefined && Number(existing[0].version) !== Number(input.version)) {
        throw new VersionConflictError();
      }

      const gtmUserId = input.gtmOwner ? await this.ensureUser(client, input.gtmOwner) : existing[0].gtm_owner_id;
      const domainUserId = input.domainOwner ? await this.ensureUser(client, input.domainOwner) : existing[0].domain_owner_id;
      const stockingUserId = input.stockingOwner ? await this.ensureUser(client, input.stockingOwner) : existing[0].stocking_owner_id;

      const { rows } = await client.query<Domain>(
        `UPDATE product_domain
         SET name = COALESCE($1, name),
             description = COALESCE($2, description),
             gtm_owner_id = COALESCE($3, gtm_owner_id),
             domain_owner_id = COALESCE($4, domain_owner_id),
             stocking_owner_id = COALESCE($5, stocking_owner_id),
             enabled = COALESCE($6, enabled),
             version = version + 1,
             updated_at = NOW()
         WHERE id = $7
         RETURNING id, name, description, enabled, version`,
        [input.name?.trim(), input.description, gtmUserId, domainUserId, stockingUserId, input.enabled, domainId]
      );

      // 获取用户名
      const { rows: gtmUser } = await client.query<{ display_name: string }>('SELECT display_name FROM app_user WHERE id = $1', [gtmUserId]);
      const { rows: domainUser } = await client.query<{ display_name: string }>('SELECT display_name FROM app_user WHERE id = $1', [domainUserId]);
      const { rows: stockingUser } = await client.query<{ display_name: string }>('SELECT display_name FROM app_user WHERE id = $1', [stockingUserId]);
      const { rows: productCount } = await client.query<{ count: string }>('SELECT COUNT(*) as count FROM product WHERE domain_id = $1 AND enabled = true', [domainId]);

      await client.query('COMMIT');

      return {
        ...rows[0],
        gtmOwner: gtmUser[0].display_name,
        domainOwner: domainUser[0]?.display_name || gtmUser[0].display_name,
        stockingOwner: stockingUser[0].display_name,
        productCount: Number(productCount[0].count) || 0,
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  },

  async createMssDomain(input: MssDomainInput): Promise<MssDomain> {
    const client = await getClient();
    try {
      await client.query('BEGIN');

      // 查找或创建MSS负责人用户
      const mssOwnerId = await this.ensureUser(client, input.mssOwner);

      const mssDomainId = input.id || `mss-${Date.now()}`;
      const mssDomainCode = input.code || `mss-${Date.now()}`;

      const { rows } = await client.query<MssDomain>(
        `INSERT INTO mss_domain (id, code, name, description, mss_owner_id, enabled)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id, code, name, description, enabled, version`,
        [mssDomainId, mssDomainCode.trim(), input.name.trim(), input.description || '', mssOwnerId, input.enabled !== false]
      );

      await client.query('COMMIT');

      return {
        ...rows[0],
        mssOwner: input.mssOwner,
        productCount: 0,
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  },

  async updateMssDomain(mssDomainId: string, input: MssDomainInput): Promise<MssDomain> {
    const client = await getClient();
    try {
      await client.query('BEGIN');

      // 检查存在和版本
      const { rows: existing } = await client.query('SELECT * FROM mss_domain WHERE id = $1', [mssDomainId]);
      if (existing.length === 0) {
        throw new NotFoundError('MSS业务领域不存在');
      }
      if (input.version !== undefined && Number(existing[0].version) !== Number(input.version)) {
        throw new VersionConflictError();
      }

      const mssOwnerId = input.mssOwner ? await this.ensureUser(client, input.mssOwner) : existing[0].mss_owner_id;

      const { rows } = await client.query<MssDomain>(
        `UPDATE mss_domain
         SET code = COALESCE($1, code),
             name = COALESCE($2, name),
             description = COALESCE($3, description),
             mss_owner_id = COALESCE($4, mss_owner_id),
             enabled = COALESCE($5, enabled),
             version = version + 1,
             updated_at = NOW()
         WHERE id = $6
         RETURNING id, code, name, description, enabled, version`,
        [input.code?.trim(), input.name?.trim(), input.description, mssOwnerId, input.enabled, mssDomainId]
      );

      // 获取负责人姓名
      const { rows: mssUser } = await client.query<{ display_name: string }>('SELECT display_name FROM app_user WHERE id = $1', [mssOwnerId]);
      const { rows: productCount } = await client.query<{ count: string }>('SELECT COUNT(*) as count FROM product WHERE mss_domain_id = $1 AND enabled = true', [mssDomainId]);

      await client.query('COMMIT');

      return {
        ...rows[0],
        mssOwner: mssUser[0]?.display_name || '待配置',
        productCount: Number(productCount[0].count) || 0,
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  },

  async createOrganization(input: OrganizationInput): Promise<Organization> {
    const client = await getClient();
    try {
      await client.query('BEGIN');

      const regionOwnerId = await this.ensureUser(client, input.owner);
      const regionId = input.id || `region-${Date.now()}`;
      const regionCode = input.id || `reg-${Date.now()}`;

      // 创建区域
      await client.query(
        `INSERT INTO org_node (id, code, name, node_type, owner_id, enabled)
         VALUES ($1, $2, $3, 'REGION', $4, $5)`,
        [regionId, regionCode, input.name.trim(), regionOwnerId, input.enabled !== false]
      );

      const offices: Office[] = [];
      // 创建代表处和国家
      for (const officeInput of input.offices || []) {
        const officeOwnerId = await this.ensureUser(client, officeInput.owner);
        const officeId = officeInput.id || `office-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
        const officeCode = officeInput.id || `off-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;

        await client.query(
          `INSERT INTO org_node (id, code, name, node_type, parent_id, owner_id, enabled)
           VALUES ($1, $2, $3, 'OFFICE', $4, $5, $6)`,
          [officeId, officeCode, officeInput.name.trim(), regionId, officeOwnerId, officeInput.enabled !== false]
        );

        const countries: string[] = [];
        for (const country of officeInput.countries || []) {
          if (!country.trim()) continue;
          const countryCode = country.toLowerCase().replace(/\s+/g, '-') + '-' + Date.now();
          await client.query(
            `INSERT INTO org_node (code, name, node_type, parent_id, enabled)
             VALUES ($1, $2, 'COUNTRY', $3, true)`,
            [countryCode, country.trim(), officeId]
          );
          countries.push(country.trim());
        }

        offices.push({
          id: officeId,
          name: officeInput.name.trim(),
          owner: officeInput.owner,
          enabled: officeInput.enabled !== false,
          countries,
        });
      }

      await client.query('COMMIT');

      return {
        id: regionId,
        name: input.name.trim(),
        owner: input.owner,
        enabled: input.enabled !== false,
        version: 1,
        offices,
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  },

  async updateOrganization(regionId: string, input: OrganizationInput): Promise<Organization> {
    const client = await getClient();
    try {
      await client.query('BEGIN');

      // 检查存在和版本
      const { rows: existing } = await client.query("SELECT * FROM org_node WHERE id = $1 AND node_type = 'REGION'", [regionId]);
      if (existing.length === 0) {
        throw new NotFoundError('区域不存在');
      }
      if (input.version !== undefined && Number(existing[0].version) !== Number(input.version)) {
        throw new VersionConflictError();
      }

      const regionOwnerId = input.owner ? await this.ensureUser(client, input.owner) : existing[0].owner_id;

      // 更新区域
      const { rows: regionRows } = await client.query<{ version: number }>(
        `UPDATE org_node
         SET name = COALESCE($1, name),
             owner_id = COALESCE($2, owner_id),
             enabled = COALESCE($3, enabled),
             version = version + 1,
             updated_at = NOW()
         WHERE id = $4 AND node_type = 'REGION'
         RETURNING version`,
        [input.name?.trim(), regionOwnerId, input.enabled, regionId]
      );

      // 简化处理：如果传了offices，删除旧的代表处和国家，重新创建（Sprint1简化，后续优化增量更新）
      const offices: Office[] = [];
      if (input.offices) {
        // 删除旧的国家
        await client.query(`
          DELETE FROM org_node WHERE node_type = 'COUNTRY' AND parent_id IN (
            SELECT id FROM org_node WHERE node_type = 'OFFICE' AND parent_id = $1
          )
        `, [regionId]);
        // 删除旧的代表处
        await client.query("DELETE FROM org_node WHERE node_type = 'OFFICE' AND parent_id = $1", [regionId]);

        // 创建新的代表处和国家
        for (const officeInput of input.offices) {
          const officeOwnerId = await this.ensureUser(client, officeInput.owner);
          const officeId = officeInput.id || `office-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
          const officeCode = officeInput.id || `off-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;

          await client.query(
            `INSERT INTO org_node (id, code, name, node_type, parent_id, owner_id, enabled)
             VALUES ($1, $2, $3, 'OFFICE', $4, $5, $6)`,
            [officeId, officeCode, officeInput.name.trim(), regionId, officeOwnerId, officeInput.enabled !== false]
          );

          const countries: string[] = [];
          for (const country of officeInput.countries || []) {
            if (!country.trim()) continue;
            const countryCode = country.toLowerCase().replace(/\s+/g, '-') + '-' + Date.now() + '-' + Math.random().toString(36).substring(2, 5);
            await client.query(
              `INSERT INTO org_node (code, name, node_type, parent_id, enabled)
               VALUES ($1, $2, 'COUNTRY', $3, true)`,
              [countryCode, country.trim(), officeId]
            );
            countries.push(country.trim());
          }

          offices.push({
            id: officeId,
            name: officeInput.name.trim(),
            owner: officeInput.owner,
            enabled: officeInput.enabled !== false,
            countries,
          });
        }
      } else {
        // 保留现有代表处和国家
        const { rows: existingOffices } = await client.query<{ id: string; name: string; owner_id: string; owner: string; enabled: boolean }>(
          "SELECT o.*, u.display_name as owner FROM org_node o LEFT JOIN app_user u ON o.owner_id = u.id WHERE o.node_type = 'OFFICE' AND o.parent_id = $1",
          [regionId]
        );
        for (const office of existingOffices) {
          const { rows: countries } = await client.query<{ name: string }>(
            "SELECT name FROM org_node WHERE node_type = 'COUNTRY' AND parent_id = $1",
            [office.id]
          );
          offices.push({
            id: office.id,
            name: office.name,
            owner: office.owner || '待配置',
            enabled: office.enabled,
            countries: countries.map(c => c.name),
          });
        }
      }

      await client.query('COMMIT');

      return {
        id: regionId,
        name: input.name?.trim() || existing[0].name,
        owner: input.owner || (await client.query<{ display_name: string }>('SELECT display_name FROM app_user WHERE id = $1', [existing[0].owner_id])).rows[0].display_name,
        enabled: input.enabled !== undefined ? input.enabled : existing[0].enabled,
        version: regionRows[0].version,
        offices,
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  },

  // 辅助函数：确保用户存在，不存在则创建
  async ensureUser(client: DbClient, displayName: string): Promise<string> {
    const employeeNo = displayName.toLowerCase().replace(/\s+/g, '-');
    const { rows } = await client.query('SELECT id FROM app_user WHERE employee_no = $1 OR display_name = $2', [employeeNo, displayName]);
    if (rows.length > 0) return rows[0].id;

    const { rows: newUser } = await client.query<{ id: string }>(
      'INSERT INTO app_user (employee_no, display_name) VALUES ($1, $2) RETURNING id',
      [employeeNo, displayName]
    );
    return newUser[0].id;
  },

  // ========== 数据字典相关方法 ==========
  // 获取所有字典项
  async getAllDictionaries(): Promise<Record<string, any[]>> {
    const { rows } = await query(
      'SELECT id, dict_type as "dictType", code, name, sort_order as "sortOrder", description, enabled, version FROM data_dictionary WHERE enabled = true ORDER BY dict_type, sort_order, code'
    );
    const result: Record<string, any[]> = {};
    for (const row of rows) {
      if (!result[row.dictType]) result[row.dictType] = [];
      result[row.dictType].push(row);
    }
    return result;
  },

  // 创建字典项
  async createDictionaryItem(input: any): Promise<any> {
    const client = await getClient();
    try {
      await client.begin();
      const { rows } = await client.query(
        `INSERT INTO data_dictionary (dict_type, code, name, sort_order, description, enabled)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, dict_type as "dictType", code, name, sort_order as "sortOrder", description, enabled, version`,
        [input.dictType, input.code, input.name, input.sortOrder || 0, input.description || '', input.enabled !== false]
      );
      await client.commit();
      return rows[0];
    } catch (error) {
      await client.rollback();
      throw error;
    } finally {
      client.release();
    }
  },

  // 更新字典项
  async updateDictionaryItem(id: string, input: any): Promise<any> {
    const client = await getClient();
    try {
      await client.begin();
      // 检查存在和版本
      const { rows: existing } = await client.query('SELECT * FROM data_dictionary WHERE id = $1', [id]);
      if (existing.length === 0) {
        throw new NotFoundError('字典项不存在');
      }
      if (input.version !== undefined && existing[0].version !== input.version) {
        throw new VersionConflictError('字典项已被其他人修改，请刷新后重试');
      }
      // 更新
      const { rows } = await client.query(
        `UPDATE data_dictionary SET name = $1, sort_order = $2, description = $3, enabled = $4, version = version + 1, updated_at = NOW()
         WHERE id = $5 RETURNING id, dict_type as "dictType", code, name, sort_order as "sortOrder", description, enabled, version`,
        [
          input.name || existing[0].name,
          input.sortOrder !== undefined ? input.sortOrder : existing[0].sort_order,
          input.description !== undefined ? input.description : existing[0].description,
          input.enabled !== undefined ? input.enabled : existing[0].enabled,
          id
        ]
      );
      await client.commit();
      return rows[0];
    } catch (error) {
      await client.rollback();
      throw error;
    } finally {
      client.release();
    }
  },

  // 删除字典项
  async deleteDictionaryItem(id: string): Promise<void> {
    const client = await getClient();
    try {
      await client.begin();
      await client.query('DELETE FROM data_dictionary WHERE id = $1', [id]);
      await client.commit();
    } catch (error) {
      await client.rollback();
      throw error;
    } finally {
      client.release();
    }
  },

  // ========== 用户相关方法 ==========
  // 获取所有用户
  async getAllUsers(): Promise<any[]> {
    const { rows } = await query(
      `SELECT id, employee_no as "employeeNo", display_name as "displayName", role, enabled, created_at as "createdAt", last_login_at as "lastLoginAt"
       FROM app_user ORDER BY created_at DESC`
    );
    // 将SQLite的0/1转为boolean
    return rows.map((row: any) => ({
      ...row,
      enabled: !!row.enabled
    }));
  },

  // 根据ID获取用户（包含密码哈希，用于密码验证）
  async getUserById(userId: string): Promise<any | null> {
    const { rows } = await query(
      `SELECT id, employee_no as "employeeNo", display_name as "displayName", role, password_hash as "passwordHash", enabled
       FROM app_user WHERE id = $1`,
      [userId]
    );
    if (rows.length === 0) return null;
    return {
      ...rows[0],
      enabled: !!rows[0].enabled
    };
  },

  // 根据工号获取用户（用于登录）
  async getUserByEmployeeNo(employeeNo: string): Promise<any | null> {
    const { rows } = await query(
      `SELECT id, employee_no as "employeeNo", display_name as "displayName", role, password_hash as "passwordHash", enabled
       FROM app_user WHERE employee_no = $1`,
      [employeeNo]
    );
    if (rows.length === 0) return null;
    return {
      ...rows[0],
      enabled: !!rows[0].enabled
    };
  },

  // 更新最后登录时间
  async updateUserLoginTime(userId: string): Promise<void> {
    await query(
      `UPDATE app_user SET last_login_at = NOW() WHERE id = $1`,
      [userId]
    );
  },

  // 更新用户密码
  async updateUserPassword(userId: string, passwordHash: string): Promise<void> {
    await query(
      `UPDATE app_user SET password_hash = $1, updated_at = NOW(), version = version + 1 WHERE id = $2`,
      [passwordHash, userId]
    );
  },

  // 创建用户
  async createUser(input: { employeeNo: string; displayName: string; role: string; password: string; enabled?: boolean }): Promise<any> {
    const bcrypt = await import('bcryptjs');
    const client = await getClient();
    try {
      await client.begin();
      const enabledValue = input.enabled !== false;
      const passwordHash = bcrypt.default.hashSync(input.password, 10);
      const { rows } = await client.query(
        `INSERT INTO app_user (employee_no, display_name, role, password_hash, enabled)
         VALUES ($1, $2, $3, $4, $5) RETURNING id, employee_no as "employeeNo", display_name as "displayName", role, enabled`,
        [input.employeeNo.trim(), input.displayName.trim(), input.role, passwordHash, enabledValue]
      );
      await client.commit();
      return {
        ...rows[0],
        enabled: !!rows[0].enabled,
        // 不返回密码哈希
        passwordHash: undefined,
      };
    } catch (error: any) {
      await client.rollback();
      if (error.message?.includes('UNIQUE constraint failed') || error.code === '23505') {
        throw new Error('工号已存在，请更换工号');
      }
      throw error;
    } finally {
      client.release();
    }
  },

  // 更新用户
  async updateUser(userId: string, input: { displayName?: string; role?: string; enabled?: boolean; password?: string }): Promise<any> {
    const bcrypt = await import('bcryptjs');
    const client = await getClient();
    try {
      await client.begin();
      const existing = await client.query('SELECT * FROM app_user WHERE id = $1', [userId]);
      if (existing.rows.length === 0) {
        throw new NotFoundError('用户不存在');
      }

      // 构建更新字段
      const updates: string[] = [];
      const params: any[] = [];
      if (input.displayName !== undefined) {
        params.push(input.displayName.trim());
        updates.push(`display_name = $${params.length}`);
      }
      if (input.role !== undefined) {
        params.push(input.role);
        updates.push(`role = $${params.length}`);
      }
      if (input.enabled !== undefined) {
        params.push(input.enabled ? 1 : 0);
        updates.push(`enabled = $${params.length}`);
      }
      if (input.password !== undefined && input.password.trim()) {
        const passwordHash = bcrypt.default.hashSync(input.password.trim(), 10);
        params.push(passwordHash);
        updates.push(`password_hash = $${params.length}`);
      }

      if (updates.length === 0) {
        // 没有需要更新的字段，直接返回现有数据
        return {
          id: existing.rows[0].id,
          employeeNo: existing.rows[0].employee_no,
          displayName: existing.rows[0].display_name,
          role: existing.rows[0].role,
          enabled: !!existing.rows[0].enabled,
        };
      }

      params.push(userId);
      updates.push(`updated_at = NOW()`);
      updates.push(`version = version + 1`);

      const { rows } = await client.query(
        `UPDATE app_user SET ${updates.join(', ')}
         WHERE id = $${params.length} RETURNING id, employee_no as "employeeNo", display_name as "displayName", role, enabled, version`,
        params
      );
      await client.commit();
      return {
        ...rows[0],
        enabled: !!rows[0].enabled,
        passwordHash: undefined,
      };
    } catch (error) {
      await client.rollback();
      throw error;
    } finally {
      client.release();
    }
  },
};
