import { readdir, readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getClient, getDbType, type DbClient } from '../config/db.js';
import { seedData } from './seed.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function runMigrations() {
  const client = await getClient();
  const dbType = getDbType();
  try {
    await client.query('BEGIN');

    // 创建迁移记录表（兼容SQLite/PG，类型用TEXT）
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version VARCHAR(255) PRIMARY KEY,
        applied_at ${dbType === 'postgres' ? 'TIMESTAMPTZ' : 'TEXT'} NOT NULL DEFAULT (now())
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

      // SQLite不支持ALTER TABLE ... ADD COLUMN IF NOT EXISTS，认证字段由下方按列补齐。
      if (dbType === 'sqlite' && file === '003_add_user_auth.sql') {
        await ensureSqliteUserColumns(client);
        await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [version]);
        continue;
      }

      console.log(`Applying migration: ${file}`);
      let sql = await readFile(join(migrationsDir, file), 'utf-8');
      if (dbType === 'postgres') sql = toPostgresMigration(sql, file);
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [version]);
    }

    // 生产环境默认不写入演示账号/业务数据；本地开发和测试保持零配置可浏览。
    if (process.env.NODE_ENV !== 'production' || process.env.SEED_DEMO_DATA === 'true') {
      await seedData(client);
    }

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

function toPostgresMigration(sql: string, file: string): string {
  let converted = sql
    .replace(/DEFAULT \(lower\(hex\(randomblob\(16\)\)\)\)/gi, "DEFAULT (gen_random_uuid()::text)")
    .replace(/\(datetime\('now'\)\)/gi, '(now())')
    .replace(/BOOLEAN NOT NULL DEFAULT 1/gi, 'BOOLEAN NOT NULL DEFAULT true')
    .replace(/BOOLEAN NOT NULL DEFAULT 0/gi, 'BOOLEAN NOT NULL DEFAULT false')
    .replace(/INSERT OR IGNORE/gi, 'INSERT')
    .replace(/PRAGMA\s+optimize\s*;/gi, '');
  if (file === '001_init.sql') {
    converted = `CREATE EXTENSION IF NOT EXISTS pgcrypto;\n${converted}`;
  }
  if (file === '002_add_dictionary.sql') {
    converted = converted.replace(/;\s*$/, ' ON CONFLICT (dict_type, code) DO NOTHING;');
  }
  return converted;
}

async function ensureSqliteUserColumns(client: DbClient) {
  const { rows } = await client.query<{ name: string }>('PRAGMA table_info(app_user)');
  const columns = new Set(rows.map((row) => row.name));
  if (!columns.has('role')) await client.query("ALTER TABLE app_user ADD COLUMN role TEXT NOT NULL DEFAULT 'REGIONAL_OWNER'");
  if (!columns.has('password_hash')) await client.query("ALTER TABLE app_user ADD COLUMN password_hash TEXT NOT NULL DEFAULT ''");
  if (!columns.has('last_login_at')) await client.query('ALTER TABLE app_user ADD COLUMN last_login_at TEXT');
  await client.query('CREATE UNIQUE INDEX IF NOT EXISTS idx_app_user_employee_no ON app_user(employee_no)');
}

export default runMigrations;
