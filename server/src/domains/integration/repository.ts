import { createHash, randomUUID } from 'node:crypto';
import { getClient, getDbType, query, type DbClient } from '../../config/db.js';
import { ForbiddenError, ValidationError, VersionConflictError } from '../../shared/errors.js';
import { ROLES } from '../../shared/types.js';
import type { DemandQuery, ShipmentIncrement } from './schemas.js';
type Actor = { role: string; userId: string };
type Reader = Pick<DbClient, 'query'>;
const normalize = (value: string) => value.normalize('NFKC').trim().toLowerCase().replace(/[\s\u200B-\u200D\uFEFF]/gu, '');
const domainKey = (value: string) => normalize(value).replace(/(?:业务领域|领域|样机)$/u, '');
const matches = (value: string, item: any) => item.id === value || normalize(item.name) === normalize(value);

async function resolve(input: DemandQuery, actor: Actor, db: Reader = { query }) {
  const { rows: allSkus } = await db.query<any>(`SELECT sku.id, sku.model, sku.bom_code, p.id AS product_id,
    p.domain_id, pd.stocking_owner_id FROM product_sku sku
    JOIN product p ON p.id = sku.product_id JOIN product_domain pd ON pd.id = p.domain_id
    WHERE sku.enabled = true AND p.enabled = true AND pd.enabled = true`);
  const skus = allSkus.filter((sku) => normalize(sku.model) === normalize(input.productModel)
    && normalize(sku.bom_code || '') === normalize(input.bomCode));
  if (skus.length !== 1) throw new ValidationError(skus.length ? '产品型号与BOM组合不唯一，请先修正主数据' : '产品型号与BOM必须同时匹配同一启用型号');
  const sku = skus[0];
  if (actor.role !== ROLES.ADMIN) {
    const { rows: assigned } = await db.query(`SELECT scope_id FROM user_scope_assignment
      WHERE user_id = $1 AND scope_type = 'PRODUCT_DOMAIN' AND scope_id = $2`, [actor.userId, sku.domain_id]);
    if (actor.role !== ROLES.STOCKING_OWNER || (sku.stocking_owner_id !== actor.userId && !assigned.length)) {
      throw new ForbiddenError('无权访问该产品品类的备货需求');
    }
  }
  const { rows: domains } = await db.query<any>('SELECT id, name, code FROM mss_domain WHERE enabled = true');
  const selectedDomains = input.mssDomain ? domains.filter((domain) => matches(input.mssDomain!, domain)
    || normalize(domain.code) === normalize(input.mssDomain!)
    || domainKey(domain.name) === domainKey(input.mssDomain!) || domainKey(domain.code) === domainKey(input.mssDomain!)) : [];
  if (input.mssDomain && selectedDomains.length !== 1) throw new ValidationError('MSS领域不存在、已停用或名称不唯一，请使用领域ID或编码');
  const { rows: nodes } = await db.query<any>('SELECT id, name, parent_id, node_type FROM org_node WHERE enabled = true');
  const regions = nodes.filter((node) => node.node_type === 'REGION' && (!input.region || matches(input.region, node)));
  const regionIds = new Set(regions.map((node) => node.id));
  const offices = nodes.filter((node) => node.node_type === 'OFFICE' && regionIds.has(node.parent_id) && (!input.office || matches(input.office, node)));
  const officeIds = new Set(offices.map((node) => node.id));
  const countries = nodes.filter((node) => node.node_type === 'COUNTRY' && officeIds.has(node.parent_id) && (!input.country || matches(input.country, node)));
  if (input.region && !regions.length) throw new ValidationError('区域不存在或已停用');
  if (input.office && !offices.length) throw new ValidationError('代表处不存在、已停用或不属于所选区域');
  if (input.country && !countries.length) throw new ValidationError('国家不存在、已停用或不属于所选区域/代表处');
  return { sku, domains: selectedDomains, regions, offices, countries };
}
function filterSql(input: DemandQuery, scope: Awaited<ReturnType<typeof resolve>>) {
  const params: any[] = [scope.sku.id];
  const conditions = ['ef.product_sku_id = $1'];
  const addIds = (column: string, ids: string[]) => {
    conditions.push(`${column} IN (${ids.map((id) => { params.push(id); return `$${params.length}`; }).join(',')})`);
  };
  if (input.mssDomain) addIds('ef.mss_domain_id', scope.domains.map((item) => item.id));
  if (input.region) addIds('ef.region_id', scope.regions.map((item) => item.id));
  if (input.office) addIds('ef.office_id', scope.offices.map((item) => item.id));
  if (input.country) addIds('ef.country_id', scope.countries.map((item) => item.id));
  return { conditions, params };
}
export async function getStockingDemand(input: DemandQuery, actor: Actor) {
  const scope = await resolve(input, actor);
  const { conditions, params } = filterSql(input, scope);
  const { rows } = await query<any>(`SELECT
    COALESCE(SUM(CASE WHEN source_type = 'CONFIRMED_DEMAND' THEN quantity ELSE 0 END),0) AS demand,
    COALESCE(SUM(CASE WHEN source_type = 'APPLICATION' THEN quantity ELSE 0 END),0) AS applied,
    COALESCE(SUM(CASE WHEN source_type = 'PRODUCTION' THEN quantity ELSE 0 END),0) AS stocked,
    COALESCE(SUM(CASE WHEN source_type = 'SHIPMENT' THEN quantity ELSE 0 END),0) AS shipped
    FROM execution_fact ef WHERE ${conditions.join(' AND ')}`, params);
  let unallocatedDemand = 0, unallocatedApplied = 0;
  if (input.country) {
    const officeIds = [...new Set(scope.countries.map((item) => item.parent_id))];
    const unallocated = filterSql({ ...input, country: undefined, office: undefined }, scope);
    unallocated.conditions.push(`ef.country_id IS NULL AND ef.office_id IN (${officeIds.map((id) => {
      unallocated.params.push(id); return `$${unallocated.params.length}`;
    }).join(',')})`);
    const { rows: counts } = await query<any>(`SELECT
      COALESCE(SUM(CASE WHEN source_type = 'CONFIRMED_DEMAND' THEN quantity ELSE 0 END),0) AS demand,
      COALESCE(SUM(CASE WHEN source_type = 'APPLICATION' THEN quantity ELSE 0 END),0) AS applied
      FROM execution_fact ef WHERE ${unallocated.conditions.join(' AND ')}`, unallocated.params);
    unallocatedDemand = Number(counts[0].demand); unallocatedApplied = Number(counts[0].applied);
  }
  const data = rows[0];
  return {
    productModel: scope.sku.model, bomCode: scope.sku.bom_code,
    filters: { mssDomain: input.mssDomain || null, region: input.region || null, office: input.office || null, country: input.country || null },
    demandQuantity: Number(data.demand), appliedQuantity: Number(data.applied), stockedQuantity: Number(data.stocked), shippedQuantity: Number(data.shipped),
    remainingToApply: Math.max(0, Number(data.demand) - Number(data.applied)),
    officeUnallocatedDemandQuantity: unallocatedDemand, officeUnallocatedAppliedQuantity: unallocatedApplied,
  };
}
let sqliteWrites: Promise<void> = Promise.resolve();
export async function appendShipment(input: ShipmentIncrement, key: string, actor: Actor, requestId: string) {
  // SQLite shares one connection; serialize this endpoint's transactions. PG
  // relies on the unique key to arbitrate concurrent requests across processes.
  if (getDbType() !== 'sqlite') return appendTransaction(input, key, actor, requestId);
  const previous = sqliteWrites;
  let unlock!: () => void;
  sqliteWrites = new Promise<void>((resolve) => { unlock = resolve; });
  await previous;
  try { return await appendTransaction(input, key, actor, requestId); } finally { unlock(); }
}
async function appendTransaction(input: ShipmentIncrement, key: string, actor: Actor, requestId: string) {
  const client = await getClient();
  try {
    await client.begin();
    const scope = await resolve(input, actor, client);
    if (scope.regions.length !== 1 || scope.offices.length !== 1 || scope.countries.length !== 1) {
      throw new ValidationError('写入的区域、代表处、国家必须唯一，请使用对应组织ID消除重名');
    }
    const ids = { productId: scope.sku.product_id, skuId: scope.sku.id, mssDomainId: scope.domains[0].id,
      regionId: scope.regions[0].id, officeId: scope.offices[0].id, countryId: scope.countries[0].id };
    const payload = { ...ids, stockedQuantity: input.stockedQuantity, shippedQuantity: input.shippedQuantity };
    const hash = createHash('sha256').update(JSON.stringify(payload)).digest('hex');
    const id = randomUUID();
    const result = { success: true, deliveryId: id, stockedQuantityAdded: input.stockedQuantity, shippedQuantityAdded: input.shippedQuantity };
    const { rows: reserved } = await client.query(`INSERT INTO integration_delivery
      (id, actor_id, idempotency_key, request_hash, request_payload, response_payload)
      VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (actor_id, idempotency_key) DO NOTHING RETURNING id`,
      [id, actor.userId, key, hash, JSON.stringify({ ...input, ...ids }), JSON.stringify(result)]);
    if (!reserved.length) {
      const { rows: existing } = await client.query<any>('SELECT request_hash, response_payload FROM integration_delivery WHERE actor_id = $1 AND idempotency_key = $2', [actor.userId, key]);
      if (existing[0].request_hash !== hash) throw new VersionConflictError('该业务流水号已用于不同的数据，请核对流水号和数量');
      await client.commit();
      return { ...JSON.parse(existing[0].response_payload), replayed: true };
    }
    const { rows: demand } = await client.query(`SELECT id FROM execution_fact WHERE source_type = 'CONFIRMED_DEMAND'
      AND product_sku_id = $1 AND mss_domain_id = $2 AND region_id = $3 AND office_id = $4
      AND (country_id IS NULL OR country_id = $5) AND quantity > 0 LIMIT 1`,
      [ids.skuId, ids.mssDomainId, ids.regionId, ids.officeId, ids.countryId]);
    if (!demand.length) throw new ValidationError('该领域、区域、代表处、型号未找到正式确认需求，请先完成领域反馈');
    for (const [type, quantity] of [['PRODUCTION', input.stockedQuantity], ['SHIPMENT', input.shippedQuantity]] as const) {
      if (!quantity) continue;
      await client.query(`INSERT INTO execution_fact
        (id,source_type,source_id,product_id,product_sku_id,mss_domain_id,region_id,office_id,country_id,quantity,occurred_at,dimension_snapshot)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW(),$11)`,
        [randomUUID(), type, id, ids.productId, ids.skuId, ids.mssDomainId, ids.regionId, ids.officeId, ids.countryId, quantity,
          JSON.stringify({ source: 'INTEGRATION_API', idempotencyKey: key, actorId: actor.userId })]);
    }
    await client.query(`INSERT INTO audit_log (id,actor_id,action,entity_type,entity_id,after_data,request_id)
      VALUES ($1,$2,'INTEGRATION_SHIPMENT_ADDED','INTEGRATION_DELIVERY',$3,$4,$5)`,
      [randomUUID(), actor.userId, id, JSON.stringify(payload), requestId]);
    await client.commit();
    return { ...result, replayed: false };
  } catch (error) { await client.rollback(); throw error; } finally { client.release(); }
}
