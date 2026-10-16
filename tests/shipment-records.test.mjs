import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp,rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

test('Shipment records use actual handler scope across records, summaries, logs, options and exports',async t=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'mss-shipments-'));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  Object.assign(process.env,{SQLITE_PATH:path.join(dir,'test.db'),NODE_ENV:'test',SEED_DEMO_DATA:'true',SEED_HUAWEI_SCENARIOS:'false',JWT_SECRET:'shipment-record-test',LOG_LEVEL:'silent'});
  const [{default:migrate},db,{buildApp}] = await Promise.all([import('../server/src/db/migrate.ts'),import('../server/src/config/db.ts'),import('../server/src/app.ts')]);
  await migrate();const app=await buildApp();t.after(()=>app.close());
  async function login(employeeNo,password='123456'){const r=await app.inject({method:'POST',url:'/api/v1/auth/login',payload:{employeeNo,password}});assert.equal(r.statusCode,200,r.body);return {authorization:`Bearer ${r.json().data.token}`};}
  const admin=await login('admin','Admin@123'),stock=await login('chentao'),gtm=await login('wanglu'),otherGtm=await login('lina'),mss=await login('zhaomin');
  const newUser=await app.inject({method:'POST',url:'/api/v1/config/users',headers:admin,payload:{employeeNo:'shipment-second',displayName:'第二处理人',role:'STOCKING_OWNER',password:'Shipment@123',productDomainIds:['wearables']}});
  assert.equal(newUser.statusCode,201,newUser.body);const second=await login('shipment-second','Shipment@123');
  const stockId=(await db.query("SELECT id FROM app_user WHERE employee_no='chentao'")).rows[0].id;
  await db.query("INSERT INTO user_scope_assignment(user_id,scope_type,scope_id) VALUES($1,'PRODUCT_DOMAIN','wearables') ON CONFLICT DO NOTHING",[stockId]);
  const secondId=(await db.query("SELECT id FROM app_user WHERE employee_no='shipment-second'")).rows[0].id;
  const sku=(await db.query("SELECT * FROM product_sku WHERE id='b19f'")).rows[0];
  const place=(await db.query(`SELECT c.id AS country_id,o.id AS office_id,r.id AS region_id FROM org_node c JOIN org_node o ON o.id=c.parent_id JOIN org_node r ON r.id=o.parent_id WHERE c.node_type='COUNTRY' ORDER BY c.id LIMIT 1`)).rows[0];
  const planId=(await db.query(`SELECT task.plan_id FROM execution_fact ef JOIN collection_plan_domain_task task ON task.id=ef.source_id WHERE ef.product_sku_id=$1 AND ef.source_type='CONFIRMED_DEMAND' LIMIT 1`,[sku.id])).rows[0].plan_id;
  await db.query('DELETE FROM execution_fact WHERE product_sku_id=$1',[sku.id]);
  await db.query(`INSERT INTO execution_fact(id,source_type,product_id,product_sku_id,mss_domain_id,region_id,office_id,country_id,quantity,collection_plan_id) VALUES($1,'CONFIRMED_DEMAND',$2,$3,'mss-mkt',$4,$5,$6,100,$7)`,[randomUUID(),sku.product_id,sku.id,place.region_id,place.office_id,place.country_id,planId]);
  const base={productModel:sku.model,bomCode:sku.bom_code,mssDomain:'mss-mkt',region:place.region_id,office:place.office_id,country:place.country_id,shippedQuantity:20,handlerName:'外部处理人甲',handlerEmployeeNo:'EXTERNAL-01',appliedAt:'2026-10-14T13:00:00Z',handledAt:'2026-10-14T14:00:00Z',applicationNo:'RECORD-APP-1',applicantName:'申请人甲',applicantEmployeeNo:'APPLICANT-01',shipmentNo:'RECORD-SHIP-1',sourceSystem:'TEST-SYNC',shippedAt:'2026-10-14T16:00:00Z',note:'原始发货说明'};
  const post=(payload=base,key=randomUUID(),headers=stock)=>app.inject({method:'POST',url:'/api/v1/integrations/shipments',headers:{...headers,'idempotency-key':key},payload});
  const get=(suffix='',filters={},headers=stock)=>app.inject({method:'GET',url:`/api/v1/integrations/shipments${suffix}?${new URLSearchParams({productId:sku.product_id,sourceSystem:'TEST-SYNC',...filters})}`,headers});
  const data=async(suffix='',filters={},headers=stock)=>{const r=await get(suffix,filters,headers);assert.equal(r.statusCode,200,r.body);return r.json().data;};
  let firstId;
  await t.test('extended API writes immutable metadata, facts and success log; retries do not add',async()=>{
    const first=await post(base,'record-first');assert.equal(first.statusCode,200,first.body);firstId=first.json().data.deliveryId;
    const again=await post(base,'record-first');assert.equal(again.statusCode,200,again.body);assert.equal(again.json().data.replayed,true);
    assert.equal((await post({...base,applicantName:'已改申请人'},'record-first')).statusCode,409);
    const facts=(await db.query('SELECT source_type,quantity FROM execution_fact WHERE source_id=$1',[firstId])).rows;
    assert.deepEqual(facts.map(f=>f.source_type).sort(),['APPLICATION','SHIPMENT']);assert.ok(facts.every(f=>f.quantity===20));
    const details=await data();assert.equal(details.total,1);assert.equal(details.totals.shippedQuantity,20);
    const r=details.items[0];assert.equal(r.handlerId,stockId);assert.equal(r.applicantName,'申请人甲');assert.equal(r.handlerName,'外部处理人甲');assert.notEqual(r.handlerEmployeeNo,r.applicantEmployeeNo);
    const logs=await data('/logs');assert.equal(logs.items.filter(l=>l.outcome==='SUCCESS').length,1);assert.equal(logs.items.filter(l=>l.outcome==='REPLAY').length,1);assert.equal(logs.items.find(l=>l.outcome==='REPLAY').quantityAdded,0);
  });
  await t.test('external people are free text and never resolve or transfer system account ownership',async()=>{
    const good=await post({...base,handlerName:'外部处理人乙',handlerEmployeeNo:'EXTERNAL-02',shippedQuantity:10,shipmentNo:'RECORD-SHIP-2',shippedAt:'2026-10-14T15:59:59Z'},'record-second',second);assert.equal(good.statusCode,200,good.body);
    const secondView=await data('',{},second);assert.equal(secondView.total,1);assert.equal(secondView.items[0].handlerId,secondId);assert.equal(secondView.items[0].recordOwnerId,secondId);assert.equal(secondView.items[0].handlerEmployeeNo,'EXTERNAL-02');
    // Even a real user's employee number remains text; it grants that user no visibility.
    const spoof=await post({...base,handlerName:'外部任意姓名',handlerEmployeeNo:'chentao'},'text-not-account',second);assert.equal(spoof.statusCode,200,spoof.body);
    assert.equal((await data()).total,1);assert.equal((await data('',{handler:'employee:chentao'},second)).total,1);assert.equal((await data('',{handler:'employee:chentao'},stock)).total,0);
    const delivery=spoof.json().data.deliveryId;
    await db.query('DELETE FROM integration_shipment_call WHERE delivery_id=$1',[delivery]);await db.query('DELETE FROM execution_fact WHERE source_id=$1',[delivery]);await db.query('DELETE FROM integration_delivery WHERE id=$1',[delivery]);
  });
  await t.test('all read surfaces enforce personal handler versus current GTM product scope',async()=>{
    for(const suffix of ['', '/summary','/logs','/options','/export']){
      assert.equal((await get(suffix,{},{})).statusCode,401);assert.equal((await get(suffix,{},mss)).statusCode,403);
    }
    assert.equal((await data('',{},gtm)).totals.shippedQuantity,30);assert.equal((await data('',{},admin)).totals.shippedQuantity,30);
    assert.equal((await data('',{},otherGtm)).total,0);
    for(const suffix of ['', '/summary','/logs','/export']){
      const d=await data(suffix,{handlerId:secondId},stock);
      assert.equal(d.total ?? d.rowCount,0,`spoofed filter on ${suffix}`);
    }
    const optionStock=await data('/options',{},stock),optionGtm=await data('/options',{},gtm);
    assert.deepEqual(optionStock.handler.map(o=>o.value),['employee:EXTERNAL-01']);assert.ok(optionGtm.handler.some(o=>o.value==='employee:EXTERNAL-02'));
    assert.ok(!optionStock.productId.some(o=>o.label.includes('Pura')));
    const exportStock=await data('/export',{},stock);assert.equal(exportStock.rowCount,1);assert.ok(exportStock.content.includes('APPLICANT-01'));assert.ok(!exportStock.content.includes('外部处理人乙'));
    assert.equal((await data('/export',{},gtm)).rowCount,2);
    const me=await app.inject({url:'/api/v1/config/auth/me',headers:gtm});assert.ok(me.json().data.permissions.includes('shipment:read'));assert.ok(!me.json().data.permissions.includes('shipment:approve'));
  });
  await t.test('summary, exact drill-down, pagination, distinct applications and Beijing date boundaries',async()=>{
    const s=await data('/summary',{groupBy:'handler'},gtm);assert.equal(s.total,2);assert.equal(s.totals.applicationCount,1);assert.equal(s.totals.countryCount,1);
    const group=s.items.find(r=>r.value==='employee:EXTERNAL-02');const drill=await data('',{groupBy:'handler',groupValue:group.value},gtm);assert.equal(drill.total,1);assert.equal(drill.items[0].handlerId,secondId);
    assert.equal((await data('',{from:'2026-10-15',to:'2026-10-15'},gtm)).totals.shippedQuantity,20);
    assert.equal((await data('',{from:'2026-10-14',to:'2026-10-14'},gtm)).totals.shippedQuantity,10);
    const p1=await data('',{pageSize:1,page:1},gtm),p2=await data('',{pageSize:1,page:2},gtm);assert.equal(p1.total,2);assert.notEqual(p1.items[0].id,p2.items[0].id);
    for(const patch of [{page:0},{pageSize:101},{groupBy:'invalid'},{from:'2026-02-30'},{from:'2026-10-16',to:'2026-10-14'}])assert.equal((await get('',patch)).statusCode,422);
    assert.equal((await data('/export',{tab:'summary',groupBy:'handler'},gtm)).rowCount,2);
  });
  await t.test('validation failures and transaction failures leave only zero-impact logs',async()=>{
    const before=(await data()).totals.shippedQuantity;
    assert.equal((await post({...base,shippedQuantity:0},'bad-number')).statusCode,422);
    assert.equal((await post({...base,sourceSystem:undefined,shippedQuantity:0},'default-source-failure')).statusCode,422);
    assert.ok((await data('/logs',{sourceSystem:'INTEGRATION_API',outcome:'FAILURE'})).items.some(l=>l.idempotencyKey==='default-source-failure'));
    assert.equal((await post({...base,shippedAt:'invalid'},'bad-date')).statusCode,422);
    await db.query(`CREATE TRIGGER reject_record BEFORE INSERT ON shipment_record BEGIN SELECT RAISE(ABORT,'forced shipment metadata failure'); END`);
    assert.equal((await post(base,'atomic-fail')).statusCode,500);
    await db.query('DROP TRIGGER reject_record');
    assert.equal((await db.query("SELECT id FROM integration_delivery WHERE idempotency_key='atomic-fail'")).rows.length,0);
    assert.equal((await data()).totals.shippedQuantity,before);
    const logs=await data('/logs',{outcome:'FAILURE'});assert.ok(logs.items.some(l=>l.idempotencyKey==='bad-date'));assert.ok(logs.items.some(l=>l.idempotencyKey==='atomic-fail'));assert.ok(logs.items.every(l=>l.quantityAdded===0));
    assert.equal((await data('/logs',{outcome:'FAILURE',countryId:place.country_id})).total,logs.total);
    assert.ok((await data('/export',{tab:'logs',outcome:'FAILURE'})).rowCount>0);
  });
  await t.test('concurrent retries write one business record and four real attempts; successful-log failure rolls all facts back',async()=>{
    const responses=await Promise.all(Array.from({length:4},()=>post({...base,shipmentNo:'RECORD-CONCURRENT'},'record-concurrent')));
    assert.ok(responses.every(r=>r.statusCode===200));assert.equal(responses.filter(r=>!r.json().data.replayed).length,1);
    const calls=(await db.query("SELECT outcome,quantity_added FROM integration_shipment_call WHERE snapshot LIKE '%record-concurrent%'")).rows;
    assert.equal(calls.length,4);assert.equal(calls.reduce((n,r)=>n+r.quantity_added,0),20);
    const business=(await db.query("SELECT sr.fact_id FROM shipment_record sr JOIN execution_fact ef ON ef.id=sr.fact_id JOIN integration_delivery d ON d.id=ef.source_id WHERE d.idempotency_key='record-concurrent'")).rows;assert.equal(business.length,1);
    await db.query(`CREATE TRIGGER reject_success_log BEFORE INSERT ON integration_shipment_call WHEN NEW.outcome='SUCCESS' BEGIN SELECT RAISE(ABORT,'forced log failure'); END`);
    try{assert.equal((await post(base,'log-atomic-fail')).statusCode,500);}finally{await db.query('DROP TRIGGER reject_success_log');}
    assert.equal((await db.query("SELECT id FROM integration_delivery WHERE idempotency_key='log-atomic-fail'")).rows.length,0);
    assert.equal((await db.query("SELECT outcome,quantity_added FROM integration_shipment_call WHERE snapshot LIKE '%log-atomic-fail%'")).rows[0].quantity_added,0);
    // Remove this scenario's rows so later fixture expectations remain simple.
    const delivery=responses[0].json().data.deliveryId;
    await db.query('DELETE FROM integration_shipment_call WHERE delivery_id=$1',[delivery]);
    await db.query('DELETE FROM execution_fact WHERE source_id=$1',[delivery]);
    await db.query('DELETE FROM integration_delivery WHERE id=$1',[delivery]);
  });
  await t.test('names freeze and stocking scope stays personal after ownership changes; GTM ownership follows current configuration',async()=>{
    await db.query("UPDATE app_user SET display_name='改名后' WHERE id=$1",[stockId]);
    assert.equal((await data()).items[0].handlerName,'外部处理人甲');
    const original=(await db.query("SELECT gtm_owner_id,stocking_owner_id FROM product_domain WHERE id='wearables'")).rows[0];
    await db.query("UPDATE product_domain SET stocking_owner_id=$1,gtm_owner_id=(SELECT id FROM app_user WHERE employee_no='lina') WHERE id='wearables'",[secondId]);
    const gtmId=(await db.query("SELECT id FROM app_user WHERE employee_no='wanglu'")).rows[0].id;
    await db.query("DELETE FROM user_scope_assignment WHERE user_id=$1 AND scope_type='PRODUCT_DOMAIN' AND scope_id='wearables'",[gtmId]);
    assert.equal((await data()).total,1);assert.equal((await data('',{},gtm)).total,0);assert.equal((await data('',{},otherGtm)).total,2);
    assert.equal((await data('/logs',{},gtm)).total,0);
    await db.query("UPDATE product_domain SET gtm_owner_id=$1,stocking_owner_id=$2 WHERE id='wearables'",[original.gtm_owner_id,original.stocking_owner_id]);
  });
  await t.test('TSMP matched rows appear once; legacy unknown handler remains hidden from personal scope',async()=>{
    const nodes=(await db.query('SELECT id,name FROM org_node')).rows;
    const name=id=>nodes.find(n=>n.id===id).name;
    const imported=await app.inject({method:'POST',url:'/api/v1/execution/imports',headers:second,payload:{fileName:'records.xlsx',rows:[{mssDomain:'MKT领域',sku:sku.model,bomCode:sku.bom_code,region:name(place.region_id),office:name(place.office_id),country:name(place.country_id),shippedQty:4,handlerName:'TSMP外部人',handlerEmployeeNo:'TSMP-NO-ACCOUNT',applicantName:'TSMP申请人',appliedAt:'2026-10-14T12:00:00Z',handledAt:'2026-10-14T13:00:00Z',externalKey:'RECORD-IMPORT',applicationNo:'RECORD-APP-IMPORT',shippedAt:'2026-10-15T09:00:00Z'}]}});
    assert.equal(imported.statusCode,202,imported.body);assert.equal(imported.json().data.matchedRows,1);
    const importedView=await data('',{sourceSystem:'TSMP'},second);assert.equal(importedView.totals.shippedQuantity,4);assert.equal(importedView.items[0].handlerName,'TSMP外部人');assert.equal(importedView.items[0].handledAt,'2026-10-14T13:00:00Z');assert.ok(importedView.items[0].recordedAt);assert.equal((await data('',{sourceSystem:'TSMP'},stock)).total,0);
    const legacyId=randomUUID();await db.query(`INSERT INTO execution_fact(id,source_type,product_id,product_sku_id,mss_domain_id,region_id,office_id,country_id,quantity) VALUES($1,'SHIPMENT',$2,$3,'mss-mkt',$4,$5,$6,3)`,[legacyId,sku.product_id,sku.id,place.region_id,place.office_id,place.country_id]);
    const all=await data('',{sourceSystem:'历史数据'},admin);assert.ok(all.items.some(r=>r.id===legacyId));assert.equal((await data('',{sourceSystem:'历史数据'},stock)).total,0);
  });
  await t.test('business times persist and retries retain original recorded time; absent times or people are not fabricated',async()=>{
    const first=(await data()).items.find(r=>r.deliveryId===firstId);
    assert.equal(first.appliedAt,base.appliedAt);assert.equal(first.handledAt,base.handledAt);assert.ok(first.recordedAt);assert.equal(first.shippedAtSource,'PROVIDED');
    const replay=await post(base,'record-first');assert.equal(replay.statusCode,200,replay.body);
    assert.equal((await data()).items.find(r=>r.deliveryId===firstId).recordedAt,first.recordedAt);
    assert.equal((await post({...base,handledAt:'2026-10-14T15:00:00Z'},'record-first')).statusCode,409);
    for(const key of ['appliedAt','handledAt'])assert.equal((await post({...base,[key]:'invalid'},'bad-'+key)).statusCode,422);
    const minimal={productModel:base.productModel,bomCode:base.bomCode,mssDomain:base.mssDomain,region:base.region,office:base.office,country:base.country,shippedQuantity:1,sourceSystem:'MINIMAL-TIME'};
    assert.equal((await post(minimal,'minimal-time')).statusCode,200);
    const record=(await data('',{sourceSystem:'MINIMAL-TIME'})).items[0];assert.equal(record.handlerName,'');assert.equal(record.handlerEmployeeNo,'');assert.equal(record.appliedAt,null);assert.equal(record.handledAt,null);assert.ok(record.recordedAt);assert.ok(record.shippedAt);assert.equal(record.shippedAtSource,'RECEIVED_AT');
    const logs=(await data('/logs',{sourceSystem:'TEST-SYNC',outcome:'SUCCESS'})).items.find(r=>r.deliveryId===firstId);assert.equal(logs.appliedAt,base.appliedAt);assert.ok(logs.recordedAt);assert.ok(logs.receivedAt);
    const csv=await data('/export');assert.ok(csv.content.includes('申请时间'));assert.ok(csv.content.includes('处理时间'));assert.ok(csv.content.includes('入账时间'));assert.ok(csv.content.includes(base.handledAt));
  });
  await t.test('identical SKU names remain distinct summary groups, exports escape formulas, and reset clears new tables',async()=>{
    const {recordShipment}=await import('../server/src/domains/integration/shipment-records.ts');
    const duplicateId=randomUUID();await db.query('INSERT INTO product_sku(id,product_id,model,bom_code) VALUES($1,$2,$3,$4)',[duplicateId,sku.product_id,sku.model,sku.bom_code]);
    for(const [id,qty] of [[sku.id,6],[duplicateId,7]]){
      const factId=randomUUID();await db.query(`INSERT INTO execution_fact(id,source_type,product_id,product_sku_id,mss_domain_id,region_id,office_id,country_id,quantity) VALUES($1,'SHIPMENT',$2,$3,'mss-mkt',$4,$5,$6,$7)`,[factId,sku.product_id,id,place.region_id,place.office_id,place.country_id,qty]);
      await recordShipment(db,factId,stockId,stockId,{sourceSystem:'DUPLICATE-SKU',applicationNo:'=FORMULA()'});
    }
    const sum=await data('/summary',{sourceSystem:'DUPLICATE-SKU',groupBy:'sku'});assert.equal(sum.total,2);assert.equal(sum.items[0].label,sum.items[1].label);assert.notEqual(sum.items[0].value,sum.items[1].value);
    assert.equal((await data('',{sourceSystem:'DUPLICATE-SKU',groupBy:'sku',groupValue:duplicateId})).total,1);
    assert.ok((await data('/export',{sourceSystem:'DUPLICATE-SKU'})).content.includes("'=FORMULA()"));
    const {resetBetaBusinessData}=await import('../server/src/db/reset-beta-data.ts');const client=await db.getClient();
    try{const r=await resetBetaBusinessData(client);assert.ok(r.deletedRows.shipment_record>0);assert.ok(r.deletedRows.integration_shipment_call>0);}finally{client.release();}
    assert.equal((await data()).total,0);assert.equal((await data('/logs')).total,0);
  });

});
