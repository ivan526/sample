// Consistent SQLite backup before deploying new code.
// Usage: node scripts/backup-sqlite.cjs
const fs = require('node:fs');
const path = require('node:path');
require('dotenv').config({ path: path.join(process.cwd(), '.env'), quiet: true });

async function main() {
  if ((process.env.DATABASE_URL || '').startsWith('postgresql://')) {
    throw new Error('PostgreSQL detected: this updater requires a separate database backup procedure.');
  }
  const source = path.resolve(process.env.SQLITE_PATH || path.join(process.cwd(), 'data', 'mss_dev.db'));
  if (!fs.existsSync(source)) throw new Error('SQLite database missing; update aborted: ' + source);

  const Database = require('better-sqlite3');
  const destinationFolder = path.join(path.dirname(source), 'backups');
  fs.mkdirSync(destinationFolder, { recursive: true });
  const destination = path.join(destinationFolder, 'mss-before-update-' + new Date().toISOString().replace(/[:.]/g, '-') + '.db');

  const db = new Database(source, { readonly: true, fileMustExist: true });
  try {
    await db.backup(destination);
  } finally {
    db.close();
  }
  const checkDb = new Database(destination, { readonly: true, fileMustExist: true });
  try {
    const integrity = checkDb.pragma('integrity_check');
    if (integrity.length !== 1 || integrity[0].integrity_check !== 'ok') {
      throw new Error('Backup integrity check failed: ' + destination);
    }
  } finally {
    checkDb.close();
  }
  console.log('SQLite backup verified:', destination);
}
main().catch(error => { console.error(error); process.exitCode = 1; });
