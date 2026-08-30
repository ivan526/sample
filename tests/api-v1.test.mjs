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

  async function login(employeeNo, password = '123456') {
    const response = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { employeeNo, password } });
    assert.equal(response.statusCode, 200, response.body);
    return { authorization: `Bearer ${response.json().data.token}` };
  }
  const admin = await login('admin', 'Admin@123');
  const gtm = await login('wanglu');
  const regional = await login('aaa');
  const stocking = await login('chentao');

  const plans = await app.inject({ method: 'GET', url: '/api/v1/collection/plans', headers: gtm });
  assert.equal(plans.statusCode, 200);
  assert.deepEqual(plans.json().data.map((plan) => plan.productId).sort(), ['chitu-b19', 'chitu-b21']);

  const draftResponse = await app.inject({ method: 'GET', url: '/api/v1/collection/plans/plan-b21-202608/regions/europe/draft', headers: regional });
  assert.equal(draftResponse.statusCode, 200, draftResponse.body);
  const draft = draftResponse.json().data;
  const saved = await app.inject({
    method: 'PUT', url: '/api/v1/collection/plans/plan-b21-202608/regions/europe/draft', headers: regional,
    payload: { version: draft.version, items: [
      { productItemKey: 'b21f', quantity: 180, basis: '新品上市体验' },
      { productItemKey: 'b21w', quantity: 210, basis: '重点客户PoC' },
      { productItemKey: 'b21d', quantity: 96, basis: '渠道体验' },
    ] },
  });
  assert.equal(saved.statusCode, 200, saved.body);
  const submitted = await app.inject({ method: 'POST', url: '/api/v1/collection/plans/plan-b21-202608/regions/europe/submit', headers: regional, payload: { version: saved.json().data.version } });
  assert.equal(submitted.statusCode, 200, submitted.body);
  assert.ok(submitted.json().data.submittedRegions.includes('europe'));

  const overview = await app.inject({ method: 'GET', url: '/api/v1/overview?productId=chitu-b19', headers: gtm });
  assert.equal(overview.statusCode, 200);
  assert.equal(overview.json().data.metrics.confirmedDemand, 2482);
  assert.equal(overview.json().data.metrics.tsmpShipped, 1040);
  assert.equal(overview.json().data.attention.find((item) => item.code === 'INVENTORY_DIFF').value, 20);

  const execution = await app.inject({ method: 'GET', url: '/api/v1/execution?productId=chitu-b19&regionId=europe&officeId=de-office', headers: gtm });
  assert.equal(execution.statusCode, 200);
  assert.equal(execution.json().data.scopeLabel, '欧洲MKT / 德国代表处');
  assert.ok(execution.json().data.metrics.demand > 0);

  const shipment = { externalKey: 'TEST-SHIP-001', applicationNo: 'TSMP-TEST-001', sku: 'Chitu-B19F', region: '欧洲MKT', office: '德国代表处', shippedQty: 5 };
  const imported = await app.inject({ method: 'POST', url: '/api/v1/execution/imports', headers: stocking, payload: { fileName: 'tsmp-test.xlsx', rows: [shipment, shipment] } });
  assert.equal(imported.statusCode, 202, imported.body);
  assert.equal(imported.json().data.matchedRows, 1);
  assert.equal(imported.json().data.duplicateRows, 1);

  const inventory = await app.inject({ method: 'GET', url: '/api/v1/inventory?productId=chitu-b19', headers: admin });
  assert.equal(inventory.statusCode, 200);
  const difference = inventory.json().data.items.find((item) => item.difference !== 0);
  const checked = await app.inject({
    method: 'PUT', url: `/api/v1/inventory/${difference.id}/check`, headers: admin,
    payload: { actualQuantity: difference.system, reason: '集成测试核对', version: difference.version },
  });
  assert.equal(checked.statusCode, 200, checked.body);
  assert.equal(checked.json().data.status, '已核对');

  const exported = await app.inject({ method: 'POST', url: '/api/v1/collection/plans/plan-b19-202608/export', headers: gtm });
  assert.equal(exported.statusCode, 200, exported.body);
  assert.match(exported.json().data.fileName, /\.xlsx$/);
  assert.ok(exported.json().data.contentBase64.length > 1000);
});
