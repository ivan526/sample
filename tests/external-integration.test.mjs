import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
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
  await db.query('DELETE FROM execution_fact WHERE product_sku_id=$1',[sku.id]);
  async function fact(type,quantity,office=place.office_id,country=null,domain='mss-mkt') {
    await db.query(`INSERT INTO execution_fact (id,source_type,product_id,product_sku_id,mss_domain_id,region_id,office_id,country_id,quantity) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,[randomUUID(),type,sku.product_id,sku.id,domain,place.region_id,office,country,quantity]);
  }
  await fact('CONFIRMED_DEMAND',100);await fact('APPLICATION',30);await fact('SHIPMENT',10,place.office_id,place.country_id);
  await fact('CONFIRMED_DEMAND',20,place.office_id,place.country_id);await fact('APPLICATION',5,place.office_id,place.country_id);await fact('SHIPMENT',7,place.office_id,place.country_id);
  await fact('CONFIRMED_DEMAND',30,place.office_id,'ext-country-2');await fact('APPLICATION',15,place.office_id,'ext-country-2');await fact('SHIPMENT',3,place.office_id,'ext-country-2');
  await fact('CONFIRMED_DEMAND',40,'ext-office-2','ext-country-3');await fact('APPLICATION',10,'ext-office-2','ext-country-3');await fact('SHIPMENT',4,'ext-office-2','ext-country-3');
  await fact('CONFIRMED_DEMAND',50,place.office_id,place.country_id,'mss-retail');await fact('APPLICATION',10,place.office_id,place.country_id,'mss-retail');await fact('SHIPMENT',5,place.office_id,place.country_id,'mss-retail');
  const base={productModel:sku.model,bomCode:sku.bom_code};
  const query=async(filters={},headers=stocking)=>app.inject({method:'GET',url:`/api/v1/integrations/stocking-demands?${new URLSearchParams({...base,...filters})}`,headers});
  await t.test('optional filters aggregate all descendants and blank means all',async()=>{
    const global=(await query()).json().data;assert.equal(global.demandQuantity,240);assert.equal(global.shippedQuantity,29);assert.equal(global.remainingToApply,170);
    const office=(await query({mssDomain:'MKT样机',region:place.region_name,office:place.office_name,country:''})).json().data;
    assert.equal(office.demandQuantity,150);assert.equal(office.appliedQuantity,50);assert.equal(office.shippedQuantity,20);assert.equal(office.remainingToApply,100);
    const region=(await query({mssDomain:'mss-mkt',region:place.region_id})).json().data;assert.equal(region.demandQuantity,190);assert.equal(region.shippedQuantity,24);
    const country=(await query({mssDomain:'mss-mkt',country:place.country_id})).json().data;assert.equal(country.demandQuantity,20);assert.equal(country.shippedQuantity,17);assert.equal(country.officeUnallocatedDemandQuantity,100);assert.equal(country.officeUnallocatedAppliedQuantity,30);
    assert.equal((await query({office:'ext-office-2',country:place.country_id})).statusCode,422);
    assert.equal((await query({bomCode:'BAD'})).statusCode,422);assert.equal((await query({productModel:'wrong'})).statusCode,422);
    assert.equal((await query({productModel:''})).statusCode,422);assert.equal((await query({region:'unknown'})).statusCode,422);
  });
  const body={...base,mssDomain:'mss-mkt',region:place.region_id,office:place.office_id,country:place.country_id,stockedQuantity:8,shippedQuantity:5};
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
    const retry=await post();assert.equal(retry.json().data.replayed,true);assert.equal(retry.json().data.deliveryId,first.json().data.deliveryId);
    assert.equal((await post({...body,shippedQuantity:6})).statusCode,409);
    const counts=(await query()).json().data;assert.equal(counts.stockedQuantity,8);assert.equal(counts.shippedQuantity,34);assert.equal(counts.remainingToApply,170);
    const {rows:audit}=await db.query("SELECT * FROM audit_log WHERE action='INTEGRATION_SHIPMENT_ADDED'");assert.equal(audit.length,1);
    const responses=await Promise.all(Array.from({length:4},()=>post(body,'concurrent')));assert.ok(responses.every(r=>r.statusCode===200));assert.equal(responses.filter(r=>!r.json().data.replayed).length,1);
    assert.equal((await query()).json().data.shippedQuantity,39);
    const view=await app.inject({method:'GET',url:`/api/v1/execution?productId=${sku.product_id}&regionId=${place.region_id}&officeId=ext-office-2`,headers:admin});
    assert.equal(view.statusCode,200,view.body);const row=view.json().data.products.flatMap(p=>p.skus).find(s=>s.id===sku.id);assert.equal(row.stocked,0);
  });
  await t.test('invalid inputs and missing demand never persist; transaction errors roll back',async()=>{
    for(const patch of [{stockedQuantity:-1},{shippedQuantity:1.2},{stockedQuantity:2147483648},{country:''},{office:'unknown'},{stockedQuantity:0,shippedQuantity:0}])assert.equal((await post({...body,...patch},randomUUID())).statusCode,422);
    assert.equal((await post(body,'')).statusCode,422);
    assert.equal((await post({...body,mssDomain:'mss-service'},'no-confirmed')).statusCode,422);
    assert.equal((await db.query("SELECT id FROM integration_delivery WHERE idempotency_key='no-confirmed'")).rows.length,0);
    const before=(await query()).json().data.shippedQuantity;
    await db.query("CREATE TRIGGER reject_external_audit BEFORE INSERT ON audit_log WHEN NEW.action='INTEGRATION_SHIPMENT_ADDED' BEGIN SELECT RAISE(ABORT,'forced rollback'); END;");
    assert.equal((await post(body,'rollback')).statusCode,500);
    await db.query('DROP TRIGGER reject_external_audit');
    assert.equal((await query()).json().data.shippedQuantity,before);
    assert.equal((await db.query("SELECT id FROM integration_delivery WHERE idempotency_key='rollback'")).rows.length,0);
    assert.equal((await post(body,'rollback')).statusCode,200);
  });
  await t.test('repeated models with distinct BOMs persist and remain separate',async()=>{
    const payload={name:'同型号测试',domainId:'wearables',skus:[{model:'同型号',bomCode:'PAIR-A'},{model:'同型号',bomCode:'PAIR-B'}]};
    const create=await app.inject({method:'POST',url:'/api/v1/config/products',headers:admin,payload});assert.equal(create.statusCode,201,create.body);
    const product=create.json().data;assert.equal(product.skus.length,2);assert.notEqual(product.skus[0].id,product.skus[1].id);
    const duplicate=await app.inject({method:'POST',url:'/api/v1/config/products',headers:admin,payload:{...payload,name:'重复测试'}});assert.equal(duplicate.statusCode,422,duplicate.body);
    const update=await app.inject({method:'PUT',url:`/api/v1/config/products/${product.id}`,headers:admin,payload:{...payload,version:product.version,skus:product.skus.map(s=>({id:s.id,model:s.model,bomCode:s.bomCode,description:'updated'}))}});assert.equal(update.statusCode,200,update.body);
    const lookup=await query({productModel:'同型号',bomCode:'PAIR-B'});assert.equal(lookup.statusCode,200,lookup.body);assert.equal(lookup.json().data.demandQuantity,0);
    const pairDuplicate=await app.inject({method:'POST',url:'/api/v1/config/products',headers:admin,payload:{...payload,skus:[{model:'重复组合',bomCode:'A'},{model:'重复组合',bomCode:'A'}]}});assert.equal(pairDuplicate.statusCode,422);
  });
  await t.test('shared BOM requires model disambiguation in TSMP and queries',async()=>{
    const product=await app.inject({method:'POST',url:'/api/v1/config/products',headers:admin,payload:{name:'BOM重名验证',domainId:'wearables',skus:[{model:'型号甲',bomCode:'SHARED-BOM'},{model:'型号乙',bomCode:'SHARED-BOM'}]}});
    assert.equal(product.statusCode,201,product.body);
    for(const item of product.json().data.skus)await db.query(`INSERT INTO execution_fact(id,source_type,product_id,product_sku_id,mss_domain_id,region_id,office_id,quantity)VALUES($1,'CONFIRMED_DEMAND',$2,$3,'mss-mkt',$4,$5,10)`,[randomUUID(),product.json().data.id,item.id,place.region_id,place.office_id]);
    const row={mssDomain:'MKT领域',bomCode:'SHARED-BOM',region:place.region_name,office:place.office_name,country:place.country_name,shippedQty:1};
    const ambiguous=await app.inject({method:'POST',url:'/api/v1/execution/imports',headers:admin,payload:{fileName:'ambiguous.xlsx',rows:[{...row,externalKey:'ambiguous-bom'}]}});
    assert.equal(ambiguous.statusCode,202,ambiguous.body);assert.equal(ambiguous.json().data.matchedRows,0);assert.equal(ambiguous.json().data.unmatchedRows,1);
    const exact=await app.inject({method:'POST',url:'/api/v1/execution/imports',headers:admin,payload:{fileName:'exact.xlsx',rows:[{...row,sku:'型号乙',externalKey:'exact-bom'}]}});
    assert.equal(exact.statusCode,202,exact.body);assert.equal(exact.json().data.matchedRows,1);
    assert.equal((await query({productModel:'型号甲',bomCode:'SHARED-BOM'})).json().data.shippedQuantity,0);
    assert.equal((await query({productModel:'型号乙',bomCode:'SHARED-BOM'})).json().data.shippedQuantity,1);
  });

});
