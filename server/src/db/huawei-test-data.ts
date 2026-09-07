import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { ROLES } from '../shared/types.js';

export type SeedDbClient = {
  query: <T = any>(sql: string, params?: any[]) => Promise<{ rows: T[]; rowCount: number }>;
};

type DemoUser = {
  employeeNo: string;
  displayName: string;
  role: ROLES;
};

type ScenarioTask = {
  mssDomainId: string;
  status: 'PENDING_DISPATCH' | 'COLLECTING' | 'READY_TO_FEEDBACK' | 'FEEDBACK_SUBMITTED';
  regionSubmissions?: Array<{
    regionId: string;
    status: 'NOT_STARTED' | 'DRAFT' | 'SUBMITTED' | 'RETURNED';
    quantities: number[];
    revisionNo?: number;
    returnReason?: string;
  }>;
};

type ScenarioPlan = {
  id: string;
  no: string;
  productId: string;
  domainId: string;
  stage: string;
  status: 'PRODUCT_DRAFT' | 'READY_TO_RELEASE' | 'COLLECTING' | 'DOMAIN_REVIEW' | 'GTM_CLOSURE' | 'EXPORTED';
  deadline: string;
  note: string;
  createdBy: string;
  tasks?: ScenarioTask[];
  exported?: boolean;
};

const HUAWEI_USERS: DemoUser[] = [
  { employeeNo: 'liuqian', displayName: '刘倩', role: ROLES.MSS_DOMAIN_OWNER },
  { employeeNo: 'chenxi', displayName: '陈曦', role: ROLES.MSS_DOMAIN_OWNER },
  { employeeNo: 'deowner', displayName: '吴凯', role: ROLES.REGIONAL_OWNER },
  { employeeNo: 'broffice', displayName: '宋扬', role: ROLES.REGIONAL_OWNER },
  { employeeNo: 'cnoffice', displayName: '郭宁', role: ROLES.REGIONAL_OWNER },
];

const HUAWEI_PRODUCT_RENAMES = [
  {
    id: 'chitu-b19', code: 'huawei-watch-5', name: 'HUAWEI WATCH 5系列', domainId: 'wearables',
    supply: '预计2026年10月上旬发货', deadline: '2026-09-30T18:00:00+08:00',
    skus: [
      ['b19f', 'HUAWEI WATCH 5 46mm', '55020HKC', '曜石黑，氟橡胶表带'],
      ['b19w', 'HUAWEI WATCH 5 42mm', '55020HKD', '晨曦金，复合编织表带'],
      ['b19fb', 'HUAWEI WATCH 5 Pro', '55020HKE', '钛空银，钛金属表带'],
      ['b19d', 'HUAWEI WATCH 5 eSIM', '55020HKF', '曜石黑，eSIM版本'],
    ],
  },
  {
    id: 'chitu-b21', code: 'huawei-watch-fit-4-pro', name: 'HUAWEI WATCH FIT 4 Pro系列', domainId: 'wearables',
    supply: '预计2026年10月下旬发货', deadline: '2026-10-15T18:00:00+08:00',
    skus: [
      ['b21f', 'HUAWEI WATCH FIT 4 Pro 黑色', '55020HLA', '黑色氟橡胶表带'],
      ['b21w', 'HUAWEI WATCH FIT 4 Pro 蓝色', '55020HLB', '蓝色氟橡胶表带'],
      ['b21d', 'HUAWEI WATCH FIT 4 Pro 绿色', '55020HLC', '绿色尼龙表带'],
    ],
  },
  {
    id: 'chitu-pad-x', code: 'huawei-matepad-pro-13-2', name: 'HUAWEI MatePad Pro 13.2系列', domainId: 'tablet',
    supply: '预计2026年11月上旬发货', deadline: '2026-10-31T18:00:00+08:00',
    skus: [
      ['padx-pro', 'HUAWEI MatePad Pro 13.2 16GB+1TB', '53014ABC', '曜金黑，柔光版'],
      ['padx-air', 'HUAWEI MatePad Pro 13.2 12GB+512GB', '53014ABD', '晶钻白，标准版'],
    ],
  },
  {
    id: 'chitu-b23', code: 'huawei-pura-project', name: 'HUAWEI Pura新品项目（BOM待补充）', domainId: 'mobile',
    supply: '待产品线确认', deadline: null, skus: [],
  },
] as const;

