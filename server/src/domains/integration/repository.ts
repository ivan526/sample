import { createHash, randomUUID } from 'node:crypto';
import { getClient, getDbType, query, type DbClient } from '../../config/db.js';
import { ForbiddenError, ValidationError, VersionConflictError } from '../../shared/errors.js';
import { ROLES } from '../../shared/types.js';
import type { DemandQuery, ShipmentIncrement } from './schemas.js';
import { metadataKeys, recordShipment, deliveryRecord, writeShipmentCall } from './shipment-records.js';
import { effectiveDemandItems } from '../../shared/demand-geography.js';
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
const parse = (value: any) => typeof value === 'string' ? JSON.parse(value) : value || {};
// Canonical shipment-only payload also recognizes deliveries made before the
// stockedQuantity field was retired. The same key must never ship twice.
function shipmentPayload(value: any) {
  const metadata: Record<string, any> = {};
  for (const key of metadataKeys) if (value[key] !== undefined && value[key] !== '') metadata[key] = value[key];
  return { productId: value.productId, skuId: value.skuId, mssDomainId: value.mssDomainId,
    regionId: value.regionId, officeId: value.officeId, countryId: value.countryId,
    ...(value.stage ? { stage: value.stage } : {}), shippedQuantity: value.shippedQuantity, ...metadata };
}
const shipmentHash = (value: any) => createHash('sha256').update(JSON.stringify(shipmentPayload(value))).digest('hex');

// Select a whole formal collection batch before geographic filtering. Missing
// countries in the new batch must never fall back to an older positive record.
export async function latestDemandFacts(input: DemandQuery, sku: any, db: Reader = { query }) {
  const params: any[] = [sku.product_id];
  let stage = '';
  if (input.stage) { params.push(input.stage); stage = ' AND plan.sample_stage = $2'; }
  const { rows: candidates } = await db.query<any>(`SELECT plan.* FROM collection_plan plan
    WHERE plan.product_id = $1 AND plan.cancelled_at IS NULL ${stage}
      AND EXISTS (SELECT 1 FROM collection_plan_domain_task task JOIN collection_plan_domain_feedback feedback ON feedback.domain_task_id = task.id WHERE task.plan_id = plan.id)
    ORDER BY plan.created_at DESC, plan.id DESC`, params);
  let plan: any = null;
  for (const candidate of candidates) {
    const { rows: snapshots } = await db.query<any>(`SELECT feedback.summary_snapshot FROM collection_plan_domain_feedback feedback
      JOIN collection_plan_domain_task task ON task.id = feedback.domain_task_id WHERE task.plan_id = $1`, [candidate.id]);
    if (snapshots.some((snapshot) => (parse(snapshot.summary_snapshot).items || []).some((item: any) => item.product_sku_id === sku.id))) { plan = candidate; break; }
  }
  if (!plan) return { plan: null, facts: [] as any[] };
  const { rows: facts } = await db.query<any>(`SELECT ef.*, COALESCE(ef.collection_plan_id, task.plan_id) AS effective_plan_id
    FROM execution_fact ef LEFT JOIN collection_plan_domain_task task ON task.id = ef.source_id
    WHERE ef.product_sku_id = $1 AND COALESCE(ef.collection_plan_id, task.plan_id) = $2`, [sku.id, plan.id]);
  return { plan, facts };
}

