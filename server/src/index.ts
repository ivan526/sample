import 'dotenv/config';
import { buildApp } from './app.js';
import runMigrations from './db/migrate.js';

async function start() {
  const port = Number(process.env.MSS_API_PORT || 8787);
  const host = process.env.MSS_API_HOST || '0.0.0.0';

  // 执行数据库迁移
  try {
    await runMigrations();
  } catch (error) {
    console.error('Failed to run migrations:', error);
    process.exit(1);
  }

  const app = await buildApp();

  try {
    await app.listen({ port, host });
    console.log(`MSS API server listening on http://localhost:${port}`);
    console.log(`API base URL: http://localhost:${port}/api/v1`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

start();