const EXTRA_PRODUCTS = [
  {
    id: 'huawei-pura-80-ultra', code: 'huawei-pura-80-ultra', name: 'HUAWEI Pura 80 Ultra系列', domainId: 'mobile', supply: '预计2026年10月中旬发货', deadline: '2026-09-25T18:00:00+08:00',
    skus: [
      ['pura80-ultra-black', 'HUAWEI Pura 80 Ultra 16GB+512GB 黑色', '51099AAA', '曜石黑，国内公开版'],
      ['pura80-ultra-gold', 'HUAWEI Pura 80 Ultra 16GB+1TB 金色', '51099AAB', '鎏光金，海外测试版'],
    ],
  },
  {
    id: 'huawei-mate-70-pro', code: 'huawei-mate-70-pro', name: 'HUAWEI Mate 70 Pro系列', domainId: 'mobile', supply: '已完成备货', deadline: '2026-08-20T18:00:00+08:00',
    skus: [
      ['mate70pro-black', 'HUAWEI Mate 70 Pro 12GB+512GB 黑色', '51098XYZ', '曜石黑，海外测试版'],
      ['mate70pro-green', 'HUAWEI Mate 70 Pro 12GB+512GB 绿色', '51098XYW', '云杉绿，海外测试版'],
    ],
  },
  {
    id: 'huawei-matepad-12x', code: 'huawei-matepad-12x', name: 'HUAWEI MatePad 12 X系列', domainId: 'tablet', supply: '预计2026年11月中旬发货', deadline: '2026-10-20T18:00:00+08:00',
    skus: [
      ['matepad12x-green', 'HUAWEI MatePad 12 X 12GB+256GB 绿色', '53014BCA', '草木绿，柔光版'],
      ['matepad12x-white', 'HUAWEI MatePad 12 X 12GB+512GB 白色', null, '珠光白，BOM待产品线补充'],
    ],
  },
  {
    id: 'huawei-freebuds-pro-4', code: 'huawei-freebuds-pro-4', name: 'HUAWEI FreeBuds Pro 4系列', domainId: 'wearables', supply: '已完成首批备货', deadline: '2026-08-15T18:00:00+08:00',
    skus: [
      ['freebuds4-black', 'HUAWEI FreeBuds Pro 4 黑色', '55037999', '曜石黑'],
      ['freebuds4-white', 'HUAWEI FreeBuds Pro 4 白色', '55038000', '陶瓷白'],
    ],
  },
] as const;

const REGION_NAMES: Record<string, string> = {
  europe: '欧洲MKT',
  eurasia: '欧亚MKT',
  sea: '亚太MKT',
  latam: '拉美MKT',
  mea: '中东非MKT',
  china: '中国区MKT',
};

function isoDaysFromNow(days: number) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  date.setUTCHours(10, 0, 0, 0);
  return date.toISOString();
}

async function ensureUser(client: SeedDbClient, user: DemoUser) {
  const { rows } = await client.query<{ id: string }>('SELECT id FROM app_user WHERE employee_no = $1', [user.employeeNo]);
  if (rows[0]) {
    await client.query('UPDATE app_user SET display_name = $1, role = $2, enabled = true, updated_at = NOW() WHERE id = $3', [user.displayName, user.role, rows[0].id]);
    return rows[0].id;
  }
  const passwordHash = bcrypt.hashSync('123456', 10);
  const inserted = await client.query<{ id: string }>(`
    INSERT INTO app_user (employee_no, display_name, password_hash, role, enabled, created_at)
    VALUES ($1, $2, $3, $4, true, NOW()) RETURNING id
  `, [user.employeeNo, user.displayName, passwordHash, user.role]);
  return inserted.rows[0].id;
}

async function getUserIds(client: SeedDbClient) {
  const { rows } = await client.query<{ id: string; employee_no: string }>('SELECT id, employee_no FROM app_user');
  return Object.fromEntries(rows.map((row) => [row.employee_no, row.id])) as Record<string, string>;
}

async function upsertProduct(client: SeedDbClient, product: typeof EXTRA_PRODUCTS[number] | typeof HUAWEI_PRODUCT_RENAMES[number]) {
  await client.query(`
    INSERT INTO product (id, code, name, domain_id, mss_domain_id, supply_time_text, default_deadline_text, enabled)
    VALUES ($1, $2, $3, $4, NULL, $5, $6, true)
    ON CONFLICT (id) DO UPDATE SET code = $2, name = $3, domain_id = $4, mss_domain_id = NULL,
      supply_time_text = $5, default_deadline_text = $6, enabled = true, updated_at = NOW()
  `, [product.id, product.code, product.name, product.domainId, product.supply, product.deadline]);
  for (const [id, model, bomCode, description] of product.skus) {
    await client.query(`
      INSERT INTO product_sku (id, product_id, model, bom_code, description, enabled)
      VALUES ($1, $2, $3, $4, $5, true)
      ON CONFLICT (id) DO UPDATE SET product_id = $2, model = $3, bom_code = $4,
        description = $5, enabled = true, updated_at = NOW()
    `, [id, product.id, model, bomCode, description]);
  }
}

