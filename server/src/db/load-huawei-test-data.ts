import runMigrations from './migrate.js';
import { getClient } from '../config/db.js';
import { seedHuaweiTestData } from './huawei-test-data.js';

if (process.env.NODE_ENV === 'production' && process.env.ALLOW_TEST_DATA !== 'true') {
  throw new Error('生产环境默认禁止写入测试数据；如确需执行，请显式设置 ALLOW_TEST_DATA=true');
}

process.env.SEED_DEMO_DATA = 'true';
await runMigrations();

const client = await getClient();
try {
  await client.begin();
  await seedHuaweiTestData(client);
  await client.commit();
  console.log('Huawei acceptance test data loaded successfully.');
} catch (error) {
  await client.rollback();
  throw error;
} finally {
  client.release();
}

