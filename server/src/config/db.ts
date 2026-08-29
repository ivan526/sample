import 'dotenv/config';
import { mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import crypto from 'node:crypto';

// 数据库类型自动检测：DATABASE_URL为postgresql://用PG，否则默认用SQLite
const DATABASE_URL = process.env.DATABASE_URL;
const isPostgres = DATABASE_URL?.startsWith('postgresql://');

let dbInstance: any = null;
let dbType: 'sqlite' | 'postgres' = 'sqlite';

// 转换PG的$1/$2占位符为SQLite的?
function convertPlaceholders(sql: string): { sql: string; paramCount: number } {
  let converted = sql;
  const placeholders = new Set<string>();
  converted = converted.replace(/\$(\d+)/g, (_, num) => {
    placeholders.add(num);
    return '?';
  });
  return { sql: converted, paramCount: placeholders.size };
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
export async function query<T = any>(sql: string, params: any[] = []): Promise<{ rows: T[]; rowCount: number }> {
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
    const { sql: convertedSql } = convertPlaceholders(sql);
    // SQLite仅支持绑定number/string/bigint/Buffer/null，将undefined转为null，布尔转为0/1
    const processedParams = params.map(p => {
      if (p === undefined) return null;
      if (typeof p === 'boolean') return p ? 1 : 0;
      return p;
    });
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
        const result = stmt.run(...params);
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
export async function getClient() {
  const db = await getDb();

  if (dbType === 'postgres') {
    const client = await db.connect();
    return {
      query: (text: string, params?: any[]) => client.query(text, params).then((res: any) => ({ rows: res.rows, rowCount: res.rowCount })),
      queryRaw: (text: string, params?: any[]) => client.query(text, params),
      begin: () => client.query('BEGIN'),
      commit: () => client.query('COMMIT'),
      rollback: () => client.query('ROLLBACK'),
      release: () => client.release(),
    };
  } else {
    // SQLite事务
    let inTransaction = false;
    return {
      query: (sql: string, params: any[] = []) => {
        const { sql: convertedSql } = convertPlaceholders(sql);
        // 参数类型兼容处理
        const processedParams = params.map(p => {
          if (p === undefined) return null;
          if (typeof p === 'boolean') return p ? 1 : 0;
          return p;
        });
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