async function getOrganizationSnapshot(client: SeedDbClient, regionId: string) {
  const { rows: offices } = await client.query<any>(`
    SELECT id, name FROM org_node WHERE parent_id = $1 AND node_type = 'OFFICE' AND enabled = true ORDER BY id
  `, [regionId]);
  const result = [];
  for (const office of offices) {
    const { rows: countries } = await client.query<any>(`
      SELECT id, name FROM org_node WHERE parent_id = $1 AND node_type = 'COUNTRY' AND enabled = true ORDER BY id
    `, [office.id]);
    result.push({ id: office.id, name: office.name, countries: countries.map((country) => country.name) });
  }
  return { offices: result };
}

async function getProductSkus(client: SeedDbClient, productId: string) {
  const { rows } = await client.query<any>('SELECT id, model, bom_code FROM product_sku WHERE product_id = $1 AND enabled = true ORDER BY id', [productId]);
  return rows;
}

async function seedTask(client: SeedDbClient, plan: ScenarioPlan, task: ScenarioTask, userIds: Record<string, string>) {
  const taskId = `scenario-task-${plan.id}-${task.mssDomainId}`;
  const mssOwnerEmployee: Record<string, string> = {
    'mss-mkt': 'zhaomin',
    'mss-retail': 'sunyue',
    'mss-service': 'liuqian',
    'mss-gtm': 'chenxi',
  };
  const ownerId = userIds[mssOwnerEmployee[task.mssDomainId]];
  await client.query(`
    INSERT INTO collection_plan_domain_task (id, plan_id, mss_domain_id, status, dispatched_by, dispatched_at)
    VALUES ($1, $2, $3, $4, CASE WHEN $4 = 'PENDING_DISPATCH' THEN NULL ELSE $5 END,
      CASE WHEN $4 = 'PENDING_DISPATCH' THEN NULL ELSE NOW() END)
    ON CONFLICT (id) DO UPDATE SET status = $4,
      dispatched_by = CASE WHEN $4 = 'PENDING_DISPATCH' THEN NULL ELSE $5 END,
      dispatched_at = CASE WHEN $4 = 'PENDING_DISPATCH' THEN NULL ELSE NOW() END, updated_at = NOW()
  `, [taskId, plan.id, task.mssDomainId, task.status, ownerId]);

  const skus = await getProductSkus(client, plan.productId);
  await client.query('DELETE FROM collection_plan_domain_task_sku WHERE domain_task_id = $1', [taskId]);
  if (task.status !== 'PENDING_DISPATCH') {
    for (const sku of skus) {
      await client.query('INSERT INTO collection_plan_domain_task_sku (domain_task_id, product_sku_id) VALUES ($1, $2)', [taskId, sku.id]);
    }
  }

  const feedbackItems: any[] = [];
  for (const region of task.regionSubmissions || []) {
    const scopeId = `scenario-scope-${plan.id}-${task.mssDomainId}-${region.regionId}`;
    const submissionId = `scenario-submission-${plan.id}-${task.mssDomainId}-${region.regionId}`;
    const orgSnapshot = await getOrganizationSnapshot(client, region.regionId);
    const regionOwnerEmployee: Record<string, string> = { europe: 'aaa', eurasia: 'bbb', sea: 'ccc', latam: 'ddd', mea: 'eee', china: 'fff' };
    const submitterId = userIds[regionOwnerEmployee[region.regionId]] || ownerId;
    await client.query(`
      INSERT INTO collection_plan_domain_scope (id, domain_task_id, region_id, region_name_snapshot, region_owner_snapshot, office_country_snapshot)
      VALUES ($1, $2, $3, $4, '区域接口人', $5)
      ON CONFLICT (id) DO UPDATE SET region_name_snapshot = $4, office_country_snapshot = $5, updated_at = NOW()
    `, [scopeId, taskId, region.regionId, REGION_NAMES[region.regionId], JSON.stringify(orgSnapshot)]);
    await client.query(`
      INSERT INTO collection_plan_domain_submission (
        id, domain_scope_id, status, saved_by, saved_at, submitted_by, submitted_at,
        returned_by, returned_at, return_reason, revision_no, change_pending
      ) VALUES ($1, $2, $3, $4, NOW(), $5, $6, $7, $8, $9, $10, false)
      ON CONFLICT (id) DO UPDATE SET status = $3, saved_by = $4, saved_at = NOW(),
        submitted_by = $5, submitted_at = $6, returned_by = $7, returned_at = $8,
        return_reason = $9, revision_no = $10, change_pending = false, updated_at = NOW()
    `, [
      submissionId, scopeId, region.status,
      region.status === 'NOT_STARTED' ? null : submitterId,
      region.status === 'SUBMITTED' ? submitterId : null,
      region.status === 'SUBMITTED' ? isoDaysFromNow(-5) : null,
      region.status === 'RETURNED' ? ownerId : null,
      region.status === 'RETURNED' ? isoDaysFromNow(-2) : null,
      region.returnReason || null,
      region.revisionNo || (region.status === 'SUBMITTED' ? 1 : 0),
    ]);
    await client.query('DELETE FROM collection_plan_domain_demand_item WHERE submission_id = $1', [submissionId]);
    const office = orgSnapshot.offices[0];
    for (let index = 0; index < skus.length; index++) {
      const quantity = Number(region.quantities[index] || 0);
      const item = {
        product_id: plan.productId,
        product_sku_id: skus[index].id,
        provisional_item_key: null,
        model: skus[index].model,
        bom_code: skus[index].bom_code,
        mss_domain_id: task.mssDomainId,
        region_id: region.regionId,
        region_name: REGION_NAMES[region.regionId],
        office_id: office?.id || null,
        office_name: office?.name || null,
        quantity,
        demand_basis: index % 2 === 0 ? '新品上市体验' : '重点客户PoC',
        planned_use_date: isoDaysFromNow(60).slice(0, 10),
        note: region.status === 'RETURNED' ? '待补充业务场景说明' : '',
      };
      await client.query(`
        INSERT INTO collection_plan_domain_demand_item (
          id, submission_id, product_sku_id, office_id, quantity, demand_basis, planned_use_date, note
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `, [`${submissionId}-${skus[index].id}`, submissionId, item.product_sku_id, item.office_id, item.quantity, item.demand_basis, item.planned_use_date, item.note]);
      if (region.status === 'SUBMITTED') feedbackItems.push(item);
    }
    if (region.status === 'SUBMITTED') {
      const snapshot = { items: feedbackItems.filter((item) => item.region_id === region.regionId) };
      await client.query(`
        INSERT INTO collection_plan_domain_submission_revision (
          id, submission_id, revision_no, data_snapshot, submitted_by, submitted_at
        ) VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (submission_id, revision_no) DO UPDATE SET data_snapshot = $4, submitted_by = $5, submitted_at = $6
      `, [`${submissionId}-revision-${region.revisionNo || 1}`, submissionId, region.revisionNo || 1, JSON.stringify(snapshot), submitterId, isoDaysFromNow(-5)]);
    }
  }

  if (task.status === 'FEEDBACK_SUBMITTED') {
    const total = feedbackItems.reduce((sum, item) => sum + Number(item.quantity), 0);
    const feedbackId = `scenario-feedback-${plan.id}-${task.mssDomainId}`;
    await client.query(`
      INSERT INTO collection_plan_domain_feedback (
        id, domain_task_id, note, total_quantity, summary_snapshot, confirmed_by, confirmed_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (id) DO UPDATE SET note = $3, total_quantity = $4, summary_snapshot = $5,
        confirmed_by = $6, confirmed_at = $7, updated_at = NOW()
    `, [feedbackId, taskId, '已完成区域需求核对并正式反馈GTM。', total, JSON.stringify({ items: feedbackItems }), ownerId, isoDaysFromNow(-4)]);
    for (let index = 0; index < feedbackItems.length; index++) {
      const item = feedbackItems[index];
      await client.query(`
        INSERT INTO execution_fact (
          id, source_type, source_id, product_id, product_sku_id, mss_domain_id,
          region_id, office_id, quantity, occurred_at, dimension_snapshot
        ) VALUES ($1, 'CONFIRMED_DEMAND', $2, $3, $4, $5, $6, $7, $8, $9, $10)
        ON CONFLICT (id) DO UPDATE SET quantity = $8, occurred_at = $9, dimension_snapshot = $10, updated_at = NOW()
      `, [
        `scenario-demand-${plan.id}-${task.mssDomainId}-${index}`, taskId, plan.productId,
        item.product_sku_id, task.mssDomainId, item.region_id, item.office_id, item.quantity,
        isoDaysFromNow(-4), JSON.stringify({ planId: plan.id, domainTaskId: taskId, seededScenario: true }),
      ]);
    }
  }
}

