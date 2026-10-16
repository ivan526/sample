import { createHash, randomUUID } from 'node:crypto';
import * as XLSX from 'xlsx';
import { getClient, getDbType, query, type DbClient } from '../../config/db.js';
import { ForbiddenError, ValidationError, VersionConflictError } from '../../shared/errors.js';
import { buildRegionSnapshot, buildSubmissionSnapshot, materializeDomainFeedback, collectionRepository } from './repository.js';
import { recordShipment } from '../integration/shipment-records.js';
import type { PlanImportInput } from './schemas.js';
type Actor = {userId:string;role:string};
type Reader = Pick<DbClient,'query'>;
const norm=(v:string)=>v.normalize('NFKC').trim().toLowerCase().replace(/[\s\u200B-\u200D\uFEFF]/gu,'');
const domainKey=(v:string)=>norm(v).replace(/(?:业务领域|领域|样机)$/u,'');
const same=(v:string,r:any)=>r.id===v || norm(r.name)===norm(v);
const sha=(v:any)=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
export const planImportHeaders=['MSS业务领域','产品型号','BOM编码','区域','代表处','国家/地区','需求数量','需求依据','计划使用时间','备注','SKU ID','累计申请数量','累计发货数量'];
async function master(productId:string,actor:Actor,db:Reader) {
  if(!['ADMIN','GTM'].includes(actor.role))throw new ForbiddenError('仅GTM和管理员可导入线下需求计划');
  const {rows:products}=await db.query<any>(`SELECT p.*,pd.gtm_owner_id,pd.enabled AS domain_enabled FROM product p JOIN product_domain pd ON pd.id=p.domain_id WHERE p.id=$1`,[productId]);
  const p=products[0];
  if(!p || !p.enabled || !p.domain_enabled)throw new ValidationError('产品或产品品类不存在或已停用，请先维护产品主数据');
  if(actor.role!=='ADMIN' && p.gtm_owner_id!==actor.userId)throw new ForbiddenError('只能导入本人负责品类的需求计划');
  const {rows:skus}=await db.query<any>('SELECT * FROM product_sku WHERE product_id=$1 AND enabled=true ORDER BY id',[productId]);
  const {rows:domains}=await db.query<any>('SELECT id,name,code FROM mss_domain WHERE enabled=true ORDER BY name');
  const {rows:nodes}=await db.query<any>('SELECT n.*,u.display_name AS owner_name FROM org_node n LEFT JOIN app_user u ON u.id=n.owner_id WHERE n.enabled=true');
  const {rows:stages}=await db.query<any>("SELECT code FROM data_dictionary WHERE dict_type='SAMPLE_STAGE' AND enabled=true");
  return {product:p,skus,domains,nodes,stages};
}
async function normalizeImport(input:PlanImportInput,actor:Actor,db:Reader) {
  const m=await master(input.productId,actor,db);
  if(!m.stages.some(s=>s.code===input.stage))throw new ValidationError('样机阶段不存在或已停用');
  const errors:Array<{row:number;message:string}>=[],warnings:string[]=[],rows:any[]=[];
  const seen=new Set<string>(),modes=new Map<string,Set<string>>();
  const exact=(items:any[],label:string)=>{if(items.length!==1)throw new Error(items.length?`${label}重名，请使用稳定ID`:`${label}不存在、已停用或层级不匹配`);return items[0];};
  for(const row of input.rows) {
    try {
      let sku:any=null;
      if(m.skus.length){
        sku=exact(row.productSkuId?m.skus.filter(s=>s.id===row.productSkuId):m.skus.filter(s=>norm(s.model)===norm(row.productModel)&&norm(s.bom_code||'')===norm(row.bomCode)),'SKU/型号+BOM');
        if(row.productSkuId && ((row.productModel && norm(row.productModel)!==norm(sku.model)) || (row.bomCode && norm(row.bomCode)!==norm(sku.bom_code||''))))throw new Error('SKU ID与填写的型号/BOM不一致');
      }else if(row.productSkuId || row.productModel || row.bomCode)throw new Error('该产品尚无启用SKU，请先维护型号或使用产品级空型号行');
      const domain=exact(m.domains.filter(d=>same(row.mssDomain,d)||domainKey(d.code)===domainKey(row.mssDomain)||domainKey(d.name)===domainKey(row.mssDomain)),'MSS业务领域');
      const region=exact(m.nodes.filter(n=>n.node_type==='REGION' && same(row.region,n)),'区域');
      const office=exact(m.nodes.filter(n=>n.node_type==='OFFICE' && n.parent_id===region.id && same(row.office,n)),'代表处');
      const country=row.country?exact(m.nodes.filter(n=>n.node_type==='COUNTRY' && n.parent_id===office.id && same(row.country,n)),'国家/地区'):null;
      const productItemKey=sku?.id || `product:${input.productId}`;
      const key=JSON.stringify([domain.id,productItemKey,office.id,country?.id||null]);
      if(seen.has(key))throw new Error('同领域/SKU/代表处/国家重复，请保留一条汇总记录');seen.add(key);
      const modeKey=JSON.stringify([domain.id,productItemKey,office.id]);if(!modes.has(modeKey))modes.set(modeKey,new Set());modes.get(modeKey)!.add(country?'COUNTRY':'OFFICE_SHARED');
      const shipped=row.shippedQuantity??0,applied=row.appliedQuantity??shipped;
      if(shipped>applied)throw new Error('累计发货数量不能大于明确填写的累计申请数量');
      if(!sku && (applied||shipped))throw new Error('历史执行数量需关联稳定SKU，请先维护型号/BOM');
      rows.push({sourceRowNo:row.sourceRowNo,productSkuId:sku?.id || null,productItemKey,productModel:sku?.model || '',bomCode:sku?.bom_code || '',
        mssDomainId:domain.id,mssDomainName:domain.name,regionId:region.id,regionName:region.name,officeId:office.id,officeName:office.name,countryId:country?.id||null,countryName:country?.name||'',
        quantity:row.quantity,appliedQuantity:applied,shippedQuantity:shipped,basis:row.basis || (row.quantity?'线下历史确认需求':''),plannedUseDate:row.plannedUseDate||null,note:row.note});
      if(row.appliedQuantity===undefined&&shipped)warnings.push(`第${row.sourceRowNo}行累计申请未填，按累计发货${shipped}补足`);
      if(applied>row.quantity)warnings.push(`第${row.sourceRowNo}行累计申请大于需求，按实际历史数量保留`);
    }catch(e:any){errors.push({row:row.sourceRowNo,message:e.message});}
  }
  for(const row of rows)if(modes.get(JSON.stringify([row.mssDomainId,row.productItemKey,row.officeId]))!.size>1)errors.push({row:row.sourceRowNo,message:'同SKU/领域/代表处不能同时导入共享配额与国家明细，请保留一种口径'});
  const canonical=rows.map(({sourceRowNo,productModel,bomCode,mssDomainName,regionName,officeName,countryName,...r})=>r).sort((a,b)=>{const x=JSON.stringify(a),y=JSON.stringify(b);return x<y?-1:x>y?1:0;});
  if(rows.reduce((n,r)=>n+r.quantity,0)>2147483647)errors.push({row:0,message:'计划需求总量超过2147483647，请拆分计划'});
  const hash=sha({productId:input.productId,stage:input.stage,sourceReference:input.sourceReference,deadline:new Date(input.deadline).toISOString(),note:input.note,rows:canonical});
  const {rows:existing}=await db.query<any>('SELECT * FROM collection_plan_import WHERE product_id=$1 AND sample_stage=$2 AND source_reference=$3',[input.productId,input.stage,input.sourceReference]);
  if(existing.length && existing[0].payload_hash!==hash)errors.push({row:0,message:'该线下计划编号已导入过不同内容，请核对原记录；不能覆盖历史计划'});
  if(!existing.length){
    const {rows:active}=await db.query<any>("SELECT plan_no FROM collection_plan WHERE product_id=$1 AND sample_stage=$2 AND cancelled_at IS NULL AND archived_at IS NULL AND status NOT IN ('EXPORTED','PRODUCT_DRAFT')",[input.productId,input.stage]);
    if(active.length)errors.push({row:0,message:`该产品/阶段已有进行中计划${active[0].plan_no}，不能通过导入覆盖；请先处理原计划`});
  }
  const sum=(k:string)=>rows.reduce((n,r)=>n+r[k],0);
  return {m,rows,hash,existing:existing[0],view:{valid:!errors.length,previewHash:hash,errors:errors.slice(0,500),errorCount:errors.length,warnings:warnings.slice(0,200),rowCount:input.rows.length,
    productName:m.product.name,stage:input.stage,sourceReference:input.sourceReference,domainCount:new Set(rows.map(r=>r.mssDomainId)).size,regionCount:new Set(rows.map(r=>r.regionId)).size,
    totals:{demandQuantity:sum('quantity'),appliedQuantity:sum('appliedQuantity'),shippedQuantity:sum('shippedQuantity')},replayed:Boolean(existing.length),planId:existing[0]?.plan_id,
    items:rows.slice(0,100),previewTruncated:rows.length>100}};
}
export async function previewPlanImport(input:PlanImportInput,actor:Actor){return (await normalizeImport(input,actor,{query})).view;}
let sqliteImports:Promise<void>=Promise.resolve();
export async function commitPlanImport(input:PlanImportInput,previewHash:string,actor:Actor,requestId:string) {
  const run=()=>commitTransaction(input,previewHash,actor,requestId);
  if(getDbType()!=='sqlite')return run();
  const previous=sqliteImports;let done!:()=>void;sqliteImports=new Promise(r=>{done=r;});await previous;try{return await run();}finally{done();}
}
async function commitTransaction(input:PlanImportInput,previewHash:string,actor:Actor,requestId:string) {
  const db=await getClient();let planId:string,replayed=false;
  try{
    await db.begin();
    // Product row lock arbitrates imports and their idempotency key on PostgreSQL.
    await db.query('UPDATE product SET version=version WHERE id=$1 RETURNING id',[input.productId]);
    const result=await normalizeImport(input,actor,db);
    if(result.existing && result.existing.payload_hash!==result.hash)throw new VersionConflictError('线下计划编号已用于不同数据');
    if(!result.view.valid)throw new ValidationError('导入校验失败，请修正后重新预览',result.view.errors.map(e=>`${e.row?`第${e.row}行`:'计划'}：${e.message}`));
    if(previewHash!==result.hash)throw new VersionConflictError('校验后数据或主数据映射发生变化，请重新预览');
    if(result.existing){planId=result.existing.plan_id;replayed=true;await db.commit();}
    else{
      const importId=randomUUID();planId=randomUUID();const planNo=`OFFLINE-${new Date().toISOString().slice(0,10).replace(/-/g,'')}-${importId.slice(0,8)}`;
      await db.query(`INSERT INTO collection_plan(id,plan_no,product_id,domain_id,mss_domain_id,sample_stage,status,deadline_at,note,created_by,created_at,released_by,released_at)
        VALUES($1,$2,$3,$4,NULL,$5,'COLLECTING',$6,$7,$8,NOW(),$8,NOW())`,[planId,planNo,input.productId,result.m.product.domain_id,input.stage,input.deadline,input.note,actor.userId]);
      await db.query(`INSERT INTO collection_plan_import(id,plan_id,product_id,sample_stage,source_reference,payload_hash,file_name,row_count,imported_by,request_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [importId,planId,input.productId,input.stage,input.sourceReference,result.hash,input.fileName,result.rows.length,actor.userId,requestId]);
      for(const domainId of new Set<string>(result.rows.map(r=>r.mssDomainId))){
        const taskId=randomUUID(),domainRows=result.rows.filter(r=>r.mssDomainId===domainId);
        await db.query(`INSERT INTO collection_plan_domain_task(id,plan_id,mss_domain_id,status,dispatched_by,dispatched_at) VALUES($1,$2,$3,'READY_TO_FEEDBACK',$4,NOW())`,[taskId,planId,domainId,actor.userId]);
        for(const skuId of new Set(domainRows.map(r=>r.productSkuId).filter(Boolean)))await db.query('INSERT INTO collection_plan_domain_task_sku(domain_task_id,product_sku_id) VALUES($1,$2)',[taskId,skuId]);
        for(const regionId of new Set<string>(domainRows.map(r=>r.regionId))){
          const region=result.m.nodes.find(n=>n.id===regionId),regionRows=domainRows.filter(r=>r.regionId===regionId),scopeId=randomUUID(),submissionId=randomUUID();
          const selected=new Set<string>(regionRows.map(r=>r.officeId));
          await db.query(`INSERT INTO collection_plan_domain_scope(id,domain_task_id,region_id,region_name_snapshot,region_owner_snapshot,office_country_snapshot) VALUES($1,$2,$3,$4,$5,$6)`,
            [scopeId,taskId,regionId,region.name,region.owner_name,await buildRegionSnapshot(db,region,selected)]);
          await db.query(`INSERT INTO collection_plan_domain_submission(id,domain_scope_id,status,saved_by,saved_at,submitted_by,submitted_at,revision_no) VALUES($1,$2,'SUBMITTED',$3,NOW(),$3,NOW(),1)`,[submissionId,scopeId,actor.userId]);
          for(const row of regionRows)await db.query(`INSERT INTO collection_plan_domain_demand_item(id,submission_id,product_sku_id,provisional_item_key,office_id,country_id,quantity,demand_basis,planned_use_date,note) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
            [randomUUID(),submissionId,row.productSkuId,row.productSkuId?null:row.productItemKey,row.officeId,row.countryId,row.quantity,row.basis||null,row.plannedUseDate,row.note||null]);
          const snapshot=await buildSubmissionSnapshot(db,submissionId);
          await db.query(`INSERT INTO collection_plan_domain_submission_revision(id,submission_id,revision_no,data_snapshot,submitted_by,submitted_at) VALUES($1,$2,1,$3,$4,NOW())`,
            [randomUUID(),submissionId,JSON.stringify({...snapshot,source:'OFFLINE_IMPORT',sourceReference:input.sourceReference}),actor.userId]);
        }
        await materializeDomainFeedback(db,{id:taskId,plan_id:planId,mss_domain_id:domainId,status:'READY_TO_FEEDBACK'},`线下已确认需求导入：${input.sourceReference}`,actor.userId,{completionMode:'OFFLINE_IMPORT',sourceReference:input.sourceReference,importId});
      }
      for(const row of result.rows)for(const [type,quantity] of [['APPLICATION',row.appliedQuantity],['SHIPMENT',row.shippedQuantity]] as const){
        if(!quantity)continue;const factId=randomUUID();
        await db.query(`INSERT INTO execution_fact(id,source_type,source_id,product_id,product_sku_id,mss_domain_id,region_id,office_id,country_id,collection_plan_id,quantity,occurred_at,dimension_snapshot) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW(),$12)`,
          [factId,type,importId,input.productId,row.productSkuId,row.mssDomainId,row.regionId,row.officeId,row.countryId,planId,quantity,JSON.stringify({source:'OFFLINE_IMPORT',sourceReference:input.sourceReference,sourceRowNo:row.sourceRowNo,baseline:true,planId})]);
        if(type==='SHIPMENT')await recordShipment(db,factId,actor.userId,actor.userId,{sourceSystem:'线下计划历史基线',shippedAt:null,note:`${input.sourceReference} 第${row.sourceRowNo}行累计发货基线，并非逐笔发货日志`,shippedAtSource:'LEGACY'});
      }
      await db.query(`INSERT INTO audit_log(id,actor_id,action,entity_type,entity_id,after_data,request_id) VALUES($1,$2,'OFFLINE_PLAN_IMPORTED','COLLECTION_PLAN',$3,$4,$5)`,
        [randomUUID(),actor.userId,planId,JSON.stringify({importId,sourceReference:input.sourceReference,rowCount:result.rows.length,totals:result.view.totals}),requestId]);
      await db.commit();
    }
  }catch(e){await db.rollback();throw e;}finally{db.release();}
  return {plan:await collectionRepository.getPlan(planId!,actor.role,actor.userId),replayed};
}
export async function planImportTemplate(productId:string,actor:Actor){
  const m=await master(productId,actor,{query}),book=XLSX.utils.book_new();
  const sheet=XLSX.utils.aoa_to_sheet([planImportHeaders]);sheet['!cols']=planImportHeaders.map((_,i)=>({wch:[0,1,2,3,4,5,8,10].includes(i)?26:18}));
  XLSX.utils.book_append_sheet(book,sheet,'需求明细');
  XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet([['SKU ID','产品型号','BOM编码','产品'],...m.skus.map(s=>[s.id,s.model,s.bom_code||'',m.product.name])]),'型号参考');
  XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet([['领域ID','MSS业务领域','编码'],...m.domains.map(d=>[d.id,d.name,d.code])]),'领域参考');
  const byId=new Map(m.nodes.map(n=>[n.id,n]));
  XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet([['区域ID','区域','代表处ID','代表处','国家ID','国家/地区'],...m.nodes.filter(o=>o.node_type==='OFFICE'&&byId.get(o.parent_id)?.node_type==='REGION').flatMap(o=>{const r=byId.get(o.parent_id),countries=m.nodes.filter(c=>c.node_type==='COUNTRY'&&c.parent_id===o.id);return (countries.length?countries:[null]).map(c=>[r.id,r.name,o.id,o.name,c?.id||'',c?.name||'']);})]),'组织参考');
  XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet([['填写说明'],['每个文件为一个产品、一个阶段、一个线下计划；在窗口选择产品/阶段/编号/截止时间。'],['仅填写需求明细，参考页不参与导入。产品/组织须预先维护；重名使用ID，重复型号+BOM使用SKU ID。'],['国家空白=代表处共享配额；同SKU/领域/代表处不能混填共享配额和国家明细；国家明确0仍按国家口径。'],['需求数量必须填写非负整数；需求依据未填标记线下历史确认需求；计划使用时间按YYYY-MM-DD。'],['累计申请/发货可空；申请未填按发货补足，两项均空为0。历史发货是累计基线，不是逐笔日志，不应重复以TSMP/API入账。'],['导入直接建立正式反馈，只涉及文件内领域，未涉及领域不代为确认；与现有正式需求共享查询/导出/变更流程。']]),'填写说明');
  return {fileName:'offline-demand-plan-template.xlsx',contentType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',fileBase64:XLSX.write(book,{type:'base64',bookType:'xlsx'})};
}
