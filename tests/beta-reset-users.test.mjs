import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { mkdtemp, rm } from 'node:fs/promises';

test('Beta user reset protects business data and keeps only admin after business reset', async (t) => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'mss-beta-reset-users-'));
  t.after(async () => rm(tempDir, { recursive: true, force: true }));

  process.env.SQLITE_PATH = path.join(tempDir, 'beta-reset-users.db');
  process.env.NODE_ENV = 'test';
  process.env.SEED_HUAWEI_SCENARIOS = 'false';

  const [{ default: migrate }, db, reset] = await Promise.all([
    import('../server/src/db/migrate.ts'),
    import('../server/src/config/db.ts'),
    import('../server/src/db/reset-beta-data.ts'),
  ]);
  await migrate();

  const client = await db.getClient();
  const countRows = async (table) => {
    const { rows } = await client.query(`SELECT COUNT(*) AS count FROM ${table}`);
    return Number(rows[0].count);
  };

  try {
    assert.ok(await countRows('app_user') > 1, 'seed should contain multiple users');
    await assert.rejects(
      () => reset.resetBetaTestUsers(client),
      /业务数据不为空|data:reset:beta/,
      'user reset must refuse while business data exists',
    );

    await reset.resetBetaBusinessData(client);
    const result = await reset.resetBetaTestUsers(client);

    assert.ok(result.deletedUsers > 0, 'non-admin users should be deleted');
    assert.equal(await countRows('app_user'), 1, 'only admin should remain');
    assert.equal(await countRows('user_scope_assignment'), 0, 'test user scopes should be removed');

    const { rows: adminRows } = await client.query(
      "SELECT id, employee_no, role FROM app_user WHERE employee_no = 'admin'",
    );
    assert.equal(adminRows.length, 1);
    assert.equal(adminRows[0].role, 'ADMIN');

    const { rows: productOwners } = await client.query(
      'SELECT gtm_owner_id, domain_owner_id, stocking_owner_id FROM product_domain',
    );
    for (const row of productOwners) {
      assert.equal(row.gtm_owner_id, adminRows[0].id, 'GTM owner should temporarily fall back to admin');
      assert.equal(row.domain_owner_id, null, 'domain owner should become unassigned');
      assert.equal(row.stocking_owner_id, adminRows[0].id, 'stocking owner should temporarily fall back to admin');
    }

    const { rows: mssOwners } = await client.query('SELECT mss_owner_id FROM mss_domain');
    for (const row of mssOwners) assert.equal(row.mss_owner_id, null, 'MSS owner should become unassigned');

    const { rows: orgOwners } = await client.query(
      "SELECT owner_id FROM org_node WHERE node_type IN ('REGION', 'OFFICE')",
    );
    for (const row of orgOwners) assert.equal(row.owner_id, null, 'organization owner should become unassigned');

    const secondReset = await reset.resetBetaTestUsers(client);
    assert.equal(secondReset.deletedUsers, 0, 'user reset should be safe to repeat');
  } finally {
    client.release();
  }
});