async function seedScenarioPlan(client: SeedDbClient, plan: ScenarioPlan, userIds: Record<string, string>) {
  await client.query(`
    INSERT INTO collection_plan (
      id, plan_no, product_id, domain_id, mss_domain_id, sample_stage, status,
      deadline_at, note, demand_total, released_by, released_at, created_by
    ) VALUES ($1, $2, $3, $4, NULL, $5, $6, $7, $8, 0, $9, $10, $9)
    ON CONFLICT (id) DO UPDATE SET product_id = $3, domain_id = $4, mss_domain_id = NULL,
      sample_stage = $5, status = $6, deadline_at = $7, note = $8,
      released_by = $9, released_at = $10, updated_at = NOW()
  `, [
    plan.id, plan.no, plan.productId, plan.domainId, plan.stage, plan.status,
    plan.deadline, plan.note, userIds[plan.createdBy],
    plan.status === 'PRODUCT_DRAFT' || plan.status === 'READY_TO_RELEASE' ? null : isoDaysFromNow(-12),
  ]);
  for (const task of plan.tasks || []) await seedTask(client, plan, task, userIds);

  const { rows: totals } = await client.query<{ total: number }>(`
    SELECT COALESCE(SUM(item.quantity), 0) AS total
    FROM collection_plan_domain_demand_item item
    JOIN collection_plan_domain_submission submission ON submission.id = item.submission_id AND submission.status = 'SUBMITTED'
    JOIN collection_plan_domain_scope scope ON scope.id = submission.domain_scope_id
    JOIN collection_plan_domain_task task ON task.id = scope.domain_task_id
    WHERE task.plan_id = $1
  `, [plan.id]);
  await client.query('UPDATE collection_plan SET demand_total = $1 WHERE id = $2', [Number(totals[0]?.total || 0), plan.id]);

  if (plan.exported) {
    const { rows: feedbackRows } = await client.query<any>(`
      SELECT feedback.summary_snapshot FROM collection_plan_domain_feedback feedback
      JOIN collection_plan_domain_task task ON task.id = feedback.domain_task_id WHERE task.plan_id = $1
    `, [plan.id]);
    const snapshot = feedbackRows.flatMap((row) => JSON.parse(row.summary_snapshot || '{}').items || []);
    await client.query(`
      INSERT INTO production_export (
        id, plan_id, plan_version, file_name, row_count, data_snapshot, exported_by, exported_at
      ) VALUES ($1, $2, 1, $3, $4, $5, $6, $7)
      ON CONFLICT (id) DO UPDATE SET file_name = $3, row_count = $4, data_snapshot = $5,
        exported_by = $6, exported_at = $7, updated_at = NOW()
    `, [
      `scenario-export-${plan.id}-v1`, plan.id, `${plan.no}_${plan.productId}_排产需求_V1_2026-09-01.xlsx`,
      snapshot.length, JSON.stringify(snapshot), userIds[plan.createdBy], isoDaysFromNow(-3),
    ]);
  }
}

