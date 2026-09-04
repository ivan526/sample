import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

test('TypeScript API closes collection, execution, import and inventory flows', async (t) => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'mss-api-v1-'));
  t.after(() => rm(tempDir, { recursive: true, force: true }));
  process.env.SQLITE_PATH = path.join(tempDir, 'test.db');
  process.env.NODE_ENV = 'test';
  process.env.SEED_DEMO_DATA = 'true';
  process.env.JWT_SECRET = 'integration-test-secret';
  process.env.LOG_LEVEL = 'silent';

  const [{ default: migrate }, { buildApp }] = await Promise.all([
    import('../server/src/db/migrate.ts'),
    import('../server/src/app.ts'),
  ]);
  await migrate();
  const app = await buildApp();
  t.after(() => app.close());

  const preflight = await app.inject({
    method: 'OPTIONS',
    url: '/api/v1/auth/login',
    headers: {
      origin: 'http://localhost:5174',
      'access-control-request-method': 'POST',
      'access-control-request-headers': 'content-type',
    },
  });
  assert.equal(preflight.statusCode, 204, preflight.body);
  assert.equal(preflight.headers['access-control-allow-origin'], 'http://localhost:5174');
  assert.match(String(preflight.headers['access-control-allow-methods']), /POST/);

  async function login(employeeNo, password = '123456') {
    const response = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { employeeNo, password } });
    assert.equal(response.statusCode, 200, response.body);
    return { authorization: `Bearer ${response.json().data.token}` };
  }
  const admin = await login('admin', 'Admin@123');
  const gtm = await login('wanglu');
  const regional = await login('aaa');
  const stocking = await login('chentao');
  const mssOwner = await login('zhaomin');
  const tabletGtm = await login('zhouhang');

  const mssCatalog = await app.inject({ method: 'GET', url: '/api/v1/config/catalog', headers: mssOwner });
  assert.equal(mssCatalog.statusCode, 200, mssCatalog.body);
  assert.deepEqual(mssCatalog.json().data.mssDomains.map((domain) => domain.id), ['mss-mkt']);
  assert.deepEqual(mssCatalog.json().data.products.map((product) => product.id).sort(), ['chitu-b19', 'chitu-b21']);

  const plans = await app.inject({ method: 'GET', url: '/api/v1/collection/plans', headers: gtm });
  assert.equal(plans.statusCode, 200);
  assert.deepEqual(plans.json().data.map((plan) => plan.productId).sort(), ['chitu-b19', 'chitu-b21']);

  const mssPlans = await app.inject({ method: 'GET', url: '/api/v1/collection/plans', headers: mssOwner });
  assert.equal(mssPlans.statusCode, 200, mssPlans.body);
  assert.deepEqual(mssPlans.json().data.map((plan) => plan.productId).sort(), ['chitu-b19', 'chitu-b21']);

  const regionalPlans = await app.inject({ method: 'GET', url: '/api/v1/collection/plans', headers: regional });
  assert.equal(regionalPlans.statusCode, 200, regionalPlans.body);
  assert.ok(regionalPlans.json().data.every((plan) => plan.regionProgress.every((progress) => progress.regionId === 'europe')));
  const regionalFeedback = regionalPlans.json().data.find((plan) => plan.id === 'plan-b19-202608').feedback;
  assert.ok(regionalFeedback.items.every((item) => item.region_id === 'europe' && item.office_id === 'de-office'));

  const forbiddenCategoryDraft = await app.inject({ method: 'GET', url: '/api/v1/collection/plans/plan-b19-202608/regions/europe/draft', headers: tabletGtm });
  assert.equal(forbiddenCategoryDraft.statusCode, 403, forbiddenCategoryDraft.body);
  const gtmSubmittedDraft = await app.inject({ method: 'GET', url: '/api/v1/collection/plans/plan-b19-202608/regions/europe/draft', headers: gtm });
  assert.equal(gtmSubmittedDraft.statusCode, 200, gtmSubmittedDraft.body);

  const missingUserScope = await app.inject({
    method: 'POST', url: '/api/v1/config/users', headers: admin,
    payload: { employeeNo: 'no-scope', displayName: '未配置范围', role: 'REGIONAL_OWNER', password: '12345678', enabled: true },
  });
  assert.equal(missingUserScope.statusCode, 400, missingUserScope.body);

  const missingOrganizationScope = await app.inject({
    method: 'POST', url: '/api/v1/config/users', headers: admin,
    payload: { employeeNo: 'no-org-scope', displayName: '未配置组织范围', role: 'REGIONAL_OWNER', password: '12345678', mssDomainIds: ['mss-mkt'], enabled: true },
  });
  assert.equal(missingOrganizationScope.statusCode, 400, missingOrganizationScope.body);
  assert.match(missingOrganizationScope.json().message, /区域或代表处/);

  const createdOfficeOwner = await app.inject({
    method: 'POST', url: '/api/v1/config/users', headers: admin,
    payload: { employeeNo: 'office2', displayName: '德国代表处二号', role: 'REGIONAL_OWNER', password: '12345678', mssDomainIds: ['mss-mkt'], organizationNodeIds: ['de-office'], enabled: true },
  });
  assert.equal(createdOfficeOwner.statusCode, 201, createdOfficeOwner.body);
  assert.deepEqual(createdOfficeOwner.json().data.mssDomainIds, ['mss-mkt']);
  assert.deepEqual(createdOfficeOwner.json().data.organizationNodeIds, ['de-office']);
  assert.deepEqual(createdOfficeOwner.json().data.organizationScopeNames, ['代表处 · 德国代表处（欧洲MKT）']);
  const officeOwner = await login('office2', '12345678');
  const officeDraftResponse = await app.inject({ method: 'GET', url: '/api/v1/collection/plans/plan-b21-202608/regions/europe/draft', headers: officeOwner });
  assert.equal(officeDraftResponse.statusCode, 200, officeDraftResponse.body);
  assert.ok(officeDraftResponse.json().data.items.every((item) => item.officeId === 'de-office'));
  const officeDraftSave = await app.inject({
    method: 'PUT', url: '/api/v1/collection/plans/plan-b21-202608/regions/europe/draft', headers: officeOwner,
    payload: { version: officeDraftResponse.json().data.version, items: officeDraftResponse.json().data.items.map((item) => ({ productItemKey: item.productItemKey, officeId: item.officeId, quantity: item.quantity, basis: item.basis })) },
  });
  assert.equal(officeDraftSave.statusCode, 200, officeDraftSave.body);
  const officeSubmit = await app.inject({ method: 'POST', url: '/api/v1/collection/plans/plan-b21-202608/regions/europe/submit', headers: officeOwner, payload: { version: officeDraftSave.json().data.version } });
  assert.equal(officeSubmit.statusCode, 403, officeSubmit.body);
  const disableOfficeOwner = await app.inject({
    method: 'PUT', url: `/api/v1/config/users/${createdOfficeOwner.json().data.id}`, headers: admin,
    payload: { enabled: false },
  });
  assert.equal(disableOfficeOwner.statusCode, 200, disableOfficeOwner.body);
  const disabledTokenUse = await app.inject({ method: 'GET', url: '/api/v1/config/catalog', headers: officeOwner });
  assert.equal(disabledTokenUse.statusCode, 401, disabledTokenUse.body);

  const draftResponse = await app.inject({ method: 'GET', url: '/api/v1/collection/plans/plan-b21-202608/regions/europe/draft', headers: regional });
  assert.equal(draftResponse.statusCode, 200, draftResponse.body);
  const draft = draftResponse.json().data;
  const saved = await app.inject({
    method: 'PUT', url: '/api/v1/collection/plans/plan-b21-202608/regions/europe/draft', headers: regional,
    payload: { version: draft.version, items: [
      { productItemKey: 'b21f', officeId: 'de-office', quantity: 180, basis: '新品上市体验' },
      { productItemKey: 'b21w', officeId: 'de-office', quantity: 210, basis: '重点客户PoC' },
      { productItemKey: 'b21d', officeId: 'de-office', quantity: 96, basis: '渠道体验' },
    ] },
  });
  assert.equal(saved.statusCode, 200, saved.body);
  const submitted = await app.inject({ method: 'POST', url: '/api/v1/collection/plans/plan-b21-202608/regions/europe/submit', headers: regional, payload: { version: saved.json().data.version } });
  assert.equal(submitted.statusCode, 200, submitted.body);
  assert.ok(submitted.json().data.submittedRegions.includes('europe'));

  const submittedDraft = await app.inject({ method: 'GET', url: '/api/v1/collection/plans/plan-b21-202608/regions/europe/draft', headers: mssOwner });
  const returned = await app.inject({
    method: 'POST', url: '/api/v1/collection/plans/plan-b21-202608/regions/europe/return', headers: mssOwner,
    payload: { reason: '补充代表处业务说明', version: submittedDraft.json().data.version },
  });
  assert.equal(returned.statusCode, 200, returned.body);
  const returnedDraft = await app.inject({ method: 'GET', url: '/api/v1/collection/plans/plan-b21-202608/regions/europe/draft', headers: regional });
  assert.equal(returnedDraft.json().data.status, 'RETURNED');
  const resavedReturned = await app.inject({
    method: 'PUT', url: '/api/v1/collection/plans/plan-b21-202608/regions/europe/draft', headers: regional,
    payload: { version: returnedDraft.json().data.version, items: returnedDraft.json().data.items.map((item) => ({ productItemKey: item.productItemKey, officeId: item.officeId, quantity: item.quantity, basis: item.basis })) },
  });
  const resubmitted = await app.inject({ method: 'POST', url: '/api/v1/collection/plans/plan-b21-202608/regions/europe/submit', headers: regional, payload: { version: resavedReturned.json().data.version } });
  assert.equal(resubmitted.statusCode, 200, resubmitted.body);

  const overview = await app.inject({ method: 'GET', url: '/api/v1/overview?productId=chitu-b19', headers: gtm });
  assert.equal(overview.statusCode, 200);
  assert.equal(overview.json().data.metrics.confirmedDemand, 2482);
  assert.equal(overview.json().data.metrics.tsmpShipped, 1040);
  assert.equal(overview.json().data.attention.find((item) => item.code === 'INVENTORY_DIFF').value, 20);

  const execution = await app.inject({ method: 'GET', url: '/api/v1/execution?productId=chitu-b19&regionId=europe&officeId=de-office', headers: gtm });
  assert.equal(execution.statusCode, 200);
  assert.equal(execution.json().data.scopeLabel, '欧洲MKT / 德国代表处');
  assert.equal(execution.json().data.metrics.demand, 991);

  const shipment = { externalKey: 'TEST-SHIP-001', applicationNo: 'TSMP-TEST-001', mssDomain: 'MKT领域', bomCode: '111', region: '欧洲MKT', office: '德国代表处', country: '德国', shippedQty: 5 };
  const imported = await app.inject({ method: 'POST', url: '/api/v1/execution/imports', headers: stocking, payload: { fileName: 'tsmp-test.xlsx', rows: [shipment, shipment] } });
  assert.equal(imported.statusCode, 202, imported.body);
  assert.equal(imported.json().data.matchedRows, 1);
  assert.equal(imported.json().data.duplicateRows, 1);

  const invalidTsmpHeaders = await app.inject({
    method: 'POST', url: '/api/v1/execution/imports', headers: stocking,
    payload: { fileName: 'missing-required-columns.xlsx', rows: [{ bomCode: '111', region: '欧洲MKT', office: '德国代表处', shippedQty: 1 }] },
  });
  assert.equal(invalidTsmpHeaders.statusCode, 422, invalidTsmpHeaders.body);

  const mismatchedTsmpScope = await app.inject({
    method: 'POST', url: '/api/v1/execution/imports', headers: stocking,
    payload: { fileName: 'mismatched-scope.xlsx', rows: [{ externalKey: 'TEST-SHIP-002', mssDomain: '未知业务领域', bomCode: '111', region: '欧洲MKT', office: '德国代表处', country: '德国', shippedQty: 1 }] },
  });
  assert.equal(mismatchedTsmpScope.statusCode, 202, mismatchedTsmpScope.body);
  assert.equal(mismatchedTsmpScope.json().data.mappingRequiredRows, 1);
  assert.equal(mismatchedTsmpScope.json().data.matchedRows, 0);

  const importRows = await app.inject({
    method: 'GET', url: `/api/v1/execution/imports/${mismatchedTsmpScope.json().data.id}/rows`, headers: stocking,
  });
  assert.equal(importRows.statusCode, 200, importRows.body);
  assert.equal(importRows.json().data.length, 1);
  assert.equal(importRows.json().data[0].matchStatus, 'MAPPING_REQUIRED');
  assert.equal(importRows.json().data[0].matchReason, '业务领域未匹配MSS领域配置');
  assert.equal(importRows.json().data[0].mssDomain, '未知业务领域');

  const regionalImports = await app.inject({ method: 'GET', url: '/api/v1/execution/imports', headers: regional });
  assert.equal(regionalImports.statusCode, 403, regionalImports.body);
  const regionalImportRows = await app.inject({ method: 'GET', url: `/api/v1/execution/imports/${mismatchedTsmpScope.json().data.id}/rows`, headers: regional });
  assert.equal(regionalImportRows.statusCode, 403, regionalImportRows.body);

  const approval = await app.inject({
    method: 'POST', url: '/api/v1/shipment-approval/check', headers: stocking,
    payload: { applicationNo: 'TSMP-CHECK-001', applicant: 'Martin Chen', sku: 'Chitu-B19F', region: '欧洲MKT', office: '德国代表处', requestedQuantity: 1 },
  });
  assert.equal(approval.statusCode, 200, approval.body);
  assert.equal(approval.json().data.confirmedDemand, 307);
  assert.equal(approval.json().data.scope.officeId, 'de-office');

  const inventory = await app.inject({ method: 'GET', url: '/api/v1/inventory?productId=chitu-b19', headers: admin });
  assert.equal(inventory.statusCode, 200);
  const difference = inventory.json().data.items.find((item) => item.difference !== 0);
  const checked = await app.inject({
    method: 'PUT', url: `/api/v1/inventory/${difference.id}/check`, headers: admin,
    payload: { actualQuantity: difference.system, reason: '集成测试核对', version: difference.version },
  });
  assert.equal(checked.statusCode, 200, checked.body);
  assert.equal(checked.json().data.status, '已核对');

  const createdStockingOwner = await app.inject({
    method: 'POST', url: '/api/v1/config/users', headers: admin,
    payload: {
      employeeNo: 'stock2', displayName: '备货测试二号', role: 'STOCKING_OWNER',
      password: '12345678', productDomainIds: ['wearables'], enabled: true,
    },
  });
  assert.equal(createdStockingOwner.statusCode, 201, createdStockingOwner.body);
  assert.deepEqual(createdStockingOwner.json().data.productDomainIds, ['wearables']);

  const catalog = await app.inject({ method: 'GET', url: '/api/v1/config/catalog', headers: admin });
  assert.equal(catalog.statusCode, 200, catalog.body);
  const wearables = catalog.json().data.domains.find((domain) => domain.id === 'wearables');
  const b19 = catalog.json().data.products.find((product) => product.id === 'chitu-b19');
  assert.equal('stage' in b19, false);
  const originalSkuIds = b19.skus.map((sku) => sku.id);
  const updatedB19 = await app.inject({
    method: 'PUT', url: '/api/v1/config/products/chitu-b19', headers: admin,
    payload: {
      name: b19.name, domainId: b19.domainId, mssDomainId: b19.mssDomainId,
      supplyTimeText: b19.supplyTimeText, defaultDeadline: b19.defaultDeadline,
      enabled: true, version: b19.version,
      skus: b19.skus.map((sku, index) => ({ ...sku, description: index === 0 ? '稳定ID增量更新验证' : sku.description })),
    },
  });
  assert.equal(updatedB19.statusCode, 200, updatedB19.body);
  assert.deepEqual(updatedB19.json().data.skus.map((sku) => sku.id), originalSkuIds);

  const gtmGlobalConfig = await app.inject({
    method: 'PUT', url: '/api/v1/config/domains/wearables', headers: gtm,
    payload: { name: wearables.name, description: wearables.description || '', gtmOwner: wearables.gtmOwner, domainOwner: wearables.domainOwner, stockingOwner: wearables.stockingOwner, enabled: true, version: wearables.version },
  });
  assert.equal(gtmGlobalConfig.statusCode, 403, gtmGlobalConfig.body);

  const adminProduct = await app.inject({
    method: 'POST', url: '/api/v1/config/products', headers: admin,
    payload: { id: 'admin-plan-product', name: '管理员计划权限验证产品', domainId: 'wearables', enabled: true, skus: [
      { id: 'admin-plan-sku-a', model: 'Admin-Model-A', bomCode: 'ADMIN-A' },
      { id: 'admin-plan-sku-b', model: 'Admin-Model-B', bomCode: 'ADMIN-B' },
    ] },
  });
  assert.equal(adminProduct.statusCode, 201, adminProduct.body);
  assert.equal(adminProduct.json().data.mssDomainId, null);
  const missingStagePlan = await app.inject({
    method: 'POST', url: '/api/v1/collection/plans', headers: admin,
    payload: { productId: 'admin-plan-product', regionIds: ['europe'], deadline: '2026-12-01T10:00:00.000Z' },
  });
  assert.equal(missingStagePlan.statusCode, 422, missingStagePlan.body);
  const adminPlan = await app.inject({
    method: 'POST', url: '/api/v1/collection/plans', headers: admin,
    payload: { productId: 'admin-plan-product', stage: '测试样机（DVT）', deadline: '2026-12-01T10:00:00.000Z' },
  });
  assert.equal(adminPlan.statusCode, 201, adminPlan.body);
  assert.equal(adminPlan.json().data.stage, '测试样机（DVT）');
  assert.equal(adminPlan.json().data.mssDomainId, undefined);
  assert.equal(adminPlan.json().data.domainTasks.length, 0);
  const duplicateStagePlan = await app.inject({
    method: 'POST', url: '/api/v1/collection/plans', headers: admin,
    payload: { productId: 'admin-plan-product', stage: '测试样机（DVT）', deadline: '2026-12-02T10:00:00.000Z' },
  });
  assert.equal(duplicateStagePlan.statusCode, 422, duplicateStagePlan.body);
  const sameStageDifferentMss = await app.inject({
    method: 'POST', url: '/api/v1/collection/plans', headers: admin,
    payload: { productId: 'admin-plan-product', stage: '测试样机（DVT）', deadline: '2026-12-02T10:00:00.000Z' },
  });
  assert.equal(sameStageDifferentMss.statusCode, 422, sameStageDifferentMss.body);
  const anotherStagePlan = await app.inject({
    method: 'POST', url: '/api/v1/collection/plans', headers: admin,
    payload: { productId: 'admin-plan-product', stage: '试生产样机（PVT）', deadline: '2026-12-03T10:00:00.000Z' },
  });
  assert.equal(anotherStagePlan.statusCode, 201, anotherStagePlan.body);
  const adminRelease = await app.inject({ method: 'POST', url: `/api/v1/collection/plans/${adminPlan.json().data.id}/release`, headers: admin, payload: { version: adminPlan.json().data.version } });
  assert.equal(adminRelease.statusCode, 200, adminRelease.body);
  const enabledMssDomainCount = catalog.json().data.mssDomains.filter((domain) => domain.enabled).length;
  assert.equal(adminRelease.json().data.domainTasks.length, enabledMssDomainCount);
  assert.ok(adminRelease.json().data.domainTasks.every((task) => task.status === 'PENDING_DISPATCH'));

  const mktDomainTask = adminRelease.json().data.domainTasks.find((task) => task.mssDomainId === 'mss-mkt');
  const domainDispatch = await app.inject({
    method: 'POST', url: `/api/v1/collection/domain-tasks/${mktDomainTask.id}/dispatch`, headers: mssOwner,
    payload: { productSkuIds: ['admin-plan-sku-a'], regionIds: ['europe'], version: mktDomainTask.version },
  });
  assert.equal(domainDispatch.statusCode, 200, domainDispatch.body);
  assert.deepEqual(domainDispatch.json().data.selectedSkuIds, ['admin-plan-sku-a']);
  assert.deepEqual(domainDispatch.json().data.regionProgress.map((item) => item.regionId), ['europe']);

  const regionalNewTasks = await app.inject({ method: 'GET', url: '/api/v1/collection/plans', headers: regional });
  const regionalNewTask = regionalNewTasks.json().data.find((plan) => plan.id === adminPlan.json().data.id);
  assert.ok(regionalNewTask);
  assert.deepEqual(regionalNewTask.selectedSkuIds, ['admin-plan-sku-a']);
  assert.equal(regionalNewTask.domainTaskId, mktDomainTask.id);

  const newTaskDraft = await app.inject({
    method: 'GET',
    url: `/api/v1/collection/plans/${adminPlan.json().data.id}/regions/europe/draft?domainTaskId=${mktDomainTask.id}`,
    headers: regional,
  });
  assert.equal(newTaskDraft.statusCode, 200, newTaskDraft.body);
  const rejectedUnselectedSku = await app.inject({
    method: 'PUT',
    url: `/api/v1/collection/plans/${adminPlan.json().data.id}/regions/europe/draft?domainTaskId=${mktDomainTask.id}`,
    headers: regional,
    payload: { version: newTaskDraft.json().data.version, items: [
      { productItemKey: 'admin-plan-sku-b', officeId: 'de-office', quantity: 1, basis: '越界型号验证' },
    ] },
  });
  assert.equal(rejectedUnselectedSku.statusCode, 422, rejectedUnselectedSku.body);
  const reassignedDomain = await app.inject({
    method: 'PUT', url: '/api/v1/config/domains/wearables', headers: admin,
    payload: {
      name: wearables.name,
      description: wearables.description || '',
      gtmOwner: wearables.gtmOwner,
      domainOwner: wearables.domainOwner,
      stockingOwner: '备货测试二号',
      enabled: true,
      version: wearables.version,
    },
  });
  assert.equal(reassignedDomain.statusCode, 200, reassignedDomain.body);

  const stocking2 = await login('stock2', '12345678');
  const oldOwnerInventory = await app.inject({ method: 'GET', url: '/api/v1/inventory?productId=chitu-b19', headers: stocking });
  const newOwnerInventory = await app.inject({ method: 'GET', url: '/api/v1/inventory?productId=chitu-b19', headers: stocking2 });
  assert.equal(oldOwnerInventory.statusCode, 200, oldOwnerInventory.body);
  assert.equal(newOwnerInventory.statusCode, 200, newOwnerInventory.body);
  assert.equal(oldOwnerInventory.json().data.items.length, 0);
  assert.equal(newOwnerInventory.json().data.items.length, 4);

  const oldOwnerPlans = await app.inject({ method: 'GET', url: '/api/v1/collection/plans', headers: stocking });
  const newOwnerPlans = await app.inject({ method: 'GET', url: '/api/v1/collection/plans', headers: stocking2 });
  assert.equal(oldOwnerPlans.statusCode, 200, oldOwnerPlans.body);
  assert.equal(newOwnerPlans.statusCode, 200, newOwnerPlans.body);
  assert.deepEqual(oldOwnerPlans.json().data, []);
  assert.deepEqual(newOwnerPlans.json().data.map((plan) => plan.productId), ['chitu-b19']);

  const oldOwnerImport = await app.inject({
    method: 'POST', url: '/api/v1/execution/imports', headers: stocking,
    payload: { fileName: 'out-of-scope.xlsx', rows: [{ externalKey: 'OUT-SCOPE-001', applicationNo: 'OUT-001', mssDomain: 'MKT领域', bomCode: '111', region: '欧洲MKT', office: '德国代表处', country: '德国', shippedQty: 1 }] },
  });
  assert.equal(oldOwnerImport.statusCode, 202, oldOwnerImport.body);
  assert.equal(oldOwnerImport.json().data.matchedRows, 0);
  assert.equal(oldOwnerImport.json().data.unmatchedRows, 1);
  const newOwnerJobs = await app.inject({ method: 'GET', url: '/api/v1/execution/imports', headers: stocking2 });
  assert.equal(newOwnerJobs.statusCode, 200, newOwnerJobs.body);
  assert.deepEqual(newOwnerJobs.json().data, []);

  const scopedInventory = newOwnerInventory.json().data.items[0];
  const forbiddenCheck = await app.inject({
    method: 'PUT', url: `/api/v1/inventory/${scopedInventory.id}/check`, headers: stocking,
    payload: { actualQuantity: scopedInventory.actual, reason: '跨领域核对', version: scopedInventory.version },
  });
  assert.equal(forbiddenCheck.statusCode, 403, forbiddenCheck.body);

  const ownerCheck = await app.inject({
    method: 'PUT', url: `/api/v1/inventory/${scopedInventory.id}/check`, headers: stocking2,
    payload: { actualQuantity: scopedInventory.actual, reason: '本领域核对', version: scopedInventory.version },
  });
  assert.equal(ownerCheck.statusCode, 200, ownerCheck.body);

  const adminCheck = await app.inject({
    method: 'PUT', url: `/api/v1/inventory/${scopedInventory.id}/check`, headers: admin,
    payload: { actualQuantity: scopedInventory.actual, reason: '管理员核对', version: ownerCheck.json().data.version },
  });
  assert.equal(adminCheck.statusCode, 200, adminCheck.body);

  const exported = await app.inject({ method: 'POST', url: '/api/v1/collection/plans/plan-b19-202608/export', headers: gtm });
  assert.equal(exported.statusCode, 200, exported.body);
  assert.match(exported.json().data.fileName, /\.xlsx$/);
  assert.ok(exported.json().data.contentBase64.length > 1000);
});
