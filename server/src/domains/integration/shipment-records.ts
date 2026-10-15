import { randomUUID } from 'node:crypto';
import { query, type DbClient } from '../../config/db.js';
import { ForbiddenError, ValidationError } from '../../shared/errors.js';
import type { ShipmentRead, ShipmentIncrement } from './schemas.js';
export type ShipmentActor = { role: string; userId: string };
type Reader = Pick<DbClient, 'query'>;
const parse = (v: any) => typeof v === 'string' ? JSON.parse(v) : v || {};
const text = (v: any, max = 256) => typeof v === 'string' ? v.trim().slice(0, max) : '';
export const metadataKeys = ['applicationNo','applicantName','applicantEmployeeNo','shipmentNo','handlerEmployeeNo','shippedAt','sourceSystem','note'] as const;

export async function resolveHandler(input: ShipmentIncrement, actor: ShipmentActor, domainId: string, db: Reader) {
  const { rows } = await db.query<any>(`SELECT id,employee_no,display_name,role FROM app_user WHERE enabled=true AND ${input.handlerEmployeeNo ? 'employee_no=$1' : 'id=$1'}`,
    [input.handlerEmployeeNo || actor.userId]);
  const user = rows[0];
  if (!user) throw new ValidationError('实际处理人不存在或已停用');
  if (user.id !== actor.userId) {
    if (actor.role !== 'ADMIN') throw new ForbiddenError('备货接口人只能记录本人处理的发货');
    const { rows: allowed } = await db.query(`SELECT id FROM product_domain WHERE id=$1 AND
      (stocking_owner_id=$2 OR EXISTS (SELECT 1 FROM user_scope_assignment WHERE user_id=$2 AND scope_type='PRODUCT_DOMAIN' AND scope_id=$1))`, [domainId,user.id]);
    if (user.role !== 'STOCKING_OWNER' || !allowed.length) throw new ForbiddenError('指定处理人不是该产品获授权的备货接口人');
  }
  return user;
}

// Names and actual handler are frozen when the business shipment is recorded.
export async function recordShipment(db: Reader, factId: string, handlerId: string, callerId: string, metadata: Record<string, any>) {
  const { rows } = await db.query<any>(`SELECT p.name AS product_name,sku.model,sku.bom_code,md.name AS domain_name,
    r.name AS region_name,o.name AS office_name,c.name AS country_name,cp.sample_stage AS stage,cp.plan_no,
    u.display_name AS handler_name,u.employee_no AS handler_employee_no
    FROM execution_fact ef JOIN product p ON p.id=ef.product_id LEFT JOIN product_sku sku ON sku.id=ef.product_sku_id
    LEFT JOIN mss_domain md ON md.id=ef.mss_domain_id LEFT JOIN org_node r ON r.id=ef.region_id
    LEFT JOIN org_node o ON o.id=ef.office_id LEFT JOIN org_node c ON c.id=ef.country_id
    LEFT JOIN collection_plan cp ON cp.id=ef.collection_plan_id LEFT JOIN app_user u ON u.id=$2 WHERE ef.id=$1`, [factId,handlerId]);
  const row = rows[0];
  const snapshot = { productName: row.product_name, productModel: row.model, bomCode: row.bom_code,
    mssDomainName: row.domain_name,regionName: row.region_name,officeName: row.office_name,countryName: row.country_name,
    stage: row.stage,planNo: row.plan_no,handlerName: row.handler_name,handlerEmployeeNo: row.handler_employee_no, ...metadata };
  await db.query(`INSERT INTO shipment_record(fact_id,handler_user_id,caller_user_id,metadata) VALUES($1,$2,$3,$4)`,
    [factId,handlerId,callerId,JSON.stringify(snapshot)]);
}
const recordSelect = `SELECT ef.*,sr.metadata,COALESCE(sr.handler_user_id,d.actor_id,j.imported_by) AS handler_id,
  COALESCE(sr.caller_user_id,d.actor_id,j.imported_by) AS caller_id, p.name AS product_name,p.domain_id AS product_domain_id,
  sku.model,sku.bom_code,md.name AS domain_name,r.name AS region_name,o.name AS office_name,c.name AS country_name,
  cp.sample_stage AS stage,cp.plan_no, u.display_name AS handler_name,u.employee_no AS handler_employee_no,
  raw.id AS tsmp_raw_id,raw.application_no,raw.external_key,d.idempotency_key,raw.raw_payload,
  d.request_payload, pd.gtm_owner_id
  FROM execution_fact ef JOIN product p ON p.id=ef.product_id JOIN product_domain pd ON pd.id=p.domain_id
  LEFT JOIN shipment_record sr ON sr.fact_id=ef.id LEFT JOIN integration_delivery d ON d.id=ef.source_id
  LEFT JOIN tsmp_shipment_raw raw ON raw.id=ef.source_id LEFT JOIN tsmp_import_job j ON j.id=raw.import_job_id
  LEFT JOIN app_user u ON u.id=COALESCE(sr.handler_user_id,d.actor_id,j.imported_by)
  LEFT JOIN product_sku sku ON sku.id=ef.product_sku_id LEFT JOIN mss_domain md ON md.id=ef.mss_domain_id
  LEFT JOIN org_node r ON r.id=ef.region_id LEFT JOIN org_node o ON o.id=ef.office_id LEFT JOIN org_node c ON c.id=ef.country_id
  LEFT JOIN collection_plan cp ON cp.id=ef.collection_plan_id`;
