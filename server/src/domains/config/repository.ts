import { query, getClient } from '../../config/db';
import { NotFoundError, VersionConflictError, ValidationError } from '../../shared/errors';
import type { ProductInput, DomainInput, OrganizationInput } from './schemas';

export interface Domain {
  id: string;
  name: string;
  description: string;
  gtmOwner: string;
  stockingOwner: string;
  enabled: boolean;
  version: number;
  productCount?: number;
}

export interface ProductSku {
  id: string;
  model: string;
  bomCode: string;
}

export interface Product {
  id: string;
  name: string;
  domainId: string;
  domain?: string;
  gtm?: string;
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

export interface Catalog {
  domains: Domain[];
  products: Product[];
  organizations: Organization[];
}

export const configRepository = {
  async getCatalog(): Promise<Catalog> {
    // 获取领域
    const { rows: domains } = await query<Domain & { gtm_owner_id: string; stocking_owner_id: string }>(`
      SELECT pd.*, gu.display_name as "gtmOwner", su.display_name as "stockingOwner",
        (SELECT COUNT(*) FROM product p WHERE p.domain_id = pd.id AND p.enabled = true) as "productCount"
      FROM product_domain pd
      JOIN app_user gu ON pd.gtm_owner_id = gu.id
      JOIN app_user su ON pd.stocking_owner_id = su.id
      ORDER BY pd.name
    `);

    // 获取产品和SKU
    const { rows: products } = await query<Product & { domain_id: string }>(`
      SELECT p.*, pd.name as domain, gu.display_name as gtm, su.display_name as "stockingOwner"
      FROM product p
      JOIN product_domain pd ON p.domain_id = pd.id
      JOIN app_user gu ON pd.gtm_owner_id = gu.id
      JOIN app_user su ON pd.stocking_owner_id = su.id
      ORDER BY p.created_at DESC
    `);

    const { rows: skus } = await query<ProductSku & { product_id: string }>(`
      SELECT id, product_id, model, bom_code as "bomCode" FROM product_sku WHERE enabled = true ORDER BY created_at
    `);

    const productsWithSkus = products.map(product => ({
      ...product,
      domainId: product.domain_id,
      skus: skus.filter(s => s.product_id === product.id).map(s => ({ id: s.id, model: s.model, bomCode: s.bomCode })),
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

    return {
      domains: domains.map(d => ({
        id: d.id,
        name: d.name,
        description: d.description || '',
        gtmOwner: d.gtmOwner,
        stockingOwner: d.stockingOwner,
        enabled: d.enabled,
        version: d.version,
        productCount: Number(d.productCount) || 0,
      })),
      products: productsWithSkus as Product[],
      organizations: regions as Organization[],
    };
  },

  async createProduct(input: ProductInput): Promise<Product> {
    const client = await getClient();
    try {
      await client.query('BEGIN');

      // 检查领域是否存在
      const { rows: domainCheck } = await client.query('SELECT id FROM product_domain WHERE id = $1 AND enabled = true', [input.domainId]);
      if (domainCheck.length === 0) {
        throw new ValidationError('所属领域不存在或已停用');
      }

      // 生成产品ID和code
      const productId = input.id || `product-${Date.now()}`;
      const productCode = input.id || `prod-${Date.now()}`;

      const { rows: productRows } = await client.query<Product>(
        `INSERT INTO product (id, code, name, domain_id, sample_stage, supply_time_text, default_deadline_text, enabled)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING id, name, domain_id as "domainId", sample_stage as stage, supply_time_text as "supplyTimeText",
                   default_deadline_text as "defaultDeadline", enabled, version`,
        [productId, productCode, input.name.trim(), input.domainId, input.stage || '工程样机（EVT）',
         input.supplyTimeText || '待产品线确认', input.defaultDeadline || null, input.enabled !== false]
      );

      const product = productRows[0];

      // 插入SKU
      const skus: ProductSku[] = [];
      for (const skuInput of input.skus || []) {
        if (!skuInput.model?.trim()) continue;
        const skuId = skuInput.id || `sku-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
        const { rows: skuRows } = await client.query<ProductSku>(
          `INSERT INTO product_sku (id, product_id, model, bom_code) VALUES ($1, $2, $3, $4)
           RETURNING id, model, bom_code as "bomCode"`,
          [skuId, productId, skuInput.model.trim(), skuInput.bomCode || '']
        );
        skus.push(skuRows[0]);
      }

      await client.query('COMMIT');

      // 获取完整产品信息（带领域责任人）
      const { rows: fullProduct } = await client.query<Product & { domain: string; gtm: string; stockingOwner: string }>(
        `SELECT p.*, pd.name as domain, gu.display_name as gtm, su.display_name as "stockingOwner"
         FROM product p
         JOIN product_domain pd ON p.domain_id = pd.id
         JOIN app_user gu ON pd.gtm_owner_id = gu.id
         JOIN app_user su ON pd.stocking_owner_id = su.id
         WHERE p.id = $1`,
        [productId]
      );

      return { ...fullProduct[0], domainId: fullProduct[0].domain_id || input.domainId, skus };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  },

  async updateProduct(productId: string, input: ProductInput): Promise<Product> {
    const client = await getClient();
    try {
      await client.query('BEGIN');

      // 检查产品存在和版本
      const { rows: existing } = await client.query('SELECT * FROM product WHERE id = $1', [productId]);
      if (existing.length === 0) {
        throw new NotFoundError('产品不存在');
      }
      if (input.version !== undefined && Number(existing[0].version) !== Number(input.version)) {
        throw new VersionConflictError();
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
            `INSERT INTO product_sku (id, product_id, model, bom_code) VALUES ($1, $2, $3, $4)
             RETURNING id, model, bom_code as "bomCode"`,
            [skuId, productId, skuInput.model.trim(), skuInput.bomCode || '']
          );
          skus.push(skuRows[0]);
        }
        product.skus = skus;
      } else {
        // 保留现有SKU
        const { rows: existingSkus } = await client.query<ProductSku>(
          'SELECT id, model, bom_code as "bomCode" FROM product_sku WHERE product_id = $1 AND enabled = true',
          [productId]
        );
        product.skus = existingSkus;
      }

      await client.query('COMMIT');

      // 获取完整产品信息
      const { rows: fullProduct } = await client.query<Product & { domain: string; gtm: string; stockingOwner: string }>(
        `SELECT p.*, pd.name as domain, gu.display_name as gtm, su.display_name as "stockingOwner"
         FROM product p
         JOIN product_domain pd ON p.domain_id = pd.id
         JOIN app_user gu ON pd.gtm_owner_id = gu.id
         JOIN app_user su ON pd.stocking_owner_id = su.id
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
      const stockingUserId = await this.ensureUser(client, input.stockingOwner);

      const domainId = input.id || `domain-${Date.now()}`;
      const domainCode = input.id || `dom-${Date.now()}`;

      const { rows } = await client.query<Domain>(
        `INSERT INTO product_domain (id, code, name, description, gtm_owner_id, stocking_owner_id, enabled)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id, name, description, enabled, version`,
        [domainId, domainCode, input.name.trim(), input.description || '', gtmUserId, stockingUserId, input.enabled !== false]
      );

      await client.query('COMMIT');

      return {
        ...rows[0],
        gtmOwner: input.gtmOwner,
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
      const stockingUserId = input.stockingOwner ? await this.ensureUser(client, input.stockingOwner) : existing[0].stocking_owner_id;

      const { rows } = await client.query<Domain>(
        `UPDATE product_domain
         SET name = COALESCE($1, name),
             description = COALESCE($2, description),
             gtm_owner_id = COALESCE($3, gtm_owner_id),
             stocking_owner_id = COALESCE($4, stocking_owner_id),
             enabled = COALESCE($5, enabled),
             version = version + 1,
             updated_at = NOW()
         WHERE id = $6
         RETURNING id, name, description, enabled, version`,
        [input.name?.trim(), input.description, gtmUserId, stockingUserId, input.enabled, domainId]
      );

      // 获取用户名
      const { rows: gtmUser } = await client.query<{ display_name: string }>('SELECT display_name FROM app_user WHERE id = $1', [gtmUserId]);
      const { rows: stockingUser } = await client.query<{ display_name: string }>('SELECT display_name FROM app_user WHERE id = $1', [stockingUserId]);
      const { rows: productCount } = await client.query<{ count: string }>('SELECT COUNT(*) as count FROM product WHERE domain_id = $1 AND enabled = true', [domainId]);

      await client.query('COMMIT');

      return {
        ...rows[0],
        gtmOwner: gtmUser[0].display_name,
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
        const { rows: existingOffices } = await client.query<{ id: string; name: string; owner_id: string; enabled: boolean }>(
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
  async ensureUser(client: any, displayName: string): Promise<string> {
    const employeeNo = displayName.toLowerCase().replace(/\s+/g, '-');
    const { rows } = await client.query('SELECT id FROM app_user WHERE employee_no = $1 OR display_name = $2', [employeeNo, displayName]);
    if (rows.length > 0) return rows[0].id;

    const { rows: newUser } = await client.query<{ id: string }>(
      'INSERT INTO app_user (employee_no, display_name) VALUES ($1, $2) RETURNING id',
      [employeeNo, displayName]
    );
    return newUser[0].id;
  },
};
