import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import os from 'node:os';
import path from 'node:path';

test('Multiple users share product and MSS scopes without replacing or broadening each other',async t=>{
  const dir=await mkdtemp(path.join(os.tmpdir(),'mss-shared-scopes-'));
  Object.assign(process.env,{SQLITE_PATH:path.join(dir,'test.db'),NODE_ENV:'test',SEED_DEMO_DATA:'true',SEED_HUAWEI_SCENARIOS:'false',JWT_SECRET:'shared-scope-test',LOG_LEVEL:'silent'});
  const [{default:migrate},db,{buildApp}]=await Promise.all([import('../server/src/db/migrate.ts'),import('../server/src/config/db.ts'),import('../server/src/app.ts')]);
  await migrate();const app=await buildApp();t.after(async()=>{await app.close();await rm(dir,{recursive:true,force:true});});
  async function login(employeeNo,password='Shared@123'){const r=await app.inject({method:'POST',url:'/api/v1/auth/login',payload:{employeeNo,password}});assert.equal(r.statusCode,200,r.body);return {authorization:`Bearer ${r.json().data.token}`};}
  const admin=await login('admin','Admin@123');
  const call=(method,url,payload,headers=admin)=>app.inject({method,url:'/api/v1'+url,payload,headers});
  async function ok(method,url,payload,headers=admin,status=200){const r=await call(method,url,payload,headers);assert.equal(r.statusCode,status,r.body);return r.json().data;}
  async function user(employeeNo,role,scopes){const u=await ok('POST','/config/users',{employeeNo,displayName:employeeNo,role,password:'Shared@123',...scopes},admin,201);return {...u,headers:await login(employeeNo)};}
  const a=await user('shared-gtm-a','GTM',{productDomainIds:['mobile','wearables']});
  const b=await user('shared-gtm-b','GTM',{productDomainIds:['mobile']});
  const stockA=await user('shared-stock-a','STOCKING_OWNER',{productDomainIds:['mobile']});
  const stockB=await user('shared-stock-b','STOCKING_OWNER',{productDomainIds:['mobile']});
  const mssA=await user('shared-mss-a','MSS_DOMAIN_OWNER',{mssDomainIds:['mss-mkt','mss-retail']});
  const mssB=await user('shared-mss-b','MSS_DOMAIN_OWNER',{mssDomainIds:['mss-mkt']});
  const outsider=await login('zhouhang','123456');
  const country=(await db.query("SELECT id FROM org_node WHERE parent_id='de-office' AND node_type='COUNTRY' LIMIT 1")).rows[0].id;
  let product,plan,task;

  await t.test('saving and editing a second user preserves everyone else and partial edits preserve other scopes',async()=>{
    let users=await ok('GET','/config/users');
    for(const u of [a,b,stockA,stockB])assert.ok(users.find(x=>x.id===u.id).productDomainIds.includes('mobile'));
    for(const u of [mssA,mssB])assert.ok(users.find(x=>x.id===u.id).mssDomainIds.includes('mss-mkt'));
    await ok('PUT',`/config/users/${b.id}`,{displayName:'shared-gtm-b-renamed',role:'GTM'});
    users=await ok('GET','/config/users');assert.deepEqual(users.find(x=>x.id===b.id).productDomainIds,['mobile']);
    assert.deepEqual(new Set(users.find(x=>x.id===a.id).productDomainIds),new Set(['mobile','wearables']));
    const bad=await call('PUT',`/config/users/${b.id}`,{productDomainIds:['not-a-domain']});assert.equal(bad.statusCode,422);
    assert.deepEqual((await ok('GET','/config/users')).find(x=>x.id===b.id).productDomainIds,['mobile']);
  });
  await t.test('upgrade backfills legacy contacts additively and does not duplicate shared grants',async()=>{
    const lina=(await db.query("SELECT id FROM app_user WHERE employee_no='lina'")).rows[0].id;
    await db.query("DELETE FROM user_scope_assignment WHERE user_id=$1 AND scope_type='PRODUCT_DOMAIN' AND scope_id='mobile'",[lina]);
    const sql=await readFile(new URL('../server/src/db/migrations/024_shared_user_scopes.sql',import.meta.url),'utf8');
    const client=await db.getClient();try{await client.query(sql);await client.query(sql);}finally{client.release();}
    const scopes=(await db.query("SELECT user_id FROM user_scope_assignment WHERE scope_type='PRODUCT_DOMAIN' AND scope_id='mobile'")).rows;
    assert.ok(scopes.some(x=>x.user_id===lina));assert.ok(scopes.some(x=>x.user_id===a.id));assert.ok(scopes.some(x=>x.user_id===b.id));assert.equal(scopes.filter(x=>x.user_id===b.id).length,1);
  });
  await t.test('both GTMs see, create, edit and release the same product while unassigned users stay excluded',async()=>{
    product=await ok('POST','/config/products',{name:'共享权限手机',domainId:'mobile',skus:[{model:'SHARED-MOBILE',bomCode:'SHARED-001'}]},a.headers,201);
    for(const u of [a,b])assert.ok((await ok('GET','/config/catalog',undefined,u.headers)).products.some(p=>p.id===product.id));
    assert.ok(!(await ok('GET','/config/catalog',undefined,outsider)).products.some(p=>p.id===product.id));
    product=await ok('PUT',`/config/products/${product.id}`,{name:product.name,domainId:'mobile',skus:product.skus,version:product.version},b.headers);
    plan=await ok('POST','/collection/plans',{productId:product.id,stage:'V3',deadline:'2099-01-01T00:00:00Z'},a.headers,201);
    assert.equal((await ok('GET',`/collection/plans/${plan.id}`,undefined,b.headers)).id,plan.id);
    assert.equal((await call('POST','/collection/plans',{productId:product.id,stage:'V4',deadline:'2099-01-01T00:00:00Z'},outsider)).statusCode,403);
    plan=await ok('POST',`/collection/plans/${plan.id}/release`,{version:plan.version},b.headers);task=plan.domainTasks.find(x=>x.mssDomainId==='mss-mkt');
  });
  await t.test('both MSS owners can act on their common task, including regional draft access and formal feedback',async()=>{
    await ok('POST',`/collection/domain-tasks/${task.id}/dispatch`,{productSkuIds:[product.skus[0].id],organizationNodeIds:['de-office']},mssA.headers);
    const url=`/collection/plans/${plan.id}/regions/europe`,suffix=`?domainTaskId=${task.id}`;
    const draft=await ok('PUT',url+'/draft'+suffix,{items:[{productItemKey:product.skus[0].id,officeId:'de-office',quantity:12,basis:'共享范围回归'}]},mssB.headers);
    await ok('GET',url+'/draft'+suffix,undefined,mssA.headers);
    await ok('POST',url+'/submit'+suffix,{version:draft.version},mssA.headers);
    await ok('POST',`/collection/domain-tasks/${task.id}/feedback`,{confirmed:true,note:'共同负责领域的正式反馈'},mssB.headers);
    const latest=await ok('GET',`/collection/plans/${plan.id}`,undefined,b.headers);
    await ok('POST',`/collection/plans/${plan.id}/complete`,{confirmed:true,version:latest.version},b.headers);
    for(const u of [a,b]){const view=await ok('GET',`/execution?productId=${product.id}`,undefined,u.headers);assert.equal(view.metrics.demand,12);}
    for(const u of [mssA,mssB]){const view=await ok('GET',`/execution?productId=${product.id}`,undefined,u.headers);assert.equal(view.metrics.demand,12);}
  });
  await t.test('shared stocking scopes allow queries/shipments; GTMs see all product records and stocking records stay personal',async()=>{
    const body={productModel:'SHARED-MOBILE',bomCode:'SHARED-001',mssDomain:'mss-mkt',region:'europe',office:'de-office',country};
    for(const [u,n] of [[stockA,2],[stockB,3]]){
      const q=await ok('GET','/integrations/stocking-demands?'+new URLSearchParams(body),undefined,u.headers);assert.equal(q.demandQuantity,12);
      await ok('POST','/integrations/shipments',{...body,shippedQuantity:n},{...u.headers,'idempotency-key':u.id});
    }
    for(const u of [a,b]){const records=await ok('GET',`/integrations/shipments?productId=${product.id}`,undefined,u.headers);assert.equal(records.total,2);assert.equal(records.totals.shippedQuantity,5);}
    for(const u of [stockA,stockB]){const records=await ok('GET',`/integrations/shipments?productId=${product.id}`,undefined,u.headers);assert.equal(records.total,1);}
    const inventoryId=randomUUID();
    await db.query(`INSERT INTO inventory_balance(id,product_id,product_sku_id,warehouse,system_quantity,actual_quantity,available_quantity) VALUES($1,$2,$3,'共享仓',10,10,10)`,[inventoryId,product.id,product.skus[0].id]);
    for(const u of [stockA,stockB]){const view=await ok('GET',`/inventory?productId=${product.id}`,undefined,u.headers);assert.equal(view.items.length,1);await ok('PUT',`/inventory/${inventoryId}/check`,{actualQuantity:10,reason:'共享备货范围',version:view.items[0].version},u.headers);}
    await ok('PUT',`/config/users/${stockA.id}`,{productDomainIds:['wearables']});
    assert.equal((await call('GET','/integrations/stocking-demands?'+new URLSearchParams(body),undefined,stockA.headers)).statusCode,403);
    assert.equal((await ok('GET',`/inventory?productId=${product.id}`,undefined,stockA.headers)).items.length,0);
    assert.equal((await ok('GET',`/inventory?productId=${product.id}`,undefined,stockB.headers)).items.length,1);
  });
  await t.test('removing one GTM grant revokes reads and writes even for the default contact, without affecting the other GTM',async()=>{
    const domain=(await ok('GET','/config/catalog')).domains.find(x=>x.id==='mobile');
    await ok('PUT','/config/domains/mobile',{...domain,gtmOwner:a.employeeNo});
    await ok('PUT',`/config/users/${a.id}`,{productDomainIds:['wearables']});
    const after=(await ok('GET','/config/catalog')).domains.find(x=>x.id==='mobile');
    await ok('PUT','/config/domains/mobile',{...after,description:'修改说明不能恢复已撤销的范围'});
    assert.ok(!(await ok('GET','/config/catalog',undefined,a.headers)).products.some(p=>p.id===product.id));
    assert.ok([403,404].includes((await call('GET',`/collection/plans/${plan.id}`,undefined,a.headers)).statusCode));
    assert.equal((await call('POST','/collection/plans',{productId:product.id,stage:'V4',deadline:'2099-01-01T00:00:00Z'},a.headers)).statusCode,403);
    assert.equal((await ok('GET',`/integrations/shipments?productId=${product.id}`,undefined,a.headers)).total,0);
    assert.equal((await ok('GET',`/collection/plans/${plan.id}`,undefined,b.headers)).id,plan.id);
    assert.equal((await ok('GET',`/integrations/shipments?productId=${product.id}`,undefined,b.headers)).total,2);
  });
  await t.test('removing one MSS grant prevents domain access and does not clear the second owner',async()=>{
    await ok('PUT',`/config/users/${mssA.id}`,{mssDomainIds:['mss-retail']});
    const url=`/collection/plans/${plan.id}/regions/europe/draft?domainTaskId=${task.id}`;
    assert.equal((await call('GET',url,undefined,mssA.headers)).statusCode,403);
    await ok('GET',url,undefined,mssB.headers);
    const view=await ok('GET',`/execution?productId=${product.id}`,undefined,mssA.headers);assert.equal(view.metrics.demand,0);
    assert.ok((await ok('GET','/config/users')).find(u=>u.id===mssB.id).mssDomainIds.includes('mss-mkt'));
  });
});