async function seedExecutionAndInventory(client: SeedDbClient, userIds: Record<string, string>) {
  const operational = [
    { sku: 'mate70pro-black', system: 160, actual: 160, locked: 36, available: 124, reason: '账实一致', production: 360, applied: 230, shipped: [60, 48], region: 'europe', office: 'de-office' },
    { sku: 'mate70pro-green', system: 120, actual: 112, locked: 28, available: 84, reason: '盘亏8台，待仓库复核出库单', production: 280, applied: 190, shipped: [50, 42, 36], region: 'europe', office: 'fr-office' },
    { sku: 'pura80-ultra-black', system: 90, actual: 96, locked: 20, available: 76, reason: '盘盈6台，疑似退样未入账', production: 180, applied: 135, shipped: [40, 32], region: 'china', office: 'cn-office' },
    { sku: 'matepad12x-green', system: 72, actual: 72, locked: 18, available: 54, reason: '', production: 120, applied: 68, shipped: [24], region: 'sea', office: 'sea-office' },
  ];
  for (const row of operational) {
    const { rows: skuRows } = await client.query<any>('SELECT product_id FROM product_sku WHERE id = $1', [row.sku]);
    const productId = skuRows[0].product_id;
    const inventoryId = `scenario-inventory-${row.sku}`;
    await client.query(`
      INSERT INTO inventory_balance (
        id, product_id, product_sku_id, warehouse, system_quantity, actual_quantity,
        locked_quantity, available_quantity, reason, checked_by, checked_at
      ) VALUES ($1, $2, $3, '深圳中心仓', $4, $5, $6, $7, $8, $9, $10)
      ON CONFLICT (id) DO UPDATE SET system_quantity = $4, actual_quantity = $5,
        locked_quantity = $6, available_quantity = $7, reason = $8, checked_by = $9,
        checked_at = $10, updated_at = NOW()
    `, [inventoryId, productId, row.sku, row.system, row.actual, row.locked, row.available, row.reason, userIds.chentao, isoDaysFromNow(-1)]);
    const facts: Array<[string, number]> = [['PRODUCTION', row.production], ['APPLICATION', row.applied], ['INVENTORY', row.available]];
    for (const [sourceType, quantity] of facts) {
      await client.query(`
        INSERT INTO execution_fact (
          id, source_type, source_id, product_id, product_sku_id, region_id, office_id,
          quantity, occurred_at, dimension_snapshot
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        ON CONFLICT (id) DO UPDATE SET quantity = $8, occurred_at = $9, dimension_snapshot = $10, updated_at = NOW()
      `, [
        `scenario-${sourceType.toLowerCase()}-${row.sku}`, sourceType,
        sourceType === 'INVENTORY' ? inventoryId : `scenario-${sourceType.toLowerCase()}-source-${row.sku}`,
        productId, row.sku, row.region, row.office, quantity, isoDaysFromNow(-2),
        JSON.stringify({ seededScenario: true, warehouse: '深圳中心仓' }),
      ]);
    }
    for (let index = 0; index < row.shipped.length; index++) {
      await client.query(`
        INSERT INTO execution_fact (
          id, source_type, source_id, product_id, product_sku_id, mss_domain_id,
          region_id, office_id, quantity, occurred_at, dimension_snapshot
        ) VALUES ($1, 'SHIPMENT', $2, $3, $4, 'mss-mkt', $5, $6, $7, $8, $9)
        ON CONFLICT (id) DO UPDATE SET quantity = $7, occurred_at = $8, dimension_snapshot = $9, updated_at = NOW()
      `, [
        `scenario-shipment-${row.sku}-${index + 1}`, `HUAWEI-SHIP-${row.sku}-${index + 1}`,
        productId, row.sku, row.region, row.office, row.shipped[index], isoDaysFromNow(-8 + index * 3),
        JSON.stringify({ seededScenario: true, batch: index + 1 }),
      ]);
    }
  }
}

