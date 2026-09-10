import 'dotenv/config';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { getClient, type DbClient } from '../config/db.js';
import runMigrations from './migrate.js';

const CONFIRMATION_TOKEN = 'RESET_BETA_DATA';

// 仅包含业务过程数据。用户、权限、产品/BOM、领域、组织和字典均保留。
export const BETA_BUSINESS_TABLES = [
  'collection_plan_domain_feedback_history',
  'collection_plan_domain_submission_revision',
  'collection_plan_region_change_request',
  'collection_plan_domain_demand_item',
  'collection_plan_domain_feedback',
  'collection_plan_domain_submission',
  'collection_plan_domain_scope',
  'collection_plan_domain_task_sku',
  'collection_plan_domain_task',
  'demand_item',
  'demand_submission',
  'collection_plan_scope',
  'domain_feedback',
  'production_export',
  'execution_fact',
  'inventory_balance',
  'tsmp_shipment_raw',
  'tsmp_import_job',
  'collection_plan',
  'audit_log',
] as const;

export type BetaResetResult = {
  deletedRows: Record<string, number>;
  totalDeletedRows: number;
};

export async function resetBetaBusinessData(client: DbClient): Promise<BetaResetResult> {
  const deletedRows: Record<string, number> = {};
  await client.begin();
  try {
    for (const table of BETA_BUSINESS_TABLES) {
      const result = await client.query(`DELETE FROM ${table}`);
      deletedRows[table] = result.rowCount;
    }
    await client.commit();
  } catch (error) {
    await client.rollback();
    throw error;
  }

  return {
    deletedRows,
    totalDeletedRows: Object.values(deletedRows).reduce((sum, count) => sum + count, 0),
  };
}

function readConfirmation(args: string[]): string | undefined {
  const inline = args.find((arg) => arg.startsWith('--confirm='));
  if (inline) return inline.slice('--confirm='.length);
  const index = args.indexOf('--confirm');
  return index >= 0 ? args[index + 1] : undefined;
}

function sqliteDatabasePath(): string {
  return resolve(process.env.SQLITE_PATH || join(process.cwd(), 'data', 'mss_dev.db'));
}

export async function backupSqliteDatabase(): Promise<string | null> {
  const sourcePath = sqliteDatabasePath();
  if (!existsSync(sourcePath)) return null;

  const backupDirectory = join(dirname(sourcePath), 'backups');
  mkdirSync(backupDirectory, { recursive: true });
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = join(backupDirectory, `mss-before-beta-reset-${timestamp}.db`);
  const database = new Database(sourcePath, { readonly: true, fileMustExist: true });
  try {
    await database.backup(backupPath);
  } finally {
    database.close();
  }
  return backupPath;
}

async function main() {
  const confirmation = readConfirmation(process.argv.slice(2));
  if (confirmation !== CONFIRMATION_TOKEN) {
    throw new Error(`清理已取消：请使用 --confirm ${CONFIRMATION_TOKEN} 明确确认。`);
  }

  const isPostgres = process.env.DATABASE_URL?.startsWith('postgresql://') === true;
  const needsElevatedConfirmation = process.env.NODE_ENV === 'production' || isPostgres;
  if (needsElevatedConfirmation && process.env.ALLOW_BETA_DATA_RESET !== 'true') {
    throw new Error('生产环境或PostgreSQL清理还需显式设置 ALLOW_BETA_DATA_RESET=true。请先完成独立数据库备份。');
  }

  console.log('请确保API服务已停止，正在准备清理Beta业务数据……');
  const backupPath = isPostgres ? null : await backupSqliteDatabase();
  if (backupPath) console.log(`SQLite备份已创建：${backupPath}`);
  if (isPostgres) console.log('PostgreSQL：已确认使用外部数据库备份。');

  await runMigrations();
  const client = await getClient();
  try {
    const result = await resetBetaBusinessData(client);
    console.log(`Beta业务数据清理完成，共删除 ${result.totalDeletedRows} 条记录。`);
    for (const [table, count] of Object.entries(result.deletedRows)) {
      if (count > 0) console.log(`- ${table}: ${count}`);
    }
    console.log('用户、权限、产品/BOM、领域、区域、代表处、国家及字典配置均已保留。');
  } finally {
    client.release();
  }
}

const isDirectRun = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
