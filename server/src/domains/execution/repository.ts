import { query, getClient } from '../../config/db.js';
import { NotFoundError, ValidationError } from '../../shared/errors.js';
import crypto from 'node:crypto';
import type { ImportRequestInput, TsmpShipmentRowInput, ExecutionQueryInput } from './schemas.js';
import { ROLES } from '../../shared/types.js';

export interface ImportJob {
  id: string;
  fileName: string;
  status: 'UPLOADED' | 'VALIDATING' | 'MATCHING' | 'COMPLETED' | 'FAILED';
  totalRows: number;
  matchedRows: number;
  mappingRequiredRows: number;
  unmatchedRows: number;
  duplicateRows: number;
  importedBy: string;
  createdAt: string;
}

export interface ExecutionSku {
  id?: string;
  sku: string;
  bom: string;
  demand: number;
  stocked: number;
  applied: number;
  shipped: number;
  inventory: number;
  shipmentCount: number;
}

export interface ExecutionProduct {
  id: string;
  name: string;
  domain: string;
  gtm: string;
  stockingOwner: string;
  skuCount: number;
  metrics: {
    demand: number;
    stocked: number;
    applied: number;
    shipped: number;
    inventory: number;
    shipmentCount: number;
  };
  skus: ExecutionSku[];
}

export interface ExecutionView {
  scopeLabel: string;
  metrics: {
    demand: number;
    stocked: number;
    applied: number;
    shipped: number;
    remainingToApply: number;
    remainingToShip: number;
    demandApplyRate: number | null;
    applyShipRate: number | null;
    shipmentCount: number;
  };
  products: ExecutionProduct[];
}

// 标准化文本（小写、去空格、去特殊字符）
function normalizeText(text: string): string {
  return text.toLowerCase().replace(/[\s\-_]/g, '').trim();
}

