import 'dotenv/config';
import { mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import crypto from 'node:crypto';

// 数据库类型自动检测：DATABASE_URL为postgresql://用PG，否则默认用SQLite
const DATABASE_URL = process.env.DATABASE_URL;
const isPostgres = DATABASE_URL?.startsWith('postgresql://');

let dbInstance: any = null;
let dbType: 'sqlite' | 'postgres' = 'sqlite';

// 将PG编号占位符转换为SQLite占位符，并记录真实绑定顺序。
// 同一个 $1 多次出现时，SQLite需要收到多份对应参数。
function convertPlaceholders(sql: string): { sql: string; paramIndexes: number[] } {
  let converted = sql;
  const paramIndexes: number[] = [];
  converted = converted.replace(/\$(\d+)/g, (_, num) => {
    paramIndexes.push(Number(num) - 1);
    return '?';
  });
  converted = converted.replace(/\bILIKE\b/gi, 'LIKE');
  return { sql: converted, paramIndexes };
}

function sqliteParams(params: any[], indexes: number[]): any[] {
  const ordered = indexes.length ? indexes.map((index) => params[index]) : params;
  return ordered.map((param) => {
    if (param === undefined) return null;
    if (typeof param === 'boolean') return param ? 1 : 0;
    return param;
  });
}

export interface DbQueryResult<T = any> {
  rows: T[];
  rowCount: number;
}

export interface DbClient {
  query<T = any>(sql: string, params?: any[]): Promise<DbQueryResult<T>>;
  queryRaw(sql: string, params?: any[]): Promise<any>;
  begin(): Promise<void>;
  commit(): Promise<void>;
  rollback(): Promise<void>;
  release(): void;
}

// 初始化SQLite
async function initSQLite() {
  const Database = (await import('better-sqlite3')).default;
  const dataDir = join(process.cwd(), 'data');
  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true });
  }
  const dbPath = process.env.SQLITE_PATH || join(dataDir, 'mss_dev.db');
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // 注册UUID生成函数，兼容PG的gen_random_uuid()
  db.function('gen_random_uuid', () => crypto.randomUUID());
  // 注册now()函数，兼容PG的now()
  db.function('now', () => new Date().toISOString());

  dbType = 'sqlite';
  return db;
}

// 初始化PostgreSQL
async function initPostgres() {
  const pg = await import('pg');
  const PGPool = pg.Pool;
  const pool = new PGPool({
    connectionString: DATABASE_URL,
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
  });

  // 测试连接
  await pool.query('SELECT NOW()');
  dbType = 'postgres';
  return pool;
}

// 获取数据库实例（单例）
async function getDb() {
  if (dbInstance) return dbInstance;

  if (isPostgres) {
    dbInstance = await initPostgres();
  } else {
    dbInstance = await initSQLite();
    console.log(`[INFO] Using SQLite database at ${process.env.SQLITE_PATH || './data/mss_dev.db'} (zero-config development mode)`);
  }

  return dbInstance;
}

// 统一查询接口，和PG返回结构一致：{ rows: [], rowCount: number }
export async function query<T = any>(sql: string, params: any[] = []): Promise<DbQueryResult<T>> {
  const db = await getDb();
  const start = Date.now();

  if (dbType === 'postgres') {
    const res = await db.query(sql, params);
    const duration = Date.now() - start;
    if (duration > 1000) {
      console.log('[SLOW QUERY]', { sql, duration, rows: res.rowCount });
    }
    return { rows: res.rows, rowCount: res.rowCount || 0 };
  } else {
    // SQLite模式：转换占位符，处理参数类型兼容
    const { sql: convertedSql, paramIndexes } = convertPlaceholders(sql);
    const processedParams = sqliteParams(params, paramIndexes);
    let rows: any[] = [];
    let rowCount = 0;

    const sqlTrimmed = sql.trim();
    const sqlLower = sqlTrimmed.toLowerCase();
    const hasReturning = sqlLower.includes('returning');
    const isControlStmt = ['begin', 'commit', 'rollback', 'pragma'].some(prefix => sqlLower.startsWith(prefix));
    // 去掉开头注释再判断DDL，支持多语句迁移SQL
    const sqlNoComments = sqlLower.replace(/^\s*(--.*\n)*\s*/, '');
    const isDDL = ['create', 'alter', 'drop'].some(prefix => sqlNoComments.startsWith(prefix)) || (sqlLower.includes(';') && (sqlLower.includes('create') || sqlLower.includes('alter') || sqlLower.includes('drop')));

    if (isDDL) {
      // DDL语句，SQLite用exec支持多语句
      db.exec(convertedSql);
      rows = [];
      rowCount = 0;
    } else {
      const stmt = db.prepare(convertedSql);
      if (isControlStmt) {
        // 事务/PRAGMA控制语句，无返回结果
        stmt.run(...processedParams);
        rows = [];
        rowCount = 0;
      } else if (hasReturning || sqlLower.startsWith('select')) {
        // 带RETURNING的写操作或读操作：all返回结果集
        rows = stmt.all(...processedParams);
        rowCount = rows.length;
      } else if (sqlLower.startsWith('insert') || sqlLower.startsWith('update') || sqlLower.startsWith('delete')) {
        // 写操作无RETURNING：run返回changes
        const result = stmt.run(...processedParams);
        rowCount = result.changes;
        rows = [];
      } else {
        stmt.run(...processedParams);
        rows = [];
        rowCount = 0;
      }
    }

    const duration = Date.now() - start;
    if (duration > 1000) {
      console.log('[SLOW QUERY]', { sql, duration, rows: rowCount });
    }
    return { rows, rowCount };
  }
}