async function seedTsmpImportDiagnostics(client: SeedDbClient, userIds: Record<string, string>) {
  const jobId = 'scenario-tsmp-import-001';
  await client.query(`
    INSERT INTO tsmp_import_job (
      id, file_name, file_hash, status, total_rows, matched_rows, mapping_required_rows,
      unmatched_rows, duplicate_rows, imported_by, started_at, completed_at
    ) VALUES ($1, 'TSMP_华为样机发货_核心场景.xlsx', $2, 'COMPLETED', 5, 1, 1, 2, 1, $3, $4, $5)
    ON CONFLICT (id) DO UPDATE SET total_rows = 5, matched_rows = 1, mapping_required_rows = 1,
      unmatched_rows = 2, duplicate_rows = 1, imported_by = $3, started_at = $4,
      completed_at = $5, updated_at = NOW()
  `, [jobId, crypto.createHash('sha256').update(jobId).digest('hex'), userIds.chentao, isoDaysFromNow(-2), isoDaysFromNow(-2)]);
  const rows = [
    { no: 2, key: 'HUAWEI-TSMP-001', bom: '51098XYZ', domain: 'MKT领域', region: '欧洲MKT', office: '德国代表处', country: '德国', qty: 12, status: 'MATCHED', reason: '已按BOM、领域、区域、代表处、国家匹配' },
    { no: 3, key: 'HUAWEI-TSMP-002', bom: '51098XYW', domain: 'MKT领域', region: '欧洲地区部', office: '法国REP', country: '法国', qty: 8, status: 'MAPPING_REQUIRED', reason: '代表处“法国REP”未维护TSMP别名' },
    { no: 4, key: 'HUAWEI-TSMP-003', bom: '99999ZZZ', domain: 'MKT领域', region: '欧洲MKT', office: '德国代表处', country: '德国', qty: 5, status: 'UNMATCHED', reason: 'BOM编码“99999ZZZ”未找到对应产品型号' },
    { no: 5, key: 'HUAWEI-TSMP-001', bom: '51098XYZ', domain: 'MKT领域', region: '欧洲MKT', office: '德国代表处', country: '德国', qty: 12, status: 'DUPLICATE', reason: '与第2行外部业务键重复' },
    { no: 6, key: 'HUAWEI-TSMP-004', bom: '51098XYZ', domain: 'MKT领域', region: '欧洲MKT', office: '德国代表处', country: '德国', qty: 0, status: 'INVALID', reason: '发货数量必须为大于0的整数；读取值：0' },
  ];
  for (const row of rows) {
    const fingerprint = crypto.createHash('sha256').update(`${jobId}-${row.no}-${row.key}`).digest('hex');
    await client.query(`
      INSERT INTO tsmp_shipment_raw (
        id, import_job_id, source_row_no, external_key, application_no, raw_mss_domain,
        raw_bom, raw_region, raw_office, raw_country, shipped_quantity, shipped_at,
        row_fingerprint, raw_payload, match_status, match_reason
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
      ON CONFLICT (id) DO UPDATE SET raw_mss_domain = $6, raw_bom = $7, raw_region = $8,
        raw_office = $9, raw_country = $10, shipped_quantity = $11, match_status = $15,
        match_reason = $16, updated_at = NOW()
    `, [
      `scenario-tsmp-row-${row.no}`, jobId, row.no, row.key, `TSMP-APP-${row.no}`,
      row.domain, row.bom, row.region, row.office, row.country, row.qty, isoDaysFromNow(-2),
      fingerprint, JSON.stringify({
        业务领域: row.domain, 地区部: row.region, 代表处: row.office, '国家/地区': row.country,
        BOM编码: row.bom, 发货数量: row.qty,
      }), row.status, row.reason,
    ]);
  }
}

