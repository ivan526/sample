import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import * as XLSX from 'xlsx';
import {parsePlanImportWorkbook} from '../src/utils/planImportExcel.js';
test('Offline plans share formal collection snapshots, execution, permissions and idempotency',async t=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'mss-plan-import-'));
 Object.assign(process.env,{SQLITE_PATH:path.join(dir,'test.db'),NODE_ENV:'test',SEED_DEMO_DATA:'true',SEED_HUAWEI_SCENARIOS:'false',JWT_SECRET:'offline-plan-test',LOG_LEVEL:'silent'});
 const [{default:migrate},db,{buildApp}]=await Promise.all([import('../server/src/db/migrate.ts'),import('../server/src/config/db.ts'),import('../server/src/app.ts')]);await migrate();const app=await buildApp();t.after(async()=>{await app.close();await rm(dir,{recursive:true,force:true});});
 async function login(employeeNo,password='123456'){const r=await app.inject({method:'POST',url:'/api/v1/auth/login',payload:{employeeNo,password}});assert.equal(r.statusCode,200,r.body);return {authorization:`Bearer ${r.json().data.token}`};}
 const admin=await login('admin','Admin@123'),gtm=await login('wanglu'),other=await login('lina'),mss=await login('zhaomin'),stock=await login('chentao');
 const call=(method,url,payload,headers=admin)=>app.inject({method,url:'/api/v1'+url,payload,headers});
 const ok=async(method,url,payload,headers=admin,status=200)=>{const r=await call(method,url,payload,headers);assert.equal(r.statusCode,status,r.body);return r.json().data;};
 await db.query("UPDATE mss_domain SET enabled=false WHERE id NOT IN ('mss-mkt','mss-retail')");
 const country=(await db.query("SELECT id FROM org_node WHERE parent_id='de-office' AND node_type='COUNTRY' LIMIT 1")).rows[0].id;
 await db.query("INSERT INTO org_node(id,code,name,node_type,parent_id) VALUES('offline-c2','offline-c2','离线国家二','COUNTRY','de-office'),('offline-c3','offline-c3','离线国家三','COUNTRY','de-office')");
 async function product(prefix){return ok('POST','/config/products',{name:prefix,domainId:'wearables',skus:[{model:prefix+'-1',bomCode:'00001'},{model:prefix+'-2',bomCode:'00002'}]},admin,201);}
 const importedProduct=await product('OFFLINE-WATCH'),onlineProduct=await product('ONLINE-WATCH');
 const row=(sku,quantity,extras={})=>({sourceRowNo:2,productSkuId:sku.id,productModel:sku.model,bomCode:sku.bomCode,mssDomain:'mss-mkt',region:'europe',office:'de-office',country:'',quantity,basis:'上市展示',plannedUseDate:'2026-11-01',note:'历史确认',...extras});
 const rows=[row(importedProduct.skus[0],100,{appliedQuantity:20,shippedQuantity:10}),row(importedProduct.skus[1],30,{sourceRowNo:3,country,appliedQuantity:7,shippedQuantity:5}),row(importedProduct.skus[1],0,{sourceRowNo:4,country:'offline-c2'}),row(importedProduct.skus[0],15,{sourceRowNo:5,mssDomain:'mss-retail',shippedQuantity:3})];
 const input={productId:importedProduct.id,stage:'V3',sourceReference:'OFFLINE-202610-V3',deadline:'2099-01-01T00:00:00Z',note:'线下已确认',fileName:'offline.xlsx',rows};
 const preview=(body=input,headers=gtm)=>ok('POST','/collection/plan-imports/preview',body,headers);
 const commit=(body=input,hash=checked.previewHash,headers=gtm)=>call('POST','/collection/plan-imports',{...body,confirmed:true,previewHash:hash},headers);
 let checked,plan;
 await t.test('template has a blank import sheet and real authorized SKU/domain/org references',async()=>{
  const r=await ok('GET',`/collection/plan-imports/template?productId=${importedProduct.id}`,undefined,gtm);
  const b=XLSX.read(r.fileBase64,{type:'base64'});assert.deepEqual(b.SheetNames,['需求明细','型号参考','领域参考','组织参考','填写说明']);
  assert.equal(XLSX.utils.sheet_to_json(b.Sheets['需求明细']).length,0);assert.ok(XLSX.utils.sheet_to_json(b.Sheets['型号参考']).some(r=>r['SKU ID']===importedProduct.skus[0].id));
  assert.throws(()=>parsePlanImportWorkbook(XLSX,XLSX.write(b,{type:'array',bookType:'xlsx'})),/没有数据/);
  for(const headers of [mss,stock,other,{}])assert.ok([401,403].includes((await call('GET',`/collection/plan-imports/template?productId=${importedProduct.id}`,undefined,headers)).statusCode));
 });
 await t.test('preview is read-only and accurately shows normalized rows, shared quota and execution baselines',async()=>{
  const before=(await db.query('SELECT count(*) AS n FROM collection_plan')).rows[0].n;
  checked=await preview();assert.equal(checked.valid,true,JSON.stringify(checked));assert.equal(checked.rowCount,4);assert.deepEqual(checked.totals,{demandQuantity:145,appliedQuantity:30,shippedQuantity:18});assert.equal(checked.domainCount,2);assert.ok(checked.warnings.some(w=>w.includes('补足')));
  assert.equal((await db.query('SELECT count(*) AS n FROM collection_plan')).rows[0].n,before);assert.equal((await db.query('SELECT id FROM collection_plan_import')).rows.length,0);
 });
 await t.test('commit creates submitted V1, formal domain feedback and same snapshot content as the normal flow',async()=>{
  const r=await commit();assert.equal(r.statusCode,201,r.body);plan=r.json().data.plan;assert.equal(plan.status,'GTM_CLOSURE');assert.equal(plan.source,'OFFLINE_IMPORT');assert.equal(plan.importReference,input.sourceReference);assert.equal(plan.feedback.totalQuantity,145);assert.equal(plan.domainTasks.length,2);assert.ok(plan.domainTasks.every(t=>t.status==='FEEDBACK_SUBMITTED'));assert.ok(plan.regionProgress.every(r=>r.status==='SUBMITTED'&&r.revisionNo===1));
  let online=await ok('POST','/collection/plans',{productId:onlineProduct.id,stage:'V3',deadline:input.deadline},admin,201);online=await ok('POST',`/collection/plans/${online.id}/release`,{version:online.version});
  for(const task of online.domainTasks){
   const source=rows.filter(r=>r.mssDomain===task.mssDomainId),selected=[...new Set(source.map(r=>onlineProduct.skus[importedProduct.skus.findIndex(s=>s.id===r.productSkuId)].id))];
   await ok('POST',`/collection/domain-tasks/${task.id}/dispatch`,{productSkuIds:selected,organizationNodeIds:['de-office']});
   const items=source.map(r=>({productItemKey:onlineProduct.skus[importedProduct.skus.findIndex(s=>s.id===r.productSkuId)].id,officeId:'de-office',countryId:r.country||undefined,quantity:r.quantity,basis:r.basis,plannedUseDate:r.plannedUseDate,note:r.note}));
   const url=`/collection/plans/${online.id}/regions/europe`,draft=await ok('PUT',`${url}/draft?domainTaskId=${task.id}`,{items});await ok('POST',`${url}/submit?domainTaskId=${task.id}`,{version:draft.version});await ok('POST',`/collection/domain-tasks/${task.id}/feedback`,{confirmed:true,note:'正式反馈'});
  }
  const strip=snapshot=>JSON.parse(snapshot).items.map(r=>({domain:r.mss_domain_id,office:r.office_id,country:r.country_id,quantity:r.quantity,basis:r.demand_basis,date:r.planned_use_date,note:r.note})).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));
  const feedbacks=async id=>(await db.query('SELECT f.summary_snapshot,t.mss_domain_id FROM collection_plan_domain_feedback f JOIN collection_plan_domain_task t ON t.id=f.domain_task_id WHERE t.plan_id=$1 ORDER BY t.mss_domain_id',[id])).rows;
  assert.deepEqual((await feedbacks(plan.id)).map(r=>strip(r.summary_snapshot)),(await feedbacks(online.id)).map(r=>strip(r.summary_snapshot)));
  const history=await ok('GET',`/collection/plans/${plan.id}/regions/europe/revisions?domainTaskId=${plan.domainTasks.find(t=>t.mssDomainId==='mss-mkt').id}`);assert.equal(history.revisions.length,1);assert.equal(history.revisions[0].revisionNo,1);
 });
 const demand=(sku,extra={})=>ok('GET','/integrations/stocking-demands?'+new URLSearchParams({productModel:sku.model,bomCode:sku.bomCode,mssDomain:'mss-mkt',stage:'V3',...extra}),undefined,stock);
 await t.test('country/shared/latest-stage API, execution, overview and production export use imported formal facts',async()=>{
  const shared=await demand(importedProduct.skus[0],{country:'offline-c3'});assert.equal(shared.planId,plan.id);assert.equal(shared.demandQuantity,100);assert.equal(shared.appliedQuantity,20);assert.equal(shared.shippedQuantity,10);assert.equal(shared.remainingToApply,80);assert.equal(shared.quotaMode,'OFFICE_SHARED');
  const precise=await demand(importedProduct.skus[1],{country});assert.equal(precise.demandQuantity,30);assert.equal(precise.appliedQuantity,7);assert.equal(precise.shippedQuantity,5);
  assert.equal((await demand(importedProduct.skus[1],{country:'offline-c2'})).demandQuantity,0);assert.equal((await demand(importedProduct.skus[1],{country:'offline-c3'})).demandQuantity,0);
  const baseline=await ok('GET','/integrations/shipments?'+new URLSearchParams({productId:importedProduct.id,sourceSystem:'线下计划历史基线'}));assert.equal(baseline.totals.shippedQuantity,18);assert.ok(baseline.items.every(r=>r.shippedAt===null&&r.recordedAt));
  const exported=await ok('POST',`/collection/plans/${plan.id}/export`,{},gtm);assert.ok(exported.rowCount>=5);assert.ok(exported.contentBase64);
  const execution=await ok('GET',`/execution?productId=${importedProduct.id}`);assert.ok(JSON.stringify(execution).includes('OFFLINE-WATCH'));
  const overview=await ok('GET','/overview?productId='+importedProduct.id);assert.ok(overview);
  const delivery=await ok('POST','/integrations/shipments',{productModel:importedProduct.skus[1].model,bomCode:'00002',mssDomain:'mss-mkt',region:'europe',office:'de-office',country,stage:'V3',shippedQuantity:2},{...stock,'idempotency-key':'after-offline'});assert.equal(delivery.success,true);assert.equal((await demand(importedProduct.skus[1],{country})).appliedQuantity,9);
 });
 await t.test('same plan reference and effective rows replay once across reordering/renamed files; conflicts never overwrite',async()=>{
  const before=(await demand(importedProduct.skus[0])).appliedQuantity;
  const replay=await commit({...input,fileName:'renamed.xlsx',rows:[...rows].reverse()});assert.equal(replay.statusCode,200,replay.body);assert.equal(replay.json().data.replayed,true);assert.equal(replay.json().data.plan.id,plan.id);
  assert.equal((await demand(importedProduct.skus[0])).appliedQuantity,before);assert.equal((await db.query('SELECT id FROM collection_plan_import')).rows.length,1);
  const changed={...input,rows:rows.map((r,i)=>i? r:{...r,quantity:101})};assert.equal((await commit(changed)).statusCode,409);assert.equal((await preview(changed)).valid,false);
  const anotherRef={...input,sourceReference:'OFFLINE-NEW-REF'};const v=await preview(anotherRef);assert.equal(v.valid,true,'original exported plan permits a new later batch');
  assert.equal((await commit(anotherRef,'0'.repeat(64))).statusCode,409);
 });
 await t.test('permissions, malformed/duplicate/ambiguous mappings, parent mismatch and mixed modes reject with source row',async()=>{
  for(const h of [mss,stock,other,{}])assert.ok([401,403].includes((await call('POST','/collection/plan-imports/preview',input,h)).statusCode));
  const otherId=(await db.query("SELECT id FROM app_user WHERE employee_no='lina'")).rows[0].id;
  await db.query("INSERT INTO user_scope_assignment(user_id,scope_type,scope_id) VALUES($1,'PRODUCT_DOMAIN','wearables') ON CONFLICT DO NOTHING",[otherId]);
  assert.equal((await call('POST','/collection/plan-imports/preview',input,other)).statusCode,403,'a stale scope assignment must not bypass the current GTM owner used by plan management');
  assert.equal((await call('POST','/collection/plan-imports',{...input,confirmed:true,previewHash:checked.previewHash},other)).statusCode,403);
  const fresh=await product('IMPORT-VALIDATION');const valid=row(fresh.skus[0],10);
  for(const [patch,message] of [[{office:'unknown'},'代表处'],[{country:'unknown'},'国家'],[{productSkuId:'',productModel:'missing'},'SKU'],[{appliedQuantity:1,shippedQuantity:2},'累计发货']]){const v=await preview({...input,productId:fresh.id,sourceReference:'bad',rows:[{...valid,...patch}]});assert.equal(v.valid,false);assert.ok(v.errors.some(e=>e.row===2&&e.message.includes(message)));}
  assert.equal((await preview({...input,productId:fresh.id,sourceReference:'duplicate',rows:[valid,{...valid,sourceRowNo:3}]})).valid,false);
  assert.equal((await preview({...input,productId:fresh.id,sourceReference:'mixed',rows:[valid,{...valid,sourceRowNo:3,country}]})).valid,false);
  const invalid=await call('POST','/collection/plan-imports/preview',{...input,rows:[{...rows[0],quantity:-1}]},gtm);assert.equal(invalid.statusCode,422);assert.ok(invalid.body.includes('第2行'));
  await ok('POST','/collection/plans',{productId:fresh.id,stage:'V3',deadline:input.deadline},admin,201);
  const active=await preview({...input,productId:fresh.id,sourceReference:'active',rows:[valid]});assert.equal(active.valid,false);assert.ok(active.errors.some(e=>e.message.includes('进行中计划')));
 });
 await t.test('entire import rolls back when final audit fails; concurrent retries create one set of facts',async()=>{
  const p=await product('IMPORT-ATOMIC'),body={...input,productId:p.id,sourceReference:'atomic',rows:[row(p.skus[0],12,{appliedQuantity:4,shippedQuantity:3})]};const v=await preview(body);
  const count=async table=>Number((await db.query(`SELECT count(*) AS n FROM ${table}`)).rows[0].n);
  const tables=['collection_plan','collection_plan_import','collection_plan_domain_task','collection_plan_domain_scope','collection_plan_domain_submission','collection_plan_domain_submission_revision','collection_plan_domain_feedback','execution_fact','shipment_record'];const before=await Promise.all(tables.map(count));
  await db.query("CREATE TRIGGER fail_offline_audit BEFORE INSERT ON audit_log WHEN NEW.action='OFFLINE_PLAN_IMPORTED' BEGIN SELECT RAISE(ABORT,'forced rollback'); END");
  try{assert.equal((await commit(body,v.previewHash)).statusCode,500);}finally{await db.query('DROP TRIGGER fail_offline_audit');}
  assert.deepEqual(await Promise.all(tables.map(count)),before);
  const r=await Promise.all(Array.from({length:3},()=>commit(body,v.previewHash)));assert.ok(r.every(r=>[200,201].includes(r.statusCode)),r.map(r=>r.body).join('\n'));assert.equal(r.filter(r=>r.statusCode===201).length,1);assert.equal((await db.query('SELECT id FROM collection_plan_import WHERE product_id=$1',[p.id])).rows.length,1);
 });
 await t.test('provisional products are supported and SKU identity never merges duplicate model/BOM rows',async()=>{
  const p=await ok('POST','/config/products',{name:'线下待补型号',domainId:'wearables',skus:[]},admin,201),body={...input,productId:p.id,sourceReference:'provisional',rows:[{sourceRowNo:2,mssDomain:'mss-mkt',region:'europe',office:'de-office',quantity:8}]};
  const v=await preview(body);assert.equal(v.valid,true);const r=await commit(body,v.previewHash);assert.equal(r.statusCode,201,r.body);assert.equal(r.json().data.plan.feedback.totalQuantity,8);
  const repeated=await ok('POST','/config/products',{name:'线下重名SKU',domainId:'wearables',skus:[{model:'REPEAT-IMPORT',bomCode:'A'},{model:'REPEAT-IMPORT',bomCode:'A'}]},admin,201);
  const duplicated={...input,productId:repeated.id,sourceReference:'stable',rows:repeated.skus.map((s,i)=>row(s,i+1,{sourceRowNo:2+i}))};assert.equal((await preview(duplicated)).valid,true);
  assert.equal((await preview({...duplicated,rows:duplicated.rows.map(r=>({...r,productSkuId:''}))})).valid,false);
 });
 await t.test('imported snapshots use the normal return/revision/feedback path without changing historical baselines',async()=>{
  const task=plan.domainTasks.find(t=>t.mssDomainId==='mss-mkt'),url=`/collection/plans/${plan.id}/regions/europe`;
  await ok('POST',`${url}/return?domainTaskId=${task.id}`,{reason:'线下计划导入后补充需求'},mss);
  const draft=await ok('GET',`${url}/draft?domainTaskId=${task.id}`,undefined,mss);assert.equal(draft.status,'RETURNED');
  const items=rows.filter(r=>r.mssDomain==='mss-mkt').map((r,i)=>({productItemKey:r.productSkuId,officeId:r.office,countryId:r.country||undefined,quantity:r.quantity+(i===0?5:0),basis:r.basis,plannedUseDate:r.plannedUseDate,note:r.note}));
  const saved=await ok('PUT',`${url}/draft?domainTaskId=${task.id}`,{version:draft.version,items},mss);await ok('POST',`${url}/submit?domainTaskId=${task.id}`,{version:saved.version},mss);await ok('POST',`/collection/domain-tasks/${task.id}/feedback`,{confirmed:true,note:'导入后的正式变更'},mss);
  const revisions=await ok('GET',`${url}/revisions?domainTaskId=${task.id}`);assert.equal(revisions.revisions.length,2);assert.equal(revisions.currentRevisionNo,2);
  const balance=await demand(importedProduct.skus[0],{country});assert.equal(balance.demandQuantity,105);assert.equal(balance.appliedQuantity,20);assert.equal(balance.shippedQuantity,10);
  assert.ok((await db.query('SELECT id FROM collection_plan_domain_feedback_history WHERE domain_task_id=$1',[task.id])).rows.length>0);
 });
 await t.test('beta reset clears import provenance and all its normal business snapshots',async()=>{
  const {resetBetaBusinessData}=await import('../server/src/db/reset-beta-data.ts');const client=await db.getClient();try{const r=await resetBetaBusinessData(client);assert.ok(r.deletedRows.collection_plan_import>0);assert.ok(r.deletedRows.shipment_record>0);}finally{client.release();}
  assert.equal((await db.query('SELECT id FROM collection_plan_import')).rows.length,0);
 });

});
