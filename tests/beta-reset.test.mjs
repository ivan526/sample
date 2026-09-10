import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';

test('Beta reset clears business data and preserves users and master data', async (t) => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'mss-beta-reset-'));
  t.after(async () => rm(tempDir, { recursive: true, force: true }));

  process.env.SQLITE_PATH = path.join(tempDir, 'beta-reset.db');
  process.env.NODE_ENV = 'test';
  process.env.SEED_HUAWEI_SCENARIOS = 'false';

  const [{ default: migrate }, db, reset] = await Promise.all([
    import('../server/src/db/migrate.ts'),
    import('../server/src/config/db.ts'),
    import('../server/src/db/reset-beta-data.ts'),
  ]);
  await migrate();

  const client = await db.getClient();
  await client.query(
    "INSERT INTO audit_log (action, entity_type, entity_id) VALUES ('TEST_ACTION', 'TEST_ENTITY', 'beta-reset-test')",
  );
  const preservedTables = [
    'app_user', 'user_scope_assignment', 'product_domain', 'mss_domain',
    'product', 'product_sku', 'org_node', 'data_dictionary', 'master_data_alias',
  ];

  const countRows = async (table) => {
    const { rows } = await client.query(`SELECT COUNT(*) AS count FROM ${table}`);
    return Number(rows[0].count);
  };

  try {
    const preservedBefore = Object.fromEntries(
      await Promise.all(preservedTables.map(async (table) => [table, await countRows(table)])),
    );
    assert.ok(await countRows('collection_plan') > 0, 'seed should contain plans before reset');
    assert.ok(await countRows('audit_log') > 0, 'seed should contain audit records before reset');

    const backupPath = await reset.backupSqliteDatabase();
    assert.ok(backupPath && existsSync(backupPath), 'SQLite backup should be created before reset');

    const firstReset = await reset.resetBetaBusinessData(client);
    assert.ok(firstReset.totalDeletedRows > 0);

    for (const table of reset.BETA_BUSINESS_TABLES) {
      assert.equal(await countRows(table), 0, `${table} should be empty after reset`);
    }
    for (const [table, count] of Object.entries(preservedBefore)) {
      assert.equal(await countRows(table), count, `${table} should be preserved`);
    }

    const secondReset = await reset.resetBetaBusinessData(client);
    assert.equal(secondReset.totalDeletedRows, 0, 'reset should be safe to repeat');
  } finally {
    client.release();
  }
});