function scopedFacts(input: DemandQuery, scope: Awaited<ReturnType<typeof resolve>>, facts: any[]) {
  const countryOffices = new Set(scope.countries.map((country) => country.parent_id));
  return facts.filter((fact) => (!input.mssDomain || scope.domains.some((node) => node.id === fact.mss_domain_id))
    && (!input.region || scope.regions.some((node) => node.id === fact.region_id))
    && (!input.office || scope.offices.some((node) => node.id === fact.office_id))
    && (!input.country || countryOffices.has(fact.office_id)));
}
function countryEligible(fact: any, countries: any[]) {
  const allowed = parse(fact.dimension_snapshot).eligibleCountryIds;
  return countries.some((country) => country.parent_id === fact.office_id && (!Array.isArray(allowed) || allowed.includes(country.id)));
}
export async function getStockingDemand(input: DemandQuery, actor: Actor) {
  const scope = await resolve(input, actor);
  const { plan, facts } = await latestDemandFacts(input, scope.sku);
  const scoped = scopedFacts(input, scope, facts);
  const demandRows = effectiveDemandItems(scoped.filter((fact) => fact.source_type === 'CONFIRMED_DEMAND'));
  const selectedCountries = new Set(scope.countries.map((node) => node.id));
  const demand = demandRows.filter((fact) => !input.country || (fact.country_id ? selectedCountries.has(fact.country_id) : countryEligible(fact, scope.countries)));
  const shared = demand.filter((fact) => !fact.country_id);
  const sharedKeys = new Set(shared.map((fact) => `${fact.mss_domain_id}:${fact.office_id}`));
  const execution = scoped.filter((fact) => fact.source_type !== 'CONFIRMED_DEMAND' && (!input.country || selectedCountries.has(fact.country_id)
    || sharedKeys.has(`${fact.mss_domain_id}:${fact.office_id}`)));
  const sum = (rows: any[]) => rows.reduce((total, fact) => total + Number(fact.quantity || 0), 0);
  const count = (type: string) => sum(execution.filter((fact) => fact.source_type === type));
  const demandQuantity = sum(demand), appliedQuantity = count('APPLICATION');
  return {
    productModel: scope.sku.model, bomCode: scope.sku.bom_code,
    filters: { mssDomain: input.mssDomain || null, region: input.region || null, office: input.office || null, country: input.country || null, stage: input.stage || null },
    planId: plan?.id || null, planNo: plan?.plan_no || null, stage: plan?.sample_stage || null,
    demandQuantity, appliedQuantity, shippedQuantity: count('SHIPMENT'),
    remainingToApply: Math.max(0, demandQuantity - appliedQuantity),
    quotaMode: !input.country ? 'AGGREGATE' : shared.length ? demand.some((fact) => fact.country_id) ? 'MIXED' : 'OFFICE_SHARED' : 'COUNTRY',
    officeUnallocatedDemandQuantity: input.country ? sum(shared) : 0,
    officeUnallocatedAppliedQuantity: input.country ? sum(execution.filter((fact) => fact.source_type === 'APPLICATION' && sharedKeys.has(`${fact.mss_domain_id}:${fact.office_id}`))) : 0,
  };
}
let sqliteWrites: Promise<void> = Promise.resolve();
async function serialized<T>(work: () => Promise<T>): Promise<T> {
  if (getDbType() !== 'sqlite') return work();
  const previous = sqliteWrites;
  let unlock!: () => void;
  sqliteWrites = new Promise<void>((resolve) => { unlock = resolve; });
  await previous;
  try { return await work(); } finally { unlock(); }
}
export async function logShipmentFailure(input: unknown, key: string, actor: Actor, requestId: string, error: any) {
  return serialized(() => writeShipmentCall({ query }, actor, requestId, key, input, 'FAILURE', error.code || 'INTERNAL_ERROR',
    error.status ? error.message : '服务暂时不可用'));
}
export async function appendShipment(input: ShipmentIncrement, key: string, actor: Actor, requestId: string) {
  return serialized(async () => {
    try { return await appendTransaction(input, key, actor, requestId); }
    catch (error: any) {
      await writeShipmentCall({ query }, actor, requestId, key, input, 'FAILURE', error.code || 'INTERNAL_ERROR', error.status ? error.message : '服务暂时不可用');
      throw error;
    }
  });
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
    const payload = shipmentPayload({ ...ids, ...input });
    const hash = shipmentHash(payload);
    const id = randomUUID();
    const result = { success: true, deliveryId: id, shippedQuantityAdded: input.shippedQuantity };
    const { rows: reserved } = await client.query(`INSERT INTO integration_delivery
      (id, actor_id, idempotency_key, request_hash, request_payload, response_payload)
      VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (actor_id, idempotency_key) DO NOTHING RETURNING id`,
      [id, actor.userId, key, hash, JSON.stringify({ ...input, ...ids }), JSON.stringify(result)]);
    if (!reserved.length) {
      const { rows: existing } = await client.query<any>('SELECT request_hash, request_payload, response_payload FROM integration_delivery WHERE actor_id = $1 AND idempotency_key = $2', [actor.userId, key]);
      if (existing[0].request_hash !== hash && shipmentHash(parse(existing[0].request_payload)) !== hash) throw new VersionConflictError('该业务流水号已用于不同的数据，请核对流水号和数量');
      const previous = parse(existing[0].response_payload);
      const record = await deliveryRecord(client, previous.deliveryId);
      await writeShipmentCall(client, actor, requestId, key, input, 'REPLAY', 'OK', '重复调用，未重复入账', record || { ...ids, handlerId: actor.userId, deliveryId: previous.deliveryId });
      await client.commit();
      return { success: true, deliveryId: previous.deliveryId, shippedQuantityAdded: previous.shippedQuantityAdded, replayed: true };
    }
    const { plan, facts } = await latestDemandFacts(input, scope.sku, client);
    const demand = effectiveDemandItems(facts.filter((fact) => fact.source_type === 'CONFIRMED_DEMAND'
      && fact.mss_domain_id === ids.mssDomainId && fact.region_id === ids.regionId && fact.office_id === ids.officeId));
    if (!demand.some((fact) => Number(fact.quantity) > 0 && (fact.country_id ? fact.country_id === ids.countryId : countryEligible(fact, scope.countries)))) {
      throw new ValidationError('最新计划中该国家未找到正数正式确认需求，请先完成领域反馈');
    }
    // Both increments share the delivery ID, dimensions, plan and transaction.
    for (const sourceType of ['APPLICATION', 'SHIPMENT'] as const) {
      const factId = randomUUID();
      await client.query(`INSERT INTO execution_fact
        (id,source_type,source_id,product_id,product_sku_id,mss_domain_id,region_id,office_id,country_id,quantity,occurred_at,dimension_snapshot,collection_plan_id)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [factId, sourceType, id, ids.productId, ids.skuId, ids.mssDomainId, ids.regionId, ids.officeId, ids.countryId, input.shippedQuantity, input.shippedAt || new Date().toISOString(),
          JSON.stringify({ source: 'INTEGRATION_API', idempotencyKey: key, actorId: actor.userId, planId: plan.id }), plan.id]);
      if (sourceType === 'SHIPMENT') await recordShipment(client, factId, actor.userId, actor.userId, {
        applicationNo: input.applicationNo || '', applicantName: input.applicantName || '', applicantEmployeeNo: input.applicantEmployeeNo || '',
        handlerName: input.handlerName || '', handlerEmployeeNo: input.handlerEmployeeNo || '',
        appliedAt: input.appliedAt || null, handledAt: input.handledAt || null, shippedAtSource: input.shippedAt ? 'PROVIDED' : 'RECEIVED_AT',
        shipmentNo: input.shipmentNo || '', sourceSystem: input.sourceSystem || 'INTEGRATION_API', note: input.note || '',
      });
    }
    await client.query(`INSERT INTO audit_log (id,actor_id,action,entity_type,entity_id,after_data,request_id)
      VALUES ($1,$2,'INTEGRATION_SHIPMENT_ADDED','INTEGRATION_DELIVERY',$3,$4,$5)`,
      [randomUUID(), actor.userId, id, JSON.stringify(payload), requestId]);
    await writeShipmentCall(client, actor, requestId, key, input, 'SUCCESS', 'OK', '入账成功', await deliveryRecord(client, id));
    await client.commit();
    return { ...result, replayed: false };
  } catch (error) { await client.rollback(); throw error; } finally { client.release(); }
}
