import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import test from 'node:test';

test('External query aggregates dimensions; increments are authorized, atomic and idempotent', async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(),'mss-external-'));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  Object.assign(process.env,{SQLITE_PATH:path.join(dir,'test.db'),NODE_ENV:'test',SEED_DEMO_DATA:'true',SEED_HUAWEI_SCENARIOS:'false',JWT_SECRET:'integration-test-secret',LOG_LEVEL:'silent'});
  const [{default:migrate},db,{buildApp}] = await Promise.all([import('../server/src/db/migrate.ts'),import('../server/src/config/db.ts'),import('../server/src/app.ts')]);
  await migrate(); const app=await buildApp(); t.after(()=>app.close());
  async function login(employeeNo,password='123456') { const r=await app.inject({method:'POST',url:'/api/v1/auth/login',payload:{employeeNo,password}}); assert.equal(r.statusCode,200,r.body);return {authorization:`Bearer ${r.json().data.token}`}; }
  const admin=await login('admin','Admin@123'), stocking=await login('chentao'),gtm=await login('wanglu');
  const {rows:skuRows}=await db.query('SELECT * FROM product_sku WHERE id = $1',['b19f']);const sku=skuRows[0];
  const {rows:places}=await db.query(`SELECT c.id AS country_id,c.name AS country_name,o.id AS office_id,o.name AS office_name,r.id AS region_id,r.name AS region_name
    FROM org_node c JOIN org_node o ON c.parent_id=o.id JOIN org_node r ON o.parent_id=r.id WHERE c.node_type='COUNTRY' ORDER BY c.id LIMIT 1`);
  const place=places[0];
  await db.query("INSERT INTO org_node (id,code,name,node_type,parent_id) VALUES ('ext-country-2','ext-country-2','测试第二国家','COUNTRY',$1)",[place.office_id]);
  await db.query("INSERT INTO org_node (id,code,name,node_type,parent_id) VALUES ('ext-office-2','ext-office-2','测试第二代表处','OFFICE',$1)",[place.region_id]);
  await db.query("INSERT INTO org_node (id,code,name,node_type,parent_id) VALUES ('ext-country-3','ext-country-3','测试第三国家','COUNTRY','ext-office-2')");
  const planId=(await db.query(`SELECT task.plan_id FROM execution_fact ef JOIN collection_plan_domain_task task ON task.id=ef.source_id WHERE ef.product_sku_id=$1 AND ef.source_type='CONFIRMED_DEMAND' LIMIT 1`,[sku.id])).rows[0].plan_id;
  await db.query('DELETE FROM execution_fact WHERE product_sku_id=$1',[sku.id]);
  async function fact(type,quantity,office=place.office_id,country=null,domain='mss-mkt') {
    await db.query(`INSERT INTO execution_fact (id,source_type,product_id,product_sku_id,mss_domain_id,region_id,office_id,country_id,quantity,collection_plan_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,[randomUUID(),type,sku.product_id,sku.id,domain,place.region_id,office,country,quantity,planId]);
  }
  await fact('CONFIRMED_DEMAND',100);await fact('APPLICATION',30);await fact('SHIPMENT',10,place.office_id,place.country_id);
  await fact('CONFIRMED_DEMAND',20,place.office_id,place.country_id);await fact('APPLICATION',5,place.office_id,place.country_id);await fact('SHIPMENT',7,place.office_id,place.country_id);
  await fact('CONFIRMED_DEMAND',30,place.office_id,'ext-country-2');await fact('APPLICATION',15,place.office_id,'ext-country-2');await fact('SHIPMENT',3,place.office_id,'ext-country-2');
  await fact('CONFIRMED_DEMAND',40,'ext-office-2','ext-country-3');await fact('APPLICATION',10,'ext-office-2','ext-country-3');await fact('SHIPMENT',4,'ext-office-2','ext-country-3');
  await fact('CONFIRMED_DEMAND',50,place.office_id,place.country_id,'mss-retail');await fact('APPLICATION',10,place.office_id,place.country_id,'mss-retail');await fact('SHIPMENT',5,place.office_id,place.country_id,'mss-retail');
  const base={productModel:sku.model,bomCode:sku.bom_code};
  const query=async(filters={},headers=stocking)=>app.inject({method:'GET',url:`/api/v1/integrations/stocking-demands?${new URLSearchParams({...base,...filters})}`,headers});
  await t.test('optional filters aggregate all descendants and blank means all',async()=>{
    const global=(await query()).json().data;assert.equal(global.demandQuantity,140);assert.equal(global.shippedQuantity,29);assert.equal(global.remainingToApply,70);
    const office=(await query({mssDomain:'MKT样机',region:place.region_name,office:place.office_name,country:''})).json().data;
    assert.equal(office.demandQuantity,50);assert.equal(office.appliedQuantity,50);assert.equal(office.shippedQuantity,20);assert.equal(office.remainingToApply,0);
    const region=(await query({mssDomain:'mss-mkt',region:place.region_id})).json().data;assert.equal(region.demandQuantity,90);assert.equal(region.shippedQuantity,24);
    const country=(await query({mssDomain:'mss-mkt',country:place.country_id})).json().data;assert.equal(country.demandQuantity,20);assert.equal(country.shippedQuantity,17);assert.equal(country.officeUnallocatedDemandQuantity,0);assert.equal(country.officeUnallocatedAppliedQuantity,0);
    assert.equal((await query({office:'ext-office-2',country:place.country_id})).statusCode,422);
    assert.equal((await query({bomCode:'BAD'})).statusCode,422);assert.equal((await query({productModel:'wrong'})).statusCode,422);
    assert.equal((await query({productModel:''})).statusCode,422);assert.equal((await query({region:'unknown'})).statusCode,422);
  });
  const body={...base,mssDomain:'mss-mkt',region:place.region_id,office:place.office_id,country:place.country_id,shippedQuantity:5};
  const post=(payload=body,key='delivery-1',headers=stocking)=>app.inject({method:'POST',url:'/api/v1/integrations/shipments',headers:{...headers,...(key?{'idempotency-key':key}:{})},payload});
  await t.test('authentication and product scope apply to reads and writes',async()=>{
    assert.equal((await query({},{})).statusCode,401);assert.equal((await query({},gtm)).statusCode,403);assert.equal((await post(body,'forbidden',gtm)).statusCode,403);
    const {rows:users}=await db.query("SELECT id FROM app_user WHERE employee_no='chentao'"); const user=users[0].id;
    await db.query("UPDATE product_domain SET stocking_owner_id=(SELECT id FROM app_user WHERE employee_no='admin') WHERE id='wearables'");
    await db.query("DELETE FROM user_scope_assignment WHERE user_id=$1 AND scope_type='PRODUCT_DOMAIN' AND scope_id='wearables'",[user]);
    assert.equal((await query()).statusCode,403);assert.equal((await post(body,'out-of-scope')).statusCode,403);
    await db.query("INSERT INTO user_scope_assignment (user_id,scope_type,scope_id) VALUES ($1,'PRODUCT_DOMAIN','wearables')",[user]);
    assert.equal((await query()).statusCode,200);
  });
  await t.test('same key retries once, differing payload conflicts; quantities increment shared facts',async()=>{
    const first=await post();assert.equal(first.statusCode,200,first.body);assert.equal(first.json().data.success,true);assert.equal(first.json().data.replayed,false);
    assert.equal(Object.hasOwn(first.json().data,'stockedQuantityAdded'),false);
    const newHash=createHash('sha256').update(JSON.stringify({productId:sku.product_id,skuId:sku.id,mssDomainId:'mss-mkt',regionId:place.region_id,officeId:place.office_id,countryId:place.country_id,shippedQuantity:5})).digest('hex');
    assert.equal((await db.query("SELECT request_hash FROM integration_delivery WHERE idempotency_key='delivery-1'")).rows[0].request_hash,newHash);
    const facts=(await db.query('SELECT source_type,quantity FROM execution_fact WHERE source_id=$1 ORDER BY source_type',[first.json().data.deliveryId])).rows;
    assert.deepEqual(facts,[{source_type:'APPLICATION',quantity:5},{source_type:'SHIPMENT',quantity:5}]);
    // Simulate a delivery saved in the previous request format. A shipment-only retry
    // returns its original delivery without adding another shipment or production.
    const stored=(await db.query("SELECT * FROM integration_delivery WHERE idempotency_key='delivery-1'")).rows[0];
    const legacyRequest={...JSON.parse(stored.request_payload),stockedQuantity:8};
    const legacyHash=createHash('sha256').update(JSON.stringify({productId:sku.product_id,skuId:sku.id,mssDomainId:'mss-mkt',regionId:place.region_id,officeId:place.office_id,countryId:place.country_id,stockedQuantity:8,shippedQuantity:5})).digest('hex');
    await db.query('UPDATE integration_delivery SET request_hash=$1,request_payload=$2,response_payload=$3 WHERE id=$4', [legacyHash,JSON.stringify(legacyRequest),JSON.stringify({...first.json().data,stockedQuantityAdded:8}),stored.id]);
    await db.query(`INSERT INTO execution_fact(id,source_type,source_id,product_id,product_sku_id,mss_domain_id,region_id,office_id,country_id,quantity,collection_plan_id)
      VALUES ('retired-production','PRODUCTION',$1,$2,$3,'mss-mkt',$4,$5,$6,8,$7)`,[first.json().data.deliveryId,sku.product_id,sku.id,place.region_id,place.office_id,place.country_id,planId]);
    const retry=await post();assert.equal(retry.json().data.replayed,true);assert.equal(Object.hasOwn(retry.json().data,'stockedQuantityAdded'),false);assert.equal(retry.json().data.deliveryId,first.json().data.deliveryId);
    assert.equal((await post({...body,shippedQuantity:6})).statusCode,409);
    const counts=(await query()).json().data;assert.equal(Object.hasOwn(counts,'stockedQuantity'),false);assert.equal(counts.shippedQuantity,34);assert.equal(counts.appliedQuantity,75);assert.equal(counts.remainingToApply,65);
    const {rows:audit}=await db.query("SELECT * FROM audit_log WHERE action='INTEGRATION_SHIPMENT_ADDED'");assert.equal(audit.length,1);
    const responses=await Promise.all(Array.from({length:4},()=>post(body,'concurrent')));assert.ok(responses.every(r=>r.statusCode===200));assert.equal(responses.filter(r=>!r.json().data.replayed).length,1);
    assert.equal((await query()).json().data.shippedQuantity,39);
    assert.equal((await query()).json().data.appliedQuantity,80);
    assert.equal((await query()).json().data.remainingToApply,60);
    assert.equal((await db.query("SELECT quantity FROM execution_fact WHERE id='retired-production'")).rows[0].quantity,8,'historical production remains unchanged');
    const view=await app.inject({method:'GET',url:`/api/v1/execution?productId=${sku.product_id}&regionId=${place.region_id}&officeId=ext-office-2`,headers:admin});
    assert.equal(view.statusCode,200,view.body);const row=view.json().data.products.flatMap(p=>p.skus).find(s=>s.id===sku.id);assert.equal(Object.hasOwn(row,'stocked'),false);
  });
  await t.test('invalid inputs and missing demand never persist; transaction errors roll back',async()=>{
    for(const patch of [{stockedQuantity:8},{shippedQuantity:-1},{shippedQuantity:0},{shippedQuantity:undefined},{shippedQuantity:1.2},{shippedQuantity:2147483648},{country:''},{office:'unknown'}])assert.equal((await post({...body,...patch},randomUUID())).statusCode,422);
    assert.equal((await post(body,'')).statusCode,422);
    assert.equal((await post({...body,mssDomain:'mss-service'},'no-confirmed')).statusCode,422);
    assert.equal((await db.query("SELECT id FROM integration_delivery WHERE idempotency_key='no-confirmed'")).rows.length,0);
    const before=(await query()).json().data;
    await db.query("CREATE TRIGGER reject_external_audit BEFORE INSERT ON audit_log WHEN NEW.action='INTEGRATION_SHIPMENT_ADDED' BEGIN SELECT RAISE(ABORT,'forced rollback'); END;");
    assert.equal((await post(body,'rollback')).statusCode,500);
    await db.query('DROP TRIGGER reject_external_audit');
    assert.equal((await query()).json().data.shippedQuantity,before.shippedQuantity);
    assert.equal((await query()).json().data.appliedQuantity,before.appliedQuantity);
    assert.equal((await db.query("SELECT id FROM integration_delivery WHERE idempotency_key='rollback'")).rows.length,0);
    assert.equal((await post(body,'rollback')).statusCode,200);
    const after=(await query()).json().data;
    assert.equal(after.appliedQuantity,before.appliedQuantity+5);
    assert.equal(after.shippedQuantity,before.shippedQuantity+5);
    // Failure on the second fact must roll back the first fact and reservation.
    await db.query("CREATE TRIGGER reject_shipment_fact BEFORE INSERT ON execution_fact WHEN NEW.source_type='SHIPMENT' AND NEW.source_id IN (SELECT id FROM integration_delivery WHERE idempotency_key='half-pair') BEGIN SELECT RAISE(ABORT,'forced pair rollback'); END;");
    assert.equal((await post(body,'half-pair')).statusCode,500);
    await db.query('DROP TRIGGER reject_shipment_fact');
    assert.equal((await query()).json().data.appliedQuantity,after.appliedQuantity);
    assert.equal((await query()).json().data.shippedQuantity,after.shippedQuantity);
    assert.equal((await db.query("SELECT id FROM integration_delivery WHERE idempotency_key='half-pair'")).rows.length,0);
  });
  await t.test('old shipment-only deliveries remain unchanged on retry after paired accounting is enabled',async()=>{
    const stored=(await db.query("SELECT * FROM integration_delivery WHERE idempotency_key='delivery-1'")).rows[0];
    const id=randomUUID(), key='legacy-shipment-only';
    await db.query(`INSERT INTO integration_delivery(id,actor_id,idempotency_key,request_hash,request_payload,response_payload)VALUES($1,$2,$3,$4,$5,$6)`,
      [id,stored.actor_id,key,stored.request_hash,stored.request_payload,JSON.stringify({success:true,deliveryId:id,shippedQuantityAdded:5})]);
    await db.query(`INSERT INTO execution_fact(id,source_type,source_id,product_id,product_sku_id,mss_domain_id,region_id,office_id,country_id,quantity,collection_plan_id)
      VALUES ($1,'SHIPMENT',$2,$3,$4,'mss-mkt',$5,$6,$7,5,$8)`,[randomUUID(),id,sku.product_id,sku.id,place.region_id,place.office_id,place.country_id,planId]);
    const before=(await query()).json().data;
    const retry=await post(body,key); assert.equal(retry.statusCode,200,retry.body);assert.equal(retry.json().data.replayed,true);
    const after=(await query()).json().data;
    assert.equal(after.appliedQuantity,before.appliedQuantity);assert.equal(after.shippedQuantity,before.shippedQuantity);
    assert.equal((await db.query("SELECT id FROM execution_fact WHERE source_id=$1 AND source_type='APPLICATION'",[id])).rows.length,0);
  });
  await t.test('repeated models with distinct BOMs persist and remain separate',async()=>{
    const payload={name:'同型号测试',domainId:'wearables',skus:[{model:'同型号',bomCode:'PAIR-A'},{model:'同型号',bomCode:'PAIR-B'}]};
    const create=await app.inject({method:'POST',url:'/api/v1/config/products',headers:admin,payload});assert.equal(create.statusCode,201,create.body);
    const product=create.json().data;assert.equal(product.skus.length,2);assert.notEqual(product.skus[0].id,product.skus[1].id);
    const update=await app.inject({method:'PUT',url:`/api/v1/config/products/${product.id}`,headers:admin,payload:{...payload,version:product.version,skus:product.skus.map(s=>({id:s.id,model:s.model,bomCode:s.bomCode,description:'updated'}))}});assert.equal(update.statusCode,200,update.body);
    const lookup=await query({productModel:'同型号',bomCode:'PAIR-B'});assert.equal(lookup.statusCode,200,lookup.body);assert.equal(lookup.json().data.demandQuantity,0);
    const duplicate=await app.inject({method:'POST',url:'/api/v1/config/products',headers:admin,payload:{...payload,name:'重复测试'}});assert.equal(duplicate.statusCode,201,duplicate.body);
    const pairDuplicate=await app.inject({method:'POST',url:'/api/v1/config/products',headers:admin,payload:{...payload,skus:[{model:'重复组合',bomCode:'A'},{model:'重复组合',bomCode:'A'}]}});assert.equal(pairDuplicate.statusCode,201,pairDuplicate.body);assert.equal(new Set(pairDuplicate.json().data.skus.map(s=>s.id)).size,2);
  });
  await t.test('shared BOM requires model disambiguation in TSMP and queries',async()=>{
    const product=await app.inject({method:'POST',url:'/api/v1/config/products',headers:admin,payload:{name:'BOM重名验证',domainId:'wearables',skus:[{model:'型号甲',bomCode:'SHARED-BOM'},{model:'型号乙',bomCode:'SHARED-BOM'}]}});
    assert.equal(product.statusCode,201,product.body);
    // Build formal demand snapshots so the latest-plan endpoint has provenance.
    const accepted=async(method,url,payload)=>{const response=await app.inject({method,url:`/api/v1${url}`,headers:admin,payload});assert.ok(response.statusCode<300,response.body);return response.json().data;};
    let batch=await accepted('POST','/collection/plans',{productId:product.json().data.id,stage:'V3',deadline:'2099-01-01T00:00:00Z'});
    batch=await accepted('POST',`/collection/plans/${batch.id}/release`,{version:batch.version});
    const task=batch.domainTasks.find(task=>task.mssDomainId==='mss-mkt');
    await accepted('POST',`/collection/domain-tasks/${task.id}/dispatch`,{productSkuIds:product.json().data.skus.map(sku=>sku.id),regionIds:[place.region_id]});
    const draft=await accepted('PUT',`/collection/plans/${batch.id}/regions/${place.region_id}/draft?domainTaskId=${task.id}`,{items:product.json().data.skus.map(sku=>({productItemKey:sku.id,officeId:place.office_id,quantity:10,basis:'上市展示'}))});
    await accepted('POST',`/collection/plans/${batch.id}/regions/${place.region_id}/submit?domainTaskId=${task.id}`,{version:draft.version});
    await accepted('POST',`/collection/domain-tasks/${task.id}/feedback`,{confirmed:true,note:'正式反馈'});

    const row={mssDomain:'MKT领域',bomCode:'SHARED-BOM',region:place.region_name,office:place.office_name,country:place.country_name,shippedQty:1};
    const ambiguous=await app.inject({method:'POST',url:'/api/v1/execution/imports',headers:admin,payload:{fileName:'ambiguous.xlsx',rows:[{...row,externalKey:'ambiguous-bom'}]}});
    assert.equal(ambiguous.statusCode,202,ambiguous.body);assert.equal(ambiguous.json().data.matchedRows,0);assert.equal(ambiguous.json().data.unmatchedRows,1);
    const exact=await app.inject({method:'POST',url:'/api/v1/execution/imports',headers:admin,payload:{fileName:'exact.xlsx',rows:[{...row,sku:'型号乙',externalKey:'exact-bom'}]}});
    assert.equal(exact.statusCode,202,exact.body);assert.equal(exact.json().data.matchedRows,1);
    assert.equal((await query({productModel:'型号甲',bomCode:'SHARED-BOM'})).json().data.shippedQuantity,0);
    assert.equal((await query({productModel:'型号乙',bomCode:'SHARED-BOM'})).json().data.shippedQuantity,1);
  });

  await t.test('all duplicate values keep independent IDs during creation and editing',async()=>{
    const payload={name:'BOM待补重复型号',domainId:'wearables',skus:[{model:'同名待补',bomCode:'',description:'黑色'},{model:'同名待补',bomCode:'  ',description:'白色'}]};
    const created=await app.inject({method:'POST',url:'/api/v1/config/products',headers:admin,payload});assert.equal(created.statusCode,201,created.body);
    let product=created.json().data;const originalIds=product.skus.map(s=>s.id);assert.equal(new Set(originalIds).size,2);
    const save=async(skus)=>app.inject({method:'PUT',url:`/api/v1/config/products/${product.id}`,headers:admin,payload:{...payload,skus,version:product.version}});
    const edited=await save([...product.skus,{model:'同名待补',bomCode:'',description:'新复制行'}]);assert.equal(edited.statusCode,200,edited.body);
    product=edited.json().data;assert.equal(new Set(product.skus.map(s=>s.id)).size,3);assert.deepEqual(product.skus.slice(0,2).map(s=>s.id),originalIds);
    const completed=await save(product.skus.map((s,i)=>({...s,bomCode:i===0?'PENDING-A':i===1?'PENDING-B':''})));assert.equal(completed.statusCode,200,completed.body);product=completed.json().data;
    const duplicate=await save(product.skus.map((s,i)=>({...s,bomCode:i<2?'PENDING-A':''})));assert.equal(duplicate.statusCode,200,duplicate.body);
    const {rows:preserved}=await db.query('SELECT bom_code FROM product_sku WHERE id=$1',[originalIds[1]]);assert.equal(preserved[0].bom_code,'PENDING-A');
    const another=await app.inject({method:'POST',url:'/api/v1/config/products',headers:admin,payload:{...payload,name:'另一产品待补型号'}});assert.equal(another.statusCode,201,another.body);
  });

});
