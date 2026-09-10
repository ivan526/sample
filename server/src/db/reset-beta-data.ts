import 'dotenv/config';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { getClient, type DbClient } from '../config/db.js';
import runMigrations from './migrate.js';

const CONFIRMATION_TOKEN = 'RESET_BETA_DATA';
const USER_RESET_CONFIRMATION_TOKEN = 'RESET_BETA_USERS';
const PROTECTED_EMPLOYEE_NO = 'admin';

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

export type BetaUserResetResult = {
  deletedUsers: number;
  protectedEmployeeNo: string;
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

async function assertBetaBusinessDataEmpty(client: DbClient) {
  const nonEmpty: string[] = [];
  for (const table of BETA_BUSINESS_TABLES) {
    const { rows } = await client.query<{ count: number | string }>(`SELECT COUNT(*) AS count FROM ${table}`);
    if (Number(rows[0]?.count || 0) > 0) nonEmpty.push(table);
  }
  if (nonEmpty.length > 0) {
    throw new Error(
      `用户清理已取消：业务数据不为空（${nonEmpty.join('、')}）。请先执行 data:reset:beta 清理Beta业务数据，再执行 data:reset:beta:users。`,
    );
  }
}

/**
 * 清理Beta阶段导入/种子的测试用户，仅保留系统管理员 admin。
 *
 * 为避免外键断链：
 * - 产品品类的必填GTM/备货负责人临时回退到admin；
 * - 产品品类的可选领域接口人、MSS业务领域负责人、区域/代表处负责人置为空；
 * - 用户负责范围随用户删除一起清理。
 *
 * 该操作要求业务过程数据已经清空，防止历史业务记录引用被删除的用户。
 */
export async function resetBetaTestUsers(client: DbClient): Promise<BetaUserResetResult> {
  await assertBetaBusinessDataEmpty(client);

  const { rows: protectedUsers } = await client.query<{ id: string; employee_no: string }>(
    'SELECT id, employee_no FROM app_user WHERE employee_no = $1 LIMIT 1',
    [PROTECTED_EMPLOYEE_NO],
  );
  if (protectedUsers.length === 0) {
    throw new Error(`用户清理已取消：未找到受保护的系统管理员账号 ${PROTECTED_EMPLOYEE_NO}。`);
  }

  const adminId = protectedUsers[0].id;
  const { rows: userCountRows } = await client.query<{ count: number | string }>(
    'SELECT COUNT(*) AS count FROM app_user WHERE employee_no <> $1',
    [PROTECTED_EMPLOYEE_NO],
  );
  const deletedUsers = Number(userCountRows[0]?.count || 0);

  await client.begin();
  try {
    // product_domain中的GTM/备货负责人是NOT NULL，必须先指向仍保留的admin。
    await client.query(
      `UPDATE product_domain
       SET gtm_owner_id = $1,
           domain_owner_id = NULL,
           stocking_owner_id = $1,
           updated_at = NOW(),
           version = version + 1`,
      [adminId],
    );

    // MSS领域和组织负责人允许为空，等待重新导入用户后由责任范围重新配置。
    await client.query('UPDATE mss_domain SET mss_owner_id = NULL, updated_at = NOW(), version = version + 1');
    await client.query(
      `UPDATE org_node
       SET owner_id = NULL, updated_at = NOW(), version = version + 1
       WHERE node_type IN ('REGION', 'OFFICE')`,
    );

    // 这里显式删除，避免依赖数据库是否启用了ON DELETE CASCADE。
    await client.query(
      'DELETE FROM user_scope_assignment WHERE user_id IN (SELECT id FROM app_user WHERE employee_no <> $1)',
      [PROTECTED_EMPLOYEE_NO],
    );
    const deleteResult = await client.query(
      'DELETE FROM app_user WHERE employee_no <> $1',
      [PROTECTED_EMPLOYEE_NO],
    );
    if (deleteResult.rowCount !== deletedUsers) {
      throw new Error(`用户清理结果异常：预期删除 ${deletedUsers} 个用户，实际删除 ${deleteResult.rowCount} 个。`);
    }

    await client.commit();
  } catch (error) {
    await client.rollback();
    throw error;
  }

  return {
    deletedUsers,
    protectedEmployeeNo: PROTECTED_EMPLOYEE_NO,
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
  const args = process.argv.slice(2);
  const confirmation = readConfirmation(args);
  const isUserReset = args.includes('--users');

  if (isUserReset) {
    if (confirmation !== USER_RESET_CONFIRMATION_TOKEN) {
      throw new Error(`清理已取消：请使用 --users --confirm ${USER_RESET_CONFIRMATION_TOKEN} 明确确认。`);
    }
  } else if (confirmation !== CONFIRMATION_TOKEN) {
    throw new Error(`清理已取消：请使用 --confirm ${CONFIRMATION_TOKEN} 明确确认。`);
  }

  const isPostgres = process.env.DATABASE_URL?.startsWith('postgresql://') === true;
  const needsElevatedConfirmation = process.env.NODE_ENV === 'production' || isPostgres;
  if (needsElevatedConfirmation && process.env.ALLOW_BETA_DATA_RESET !== 'true') {
    throw new Error('生产环境或PostgreSQL清理还需显式设置 ALLOW_BETA_DATA_RESET=true。请先完成独立数据库备份。');
  }

  console.log('请确保API服务已停止，正在准备Beta数据清理……');
  const backupPath = isPostgres ? null : await backupSqliteDatabase();
  if (backupPath) console.log(`SQLite备份已创建：${backupPath}`);
  if (isPostgres) console.log('PostgreSQL：已确认使用外部数据库备份。');

  await runMigrations();
  const client = await getClient();
  try {
    if (isUserReset) {
      const result = await resetBetaTestUsers(client);
      console.log(`Beta测试用户清理完成，共删除 ${result.deletedUsers} 个用户，仅保留 ${result.protectedEmployeeNo}。`);
      console.log('产品品类、MSS业务领域、区域/代表处责任人已清空/临时回退，等待重新导入用户后重新配置。');
    } else {
      const result = await resetBetaBusinessData(client);
      console.log(`Beta业务数据清理完成，共删除 ${result.totalDeletedRows} 条记录。`);
      for (const [table, count] of Object.entries(result.deletedRows)) {
        if (count > 0) console.log(`- ${table}: ${count}`);
      }
      console.log('用户、权限、产品/BOM、领域、区域、代表处、国家及字典配置均已保留。');
    }
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