function scopeSQL(actor: ShipmentActor, handler: string, productDomain: string, gtm: string) {
  if (actor.role === 'ADMIN') return { sql: '1=1', params: [] as any[] };
  if (actor.role === 'STOCKING_OWNER') return { sql: `${handler}=$1`, params: [actor.userId] };
  if (actor.role === 'GTM') return { sql: `(${gtm}=$1 OR EXISTS (SELECT 1 FROM user_scope_assignment usa WHERE usa.user_id=$1 AND usa.scope_type='PRODUCT_DOMAIN' AND usa.scope_id=${productDomain}))`, params: [actor.userId] };
  throw new ForbiddenError();
}
function mapRecord(row: any) {
  const meta = parse(row.metadata), legacy = { ...parse(row.raw_payload), ...parse(row.request_payload), ...parse(row.dimension_snapshot) };
  return { id: row.id, deliveryId: row.idempotency_key ? row.source_id : null, planId: row.collection_plan_id,
    productId: row.product_id,skuId: row.product_sku_id,mssDomainId: row.mss_domain_id,
    regionId: row.region_id,officeId: row.office_id,countryId: row.country_id,handlerId: row.handler_id,callerId: row.caller_id,
    productName: row.product_name,productModel: row.model,bomCode: row.bom_code,mssDomainName: row.domain_name,
    regionName: row.region_name,officeName: row.office_name,countryName: row.country_name,stage: row.stage,planNo: row.plan_no,
    handlerName: row.handler_name,handlerEmployeeNo: row.handler_employee_no,
    applicationNo: row.application_no || legacy.applicationNo || '',applicantName: legacy.applicantName || '',applicantEmployeeNo: legacy.applicantEmployeeNo || '',
    shipmentNo: legacy.shipmentNo || row.external_key || '',shippedAt: new Date(row.occurred_at).toISOString(),
    sourceSystem: row.idempotency_key ? 'INTEGRATION_API' : row.tsmp_raw_id ? 'TSMP' : '历史数据',
    idempotencyKey: row.idempotency_key || '', ...meta, shippedQuantity: Number(row.quantity) };
}
async function scopedRecords(actor: ShipmentActor, db: Reader = { query }) {
  const scope = scopeSQL(actor,'COALESCE(sr.handler_user_id,d.actor_id,j.imported_by)','p.domain_id','pd.gtm_owner_id');
  return (await db.query<any>(`${recordSelect} WHERE ef.source_type='SHIPMENT' AND ${scope.sql}`,scope.params)).rows.map(mapRecord);
}