async function seedPendingChangeRequest(client: SeedDbClient, userIds: Record<string, string>) {
  const submissionId = 'scenario-submission-plan-huawei-freebuds-change-mss-mkt-europe';
  const { rows } = await client.query<any>('SELECT id, version, revision_no FROM collection_plan_domain_submission WHERE id = $1', [submissionId]);
  if (!rows[0]) return;
  const requestId = 'scenario-change-request-freebuds-europe';
  const { rows: items } = await client.query<any>('SELECT * FROM collection_plan_domain_demand_item WHERE submission_id = $1 ORDER BY id', [submissionId]);
  await client.query(`
    INSERT INTO collection_plan_region_change_request (
      id, submission_id, request_type, status, reason, source_submission_version,
      source_revision_no, source_plan_status, source_snapshot, requested_by, requested_at
    ) VALUES ($1, $2, 'POST_EXPORT_CHANGE', 'PENDING', $3, $4, $5, 'EXPORTED', $6, $7, $8)
    ON CONFLICT (id) DO UPDATE SET status = 'PENDING', reason = $3,
      source_submission_version = $4, source_revision_no = $5, source_snapshot = $6,
      requested_by = $7, requested_at = $8, decided_by = NULL, decided_at = NULL,
      decision_note = NULL, updated_at = NOW()
  `, [
    requestId, submissionId, '产品线调整上市节奏，需要增加欧洲重点客户体验样机。',
    Number(rows[0].version), Number(rows[0].revision_no), JSON.stringify({ items }),
    userIds.aaa, isoDaysFromNow(-1),
  ]);
  await client.query('UPDATE collection_plan_domain_submission SET change_pending = true, updated_at = NOW() WHERE id = $1', [submissionId]);
}

/**
 * 可重复执行的华为验收数据集。只写入或更新带有固定scenario标识的测试记录，
 * 不清空用户自行录入的数据，适合给已经初始化过的本地开发库补充验收场景。
 */
