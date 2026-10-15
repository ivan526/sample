import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import * as XLSX from 'xlsx';

test('Hierarchical dispatch, country override and latest-stage integration use formal snapshots', async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'mss-country-'));
  Object.assign(process.env, { SQLITE_PATH: path.join(dir, 'test.db'), NODE_ENV: 'test', SEED_DEMO_DATA: 'true',
    SEED_HUAWEI_SCENARIOS: 'false', JWT_SECRET: 'country-test-secret', LOG_LEVEL: 'silent' });
  const [{ default: migrate }, db, { buildApp }] = await Promise.all([import('../server/src/db/migrate.ts'), import('../server/src/config/db.ts'), import('../server/src/app.ts')]);
  await migrate(); const app = await buildApp();
  t.after(async () => { await app.close(); await rm(dir, { recursive: true, force: true }); });
  const call = (method, url, payload, headers = admin) => app.inject({ method, url: `/api/v1${url}`, headers, payload });
  async function ok(method, url, payload, headers, status = 200) {
    const result = await call(method, url, payload, headers); assert.equal(result.statusCode, status, result.body); return result.json().data;
  }
  const login = async (employeeNo, password) => {
    const result = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { employeeNo, password } });
    assert.equal(result.statusCode, 200, result.body); return { authorization: `Bearer ${result.json().data.token}` };
  };
  const admin = await login('admin', 'Admin@123'), mss = await login('zhaomin', '123456'), regional = await login('aaa', '123456');
  const catalog = await ok('GET', '/config/catalog');
  const office = catalog.organizations.find((region) => region.id === 'europe').offices.find((office) => office.id === 'de-office');
  assert.ok(office.countryNodes[0].id); assert.equal(typeof office.countries[0], 'string');
  const first = office.countryNodes[0].id;
  await db.query("INSERT INTO org_node(id,code,name,node_type,parent_id) VALUES ('geo-second','geo-second','测试国家二','COUNTRY','de-office'),('geo-third','geo-third','测试国家三','COUNTRY','de-office')");
  const product = await ok('POST', '/config/products', { name: '国家配额测试', domainId: 'wearables', skus: [{ model: 'GEO-1', bomCode: 'GEO-BOM-1' }, { model: 'GEO-2', bomCode: 'GEO-BOM-2' }] }, admin, 201);
  const [sku, sku2] = product.skus;
  let seq = 0;
  async function make(stage = 'V3', selected = ['de-office']) {
    let plan = await ok('POST', '/collection/plans', { productId: product.id, stage, deadline: '2099-01-01T00:00:00Z' }, admin, 201);
    await db.query('UPDATE collection_plan SET created_at=$1 WHERE id=$2', [`2026-10-${String(++seq).padStart(2, '0')}T00:00:00.000Z`, plan.id]);
    plan = await ok('POST', `/collection/plans/${plan.id}/release`, { version: plan.version });
    const task = plan.domainTasks.find((task) => task.mssDomainId === 'mss-mkt');
    await ok('POST', `/collection/domain-tasks/${task.id}/dispatch`, { productSkuIds: [sku.id, sku2.id], organizationNodeIds: selected, version: task.version });
    return { plan, task, url: (action) => `/collection/plans/${plan.id}/regions/europe/${action}?domainTaskId=${task.id}` };
  }
  const item = (quantity, countryId, productItemKey = sku.id) => ({ productItemKey, officeId: 'de-office', countryId, quantity, basis: quantity ? '上市展示' : '' });
  const query = async (filters = {}) => ok('GET', `/integrations/stocking-demands?${new URLSearchParams({ productModel: sku.model, bomCode: sku.bomCode, mssDomain: 'mss-mkt', ...filters })}`);
  const submit = async (batch, items) => {
    const draft = await ok('PUT', batch.url('draft'), { items }, mss);
    await ok('POST', batch.url('submit'), { version: draft.version }, regional);
    return ok('POST', `/collection/domain-tasks/${batch.task.id}/feedback`, { confirmed: true, note: '核对完成' }, mss);
  };
  let officeBatch;
  await t.test('country-leaf selection persists and rejects countries/offices outside dispatch', async () => {
    const batch = await make('VN1', [first]);
    const draft = await ok('GET', batch.url('draft'), undefined, mss);
    assert.deepEqual(draft.offices.map((office) => office.id), ['de-office']);
    assert.deepEqual(draft.offices[0].countries.map((country) => country.id), [first]);
    assert.equal((await call('PUT', batch.url('draft'), { items: [item(5, 'geo-second')] }, mss)).statusCode, 422);
    assert.equal((await call('PUT', batch.url('draft'), { items: [{ ...item(5), officeId: 'fr-office' }] }, mss)).statusCode, 422);
    assert.equal((await call('PUT', batch.url('draft'), { items: [item(5, first), item(6, first)] }, mss)).statusCode, 422);
    await submit(batch, [item(25)]);
    assert.equal((await query({ stage: 'VN1', country: first })).demandQuantity, 25);
    assert.equal((await query({ stage: 'VN1', country: 'geo-second' })).demandQuantity, 0);
  });
  await t.test('office pool is shared by countries and aggregate counts it once', async () => {
    officeBatch = await make();
    await ok('PUT', officeBatch.url('draft'), { items: [item(99)] }, mss);
    assert.equal((await query()).planId !== officeBatch.plan.id, true, 'draft must not become latest formal record');
    await submit(officeBatch, [item(100), item(60, undefined, sku2.id)]);
    assert.equal((await query()).demandQuantity, 100);
    for (const country of [first, 'geo-second', 'geo-third']) {
      const result = await query({ country }); assert.equal(result.demandQuantity, 100); assert.equal(result.quotaMode, 'OFFICE_SHARED');
    }
    await db.query(`INSERT INTO execution_fact(id,source_type,product_id,product_sku_id,mss_domain_id,region_id,office_id,country_id,quantity,collection_plan_id)
      VALUES ('geo-apply','APPLICATION',$1,$2,'mss-mkt','europe','de-office',$3,30,$4)`, [product.id, sku.id, first, officeBatch.plan.id]);
    assert.equal((await query({ country: 'geo-second' })).remainingToApply, 70, 'other countries consume the same office pool');
    const current = await ok('GET', `/collection/plans/${officeBatch.plan.id}`);
    await ok('POST', `/collection/plans/${current.id}/complete`, { confirmed: true, version: current.version });
    await ok('POST', `/collection/plans/${current.id}/export`, {});
  });
  let detailedBatch;
  await t.test('any explicit country quantity replaces office pool; unreported and explicit-zero countries are zero', async () => {
    detailedBatch = await make();
    const view = await submit(detailedBatch, [item(100), item(20, first), item(0, 'geo-third'), item(60, undefined, sku2.id)]);
    assert.equal(view.demandTotal, 80);
    const country = await query({ country: first }); assert.equal(country.demandQuantity, 20); assert.equal(country.planId, detailedBatch.plan.id);
    assert.equal((await query({ country: 'geo-second' })).demandQuantity, 0);
    assert.equal((await query({ country: 'geo-third' })).demandQuantity, 0);
    assert.equal((await query()).demandQuantity, 20); assert.equal((await query()).appliedQuantity, 0);
    const secondSku = await query({ productModel: sku2.model, bomCode: sku2.bomCode, country: first }); assert.equal(secondSku.demandQuantity, 60);
    const history = await ok('GET', detailedBatch.url('revisions'), undefined, mss);
    assert.equal(history.revisions[0].totalQuantity, 80); assert.equal(history.revisions[0].items.length, 4, 'original office row remains in history');
    assert.ok(history.revisions[0].items.some((item) => item.countryId === first));
    const snapshot = (await db.query('SELECT summary_snapshot FROM collection_plan_domain_feedback WHERE domain_task_id=$1', [detailedBatch.task.id])).rows[0];
    const rows = JSON.parse(snapshot.summary_snapshot).items;
    assert.equal(rows.find((row) => row.product_sku_id === sku.id && row.country_id === 'geo-second').quantity, 0);
    const plan = await ok('GET', `/collection/plans/${detailedBatch.plan.id}`);
    await ok('POST', `/collection/plans/${plan.id}/complete`, { confirmed: true, version: plan.version });
    const exported = await ok('POST', `/collection/plans/${plan.id}/export`, {});
    const book = XLSX.read(exported.contentBase64, { type: 'base64' });
    const exportRows = XLSX.utils.sheet_to_json(book.Sheets['排产需求']);
    assert.ok(exportRows.some((row) => row['国家/地区'] === '测试国家二' && row['确认需求数量(Pcs)'] === 0));
    const post = (country, key) => app.inject({ method: 'POST', url: '/api/v1/integrations/shipments', headers: { ...admin, 'idempotency-key': key }, payload: {
      productModel: sku.model, bomCode: sku.bomCode, mssDomain: 'mss-mkt', region: 'europe', office: 'de-office', country, stockedQuantity: 2, shippedQuantity: 1 } });
    assert.equal((await post('geo-second', 'geo-zero')).statusCode, 422, 'do not fall back to older office demand');
    assert.equal((await post(first, 'geo-shipment')).statusCode, 200);
    assert.equal((await query({ country: first })).shippedQuantity, 1);
    assert.equal((await query({ stage: 'VN1', country: first })).shippedQuantity, 0);
  });
  await t.test('stage omitted selects latest batch; repeated stage selects latest of that stage; no match returns zero', async () => {
    const vn2 = await make('VN2'); await submit(vn2, [item(7)]);
    assert.equal((await query()).planId, vn2.plan.id); assert.equal((await query()).demandQuantity, 7);
    assert.equal((await query({ stage: 'V3' })).planId, detailedBatch.plan.id);
    assert.equal((await query({ stage: '' })).planId, vn2.plan.id);
    const absent = await query({ stage: 'V4' }); assert.equal(absent.planId, null); assert.equal(absent.demandQuantity, 0);
    const laterV3 = await make(); await submit(laterV3, [item(0, first)]);
    assert.equal((await query()).planId, laterV3.plan.id); assert.equal((await query({ stage: 'V3' })).demandQuantity, 0);
    assert.equal((await query({ country: 'geo-second' })).demandQuantity, 0);
    // Retry after a new latest plan still returns original successful delivery.
    const retry = await app.inject({ method: 'POST', url: '/api/v1/integrations/shipments', headers: { ...admin, 'idempotency-key': 'geo-shipment' }, payload: {
      productModel: sku.model, bomCode: sku.bomCode, mssDomain: 'mss-mkt', region: 'europe', office: 'de-office', country: first, stockedQuantity: 2, shippedQuantity: 1 } });
    assert.equal(retry.statusCode, 200, retry.body); assert.equal(retry.json().data.replayed, true);
  });
});
