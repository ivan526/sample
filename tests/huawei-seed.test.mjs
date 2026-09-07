import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

test('Huawei acceptance seed covers all core business scenarios', async (t) => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'mss-huawei-seed-'));
  t.after(() => rm(tempDir, { recursive: true, force: true }));
  process.env.SQLITE_PATH = path.join(tempDir, 'huawei.db');
  process.env.NODE_ENV = 'test';
  process.env.SEED_DEMO_DATA = 'true';
  process.env.SEED_HUAWEI_SCENARIOS = 'true';
  process.env.JWT_SECRET = 'huawei-seed-test-secret';
  process.env.LOG_LEVEL = 'silent';

  const [{ default: migrate }, db, { buildApp }, { seedHuaweiTestData }] = await Promise.all([
    import('../server/src/db/migrate.ts'),
    import('../server/src/config/db.ts'),
    import('../server/src/app.ts'),
    import('../server/src/db/huawei-test-data.ts'),
  ]);
  await migrate();
  const secondSeedClient = await db.getClient();
  try {
    await secondSeedClient.begin();
    await seedHuaweiTestData(secondSeedClient);
    await secondSeedClient.commit();
  } catch (error) {
    await secondSeedClient.rollback();
    throw error;
  } finally {
    secondSeedClient.release();
  }
  const { query } = db;

  const products = await query(`
    SELECT id, name FROM product WHERE enabled = true ORDER BY name
  `);
  assert.equal(products.rows.length, 8);
  assert.ok(products.rows.every((product) => product.name.startsWith('HUAWEI')));

  const productGaps = await query(`
    SELECT
      (SELECT COUNT(*) FROM product WHERE enabled = true AND NOT EXISTS (
        SELECT 1 FROM product_sku WHERE product_sku.product_id = product.id AND product_sku.enabled = true
      )) AS products_without_sku,
      (SELECT COUNT(*) FROM product_sku WHERE enabled = true AND (bom_code IS NULL OR bom_code = '')) AS skus_without_bom
  `);
  assert.equal(Number(productGaps.rows[0].products_without_sku), 1);
  assert.equal(Number(productGaps.rows[0].skus_without_bom), 1);

  const planStatuses = await query(`
    SELECT status, COUNT(*) AS count FROM collection_plan GROUP BY status ORDER BY status
  `);
  assert.deepEqual(
    new Set(planStatuses.rows.map((row) => row.status)),
    new Set(['PRODUCT_DRAFT', 'READY_TO_RELEASE', 'COLLECTING', 'DOMAIN_REVIEW', 'GTM_CLOSURE', 'EXPORTED']),
  );

  const activeMssDomains = await query('SELECT id FROM mss_domain WHERE enabled = true ORDER BY id');
  assert.deepEqual(activeMssDomains.rows.map((row) => row.id), ['mss-gtm', 'mss-mkt', 'mss-retail', 'mss-service']);

  const fanout = await query(`
    SELECT plan_id, COUNT(*) AS task_count
    FROM collection_plan_domain_task
    WHERE plan_id LIKE 'plan-huawei-%'
    GROUP BY plan_id ORDER BY plan_id
  `);
  assert.ok(fanout.rows.length >= 4);
  assert.ok(fanout.rows.every((row) => Number(row.task_count) === 4));

  const submissionStatuses = await query(`
    SELECT DISTINCT submission.status
    FROM collection_plan_domain_submission submission
    JOIN collection_plan_domain_scope scope ON scope.id = submission.domain_scope_id
    JOIN collection_plan_domain_task task ON task.id = scope.domain_task_id
    WHERE task.plan_id LIKE 'plan-huawei-%'
  `);
  assert.deepEqual(
    new Set(submissionStatuses.rows.map((row) => row.status)),
    new Set(['NOT_STARTED', 'DRAFT', 'SUBMITTED', 'RETURNED']),
  );

  const pendingChange = await query(`
    SELECT request.request_type, request.status, plan.status AS plan_status, submission.change_pending
    FROM collection_plan_region_change_request request
    JOIN collection_plan_domain_submission submission ON submission.id = request.submission_id
    JOIN collection_plan_domain_scope scope ON scope.id = submission.domain_scope_id
    JOIN collection_plan_domain_task task ON task.id = scope.domain_task_id
    JOIN collection_plan plan ON plan.id = task.plan_id
    WHERE request.id = 'scenario-change-request-freebuds-europe'
  `);
  assert.deepEqual(pendingChange.rows[0], {
    request_type: 'POST_EXPORT_CHANGE', status: 'PENDING', plan_status: 'EXPORTED', change_pending: 1,
  });

  const exports = await query(`
    SELECT plan_id, plan_version, row_count FROM production_export
    WHERE id LIKE 'scenario-export-%' ORDER BY plan_id
  `);
  assert.equal(exports.rows.length, 2);
  assert.ok(exports.rows.every((row) => Number(row.plan_version) === 1 && Number(row.row_count) > 0));

  const factTypes = await query(`
    SELECT DISTINCT source_type FROM execution_fact
    WHERE id LIKE 'scenario-%' ORDER BY source_type
  `);
  assert.deepEqual(factTypes.rows.map((row) => row.source_type), ['APPLICATION', 'CONFIRMED_DEMAND', 'INVENTORY', 'PRODUCTION', 'SHIPMENT']);

  const inventoryDifferences = await query(`
    SELECT system_quantity - actual_quantity AS difference
    FROM inventory_balance WHERE id LIKE 'scenario-inventory-%' ORDER BY difference
  `);
  assert.ok(inventoryDifferences.rows.some((row) => Number(row.difference) === 0));
  assert.ok(inventoryDifferences.rows.some((row) => Number(row.difference) > 0));
  assert.ok(inventoryDifferences.rows.some((row) => Number(row.difference) < 0));

  const importDiagnostics = await query(`
    SELECT match_status, COUNT(*) AS count FROM tsmp_shipment_raw
    WHERE import_job_id = 'scenario-tsmp-import-001'
    GROUP BY match_status ORDER BY match_status
  `);
  assert.deepEqual(importDiagnostics.rows.map((row) => row.match_status), ['DUPLICATE', 'INVALID', 'MAPPING_REQUIRED', 'MATCHED', 'UNMATCHED']);
  assert.ok(importDiagnostics.rows.every((row) => Number(row.count) === 1));

  const app = await buildApp();
  t.after(() => app.close());
  async function login(employeeNo, password = '123456') {
    const response = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { employeeNo, password } });
    assert.equal(response.statusCode, 200, response.body);
    return { authorization: `Bearer ${response.json().data.token}` };
  }
  const admin = await login('admin', 'Admin@123');
  const mobileGtm = await login('lina');
  const serviceOwner = await login('liuqian');
  const officeOwner = await login('deowner');

  const catalog = await app.inject({ method: 'GET', url: '/api/v1/config/catalog', headers: admin });
  assert.equal(catalog.statusCode, 200, catalog.body);
  assert.ok(catalog.json().data.products.every((product) => product.name.startsWith('HUAWEI')));
  assert.deepEqual(catalog.json().data.dictionaries.SAMPLE_STAGE.map((item) => item.name), ['V3', 'V4', 'VN1', 'VN2']);
  assert.equal(catalog.json().data.dictionaries.MSS_DOMAIN, undefined, 'MSS业务领域不应在基础枚举中重复出现');

  const mobilePlans = await app.inject({ method: 'GET', url: '/api/v1/collection/plans', headers: mobileGtm });
  assert.equal(mobilePlans.statusCode, 200, mobilePlans.body);
  assert.ok(mobilePlans.json().data.some((plan) => plan.status === 'PRODUCT_DRAFT'));
  assert.ok(mobilePlans.json().data.some((plan) => plan.status === 'DOMAIN_REVIEW'));
  assert.ok(mobilePlans.json().data.some((plan) => plan.status === 'EXPORTED'));
  assert.ok(mobilePlans.json().data.every((plan) => ['V3', 'V4', 'VN1', 'VN2'].includes(plan.stage)));
  const exportedPlan = mobilePlans.json().data.find((plan) => plan.planNo === 'HUAWEI-TEST-005');
  assert.equal(exportedPlan.demandItems.length, 8, 'GTM领域汇总应返回4个领域的逐BOM反馈明细');
  const bomTotals = exportedPlan.demandItems.reduce((totals, item) => {
    totals[item.bomCode] = (totals[item.bomCode] || 0) + item.quantity;
    return totals;
  }, {});
  assert.deepEqual(Object.values(bomTotals).sort((left, right) => left - right), [336, 464]);

  const servicePlans = await app.inject({ method: 'GET', url: '/api/v1/collection/plans', headers: serviceOwner });
  assert.equal(servicePlans.statusCode, 200, servicePlans.body);
  assert.ok(servicePlans.json().data.some((plan) => plan.domainTasks.some((task) => task.mssDomainId === 'mss-service')));
  const serviceExportedPlan = servicePlans.json().data.find((plan) => plan.planNo === 'HUAWEI-TEST-005');
  assert.equal(serviceExportedPlan.demandItems.length, 2, '领域接口人应看到本领域逐BOM反馈明细');
  assert.ok(serviceExportedPlan.demandItems.every((item) => item.mssDomainId === 'mss-service'));

  const officePlans = await app.inject({ method: 'GET', url: '/api/v1/collection/plans', headers: officeOwner });
  assert.equal(officePlans.statusCode, 200, officePlans.body);
  assert.ok(officePlans.json().data.every((plan) => plan.regionProgress.every((progress) => progress.regionId === 'europe')));

  // 回归：任务下发后再配置、且同时负责多个领域的区域接口人，必须看到准确的产品与SKU范围。
  const lateOwner = await login('lateowner');
  const lateOwnerCatalog = await app.inject({ method: 'GET', url: '/api/v1/config/catalog', headers: lateOwner });
  assert.equal(lateOwnerCatalog.statusCode, 200, lateOwnerCatalog.body);
  const lateOwnerPlans = await app.inject({ method: 'GET', url: '/api/v1/collection/plans', headers: lateOwner });
  assert.equal(lateOwnerPlans.statusCode, 200, lateOwnerPlans.body);
  const lateTasks = lateOwnerPlans.json().data.filter((plan) => plan.planNo === 'HUAWEI-TEST-007');
  assert.equal(lateTasks.length, 2, '后配置区域接口人应看到同一计划的两个领域任务');
  assert.deepEqual(lateTasks.map((plan) => plan.mssDomainId).sort(), ['mss-mkt', 'mss-service']);
  assert.ok(lateTasks.every((plan) => plan.selectedSkuIds.length > 0 && plan.regionProgress.every((progress) => progress.regionId === 'hq')));
  const lateTask = lateTasks.find((plan) => plan.mssDomainId === 'mss-service');
  const lateProduct = lateOwnerCatalog.json().data.products.find((product) => product.id === lateTask.productId);
  assert.ok(lateProduct?.skus.length > 0, '区域接口人的产品目录应包含SKU');
  const lateDraft = await app.inject({
    method: 'GET',
    url: `/api/v1/collection/plans/${lateTask.id}/regions/hq/draft?domainTaskId=${lateTask.domainTaskId}`,
    headers: lateOwner,
  });
  assert.equal(lateDraft.statusCode, 200, lateDraft.body);
  assert.deepEqual(
    lateDraft.json().data.availableItems.map((item) => item.productItemKey).sort(),
    [...lateTask.selectedSkuIds].sort(),
    '草稿接口必须按当前领域任务返回可填报SKU，不能依赖用户配置时间',
  );
});
