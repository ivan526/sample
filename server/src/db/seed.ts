import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { ROLES } from '../shared/types.js';

// 统一数据库客户端类型，兼容SQLite和PostgreSQL
type DbClient = {
  query: <T = any>(sql: string, params?: any[]) => Promise<{ rows: T[]; rowCount: number }>;
};

export async function seedData(client: DbClient) {
  // 检查是否已初始化
  const { rows: domainCount } = await client.query('SELECT COUNT(*) AS count FROM product_domain');
  if (Number(domainCount[0].count) > 0) {
    // 检查是否需要给已有用户补默认密码（升级场景）
    const { rows: noPasswordUsers } = await client.query<{ id: string, employee_no: string }>(
      'SELECT id, employee_no FROM app_user WHERE password_hash = \'\' OR password_hash IS NULL'
    );
    for (const u of noPasswordUsers) {
      const defaultPwd = u.employee_no === 'admin' ? 'Admin@123' : '123456';
      const hash = bcrypt.hashSync(defaultPwd, 10);
      await client.query(
        'UPDATE app_user SET password_hash = $1 WHERE id = $2',
        [hash, u.id]
      );
    }
    if (noPasswordUsers.length > 0) {
      console.log(`Updated default password for ${noPasswordUsers.length} existing users`);
    }
    console.log('Seed data already exists, skipping');
    return;
  }

  console.log('Seeding initial data...');

  // 默认用户配置，包含角色和初始密码
  const users = [
    { employeeNo: 'admin', displayName: '系统管理员', role: ROLES.ADMIN, password: 'Admin@123' },
    { employeeNo: 'wanglu', displayName: '王璐', role: ROLES.GTM, password: '123456' },
    { employeeNo: 'zhaomin', displayName: '赵敏', role: ROLES.MSS_DOMAIN_OWNER, password: '123456' },
    { employeeNo: 'aaa', displayName: 'AAA', role: ROLES.REGIONAL_OWNER, password: '123456' },
    { employeeNo: 'chentao', displayName: '陈涛', role: ROLES.STOCKING_OWNER, password: '123456' },
    { employeeNo: 'lina', displayName: '李娜', role: ROLES.GTM, password: '123456' },
    { employeeNo: 'zhouhang', displayName: '周航', role: ROLES.GTM, password: '123456' },
    { employeeNo: 'sunyue', displayName: '孙悦', role: ROLES.MSS_DOMAIN_OWNER, password: '123456' },
    { employeeNo: 'bbb', displayName: 'BBB', role: ROLES.REGIONAL_OWNER, password: '123456' },
    { employeeNo: 'ccc', displayName: 'CCC', role: ROLES.REGIONAL_OWNER, password: '123456' },
    { employeeNo: 'ddd', displayName: 'DDD', role: ROLES.REGIONAL_OWNER, password: '123456' },
    { employeeNo: 'eee', displayName: 'EEE', role: ROLES.REGIONAL_OWNER, password: '123456' },
    { employeeNo: 'fff', displayName: 'FFF', role: ROLES.REGIONAL_OWNER, password: '123456' },
  ];

  const userIds: Record<string, string> = {};
  for (const user of users) {
    const passwordHash = bcrypt.hashSync(user.password, 10);
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO app_user (employee_no, display_name, password_hash, role, enabled, created_at)
       VALUES ($1, $2, $3, $4, true, NOW())
       RETURNING id`,
      [user.employeeNo, user.displayName, passwordHash, user.role]
    );
    userIds[user.employeeNo] = rows[0].id;
      console.log(`Created development user: ${user.employeeNo} (${user.displayName}) / ${user.role}`);
  }

  // 008 migration runs before demo users are seeded, so its owner lookups are
  // intentionally nullable. Finish the relationship after users exist and also
  // repair databases created by earlier releases.
  const mssDomains = [
    { id: 'mss-mkt', code: 'mkt', name: 'MKT领域', description: '市场线需求，覆盖上市营销、展会、发布会等场景', ownerId: userIds.zhaomin },
    { id: 'mss-retail', code: 'retail', name: '零售领域', description: '零售门店、线下渠道需求', ownerId: userIds.sunyue },
    { id: 'mss-service', code: 'service', name: '服务领域', description: '售后服务、维修、客户服务场景需求', ownerId: null },
    { id: 'mss-gtm', code: 'gtm', name: 'GTM领域', description: '产品上市、发布与GTM专项需求', ownerId: null },
  ];
  for (const domain of mssDomains) {
    await client.query(`
      INSERT INTO mss_domain (id, code, name, description, mss_owner_id, enabled)
      VALUES ($1, $2, $3, $4, $5, true)
      ON CONFLICT (id) DO UPDATE SET
        code = $2, name = $3, description = $4,
        mss_owner_id = COALESCE($5, mss_domain.mss_owner_id), enabled = true,
        updated_at = NOW()
    `, [domain.id, domain.code, domain.name, domain.description, domain.ownerId]);
  }

  // 插入产品领域
  const domains = [
    { id: 'wearables', code: 'wearables', name: '穿戴', gtmOwnerId: userIds.wanglu, domainOwnerId: userIds.zhaomin, stockingOwnerId: userIds.chentao, description: '手表、手环及穿戴配件' },
    { id: 'mobile', code: 'mobile', name: '手机', gtmOwnerId: userIds.lina, domainOwnerId: userIds.zhaomin, stockingOwnerId: userIds.chentao, description: '手机及移动终端' },
    { id: 'tablet', code: 'tablet', name: '平板', gtmOwnerId: userIds.zhouhang, domainOwnerId: userIds.sunyue, stockingOwnerId: userIds.chentao, description: '平板及配套终端' },
  ];

  for (const domain of domains) {
    await client.query(
      'INSERT INTO product_domain (id, code, name, description, gtm_owner_id, domain_owner_id, stocking_owner_id) VALUES ($1, $2, $3, $4, $5, $6, $7)',
      [domain.id, domain.code, domain.name, domain.description, domain.gtmOwnerId, domain.domainOwnerId, domain.stockingOwnerId]
    );
  }

  const productScopeAssignments: Array<[string, string]> = [
    [userIds.wanglu, 'wearables'],
    [userIds.lina, 'mobile'],
    [userIds.zhouhang, 'tablet'],
    [userIds.chentao, 'wearables'],
    [userIds.chentao, 'mobile'],
    [userIds.chentao, 'tablet'],
  ];
  const mssScopeAssignments: Array<[string, string]> = [
    [userIds.zhaomin, 'mss-mkt'],
    [userIds.sunyue, 'mss-retail'],
    [userIds.aaa, 'mss-mkt'],
    [userIds.bbb, 'mss-mkt'],
    [userIds.ccc, 'mss-mkt'],
    [userIds.ddd, 'mss-mkt'],
    [userIds.eee, 'mss-mkt'],
    [userIds.fff, 'mss-mkt'],
  ];
  for (const [userId, scopeId] of productScopeAssignments) {
    await client.query(
      `INSERT INTO user_scope_assignment (user_id, scope_type, scope_id)
       VALUES ($1, 'PRODUCT_DOMAIN', $2) ON CONFLICT (user_id, scope_type, scope_id) DO NOTHING`,
      [userId, scopeId]
    );
  }
  for (const [userId, scopeId] of mssScopeAssignments) {
    await client.query(
      `INSERT INTO user_scope_assignment (user_id, scope_type, scope_id)
       VALUES ($1, 'MSS_DOMAIN', $2) ON CONFLICT (user_id, scope_type, scope_id) DO NOTHING`,
      [userId, scopeId]
    );
  }

  // 插入产品
  const products = [
    { id: 'chitu-b19', code: 'chitu-b19', name: 'Chitu B19系列', domainId: 'wearables', mssDomainId: 'mss-mkt', supplyTimeText: '预计2026年1月初发货', defaultDeadlineText: '2026-08-31T18:00:00+08:00' },
    { id: 'chitu-b21', code: 'chitu-b21', name: 'Chitu B21系列', domainId: 'wearables', mssDomainId: 'mss-mkt', supplyTimeText: '预计2026年2月中旬发货', defaultDeadlineText: '2026-09-15T18:00:00+08:00' },
    { id: 'chitu-pad-x', code: 'chitu-pad-x', name: 'Chitu Pad X系列', domainId: 'tablet', mssDomainId: 'mss-retail', supplyTimeText: '预计2026年3月初发货', defaultDeadlineText: '2026-09-30T18:00:00+08:00' },
    { id: 'chitu-b23', code: 'chitu-b23', name: 'Chitu B23新品项目', domainId: 'wearables', mssDomainId: 'mss-mkt', supplyTimeText: '待产品线确认', defaultDeadlineText: null },
  ];

  for (const product of products) {
    await client.query(
      'INSERT INTO product (id, code, name, domain_id, mss_domain_id, supply_time_text, default_deadline_text) VALUES ($1, $2, $3, $4, $5, $6, $7)',
      [product.id, product.code, product.name, product.domainId, product.mssDomainId, product.supplyTimeText, product.defaultDeadlineText]
    );
  }

  // 插入SKU
  const skus = [
    { id: 'b19f', productId: 'chitu-b19', model: 'Chitu-B19F', bomCode: '111' },
    { id: 'b19w', productId: 'chitu-b19', model: 'Chitu-B19W', bomCode: '222' },
    { id: 'b19fb', productId: 'chitu-b19', model: 'Chitu-B19FB', bomCode: '333' },
    { id: 'b19d', productId: 'chitu-b19', model: 'Chitu-B19D', bomCode: '444' },
    { id: 'b21f', productId: 'chitu-b21', model: 'Chitu-B21F', bomCode: '521' },
    { id: 'b21w', productId: 'chitu-b21', model: 'Chitu-B21W', bomCode: '522' },
    { id: 'b21d', productId: 'chitu-b21', model: 'Chitu-B21D', bomCode: '523' },
    { id: 'padx-pro', productId: 'chitu-pad-x', model: 'Chitu-PadX-Pro', bomCode: 'PX01' },
    { id: 'padx-air', productId: 'chitu-pad-x', model: 'Chitu-PadX-Air', bomCode: 'PX02' },
  ];

  for (const sku of skus) {
    await client.query(
      'INSERT INTO product_sku (id, product_id, model, bom_code) VALUES ($1, $2, $3, $4)',
      [sku.id, sku.productId, sku.model, sku.bomCode]
    );
  }

  // 插入组织 - 区域
  const regions = [
    { id: 'europe', code: 'europe', name: '欧洲MKT', ownerId: userIds.aaa },
    { id: 'eurasia', code: 'eurasia', name: '欧亚MKT', ownerId: userIds.bbb },
    { id: 'sea', code: 'sea', name: '亚太MKT', ownerId: userIds.ccc },
    { id: 'latam', code: 'latam', name: '拉美MKT', ownerId: userIds.ddd },
    { id: 'mea', code: 'mea', name: '中东非MKT', ownerId: userIds.eee },
    { id: 'china', code: 'china', name: '中国区MKT', ownerId: userIds.fff },
  ];

  const orgIds: Record<string, string> = {};
  for (const region of regions) {
    const { rows } = await client.query<{ id: string }>(
      'INSERT INTO org_node (id, code, name, node_type, owner_id) VALUES ($1, $2, $3, $4, $5) RETURNING id',
      [region.id, region.code, region.name, 'REGION', region.ownerId]
    );
    orgIds[region.id] = rows[0].id;
  }

  // 插入代表处
  const offices = [
    { id: 'de-office', code: 'de-office', name: '德国代表处', parentId: 'europe', ownerId: userIds.aaa, countries: ['德国', '奥地利', '瑞士'] },
    { id: 'fr-office', code: 'fr-office', name: '法国代表处', parentId: 'europe', ownerId: userIds.aaa, countries: ['法国', '比利时', '荷兰'] },
    { id: 'es-office', code: 'es-office', name: '西班牙代表处', parentId: 'europe', ownerId: userIds.aaa, countries: ['西班牙', '葡萄牙'] },
    { id: 'kz-office', code: 'kz-office', name: '哈萨克斯坦代表处', parentId: 'eurasia', ownerId: userIds.bbb, countries: ['哈萨克斯坦', '乌兹别克斯坦'] },
    { id: 'tr-office', code: 'tr-office', name: '土耳其代表处', parentId: 'eurasia', ownerId: userIds.bbb, countries: ['土耳其', '格鲁吉亚'] },
    { id: 'sea-office', code: 'sea-office', name: '东南亚代表处', parentId: 'sea', ownerId: userIds.ccc, countries: ['新加坡', '泰国', '马来西亚', '菲律宾'] },
    { id: 'br-office', code: 'br-office', name: '巴西代表处', parentId: 'latam', ownerId: userIds.ddd, countries: ['巴西', '阿根廷', '智利'] },
    { id: 'mx-office', code: 'mx-office', name: '墨西哥代表处', parentId: 'latam', ownerId: userIds.ddd, countries: ['墨西哥', '哥伦比亚', '秘鲁'] },
    { id: 'me-office', code: 'me-office', name: '中东代表处', parentId: 'mea', ownerId: userIds.eee, countries: ['阿联酋', '沙特阿拉伯'] },
    { id: 'za-office', code: 'za-office', name: '南非代表处', parentId: 'mea', ownerId: userIds.eee, countries: ['南非', '肯尼亚'] },
    { id: 'cn-office', code: 'cn-office', name: '中国区代表处', parentId: 'china', ownerId: userIds.fff, countries: ['中国'] },
  ];

  for (const office of offices) {
    const { rows } = await client.query<{ id: string }>(
      'INSERT INTO org_node (id, code, name, node_type, parent_id, owner_id) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
      [office.id, office.code, office.name, 'OFFICE', orgIds[office.parentId], office.ownerId]
    );
    orgIds[office.id] = rows[0].id;
  }

  // 插入国家
  for (const office of offices) {
    for (const country of office.countries) {
      const countryCode = country.toLowerCase().replace(/\s+/g, '-');
      await client.query(
        'INSERT INTO org_node (code, name, node_type, parent_id, owner_id) VALUES ($1, $2, $3, $4, $5)',
        [countryCode, country, 'COUNTRY', orgIds[office.id], null]
      );
    }
  }

  await seedCollectionAndExecution(client, userIds, offices);

  console.log('Seed data completed');
}

async function seedCollectionAndExecution(client: DbClient, userIds: Record<string, string>, offices: Array<{ id: string; name: string; parentId: string; ownerId: string; countries: string[] }>) {
  const b19Demand: Record<string, number[]> = {
    europe: [307, 405, 170, 109], eurasia: [50, 50, 50, 20], sea: [120, 150, 80, 60],
    latam: [90, 120, 60, 40], mea: [100, 125, 70, 45], china: [80, 90, 50, 41],
  };
  const b21Demand: Record<string, number[]> = {
    europe: [180, 210, 96], eurasia: [60, 70, 35], sea: [90, 110, 48], latam: [55, 65, 30], mea: [45, 56, 30],
  };
  const regionNames: Record<string, string> = {
    europe: '欧洲MKT', eurasia: '欧亚MKT', sea: '东南亚MKT', latam: '拉美MKT', mea: '中东非MKT', china: '中国区MKT',
  };
  const skuIds: Record<string, string[]> = { 'chitu-b19': ['b19f', 'b19w', 'b19fb', 'b19d'], 'chitu-b21': ['b21f', 'b21w', 'b21d'] };
  const skuModels: Record<string, string[]> = { 'chitu-b19': ['Chitu-B19F', 'Chitu-B19W', 'Chitu-B19FB', 'Chitu-B19D'], 'chitu-b21': ['Chitu-B21F', 'Chitu-B21W', 'Chitu-B21D'] };
  const skuBoms: Record<string, string[]> = { 'chitu-b19': ['111', '222', '333', '444'], 'chitu-b21': ['521', '522', '523'] };
  const plans = [
    { id: 'plan-b19-202608', no: 'PLAN-2608-01', productId: 'chitu-b19', domainId: 'wearables', stage: '测试样机（VN2）', status: 'GTM_CLOSURE', regions: Object.keys(b19Demand), demand: b19Demand, submitted: Object.keys(b19Demand), total: 2482, deadline: '2026-08-31T18:00:00+08:00' },
    { id: 'plan-b21-202608', no: 'PLAN-2608-02', productId: 'chitu-b21', domainId: 'wearables', stage: '工程样机（EVT）', status: 'COLLECTING', regions: Object.keys(b21Demand), demand: b21Demand, submitted: ['eurasia', 'sea', 'latam'], total: 0, deadline: '2026-09-15T18:00:00+08:00' },
  ];

  for (const plan of plans) {
    await client.query(`
      INSERT INTO collection_plan (id, plan_no, product_id, domain_id, mss_domain_id, sample_stage, status, deadline_at, note, demand_total, released_by, released_at, created_by)
      VALUES ($1, $2, $3, $4, (SELECT mss_domain_id FROM product WHERE id = $3), $5, $6, $7, $8, $9, $10, NOW(), $10)
    `, [plan.id, plan.no, plan.productId, plan.domainId, plan.stage, plan.status, plan.deadline, '演示收集计划', plan.total, userIds.wanglu]);

    const domainTaskId = `domain-task-${plan.id}-mss-mkt`;
    const domainTaskStatus = plan.status === 'GTM_CLOSURE' ? 'FEEDBACK_SUBMITTED' : plan.status === 'DOMAIN_REVIEW' ? 'READY_TO_FEEDBACK' : 'COLLECTING';
    await client.query(`
      INSERT INTO collection_plan_domain_task (id, plan_id, mss_domain_id, status, dispatched_by, dispatched_at)
      VALUES ($1, $2, 'mss-mkt', $3, $4, NOW())
    `, [domainTaskId, plan.id, domainTaskStatus, userIds.zhaomin]);
    for (const skuId of skuIds[plan.productId]) {
      await client.query(
        'INSERT INTO collection_plan_domain_task_sku (domain_task_id, product_sku_id) VALUES ($1, $2)',
        [domainTaskId, skuId]
      );
    }

    const snapshotItems: any[] = [];
    for (const regionId of plan.regions) {
      const scopeId = `${plan.id}-${regionId}`;
      const submissionId = `${scopeId}-submission`;
      const regionOffices = offices.filter((office) => office.parentId === regionId).map((office) => ({ id: office.id, name: office.name, countries: office.countries }));
      await client.query(`
        INSERT INTO collection_plan_scope (id, plan_id, region_id, region_name_snapshot, region_owner_snapshot, office_country_snapshot)
        VALUES ($1, $2, $3, $4, $5, $6)
      `, [scopeId, plan.id, regionId, regionNames[regionId], '区域接口人', JSON.stringify({ offices: regionOffices })]);
      const submitted = plan.submitted.includes(regionId);
      await client.query(`
        INSERT INTO demand_submission (id, plan_scope_id, status, saved_by, saved_at, submitted_by, submitted_at)
        VALUES ($1, $2, $3, $4, NOW(), $5, $6)
      `, [submissionId, scopeId, submitted ? 'SUBMITTED' : 'DRAFT', userIds.aaa, submitted ? userIds.aaa : null, submitted ? new Date().toISOString() : null]);
      const domainScopeId = `domain-${scopeId}`;
      const domainSubmissionId = `domain-${submissionId}`;
      await client.query(`
        INSERT INTO collection_plan_domain_scope (id, domain_task_id, region_id, region_name_snapshot, region_owner_snapshot, office_country_snapshot)
        VALUES ($1, $2, $3, $4, $5, $6)
      `, [domainScopeId, domainTaskId, regionId, regionNames[regionId], '区域接口人', JSON.stringify({ offices: regionOffices })]);
      await client.query(`
        INSERT INTO collection_plan_domain_submission (id, domain_scope_id, status, saved_by, saved_at, submitted_by, submitted_at)
        VALUES ($1, $2, $3, $4, NOW(), $5, $6)
      `, [domainSubmissionId, domainScopeId, submitted ? 'SUBMITTED' : 'DRAFT', userIds.aaa, submitted ? userIds.aaa : null, submitted ? new Date().toISOString() : null]);
      const quantities = plan.demand[regionId];
      for (let index = 0; index < quantities.length; index++) {
        const item = {
          product_id: plan.productId,
          product_sku_id: skuIds[plan.productId][index],
          provisional_item_key: null,
          model: skuModels[plan.productId][index],
          bom_code: skuBoms[plan.productId][index],
          region_id: regionId,
          region_name: regionNames[regionId],
          office_id: regionOffices[0]?.id || null,
          office_name: regionOffices[0]?.name || null,
          quantity: quantities[index],
          demand_basis: index % 2 === 0 ? '新品上市体验' : '重点客户PoC',
          planned_use_date: '2026-12-31',
          note: '',
        };
        await client.query(`
          INSERT INTO demand_item (id, submission_id, product_sku_id, office_id, quantity, demand_basis, planned_use_date, note)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        `, [`${submissionId}-${index}`, submissionId, item.product_sku_id, item.office_id, item.quantity, item.demand_basis, item.planned_use_date, item.note]);
        await client.query(`
          INSERT INTO collection_plan_domain_demand_item (id, submission_id, product_sku_id, office_id, quantity, demand_basis, planned_use_date, note)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        `, [`domain-${submissionId}-${index}`, domainSubmissionId, item.product_sku_id, item.office_id, item.quantity, item.demand_basis, item.planned_use_date, item.note]);
        if (submitted && plan.status === 'GTM_CLOSURE') snapshotItems.push(item);
      }
    }

    if (plan.status === 'GTM_CLOSURE') {
      await client.query(`
        INSERT INTO domain_feedback (id, plan_id, note, total_quantity, summary_snapshot, confirmed_by, confirmed_at)
        VALUES ($1, $2, $3, $4, $5, $6, NOW())
      `, [`${plan.id}-feedback`, plan.id, '区域需求已核对，可供GTM汇总排产。', plan.total, JSON.stringify({ items: snapshotItems }), userIds.zhaomin]);
      await client.query(`
        INSERT INTO collection_plan_domain_feedback (id, domain_task_id, note, total_quantity, summary_snapshot, confirmed_by, confirmed_at)
        VALUES ($1, $2, $3, $4, $5, $6, NOW())
      `, [`domain-${plan.id}-feedback`, domainTaskId, '区域需求已核对，可供GTM汇总排产。', plan.total, JSON.stringify({ items: snapshotItems }), userIds.zhaomin]);
      for (const item of snapshotItems) {
        await client.query(`
          INSERT INTO execution_fact (id, source_type, source_id, product_id, product_sku_id, region_id, office_id, quantity, occurred_at, dimension_snapshot)
          VALUES ($1, 'CONFIRMED_DEMAND', $2, $3, $4, $5, $6, $7, NOW(), $8)
        `, [crypto.randomUUID(), plan.id, plan.productId, item.product_sku_id, item.region_id, item.office_id, item.quantity, JSON.stringify({ feedbackPlanId: plan.id })]);
      }
    }
  }

  const operational = [
    { sku: 'b19f', product: 'chitu-b19', warehouse: '欧洲中心仓', system: 320, actual: 320, locked: 144, production: 620, applied: 512, shipped: 348, inventory: 176, batches: 3 },
    { sku: 'b19w', product: 'chitu-b19', warehouse: '欧洲中心仓', system: 420, actual: 412, locked: 184, production: 680, applied: 486, shipped: 392, inventory: 228, batches: 3 },
    { sku: 'b19fb', product: 'chitu-b19', warehouse: '深圳中心仓', system: 220, actual: 220, locked: 94, production: 360, applied: 270, shipped: 210, inventory: 126, batches: 3 },
    { sku: 'b19d', product: 'chitu-b19', warehouse: '深圳中心仓', system: 160, actual: 148, locked: 58, production: 200, applied: 130, shipped: 90, inventory: 90, batches: 2 },
  ];
  for (const row of operational) {
    const inventoryId = `inventory-${row.sku}`;
    await client.query(`
      INSERT INTO inventory_balance (id, product_id, product_sku_id, warehouse, system_quantity, actual_quantity, locked_quantity, available_quantity, reason, checked_by, checked_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
    `, [inventoryId, row.product, row.sku, row.warehouse, row.system, row.actual, row.locked, row.inventory, row.system === row.actual ? '账实一致' : '', userIds.zhaomin]);
    for (const [sourceType, quantity] of [['PRODUCTION', row.production], ['APPLICATION', row.applied], ['INVENTORY', row.inventory]] as const) {
      await client.query(`
        INSERT INTO execution_fact (id, source_type, source_id, product_id, product_sku_id, region_id, office_id, quantity, occurred_at, dimension_snapshot)
        VALUES ($1, $2, $3, $4, $5, 'europe', 'de-office', $6, NOW(), $7)
      `, [crypto.randomUUID(), sourceType, sourceType === 'INVENTORY' ? inventoryId : crypto.randomUUID(), row.product, row.sku, quantity, JSON.stringify({ seeded: true, warehouse: row.warehouse })]);
    }
    const base = Math.floor(row.shipped / row.batches);
    for (let batch = 0; batch < row.batches; batch++) {
      const quantity = batch === row.batches - 1 ? row.shipped - base * batch : base;
      await client.query(`
        INSERT INTO execution_fact (id, source_type, source_id, product_id, product_sku_id, region_id, office_id, quantity, occurred_at, dimension_snapshot)
        VALUES ($1, 'SHIPMENT', $2, $3, $4, 'europe', 'de-office', $5, NOW(), $6)
      `, [crypto.randomUUID(), crypto.randomUUID(), row.product, row.sku, quantity, JSON.stringify({ seeded: true, batch: batch + 1 })]);
    }
  }
}