export const executionRepository = {
  // 导入TSMP发货数据
  async importTsmpData(input: ImportRequestInput, userId: string, role: string): Promise<ImportJob> {
    const client = await getClient();
    try {
      await client.query('BEGIN');

      const jobId = crypto.randomUUID();
      const totalRows = input.rows.length;
      let matchedRows = 0;
      let mappingRequiredRows = 0;
      let unmatchedRows = 0;
      let duplicateRows = 0;

      // 计算文件指纹，去重
      const fileHash = crypto.createHash('md5').update(`${role === ROLES.STOCKING_OWNER ? userId : 'ADMIN'}|${JSON.stringify(input.rows)}`).digest('hex');
      const { rows: existingJob } = await client.query(
        'SELECT * FROM tsmp_import_job WHERE file_hash = $1',
        [fileHash]
      );
      if (existingJob.length > 0) {
        await client.query('COMMIT');
        return {
          id: existingJob[0].id,
          fileName: existingJob[0].file_name,
          status: existingJob[0].status,
          totalRows: Number(existingJob[0].total_rows),
          matchedRows: Number(existingJob[0].matched_rows),
          mappingRequiredRows: Number(existingJob[0].mapping_required_rows),
          unmatchedRows: Number(existingJob[0].unmatched_rows),
          duplicateRows: totalRows,
          importedBy: existingJob[0].imported_by,
          createdAt: existingJob[0].created_at,
        };
      }

      // 创建导入任务
      await client.query(`
        INSERT INTO tsmp_import_job (id, file_name, file_hash, status, total_rows, imported_by, started_at)
        VALUES ($1, $2, $3, 'MATCHING', $4, $5, NOW())
      `, [jobId, input.fileName, fileHash, totalRows, userId]);

      // 获取所有主数据用于匹配
      const productScopeSql = role === ROLES.STOCKING_OWNER ? 'AND pd.stocking_owner_id = $1' : '';
      const productScopeParams = role === ROLES.STOCKING_OWNER ? [userId] : [];
      const { rows: products } = await client.query(`
        SELECT p.id, p.name, pd.name as domain_name, gu.display_name as gtm_name, su.display_name as stocking_owner_name
        FROM product p
        JOIN product_domain pd ON p.domain_id = pd.id
        JOIN app_user gu ON pd.gtm_owner_id = gu.id
        JOIN app_user su ON pd.stocking_owner_id = su.id
        WHERE p.enabled = true ${productScopeSql}
      `, productScopeParams);
      const visibleProductIds = new Set(products.map((product) => product.id));

      const { rows: skus } = await client.query(`
        SELECT id, product_id, model, bom_code FROM product_sku WHERE enabled = true
      `);
      const skuNormalized = new Map<string, { id: string; productId: string; model: string; bomCode: string }>();
      skus.filter((sku) => visibleProductIds.has(sku.product_id)).forEach(s => skuNormalized.set(normalizeText(s.model), {
        id: s.id,
        productId: s.product_id,
        model: s.model,
        bomCode: s.bom_code,
      }));

      const { rows: regions } = await client.query(`
        SELECT id, name FROM org_node WHERE node_type = 'REGION' AND enabled = true
      `);
      const regionNormalized = new Map<string, { id: string; name: string }>();
      regions.forEach(r => regionNormalized.set(normalizeText(r.name), r));

      const { rows: offices } = await client.query(`
        SELECT id, name, parent_id FROM org_node WHERE node_type = 'OFFICE' AND enabled = true
      `);
      const officeNormalized = new Map<string, { id: string; name: string; parent_id: string }>();
      offices.forEach(o => officeNormalized.set(normalizeText(o.name), o));

      const { rows: countries } = await client.query(`
        SELECT id, name, parent_id FROM org_node WHERE node_type = 'COUNTRY' AND enabled = true
      `);
      const countryNormalized = new Map<string, { id: string; name: string; officeId: string }>();
      countries.forEach(c => countryNormalized.set(normalizeText(c.name), { ...c, officeId: c.parent_id }));

      // 获取已确认需求事实，匹配口径固定为SKU + 区域 + 代表处。
      const { rows: confirmedDemand } = await client.query(`
        SELECT product_sku_id as sku_id, region_id, office_id, SUM(quantity) as demand
        FROM execution_fact
        WHERE source_type = 'CONFIRMED_DEMAND'
        GROUP BY product_sku_id, region_id, office_id
      `);

      // 处理每一行
      const seenFingerprints = new Set<string>();
      const executionFacts: any[] = [];

      for (let i = 0; i < input.rows.length; i++) {
        const row = input.rows[i];
        const rowNo = i + 1;
        const rawId = crypto.randomUUID();

        // 生成行指纹去重
        const fingerprint = crypto.createHash('md5').update(
          `${row.externalKey || ''}|${row.applicationNo || ''}|${row.sku}|${row.region}|${row.office}|${row.shippedAt || ''}|${row.shippedQty}`
        ).digest('hex');

        const { rows: importedFingerprint } = await client.query(
          "SELECT id FROM tsmp_shipment_raw WHERE row_fingerprint = $1 AND match_status = 'MATCHED' LIMIT 1",
          [fingerprint]
        );
        if (seenFingerprints.has(fingerprint) || importedFingerprint.length > 0) {
          duplicateRows++;
          await client.query(`
            INSERT INTO tsmp_shipment_raw (id, import_job_id, source_row_no, external_key, application_no, raw_sku, raw_bom, raw_region, raw_office, raw_country, shipped_quantity, shipped_at, row_fingerprint, raw_payload, match_status, match_reason)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, 'DUPLICATE', '重复数据')
          `, [rawId, jobId, rowNo, row.externalKey, row.applicationNo, row.sku, row.bomCode, row.region, row.office, row.country, row.shippedQty, row.shippedAt, fingerprint, JSON.stringify(row)]);
          continue;
        }
        seenFingerprints.add(fingerprint);

        // 匹配SKU
        const skuMatch = skuNormalized.get(normalizeText(row.sku));
        // 匹配区域
        const regionMatch = regionNormalized.get(normalizeText(row.region));
        // 匹配代表处
        const officeMatch = officeNormalized.get(normalizeText(row.office));
        const countryMatch = row.country ? countryNormalized.get(normalizeText(row.country)) : undefined;

        let matchStatus: 'MATCHED' | 'MAPPING_REQUIRED' | 'UNMATCHED' | 'DUPLICATE' | 'INVALID' = 'MATCHED';
        let matchReason = '';

        if (!skuMatch) {
          matchStatus = 'UNMATCHED';
          matchReason = 'SKU未匹配或不在当前备货负责范围';
          unmatchedRows++;
        } else if (!regionMatch || !officeMatch) {
          matchStatus = 'MAPPING_REQUIRED';
          matchReason = !regionMatch ? '区域未匹配' : '代表处未匹配';
          mappingRequiredRows++;
        } else if (officeMatch.parent_id !== regionMatch.id) {
          matchStatus = 'MAPPING_REQUIRED';
          matchReason = '代表处不属于所选区域';
          mappingRequiredRows++;
        } else if (countryMatch && countryMatch.officeId !== officeMatch.id) {
          matchStatus = 'MAPPING_REQUIRED';
          matchReason = '国家/地区不属于所选代表处';
          mappingRequiredRows++;
        } else {
          // 检查是否有关联的确认需求
          const hasDemand = confirmedDemand.some(d =>
            d.sku_id === skuMatch.id && d.region_id === regionMatch.id && d.office_id === officeMatch.id
          );
          if (!hasDemand) {
            matchStatus = 'MAPPING_REQUIRED';
            matchReason = '未找到匹配的确认需求';
            mappingRequiredRows++;
          } else {
            matchedRows++;
            // 写入执行事实
            executionFacts.push({
              sourceType: 'SHIPMENT',
              sourceId: rawId,
              productId: skuMatch.productId,
              productSkuId: skuMatch.id,
              regionId: regionMatch.id,
              officeId: officeMatch?.id,
              countryId: countryMatch?.id,
              quantity: row.shippedQty,
              occurredAt: row.shippedAt || new Date().toISOString(),
              dimensionSnapshot: JSON.stringify({ importJobId: jobId, applicationNo: row.applicationNo, externalKey: row.externalKey }),
            });
          }
        }

        // 保存原始行
        await client.query(`
          INSERT INTO tsmp_shipment_raw (id, import_job_id, source_row_no, external_key, application_no, raw_sku, raw_bom, raw_region, raw_office, raw_country, shipped_quantity, shipped_at, row_fingerprint, raw_payload, match_status, match_reason)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
        `, [rawId, jobId, rowNo, row.externalKey, row.applicationNo, row.sku, row.bomCode, row.region, row.office, row.country, row.shippedQty, row.shippedAt, fingerprint, JSON.stringify(row), matchStatus, matchReason]);
      }

      // 批量写入执行事实
      for (const fact of executionFacts) {
        await client.query(`
          INSERT INTO execution_fact (id, source_type, source_id, product_id, product_sku_id, region_id, office_id, country_id, quantity, occurred_at, dimension_snapshot)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        `, [crypto.randomUUID(), fact.sourceType, fact.sourceId, fact.productId, fact.productSkuId, fact.regionId, fact.officeId, fact.countryId, fact.quantity, fact.occurredAt, fact.dimensionSnapshot]);
      }

      // 更新导入任务状态
      await client.query(`
        UPDATE tsmp_import_job
        SET status = 'COMPLETED', matched_rows = $1, mapping_required_rows = $2, unmatched_rows = $3, duplicate_rows = $4, completed_at = NOW()
        WHERE id = $5
      `, [matchedRows, mappingRequiredRows, unmatchedRows, duplicateRows, jobId]);

      await client.query('COMMIT');

      return {
        id: jobId,
        fileName: input.fileName,
        status: 'COMPLETED',
        totalRows,
        matchedRows,
        mappingRequiredRows,
        unmatchedRows,
        duplicateRows,
        importedBy: userId,
        createdAt: new Date().toISOString(),
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  },

  // 获取执行数据
  async getExecutionView(filters: ExecutionQueryInput, actor?: { role: string; userId: string }): Promise<ExecutionView> {
    const conditions: string[] = [];
    const params: any[] = [];

    if (filters.productId && filters.productId !== 'all') {
      params.push(filters.productId);
      conditions.push(`p.id = $${params.length}`);
    }
    if (filters.regionId) {
      params.push(filters.regionId);
      conditions.push(`(ef.source_type IN ('PRODUCTION', 'INVENTORY') OR ef.region_id = $${params.length})`);
    }
    if (filters.officeId) {
      params.push(filters.officeId);
      conditions.push(`(ef.source_type IN ('PRODUCTION', 'INVENTORY') OR ef.office_id = $${params.length})`);
    }
    if (filters.country) {
      params.push(filters.country);
      conditions.push(`(ef.source_type IN ('PRODUCTION', 'INVENTORY') OR ef.country_id IN (SELECT id FROM org_node WHERE id = $${params.length} OR name = $${params.length}))`);
    }
    if (filters.keyword) {
      params.push(`%${filters.keyword}%`);
      conditions.push(`(p.name ILIKE $${params.length} OR ps.model ILIKE $${params.length} OR ps.bom_code ILIKE $${params.length})`);
    }
    if (actor?.role === ROLES.GTM) {
      params.push(actor.userId);
      conditions.push(`pd.gtm_owner_id = $${params.length}`);
    } else if (actor?.role === ROLES.MSS_DOMAIN_OWNER) {
      params.push(actor.userId);
      conditions.push(`EXISTS (
        SELECT 1 FROM collection_plan cp JOIN mss_domain md ON cp.mss_domain_id = md.id
        WHERE cp.product_id = p.id AND md.mss_owner_id = $${params.length}
      )`);
    } else if (actor?.role === ROLES.STOCKING_OWNER) {
      params.push(actor.userId);
      conditions.push(`pd.stocking_owner_id = $${params.length}`);
    } else if (actor?.role === ROLES.REGIONAL_OWNER) {
      params.push(actor.userId);
      conditions.push(`(
        ef.region_id IN (SELECT region.id FROM org_node region WHERE region.node_type = 'REGION' AND region.owner_id = $${params.length})
        OR ef.office_id IN (SELECT office.id FROM org_node office WHERE office.node_type = 'OFFICE' AND office.owner_id = $${params.length})
      )`);
      conditions.push(`EXISTS (
        SELECT 1 FROM collection_plan cp JOIN user_scope_assignment usa ON usa.scope_id = cp.mss_domain_id
        WHERE cp.product_id = p.id AND usa.user_id = $${params.length} AND usa.scope_type = 'MSS_DOMAIN'
      )`);
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    // 聚合数据
    const { rows: aggregated } = await query(`
      SELECT
        p.id as product_id,
        p.name as product_name,
        pd.name as domain_name,
        gu.display_name as gtm_name,
        su.display_name as stocking_owner_name,
        (SELECT COUNT(*) FROM product_sku count_sku WHERE count_sku.product_id = p.id AND count_sku.enabled = true) as sku_count,
        ps.id as sku_id,
        ps.model as sku_model,
        ps.bom_code as bom_code,
        SUM(CASE WHEN ef.source_type = 'CONFIRMED_DEMAND' THEN ef.quantity ELSE 0 END) as demand,
        SUM(CASE WHEN ef.source_type = 'PRODUCTION' THEN ef.quantity ELSE 0 END) as stocked,
        SUM(CASE WHEN ef.source_type = 'APPLICATION' THEN ef.quantity ELSE 0 END) as applied,
        SUM(CASE WHEN ef.source_type = 'SHIPMENT' THEN ef.quantity ELSE 0 END) as shipped,
        SUM(CASE WHEN ef.source_type = 'INVENTORY' THEN ef.quantity ELSE 0 END) as inventory,
        COUNT(DISTINCT CASE WHEN ef.source_type = 'SHIPMENT' THEN ef.id END) as shipment_count
      FROM execution_fact ef
      JOIN product p ON ef.product_id = p.id
      JOIN product_domain pd ON p.domain_id = pd.id
      JOIN app_user gu ON pd.gtm_owner_id = gu.id
      JOIN app_user su ON pd.stocking_owner_id = su.id
      LEFT JOIN product_sku ps ON ef.product_sku_id = ps.id
      ${whereClause}
      GROUP BY p.id, p.name, pd.name, gu.display_name, su.display_name, ps.id, ps.model, ps.bom_code
      ORDER BY p.name, ps.model
    `, params);

    // 按产品分组
    const productsMap = new Map<string, ExecutionProduct>();
    let totalDemand = 0;
    let totalStocked = 0;
    let totalApplied = 0;
    let totalShipped = 0;
    let totalInventory = 0;
    let totalShipments = 0;

    for (const row of aggregated) {
      const demand = Number(row.demand) || 0;
      const stocked = Number(row.stocked) || 0;
      const applied = Number(row.applied) || 0;
      const shipped = Number(row.shipped) || 0;
      const inventory = Number(row.inventory) || 0;
      const shipmentCount = Number(row.shipment_count) || 0;

      totalDemand += demand;
      totalStocked += stocked;
      totalApplied += applied;
      totalShipped += shipped;
      totalInventory += inventory;
      totalShipments += shipmentCount;

      if (!productsMap.has(row.product_id)) {
        productsMap.set(row.product_id, {
          id: row.product_id,
          name: row.product_name,
          domain: row.domain_name,
          gtm: row.gtm_name,
          stockingOwner: row.stocking_owner_name,
          skuCount: Number(row.sku_count) || 0,
          metrics: { demand: 0, stocked: 0, applied: 0, shipped: 0, inventory: 0, shipmentCount: 0 },
          skus: [],
        });
      }

      const product = productsMap.get(row.product_id)!;
      product.metrics.demand += demand;
      product.metrics.stocked += stocked;
      product.metrics.applied += applied;
      product.metrics.shipped += shipped;
      product.metrics.inventory += inventory;
      product.metrics.shipmentCount += shipmentCount;

      if (row.sku_id) {
        product.skus.push({
          id: row.sku_id,
          sku: row.sku_model,
          bom: row.bom_code || '待补充',
          demand,
          stocked,
          applied,
          shipped,
          inventory,
          shipmentCount,
        });
      }
    }

    // 构建范围标签
    let scopeLabel = '全球MSS';
    if (filters.regionId) {
      const { rows: regionRows } = await query('SELECT name FROM org_node WHERE id = $1', [filters.regionId]);
      if (regionRows.length > 0) {
        scopeLabel = regionRows[0].name;
        if (filters.officeId) {
          const { rows: officeRows } = await query('SELECT name FROM org_node WHERE id = $1', [filters.officeId]);
          if (officeRows.length > 0) {
            scopeLabel += ` / ${officeRows[0].name}`;
            if (filters.country) {
              scopeLabel += ` / ${filters.country}`;
            }
          }
        }
      }
    }

    return {
      scopeLabel,
      metrics: {
        demand: totalDemand,
        stocked: totalStocked,
        applied: totalApplied,
        shipped: totalShipped,
        remainingToApply: Math.max(0, totalDemand - totalApplied),
        remainingToShip: Math.max(0, totalApplied - totalShipped),
        demandApplyRate: totalDemand > 0 ? Math.round((totalApplied / totalDemand) * 1000) / 10 : null,
        applyShipRate: totalApplied > 0 ? Math.round((totalShipped / totalApplied) * 1000) / 10 : null,
        shipmentCount: totalShipments,
      },
      products: Array.from(productsMap.values()),
    };
  },

  // 获取最近导入任务
  async getLatestImportJobs(limit: number = 5, actor?: { role: string; userId: string }): Promise<ImportJob[]> {
    const ownerFilter = actor?.role === ROLES.STOCKING_OWNER ? 'WHERE ij.imported_by = $2' : '';
    const params = actor?.role === ROLES.STOCKING_OWNER ? [limit, actor.userId] : [limit];
    const { rows } = await query(`
      SELECT ij.id, ij.file_name, ij.status, ij.total_rows, ij.matched_rows, ij.mapping_required_rows, ij.unmatched_rows, ij.duplicate_rows, ij.imported_by, ij.created_at, au.display_name as importer_name
      FROM tsmp_import_job ij
      LEFT JOIN app_user au ON ij.imported_by = au.id
      ${ownerFilter}
      ORDER BY ij.created_at DESC
      LIMIT $1
    `, params);

    return rows.map(r => ({
      id: r.id,
      fileName: r.file_name,
      status: r.status,
      totalRows: Number(r.total_rows),
      matchedRows: Number(r.matched_rows),
      mappingRequiredRows: Number(r.mapping_required_rows),
      unmatchedRows: Number(r.unmatched_rows),
      duplicateRows: Number(r.duplicate_rows),
      importedBy: r.importer_name || r.imported_by,
      createdAt: r.created_at,
    }));
  }
};