export async function seedHuaweiTestData(client: SeedDbClient) {
  for (const user of HUAWEI_USERS) await ensureUser(client, user);
  const userIds = await getUserIds(client);

  await client.query("UPDATE mss_domain SET enabled = false, updated_at = NOW() WHERE id = 'mss-ecommerce'");
  const mssOwners: Array<[string, string]> = [
    ['mss-mkt', 'zhaomin'], ['mss-retail', 'sunyue'], ['mss-service', 'liuqian'], ['mss-gtm', 'chenxi'],
  ];
  for (const [domainId, employeeNo] of mssOwners) {
    await client.query('UPDATE mss_domain SET mss_owner_id = $1, enabled = true, updated_at = NOW() WHERE id = $2', [userIds[employeeNo], domainId]);
    await client.query(`
      INSERT INTO user_scope_assignment (user_id, scope_type, scope_id)
      VALUES ($1, 'MSS_DOMAIN', $2) ON CONFLICT (user_id, scope_type, scope_id) DO NOTHING
    `, [userIds[employeeNo], domainId]);
  }
  const officeScopes: Array<[string, string, string]> = [
    ['deowner', 'mss-mkt', 'de-office'],
    ['broffice', 'mss-mkt', 'br-office'],
    ['cnoffice', 'mss-retail', 'cn-office'],
  ];
  for (const [employeeNo, mssDomainId, officeId] of officeScopes) {
    await client.query(`
      INSERT INTO user_scope_assignment (user_id, scope_type, scope_id)
      VALUES ($1, 'MSS_DOMAIN', $2) ON CONFLICT (user_id, scope_type, scope_id) DO NOTHING
    `, [userIds[employeeNo], mssDomainId]);
    await client.query('UPDATE org_node SET owner_id = $1, updated_at = NOW() WHERE id = $2', [userIds[employeeNo], officeId]);
  }

  for (const product of HUAWEI_PRODUCT_RENAMES) await upsertProduct(client, product);
  for (const product of EXTRA_PRODUCTS) await upsertProduct(client, product);

  const allDomains = ['mss-mkt', 'mss-retail', 'mss-service', 'mss-gtm'];
  const submittedTask = (mssDomainId: string, regionId: string, quantities: number[]): ScenarioTask => ({
    mssDomainId, status: 'FEEDBACK_SUBMITTED', regionSubmissions: [{ regionId, status: 'SUBMITTED', quantities, revisionNo: 1 }],
  });
  const readyTask = (mssDomainId: string, regionId: string, quantities: number[]): ScenarioTask => ({
    mssDomainId, status: 'READY_TO_FEEDBACK', regionSubmissions: [{ regionId, status: 'SUBMITTED', quantities, revisionNo: 1 }],
  });

  const scenarios: ScenarioPlan[] = [
    {
      id: 'plan-huawei-pura-draft', no: 'HUAWEI-TEST-001', productId: 'chitu-b23', domainId: 'mobile',
      stage: '工程样机（EVT）', status: 'PRODUCT_DRAFT', deadline: isoDaysFromNow(45),
      note: '场景01：仅维护产品名称，型号与BOM均待产品线确认。', createdBy: 'lina',
    },
    {
      id: 'plan-huawei-matepad-ready', no: 'HUAWEI-TEST-002', productId: 'chitu-pad-x', domainId: 'tablet',
      stage: '测试样机（DVT）', status: 'READY_TO_RELEASE', deadline: isoDaysFromNow(30),
      note: '场景02：计划信息完整，等待GTM下发全部MSS领域。', createdBy: 'zhouhang',
    },
    {
      id: 'plan-huawei-matepad-collecting', no: 'HUAWEI-TEST-003', productId: 'huawei-matepad-12x', domainId: 'tablet',
      stage: '工程样机（EVT）', status: 'COLLECTING', deadline: isoDaysFromNow(20),
      note: '场景03：多领域并行收集，覆盖待下发、草稿、已提交、退回修改。', createdBy: 'zhouhang',
      tasks: [
        {
          mssDomainId: 'mss-mkt', status: 'COLLECTING', regionSubmissions: [
            { regionId: 'europe', status: 'NOT_STARTED', quantities: [0, 0] },
            { regionId: 'eurasia', status: 'DRAFT', quantities: [36, 18] },
            { regionId: 'sea', status: 'SUBMITTED', quantities: [52, 24], revisionNo: 1 },
            { regionId: 'latam', status: 'RETURNED', quantities: [28, 16], returnReason: '请补充重点客户名称及计划使用时间。' },
          ],
        },
        { mssDomainId: 'mss-retail', status: 'PENDING_DISPATCH' },
        { mssDomainId: 'mss-service', status: 'COLLECTING', regionSubmissions: [{ regionId: 'mea', status: 'DRAFT', quantities: [20, 8] }] },
        readyTask('mss-gtm', 'china', [30, 12]),
      ],
    },
    {
      id: 'plan-huawei-pura80-review', no: 'HUAWEI-TEST-004', productId: 'huawei-pura-80-ultra', domainId: 'mobile',
      stage: '测试样机（DVT）', status: 'DOMAIN_REVIEW', deadline: isoDaysFromNow(10),
      note: '场景04：所有领域区域已提交，等待各领域正式反馈GTM。', createdBy: 'lina',
      tasks: [
        readyTask('mss-mkt', 'europe', [120, 48]), readyTask('mss-retail', 'china', [86, 32]),
        readyTask('mss-service', 'sea', [44, 18]), readyTask('mss-gtm', 'eurasia', [38, 16]),
      ],
    },
    {
      id: 'plan-huawei-mate70-exported', no: 'HUAWEI-TEST-005', productId: 'huawei-mate-70-pro', domainId: 'mobile',
      stage: '试生产样机（PVT）', status: 'EXPORTED', deadline: isoDaysFromNow(-30),
      note: '场景05：领域反馈、GTM导出、分批发货和库存核对均已发生。', createdBy: 'lina', exported: true,
      tasks: [
        submittedTask('mss-mkt', 'europe', [220, 160]), submittedTask('mss-retail', 'china', [128, 92]),
        submittedTask('mss-service', 'sea', [64, 48]), submittedTask('mss-gtm', 'eurasia', [52, 36]),
      ],
    },
    {
      id: 'plan-huawei-freebuds-change', no: 'HUAWEI-TEST-006', productId: 'huawei-freebuds-pro-4', domainId: 'wearables',
      stage: '测试样机（VN2）', status: 'EXPORTED', deadline: isoDaysFromNow(-20),
      note: '场景06：已导出后区域申请变更，等待MSS领域接口人审批。', createdBy: 'wanglu', exported: true,
      tasks: [
        submittedTask('mss-mkt', 'europe', [96, 72]), submittedTask('mss-retail', 'china', [58, 42]),
        submittedTask('mss-service', 'sea', [34, 26]), submittedTask('mss-gtm', 'eurasia', [28, 20]),
      ],
    },
  ];
  for (const scenario of scenarios) await seedScenarioPlan(client, scenario, userIds);
  await seedPendingChangeRequest(client, userIds);
  await seedExecutionAndInventory(client, userIds);
  await seedTsmpImportDiagnostics(client, userIds);

  // 覆盖4个有效MSS领域的GTM下发结构，避免测试数据退回到旧的一计划一领域模型。
  for (const planId of ['plan-huawei-matepad-collecting', 'plan-huawei-pura80-review', 'plan-huawei-mate70-exported', 'plan-huawei-freebuds-change']) {
    const { rows } = await client.query<{ count: number }>('SELECT COUNT(*) AS count FROM collection_plan_domain_task WHERE plan_id = $1', [planId]);
    if (Number(rows[0].count) !== allDomains.length) throw new Error(`Huawei scenario ${planId} does not contain all MSS domain tasks`);
  }
}
