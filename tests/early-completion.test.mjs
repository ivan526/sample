import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import * as XLSX from 'xlsx';

test('GTM early completion freezes unreported domains at zero without losing original submissions', async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'mss-complete-'));
  Object.assign(process.env, { SQLITE_PATH: path.join(dir, 'test.db'), NODE_ENV: 'test',
    SEED_DEMO_DATA: 'true', SEED_HUAWEI_SCENARIOS: 'false', JWT_SECRET: 'integration-test-secret', LOG_LEVEL: 'silent' });
  const [{ default: migrate }, db, { buildApp }] = await Promise.all([
    import('../server/src/db/migrate.ts'), import('../server/src/config/db.ts'), import('../server/src/app.ts'),
  ]);
  await migrate();
  const app = await buildApp();
  t.after(async () => { await app.close(); await rm(dir, { recursive: true, force: true }); });
  const call = (method, url, headers, payload) => app.inject({ method, url: `/api/v1${url}`, headers, payload });
  async function ok(method, url, headers, payload, status = 200) {
    const response = await call(method, url, headers, payload);
    assert.equal(response.statusCode, status, response.body);
    return response.json().data;
  }
  async function login(employeeNo, password = '123456') {
    const result = await ok('POST', '/auth/login', {}, { employeeNo, password });
    return { authorization: `Bearer ${result.token}` };
  }
  const admin = await login('admin', 'Admin@123'), gtm = await login('wanglu');
  const mkt = await login('zhaomin'), retail = await login('sunyue');
  const regional = await login('aaa'), otherGtm = await login('zhouhang');
  await ok('POST', '/config/users', admin, { employeeNo: 'earlyservice', displayName: '服务测试接口人', role: 'MSS_DOMAIN_OWNER',
    password: '12345678', enabled: true, mssDomainIds: ['mss-service'] }, 201);
  const service = await login('earlyservice', '12345678');
  const product = await ok('POST', '/config/products', admin, { name: '提前完成验证产品', domainId: 'wearables',
    skus: [{ model: 'EARLY-A', bomCode: 'EARLY-BOM-A' }, { model: 'EARLY-B', bomCode: 'EARLY-BOM-B' }] }, 201);
  const get = (id) => ok('GET', `/collection/plans/${id}`, gtm);
  let planSequence = 0;
  async function makePlan(productId = product.id, release = true) {
    let plan = await ok('POST', '/collection/plans', gtm, { productId, stage: ['V3', 'V4', 'VN1', 'VN2'][planSequence++ % 4], deadline: '2099-01-01T00:00:00Z' }, 201);
    if (release) plan = await ok('POST', `/collection/plans/${plan.id}/release`, gtm, { version: plan.version });
    return plan;
  }
  function taskUrl(plan, task) { return `/collection/plans/${plan.id}/regions/europe?domainTaskId=${task.id}`; }
  function regionUrl(plan, task, action) { return taskUrl(plan, task).replace('/europe?', `/europe/${action}?`); }
  const save = (plan, task, owner, quantity) => ok('PUT', regionUrl(plan, task, 'draft'), owner,
    { items: [{ productItemKey: product.skus[0].id, officeId: 'de-office', quantity, basis: '上市展示' }] });
  const dispatch = (task, owner = admin) => ok('POST', `/collection/domain-tasks/${task.id}/dispatch`, owner,
    { productSkuIds: product.skus.map((sku) => sku.id), regionIds: ['europe'], version: task.version });
  const feedback = (task, owner) => ok('POST', `/collection/domain-tasks/${task.id}/feedback`, owner, { confirmed: true, note: '已核对本领域需求' });
  const complete = (plan, headers = gtm, patch = {}) => call('POST', `/collection/plans/${plan.id}/complete`, headers,
    { confirmed: true, version: plan.version, ...patch });
  async function exported(plan) {
    const result = await ok('POST', `/collection/plans/${plan.id}/export`, gtm, {});
    const workbook = XLSX.read(result.contentBase64, { type: 'base64' });
    return { result, rows: XLSX.utils.sheet_to_json(workbook.Sheets['排产需求']) };
  }

  await t.test('mixed formal feedback, submitted-only, draft-only and undispatched domains', async () => {
    let plan = await makePlan();
    const task = Object.fromEntries(plan.domainTasks.map((item) => [item.mssDomainId, item]));
    for (const domain of ['mss-mkt', 'mss-retail', 'mss-service']) await dispatch(task[domain]);
    await save(plan, task['mss-mkt'], mkt, 20);
    await ok('POST', regionUrl(plan, task['mss-mkt'], 'submit'), mkt, {});
    await feedback(task['mss-mkt'], mkt);
    await save(plan, task['mss-retail'], retail, 99);
    await ok('POST', regionUrl(plan, task['mss-retail'], 'submit'), retail, {});
    await save(plan, task['mss-service'], service, 77);
    plan = await get(plan.id);
    const officialBefore = (await db.query('SELECT * FROM collection_plan_domain_feedback WHERE domain_task_id = $1', [task['mss-mkt'].id])).rows[0];
    assert.equal((await call('POST', `/collection/plans/${plan.id}/export`, gtm, {})).statusCode, 409);
    for (const headers of [mkt, regional, otherGtm]) assert.equal((await complete(plan, headers)).statusCode, 403);
    assert.equal((await complete(plan, {})).statusCode, 401);
    assert.equal((await complete(plan, gtm, { confirmed: false })).statusCode, 422);
    assert.equal((await complete(plan, gtm, { version: plan.version - 1 })).statusCode, 409);
    const pending = await ok('POST', regionUrl(plan, task['mss-mkt'], 'change-request'), regional, { reason: '待审批修改' });
    plan = await get(plan.id);
    assert.equal((await complete(plan)).statusCode, 409, 'Pending changes cannot be bypassed');
    await ok('POST', `/collection/change-requests/${pending.request.id}/decision`, mkt, { approved: false, note: '维持原反馈' });
    plan = await get(plan.id);
    const response = await complete(plan);
    assert.equal(response.statusCode, 200, response.body);
    const closed = response.json().data;
    assert.equal(closed.status, 'GTM_CLOSURE');
    assert.equal(closed.completedEarly, true);
    assert.equal(closed.demandTotal, 20);
    assert.equal(closed.feedback.totalQuantity, 20);
    assert.equal(closed.domainTasks.filter((item) => item.zeroFilled).length, 3);
    assert.ok(closed.demandItems.filter((item) => item.mssDomainId !== 'mss-mkt').every((item) => item.quantity === 0));
    assert.deepEqual((await db.query('SELECT * FROM collection_plan_domain_feedback WHERE domain_task_id = $1', [task['mss-mkt'].id])).rows[0], officialBefore);
    const facts = await db.query("SELECT SUM(quantity) AS total FROM execution_fact WHERE product_id = $1 AND source_type = 'CONFIRMED_DEMAND'", [product.id]);
    assert.equal(facts.rows[0].total, 20);
    const serviceView = await ok('GET', `/collection/plans/${plan.id}?domainTaskId=${task['mss-service'].id}`, service);
    assert.equal(serviceView.zeroFilled, true);
    assert.equal(serviceView.demandTotal, 0);
    assert.equal(serviceView.feedback.totalQuantity, 0);
    assert.ok(serviceView.regionProgress.every((item) => item.demand === 0));
    const original = await ok('GET', regionUrl(plan, task['mss-service'], 'draft'), service);
    assert.equal(original.status, 'DRAFT');
    assert.equal(original.items[0].quantity, 77);
    const history = await ok('GET', regionUrl(plan, task['mss-retail'], 'revisions'), retail);
    assert.equal(history.revisions[0].totalQuantity, 99);
    for (const [method, url, headers, payload] of [
      ['PUT', regionUrl(plan, task['mss-service'], 'draft'), service, { items: [{ productItemKey: product.skus[0].id, officeId: 'de-office', quantity: 1, basis: 'test' }] }],
      ['POST', regionUrl(plan, task['mss-service'], 'submit'), service, {}],
      ['POST', `/collection/domain-tasks/${task['mss-service'].id}/dispatch`, service, { productSkuIds: [product.skus[0].id], regionIds: ['europe'] }],
      ['POST', `/collection/domain-tasks/${task['mss-retail'].id}/feedback`, retail, { confirmed: true, note: '不能覆盖GTM完成结果' }],
    ]) assert.equal((await call(method, url, headers, payload)).statusCode, 409);
    const file = await exported(plan);
    assert.equal(file.rows.reduce((sum, row) => sum + row['确认需求数量(Pcs)'], 0), 20);
    assert.equal(new Set(file.rows.map((row) => row['MSS业务领域'])).size, 4);
    const zeroRows = file.rows.filter((row) => row['收集处理方式'] === '未反馈，GTM按0完成');
    assert.ok(zeroRows.length >= 3);
    assert.ok(zeroRows.every((row) => row['确认需求数量(Pcs)'] === 0 && !row['领域反馈人'] && !row['反馈时间'] && row['完成操作人'] && row['完成时间']));
    assert.ok(zeroRows.some((row) => row['BOM编码'] === 'EARLY-BOM-B'));
    assert.equal((await complete(closed)).statusCode, 409);
    assert.equal((await db.query("SELECT id FROM audit_log WHERE action = 'PLAN_COMPLETED_EARLY' AND entity_id = $1", [plan.id])).rows.length, 1);

    // Existing approved-return workflow remains available; it invalidates the zero snapshot.
    await ok('POST', regionUrl(plan, task['mss-retail'], 'return'), retail, { reason: '正式重新开放本领域' });
    await save(plan, task['mss-retail'], retail, 5);
    await ok('POST', regionUrl(plan, task['mss-retail'], 'submit'), retail, {});
    await feedback(task['mss-retail'], retail);
    const nextFile = await exported(plan);
    assert.equal(nextFile.result.exportVersion, 2);
    assert.equal(nextFile.rows.reduce((sum, row) => sum + row['确认需求数量(Pcs)'], 0), 25);
    assert.equal((await db.query('SELECT id FROM collection_plan_domain_feedback_history WHERE domain_task_id = $1', [task['mss-retail'].id])).rows.length, 1);
  });

  await t.test('all-unreported provisional product can complete and export explicit zeros', async () => {
    const provisional = await ok('POST', '/config/products', admin, { name: '型号待补提前完成', domainId: 'wearables', skus: [] }, 201);
    const plan = await makePlan(provisional.id);
    const response = await complete(plan, admin);
    assert.equal(response.statusCode, 200, response.body);
    assert.equal(response.json().data.demandTotal, 0);
    const file = await exported(plan);
    assert.equal(file.rows.length, 4);
    assert.ok(file.rows.every((row) => row['确认需求数量(Pcs)'] === 0 && row['SKU/产品项'] === '型号待补提前完成（型号待补充）'));
  });

  await t.test('draft, cancelled and archived plans reject completion', async () => {
    const draft = await makePlan(product.id, false);
    assert.equal((await complete(draft)).statusCode, 409);
    const cancelled = await makePlan();
    await ok('POST', `/collection/plans/${cancelled.id}/cancel`, gtm, {});
    assert.equal((await complete(await get(cancelled.id))).statusCode, 409);
    const archived = await makePlan();
    await ok('POST', `/collection/plans/${archived.id}/archive`, gtm, {});
    assert.equal((await complete(archived)).statusCode, 409);
  });

  await t.test('failed audit rolls back every zero snapshot, task transition and parent update', async () => {
    const plan = await makePlan();
    await db.query("CREATE TRIGGER reject_early_completion BEFORE INSERT ON audit_log WHEN NEW.action='PLAN_COMPLETED_EARLY' BEGIN SELECT RAISE(ABORT,'forced rollback'); END;");
    assert.equal((await complete(plan)).statusCode, 500);
    await db.query('DROP TRIGGER reject_early_completion');
    const current = await get(plan.id);
    assert.equal(current.version, plan.version);
    assert.equal(current.status, 'COLLECTING');
    assert.equal(current.feedback, null);
    assert.ok(current.domainTasks.every((item) => item.status === 'PENDING_DISPATCH' && !item.zeroFilled));
    assert.equal((await complete(current)).statusCode, 200);
  });
});
