// 统一数据库客户端类型，兼容SQLite和PostgreSQL
type DbClient = {
  query: <T = any>(sql: string, params?: any[]) => Promise<{ rows: T[]; rowCount: number }>;
};

export async function seedData(client: DbClient) {
  // 检查是否已初始化
  const { rows: domainCount } = await client.query('SELECT COUNT(*) AS count FROM product_domain');
  if (Number(domainCount[0].count) > 0) {
    console.log('Seed data already exists, skipping');
    return;
  }

  console.log('Seeding initial data...');

  // 插入测试用户
  const users = [
    { employeeNo: 'wanglu', displayName: '王璐' },
    { employeeNo: 'zhaomin', displayName: '赵敏' },
    { employeeNo: 'lina', displayName: '李娜' },
    { employeeNo: 'chentao', displayName: '陈涛' },
    { employeeNo: 'zhouhang', displayName: '周航' },
    { employeeNo: 'sunyue', displayName: '孙悦' },
    { employeeNo: 'aaa', displayName: 'AAA' },
    { employeeNo: 'bbb', displayName: 'BBB' },
    { employeeNo: 'ccc', displayName: 'CCC' },
    { employeeNo: 'ddd', displayName: 'DDD' },
    { employeeNo: 'eee', displayName: 'EEE' },
    { employeeNo: 'fff', displayName: 'FFF' },
  ];

  const userIds: Record<string, string> = {};
  for (const user of users) {
    const { rows } = await client.query<{ id: string }>(
      'INSERT INTO app_user (employee_no, display_name) VALUES ($1, $2) RETURNING id',
      [user.employeeNo, user.displayName]
    );
    userIds[user.employeeNo] = rows[0].id;
  }

  // 插入产品领域
  const domains = [
    { id: 'wearables', code: 'wearables', name: '穿戴', gtmOwnerId: userIds.wanglu, stockingOwnerId: userIds.zhaomin, description: '手表、手环及穿戴配件' },
    { id: 'mobile', code: 'mobile', name: '手机', gtmOwnerId: userIds.lina, stockingOwnerId: userIds.chentao, description: '手机及移动终端' },
    { id: 'tablet', code: 'tablet', name: '平板', gtmOwnerId: userIds.zhouhang, stockingOwnerId: userIds.sunyue, description: '平板及配套终端' },
  ];

  for (const domain of domains) {
    await client.query(
      'INSERT INTO product_domain (id, code, name, description, gtm_owner_id, stocking_owner_id) VALUES ($1, $2, $3, $4, $5, $6)',
      [domain.id, domain.code, domain.name, domain.description, domain.gtmOwnerId, domain.stockingOwnerId]
    );
  }

  // 插入产品
  const products = [
    { id: 'chitu-b19', code: 'chitu-b19', name: 'Chitu B19系列', domainId: 'wearables', stage: '测试样机（VN2）', supplyTimeText: '预计2026年1月初发货', defaultDeadlineText: '2026-08-31T18:00:00+08:00' },
    { id: 'chitu-b21', code: 'chitu-b21', name: 'Chitu B21系列', domainId: 'wearables', stage: '工程样机（EVT）', supplyTimeText: '预计2026年2月中旬发货', defaultDeadlineText: '2026-09-15T18:00:00+08:00' },
    { id: 'chitu-pad-x', code: 'chitu-pad-x', name: 'Chitu Pad X系列', domainId: 'tablet', stage: '测试样机（DVT）', supplyTimeText: '预计2026年3月初发货', defaultDeadlineText: '2026-09-30T18:00:00+08:00' },
    { id: 'chitu-b23', code: 'chitu-b23', name: 'Chitu B23新品项目', domainId: 'wearables', stage: '工程样机（EVT）', supplyTimeText: '待产品线确认', defaultDeadlineText: null },
  ];

  for (const product of products) {
    await client.query(
      'INSERT INTO product (id, code, name, domain_id, sample_stage, supply_time_text, default_deadline_text) VALUES ($1, $2, $3, $4, $5, $6, $7)',
      [product.id, product.code, product.name, product.domainId, product.stage, product.supplyTimeText, product.defaultDeadlineText]
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
    { id: 'sea', code: 'sea', name: '东南亚MKT', ownerId: userIds.ccc },
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

  console.log('Seed data completed');
}