// 获取客户端/事务对象
export async function getClient(): Promise<DbClient> {
  const db = await getDb();

  if (dbType === 'postgres') {
    const client = await db.connect();
    return {
      query: (text: string, params?: any[]) => client.query(text, params).then((res: any) => ({ rows: res.rows, rowCount: res.rowCount })),
      queryRaw: (text: string, params?: any[]) => client.query(text, params),
      begin: async () => { await client.query('BEGIN'); },
      commit: async () => { await client.query('COMMIT'); },
      rollback: async () => { await client.query('ROLLBACK'); },
      release: () => client.release(),
    };
  } else {
    // SQLite事务
    let inTransaction = false;
    return {
      query: (sql: string, params: any[] = []) => {
        const { sql: convertedSql, paramIndexes } = convertPlaceholders(sql);
        const processedParams = sqliteParams(params, paramIndexes);
        let rows: any[] = [];
        let rowCount = 0;
        const sqlTrimmed = sql.trim();
        const sqlLower = sqlTrimmed.toLowerCase();
        const hasReturning = sqlLower.includes('returning');
        const isControlStmt = ['begin', 'commit', 'rollback', 'pragma'].some(prefix => sqlLower.startsWith(prefix));
        // 去掉开头注释再判断DDL，支持多语句迁移SQL
        const sqlNoComments = sqlLower.replace(/^\s*(--.*\n)*\s*/, '');
        const isDDL = ['create', 'alter', 'drop'].some(prefix => sqlNoComments.startsWith(prefix)) || (sqlLower.includes(';') && (sqlLower.includes('create') || sqlLower.includes('alter') || sqlLower.includes('drop')));

        if (isDDL) {
          // DDL语句，SQLite用exec支持多语句
          db.exec(convertedSql);
          rows = [];
          rowCount = 0;
        } else {
          const stmt = db.prepare(convertedSql);
          if (isControlStmt) {
            stmt.run(...processedParams);
            rows = [];
            rowCount = 0;
          } else if (hasReturning || sqlLower.startsWith('select')) {
            rows = stmt.all(...processedParams);
            rowCount = rows.length;
          } else if (sqlLower.startsWith('insert') || sqlLower.startsWith('update') || sqlLower.startsWith('delete')) {
            const result = stmt.run(...processedParams);
            rowCount = result.changes;
            rows = [];
          } else {
            stmt.run(...processedParams);
            rows = [];
            rowCount = 0;
          }
        }
        return Promise.resolve({ rows, rowCount });
      },
      queryRaw: async (sql: string, params: any[] = []) => {
        const result = await query(sql, params);
        return result;
      },
      begin: () => {
        inTransaction = true;
        db.exec('BEGIN');
        return Promise.resolve();
      },
      commit: () => {
        db.exec('COMMIT');
        inTransaction = false;
        return Promise.resolve();
      },
      rollback: () => {
        if (inTransaction) {
          db.exec('ROLLBACK');
          inTransaction = false;
        }
        return Promise.resolve();
      },
      release: () => {
        if (inTransaction) {
          db.exec('ROLLBACK');
        }
      },
    };
  }
}

// 导出数据库类型供迁移使用
export function getDbType() {
  return dbType;
}

export default { query, getClient, getDbType };