export async function writeShipmentCall(db: Reader, actor: ShipmentActor, requestId: string, key: string, input: any,
  outcome: 'SUCCESS'|'REPLAY'|'FAILURE', code: string, message: string, record?: any) {
  const safe: any = {};
  for (const k of ['productModel','bomCode','mssDomain','region','office','country','stage',...metadataKeys]) safe[k] = text(input?.[k], k === 'note' ? 2000 : 256);
  if (!safe.shippedAt || Number.isNaN(Date.parse(safe.shippedAt))) delete safe.shippedAt;
  safe.sourceSystem ||= 'INTEGRATION_API';
  safe.requestedQuantity = typeof input?.shippedQuantity === 'number' && Number.isFinite(input.shippedQuantity) ? input.shippedQuantity : null;
  safe.idempotencyKey = text(key,128);
  // Failed requests never trust a caller-supplied handler or guessed product.
  if (!record) {
    const { rows: users } = await db.query<any>('SELECT display_name,employee_no FROM app_user WHERE id=$1',[actor.userId]);
    record = { handlerId: actor.userId, handlerName: users[0]?.display_name, handlerEmployeeNo: users[0]?.employee_no };
    const norm = (v: string) => v.normalize('NFKC').toLowerCase().replace(/[\s\u200B-\u200D\uFEFF]/gu,'');
    const { rows: allSkus } = await db.query<any>('SELECT sku.id,sku.model,sku.bom_code,p.id AS product_id,p.name FROM product_sku sku JOIN product p ON p.id=sku.product_id');
    const skus = allSkus.filter(s=>norm(s.model)===norm(safe.productModel) && norm(s.bom_code || '')===norm(safe.bomCode));
    if (skus.length === 1) Object.assign(record,{productId:skus[0].product_id,productName:skus[0].name,skuId:skus[0].id});
    const { rows: nodes } = await db.query<any>('SELECT id,name,parent_id,node_type FROM org_node');
    for (const [key,type,parentKey] of [['region','REGION',''],['office','OFFICE','region'],['country','COUNTRY','office']]) {
      const matches = nodes.filter(n=>n.node_type===type && safe[key] && (n.id===safe[key] || norm(n.name)===norm(safe[key])) && (!parentKey || !record[parentKey+'Id'] || n.parent_id===record[parentKey+'Id']));
      if(matches.length===1) Object.assign(record,{[key+'Id']:matches[0].id,[key+'Name']:matches[0].name});
    }
    const { rows: domains } = await db.query<any>('SELECT id,name,code FROM mss_domain');
    const domainKey=(v:string)=>norm(v).replace(/(?:业务领域|领域|样机)$/u,'');
    const domainsMatched = domains.filter(d=>safe.mssDomain && (d.id===safe.mssDomain || domainKey(d.name)===domainKey(safe.mssDomain) || domainKey(d.code)===domainKey(safe.mssDomain)));
    if(domainsMatched.length===1) Object.assign(record,{mssDomainId:domainsMatched[0].id,mssDomainName:domainsMatched[0].name});
  }
  const added = outcome === 'SUCCESS' ? Number(record.shippedQuantity) : 0;
  await db.query(`INSERT INTO integration_shipment_call(id,request_id,actor_id,handler_user_id,product_id,delivery_id,outcome,quantity_added,code,message,snapshot)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,[randomUUID(),text(requestId),actor.userId,record.handlerId || null,
      record.productId || null,record.deliveryId || null,outcome,added,code,text(message,1000),JSON.stringify({...safe,...record})]);
}
export async function deliveryRecord(db: Reader, deliveryId: string) {
  const { rows } = await db.query<any>(`${recordSelect} WHERE ef.source_type='SHIPMENT' AND ef.source_id=$1`,[deliveryId]);
  return rows[0] ? mapRecord(rows[0]) : null;
}
async function scopedLogs(actor: ShipmentActor) {
  const scope = scopeSQL(actor,'l.handler_user_id','p.domain_id','pd.gtm_owner_id');
  const { rows } = await query<any>(`SELECT l.* FROM integration_shipment_call l LEFT JOIN product p ON p.id=l.product_id
    LEFT JOIN product_domain pd ON pd.id=p.domain_id WHERE ${scope.sql}`,scope.params);
  return rows.map(row => ({...parse(row.snapshot),id:row.id,requestId:row.request_id,callerId:row.actor_id,
    handlerId:row.handler_user_id,productId:row.product_id,deliveryId:row.delivery_id,
    outcome:row.outcome,quantityAdded:Number(row.quantity_added),code:row.code,message:row.message,receivedAt:new Date(row.received_at).toISOString()}));
}
const groupKeys: Record<string,string> = {region:'regionId',office:'officeId',country:'countryId',sku:'skuId',domain:'mssDomainId',stage:'stage',handler:'handlerId',product:'productId',application:'applicationNo'};
const labelKeys: Record<string,string> = {region:'regionName',office:'officeName',country:'countryName',sku:'productModel',domain:'mssDomainName',stage:'stage',handler:'handlerName',product:'productName',application:'applicationNo'};
// Unknown groups have an explicit sentinel so drill-down is exact, including NULL.
const groupValue = (r: any, by: string) => String(r[groupKeys[by]] || '__UNKNOWN__');
function filterRows(rows: any[], f: ShipmentRead, logs = false) {
  return rows.filter(r => {
    if (['productId','skuId','handlerId','mssDomainId','regionId','officeId','countryId','stage','sourceSystem','applicationNo'].some(k => (f as any)[k] && r[k] !== (f as any)[k])) return false;
    if (logs && f.outcome && r.outcome !== f.outcome) return false;
    // Date filters represent Beijing business dates. Invalid requests use received time.
    const time = logs ? (r.shippedAt || r.receivedAt) : r.shippedAt;
    const day = new Date(new Date(time).getTime()+8*3600000).toISOString().slice(0,10);
    if ((f.from && day<f.from) || (f.to && day>f.to)) return false;
    if (f.groupValue !== undefined && groupValue(r,f.groupBy)!==f.groupValue) return false;
    const keyword = f.keyword?.toLocaleLowerCase();
    return !keyword || ['applicationNo','shipmentNo','applicantName','applicantEmployeeNo','handlerName','handlerEmployeeNo','productName','productModel','bomCode','idempotencyKey','requestId'].some(k => String(r[k] || '').toLocaleLowerCase().includes(keyword));
  });
}
const totals = (rows: any[]) => ({shippedQuantity:rows.reduce((sum,r)=>sum+r.shippedQuantity,0),recordCount:rows.length,
  applicationCount:new Set(rows.filter(r=>r.applicationNo).map(r=>`${r.sourceSystem}:${r.applicationNo}`)).size,
  countryCount:new Set(rows.filter(r=>r.countryId).map(r=>r.countryId)).size});
function summary(rows: any[], by: string) {
  const groups = new Map<string,any[]>();
  for (const r of rows) { const k=groupValue(r,by); if(!groups.has(k))groups.set(k,[]);groups.get(k)!.push(r); }
  return [...groups].map(([value,rs])=>({groupBy:by,value,label:rs[0][labelKeys[by]] || '未记录',
    description:by==='sku' ? `${rs[0].bomCode || 'BOM待补'} · ${rs[0].productName}` : by==='handler' ? rs[0].handlerEmployeeNo : '',
    ...totals(rs),latestShippedAt:rs.map(r=>r.shippedAt).sort().at(-1)})).sort((a,b)=>b.shippedQuantity-a.shippedQuantity || a.value.localeCompare(b.value));
}
const paginate = (items: any[], f: ShipmentRead) => ({items:items.slice((f.page-1)*f.pageSize,f.page*f.pageSize),total:items.length,page:f.page,pageSize:f.pageSize});
export async function getShipmentData(actor: ShipmentActor, f: ShipmentRead, tab = f.tab) {
  const rows = filterRows(await scopedRecords(actor),f);
  let items = tab==='logs' ? filterRows(await scopedLogs(actor),f,true).sort((a,b)=>b.receivedAt.localeCompare(a.receivedAt)||a.id.localeCompare(b.id))
    : tab==='summary' ? summary(rows,f.groupBy) : rows.sort((a,b)=>b.shippedAt.localeCompare(a.shippedAt)||a.id.localeCompare(b.id));
  return {...paginate(items,f),totals:totals(rows)};
}
export async function shipmentOptions(actor: ShipmentActor) {
  // Option values come exclusively from visible records/calls, including historical nodes.
  const rows = [...await scopedRecords(actor),...await scopedLogs(actor)];
  const options: Record<string,any[]> = {};
  for (const [key,label] of Object.entries({productId:'productName',handlerId:'handlerName',mssDomainId:'mssDomainName',regionId:'regionName',officeId:'officeName',countryId:'countryName',stage:'stage',sourceSystem:'sourceSystem'})) {
    const map = new Map<string,any>();
    for(const r of rows) if(r[key]) map.set(r[key],{value:r[key],label:r[label] || r[key],...(key==='handlerId'?{employeeNo:r.handlerEmployeeNo}:{}),
      ...(key==='officeId'?{regionId:r.regionId}:key==='countryId'?{officeId:r.officeId,regionId:r.regionId}:{})});
    options[key] = [...map.values()].sort((a,b)=>a.label.localeCompare(b.label,'zh-CN'));
  }
  return options;
}
// CSV returned inside the normal envelope so authenticated downloads share error handling.
export async function exportShipments(actor: ShipmentActor, f: ShipmentRead) {
  const rows = filterRows(await scopedRecords(actor),f);
  const items = f.tab==='logs' ? filterRows(await scopedLogs(actor),f,true) : f.tab==='summary' ? summary(rows,f.groupBy) : rows;
  const columns = f.tab==='logs' ? [['receivedAt','接收时间'],['sourceSystem','来源'],['handlerName','处理人'],['handlerEmployeeNo','处理人工号'],['idempotencyKey','业务流水号'],['requestId','请求ID'],['outcome','结果'],['code','结果编码'],['message','说明'],['quantityAdded','申请与发货各增加']]
    : f.tab==='summary' ? [['label','汇总维度'],['value','稳定维度ID'],['description','补充信息'],['shippedQuantity','发货数量'],['recordCount','记录数'],['applicationCount','申请单数'],['latestShippedAt','最近发货']]
    : [['shippedAt','发货时间'],['applicationNo','申请单号'],['applicantName','申请人'],['applicantEmployeeNo','申请人工号'],['handlerName','处理人'],['handlerEmployeeNo','处理人工号'],['productName','产品'],['skuId','SKU ID'],['productModel','型号'],['bomCode','BOM'],['mssDomainName','领域'],['stage','阶段'],['regionName','区域'],['officeName','代表处'],['countryName','国家'],['shippedQuantity','本次发货'],['shipmentNo','发货单号'],['sourceSystem','来源'],['idempotencyKey','流水号']];
  const cell = (v: any) => { let value=String(v??'');if(/^[\s]*[=+\-@]/.test(value))value="'"+value;return '"'+value.replace(/"/g,'""')+'"'; };
  return {fileName:`shipments-${f.tab}-${new Date().toISOString().slice(0,10)}.csv`,
    content:'\uFEFF'+[columns.map(c=>cell(c[1])).join(','),...items.map(r=>columns.map(c=>cell(r[c[0]])).join(','))].join('\r\n'),rowCount:items.length};
}
