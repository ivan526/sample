import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

test('Country upgrade preserves office demands and only backfills unambiguous plan provenance', async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'mss-country-upgrade-'));
  Object.assign(process.env, { SQLITE_PATH: path.join(dir, 'test.db'), NODE_ENV: 'test', SEED_DEMO_DATA: 'true', SEED_HUAWEI_SCENARIOS: 'false' });
  const [{ default: migrate }, db] = await Promise.all([import('../server/src/db/migrate.ts'), import('../server/src/config/db.ts')]);
  await migrate(); t.after(() => rm(dir, { recursive: true, force: true }));
  const { rows: before } = await db.query('SELECT id,submission_id,product_sku_id,office_id,quantity FROM collection_plan_domain_demand_item ORDER BY id');
  // Recreate the pre-021 shape with existing office rows and formal feedback.
  await db.query(`DROP INDEX idx_fact_collection_plan;
    DROP INDEX idx_domain_demand_geography;
    ALTER TABLE execution_fact DROP COLUMN collection_plan_id;
    ALTER TABLE collection_plan_domain_demand_item DROP COLUMN country_id;`);
  await db.query("DELETE FROM schema_migrations WHERE version='021'");
  const demand = (await db.query(`SELECT ef.*,task.plan_id FROM execution_fact ef JOIN collection_plan_domain_task task ON task.id=ef.source_id WHERE ef.source_type='CONFIRMED_DEMAND' LIMIT 1`)).rows[0];
  await db.query(`INSERT INTO execution_fact(id,source_type,product_id,product_sku_id,mss_domain_id,region_id,office_id,quantity)
    VALUES ('legacy-unique-shipment','SHIPMENT',$1,$2,$3,$4,$5,3)`, [demand.product_id,demand.product_sku_id,demand.mss_domain_id,demand.region_id,demand.office_id]);
  await db.query(`INSERT INTO execution_fact(id,source_type,product_id,product_sku_id,quantity)
    VALUES ('legacy-unknown-shipment','SHIPMENT',$1,$2,7)`, [demand.product_id,demand.product_sku_id]);
  await migrate();
  assert.deepEqual((await db.query('SELECT id,submission_id,product_sku_id,office_id,quantity FROM collection_plan_domain_demand_item ORDER BY id')).rows, before);
  assert.equal((await db.query('SELECT collection_plan_id FROM execution_fact WHERE id=$1',[demand.id])).rows[0].collection_plan_id,demand.plan_id);
  assert.equal((await db.query("SELECT collection_plan_id FROM execution_fact WHERE id='legacy-unique-shipment'")).rows[0].collection_plan_id,demand.plan_id);
  assert.equal((await db.query("SELECT collection_plan_id FROM execution_fact WHERE id='legacy-unknown-shipment'")).rows[0].collection_plan_id,null);
  assert.equal((await db.query('SELECT country_id FROM collection_plan_domain_demand_item LIMIT 1')).rows[0].country_id,null);
  assert.deepEqual((await db.query('SELECT * FROM pragma_foreign_key_check')).rows,[]);
  await migrate(); // Retry is safe and quantities stay intact.
  assert.equal((await db.query("SELECT quantity FROM execution_fact WHERE id='legacy-unique-shipment'")).rows[0].quantity,3);
});
