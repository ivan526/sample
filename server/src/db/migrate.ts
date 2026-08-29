import { readdir, readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getClient } from '../config/db.js';
import { seedData } from './seed.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function runMigrations() {
  const client = await getClient();
  try {
    await client.query('BEGIN');

    // 创建迁移记录表（兼容SQLite/PG，类型用TEXT）
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version VARCHAR(255) PRIMARY KEY,
        applied_at TEXT NOT NULL DEFAULT (now())
      )
    `);

    // 获取已执行的迁移
    const { rows: appliedMigrations } = await client.query<{ version: string }>(
      'SELECT version FROM schema_migrations ORDER BY version'
    );
    const appliedVersions = new Set(appliedMigrations.map(r => r.version));

    // 读取迁移文件
    const migrationsDir = join(__dirname, 'migrations');
    const files = (await readdir(migrationsDir))
      .filter(f => f.endsWith('.sql'))
      .sort();

    for (const file of files) {
      const version = file.split('_')[0];
      if (appliedVersions.has(version)) continue;

      console.log(`Applying migration: ${file}`);
      const sql = await readFile(join(migrationsDir, file), 'utf-8');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [version]);
    }

    // 插入初始seed数据
    await seedData(client);

    await client.query('COMMIT');
    console.log('Migrations completed successfully');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Migration failed:', error);
    throw error;
  } finally {
    client.release();
  }
}

export default runMigrations;
