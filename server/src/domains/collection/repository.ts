import { query, getClient } from '../../config/db.js';
import { NotFoundError, VersionConflictError, PlanStateConflictError, ForbiddenError, ValidationError } from '../../shared/errors.js';
import { PLAN_STATUS, ROLES } from '../../shared/types.js';
import type { CreatePlanInput, DraftSaveInput, DomainFeedbackInput } from './schemas.js';
import * as XLSX from 'xlsx';

export interface CollectionPlan {
  id: string;
  planNo: string;
  productId: string;
  domainId: string;
  status: PLAN_STATUS;
  deadline: string;
  note?: string;
  demandTotal: number;
  createdBy: string;
  createdAt: string;
  releasedBy?: string;
  releasedAt?: string;
  version: number;
  product?: {
    id: string;
    name: string;
    domain: string;
    gtm: string;
    stockingOwner: string;
    skuCount: number;
  };
  submittedRegions: string[];
  totalRegions: number;
  regionProgress: Array<{
    regionId: string;
    regionName: string;
    owner: string;
    officeCount: number;
    countryCount: number;
    status: 'NOT_STARTED' | 'DRAFT' | 'SUBMITTED' | 'RETURNED';
    demand: number;
    submittedAt?: string;
  }>;
  feedback?: {
    note: string;
    totalQuantity: number;
    confirmedBy: string;
    confirmedAt: string;
    items: any[];
  };
  draftDemandTotal: number;
}

export interface DemandDraft {
  id: string;
  planId: string;
  regionId: string;
  status: 'NOT_STARTED' | 'DRAFT' | 'SUBMITTED' | 'RETURNED';
  version: number;
  savedBy: string;
  savedAt: string;
  submittedBy?: string;
  submittedAt?: string;
  items: Array<{
    id: string;
    productItemKey: string;
    skuModel?: string;
    bomCode?: string;
    quantity: number;
    basis?: string;
    plannedUseDate?: string;
    note?: string;
    officeId?: string;
  }>;
}

function parseSnapshot(value: unknown): { offices: any[] } {
  if (!value) return { offices: [] };
  if (typeof value === 'object') return { offices: Array.isArray((value as any).offices) ? (value as any).offices : [] };
  try {
    const parsed = JSON.parse(String(value));
    return { offices: Array.isArray(parsed?.offices) ? parsed.offices : [] };
  } catch {
    return { offices: [] };
  }
}

function parseJsonObject(value: unknown): any {
  if (!value) return {};
  if (typeof value === 'object') return value;
  try { return JSON.parse(String(value)); } catch { return {}; }
}

async function writeAudit(client: Awaited<ReturnType<typeof getClient>>, actorId: string, action: string, entityType: string, entityId: string, beforeData: unknown, afterData: unknown) {
  await client.query(`
    INSERT INTO audit_log (id, actor_id, action, entity_type, entity_id, before_data, after_data)
    VALUES ($1, $2, $3, $4, $5, $6, $7)
  `, [crypto.randomUUID(), actorId, action, entityType, entityId, beforeData ? JSON.stringify(beforeData) : null, afterData ? JSON.stringify(afterData) : null]);
}

function assertScopeActor(scope: any, role: string, userId: string) {
  if (role === ROLES.ADMIN || role === ROLES.GTM) return;
  if (role === ROLES.MSS_DOMAIN_OWNER && scope.domain_owner_id === userId) return;
  if (role === ROLES.REGIONAL_OWNER && (scope.region_owner_id === userId || Boolean(scope.office_owned))) return;
  throw new ForbiddenError('无权处理该领域或区域的需求');
}

export const collectionRepository = {
  // 获取计划列表（按角色过滤）
  async listPlans(role: string, userId: string, keyword?: string, status?: string, productId?: string, regionId?: string): Promise<CollectionPlan[]> {
    const conditions: string[] = [];
    const params: any[] = [];

    if (status) {
      params.push(status);
      conditions.push(`cp.status = $${params.length}`);
    }
    if (productId && productId !== 'all') {
      params.push(productId);
      conditions.push(`cp.product_id = $${params.length}`);
    }
    if (keyword) {
      params.push(`%${keyword}%`);
      conditions.push(`(p.name ILIKE $${params.length} OR cp.plan_no ILIKE $${params.length} OR pd.name ILIKE $${params.length})`);
    }

    // 角色过滤
    if (role === ROLES.GTM) {
      params.push(userId);
      conditions.push(`pd.gtm_owner_id = $${params.length}`);
    }
    if (role === ROLES.MSS_DOMAIN_OWNER) {
      // 领域接口人只能看到自己负责领域的、已发布（收集及以后状态）的计划
      params.push(userId);
      conditions.push(`pd.domain_owner_id = $${params.length}`);
      conditions.push(`cp.status IN ('COLLECTING', 'DOMAIN_REVIEW', 'GTM_CLOSURE', 'EXPORTED')`);
    }
    if (role === ROLES.REGIONAL_OWNER) {
      // 区域接口人只能看到自己负责区域的、已发布的计划
      conditions.push(`cp.status IN ('COLLECTING', 'DOMAIN_REVIEW', 'GTM_CLOSURE', 'EXPORTED')`);
      params.push(userId);
      conditions.push(`EXISTS (
        SELECT 1 FROM collection_plan_scope own_scope
        JOIN org_node own_region ON own_region.id = own_scope.region_id
        WHERE own_scope.plan_id = cp.id AND (
          own_region.owner_id = $${params.length}
          OR EXISTS (SELECT 1 FROM org_node own_office WHERE own_office.parent_id = own_region.id AND own_office.owner_id = $${params.length})
        )
      )`);
      if (regionId) {
        params.push(regionId);
        conditions.push(`EXISTS (SELECT 1 FROM collection_plan_scope cps_sub WHERE cps_sub.plan_id = cp.id AND cps_sub.region_id = $${params.length})`);
      }
    }
    if (role === ROLES.STOCKING_OWNER) {
      // 备货接口人只能看到自己负责领域的、待发货及以后的计划
      params.push(userId);
      conditions.push(`pd.stocking_owner_id = $${params.length}`);
      conditions.push(`cp.status IN ('DOMAIN_REVIEW', 'GTM_CLOSURE', 'EXPORTED')`);
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const { rows: plans } = await query(`
      SELECT cp.*, p.name as product_name, pd.name as domain_name, gu.display_name as gtm_name, su.display_name as stocking_owner_name,
        (SELECT COUNT(*) FROM product_sku ps WHERE ps.product_id = p.id AND ps.enabled = true) as sku_count,
        (SELECT COUNT(*) FROM collection_plan_scope cps WHERE cps.plan_id = cp.id) as total_regions,
        (SELECT COUNT(*) FROM demand_submission ds JOIN collection_plan_scope cps ON ds.plan_scope_id = cps.id WHERE cps.plan_id = cp.id AND ds.status = 'SUBMITTED') as submitted_regions,
        (SELECT COALESCE(SUM(di.quantity), 0) FROM demand_item di JOIN demand_submission ds ON di.submission_id = ds.id JOIN collection_plan_scope cps ON ds.plan_scope_id = cps.id WHERE cps.plan_id = cp.id) as total_demand,
        (SELECT COALESCE(SUM(di.quantity), 0) FROM demand_item di JOIN demand_submission ds ON di.submission_id = ds.id JOIN collection_plan_scope cps ON ds.plan_scope_id = cps.id WHERE cps.plan_id = cp.id AND ds.status IN ('DRAFT', 'SUBMITTED')) as draft_total_demand
      FROM collection_plan cp
      JOIN product p ON cp.product_id = p.id
      JOIN product_domain pd ON cp.domain_id = pd.id
      JOIN app_user gu ON pd.gtm_owner_id = gu.id
      JOIN app_user su ON pd.stocking_owner_id = su.id
      ${whereClause}
      ORDER BY cp.created_at DESC
    `, params);

    // 获取每个计划的区域进度
    const planIds = plans.map(p => p.id);
    let progressRows: any[] = [];
    if (planIds.length > 0) {
      const placeholders = planIds.map((_, i) => `$${i + 1}`).join(',');
      const { rows } = await query(`
        SELECT cps.plan_id, cps.id as scope_id, cps.region_id, cps.region_name_snapshot, cps.region_owner_snapshot,
          cps.office_country_snapshot, ds.status, ds.submitted_at,
          COALESCE((SELECT SUM(quantity) FROM demand_item di WHERE di.submission_id = ds.id), 0) as demand
        FROM collection_plan_scope cps
        LEFT JOIN demand_submission ds ON cps.id = ds.plan_scope_id
        WHERE cps.plan_id IN (${placeholders})
      `, planIds);
      progressRows = rows;
    }
    if (role === ROLES.REGIONAL_OWNER && progressRows.length > 0) {
      const { rows: allowedRegions } = await query(`
        SELECT DISTINCT region.id
        FROM org_node region
        WHERE region.node_type = 'REGION' AND (
          region.owner_id = $1
          OR EXISTS (SELECT 1 FROM org_node office WHERE office.parent_id = region.id AND office.owner_id = $1)
        )
      `, [userId]);
      const allowedRegionIds = new Set(allowedRegions.map((region) => region.id));
      progressRows = progressRows.filter((progress) => allowedRegionIds.has(progress.region_id));
    }

    // 获取领域反馈
    let feedbackRows: any[] = [];
    if (planIds.length > 0) {
      const placeholders = planIds.map((_, i) => `$${i + 1}`).join(',');
      const { rows } = await query(`
        SELECT df.*, au.display_name as confirmer_name
        FROM domain_feedback df
        JOIN app_user au ON df.confirmed_by = au.id
        WHERE df.plan_id IN (${placeholders})
      `, planIds);
      feedbackRows = rows;
    }

    return plans.map(plan => {
      const planProgress = progressRows.filter(r => r.plan_id === plan.id);
      const feedback = feedbackRows.find(f => f.plan_id === plan.id);

      return {
        id: plan.id,
        planNo: plan.plan_no,
        productId: plan.product_id,
        domainId: plan.domain_id,
        status: plan.status,
        deadline: plan.deadline_at,
        note: plan.note,
        demandTotal: Number(plan.total_demand) || 0,
        createdBy: plan.created_by,
        createdAt: plan.created_at,
        releasedBy: plan.released_by,
        releasedAt: plan.released_at,
        version: Number(plan.version),
        product: {
          id: plan.product_id,
          name: plan.product_name,
          domain: plan.domain_name,
          gtm: plan.gtm_name,
          stockingOwner: plan.stocking_owner_name,
          skuCount: Number(plan.sku_count) || 0,
        },
        submittedRegions: planProgress.filter(p => p.status === 'SUBMITTED').map(p => p.region_id),
        totalRegions: role === ROLES.REGIONAL_OWNER ? planProgress.length : Number(plan.total_regions) || 0,
        regionProgress: planProgress.map(p => ({
          regionId: p.region_id,
          regionName: p.region_name_snapshot,
          owner: p.region_owner_snapshot || '待配置',
          officeCount: parseSnapshot(p.office_country_snapshot).offices.length,
          countryCount: parseSnapshot(p.office_country_snapshot).offices.reduce((sum: number, o: any) => sum + (o.countries?.length || 0), 0),
          status: p.status || 'NOT_STARTED',
          demand: Number(p.demand) || 0,
          submittedAt: p.submitted_at,
        })),
        feedback: feedback ? {
          note: feedback.note,
          totalQuantity: Number(feedback.total_quantity),
          confirmedBy: feedback.confirmer_name,
          confirmedAt: feedback.confirmed_at,
          items: Array.isArray(parseJsonObject(feedback.summary_snapshot).items) ? parseJsonObject(feedback.summary_snapshot).items : [],
        } : null,
        draftDemandTotal: Number(plan.draft_total_demand) || 0,
      };
    });
  },

  // 获取计划详情
  async getPlan(planId: string, role: string = ROLES.ADMIN, userId: string = ''): Promise<CollectionPlan | null> {
    const plans = await this.listPlans(role, userId, undefined, undefined, undefined, undefined);
    return plans.find(p => p.id === planId) || null;
  },

  // 创建收集计划
  async createPlan(input: CreatePlanInput, userId: string): Promise<CollectionPlan> {
    const client = await getClient();
    try {
      await client.query('BEGIN');

      // 检查产品是否存在
      const { rows: productRows } = await client.query(`
        SELECT p.*, pd.id as domain_id, pd.gtm_owner_id FROM product p
        JOIN product_domain pd ON p.domain_id = pd.id
        WHERE p.id = $1 AND p.enabled = true
      `, [input.productId]);
      if (productRows.length === 0) {
        throw new NotFoundError('产品不存在或已停用');
      }
      const product = productRows[0];
      if (product.gtm_owner_id !== userId) {
        throw new ForbiddenError('只能为自己负责领域的产品创建收集计划');
      }

      // 检查区域是否存在
      const regionPlaceholders = input.regionIds.map((_, index) => `$${index + 1}`).join(',');
      const { rows: regionRows } = await client.query(`
        SELECT n.*, u.display_name as owner_name
        FROM org_node n
        LEFT JOIN app_user u ON n.owner_id = u.id
        WHERE n.id IN (${regionPlaceholders}) AND n.node_type = 'REGION' AND n.enabled = true
      `, input.regionIds);
      if (regionRows.length !== input.regionIds.length) {
        throw new ValidationError('部分区域不存在或已停用');
      }

      // 检查同一产品是否有进行中的计划
      const { rows: existingActive } = await client.query(`
        SELECT id FROM collection_plan
        WHERE product_id = $1 AND status NOT IN ('EXPORTED', 'PRODUCT_DRAFT')
      `, [input.productId]);
      if (existingActive.length > 0) {
        throw new ValidationError('该产品已有进行中的收集计划，请勿重复创建');
      }

      // 生成计划编号
      const planNo = `PLAN-${new Date().getFullYear()}${String(new Date().getMonth() + 1).padStart(2, '0')}-${String(Math.floor(Math.random() * 10000)).padStart(4, '0')}`;
      const planId = crypto.randomUUID();

      // 插入计划
      await client.query(`
        INSERT INTO collection_plan (id, plan_no, product_id, domain_id, status, deadline_at, note, created_by)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      `, [
        planId, planNo, input.productId, product.domain_id,
        PLAN_STATUS.READY_TO_RELEASE, input.deadline, input.note || '', userId
      ]);

      // 插入范围快照
      for (const region of regionRows) {
        // 获取区域下的代表处和国家快照
        const { rows: offices } = await client.query(`
          SELECT o.id, o.name, u.display_name as owner
          FROM org_node o
          LEFT JOIN app_user u ON o.owner_id = u.id
          WHERE o.parent_id = $1 AND o.node_type = 'OFFICE' AND o.enabled = true
        `, [region.id]);
        const officesWithCountries = [];
        for (const office of offices) {
          const { rows: countries } = await client.query(
            "SELECT id, name FROM org_node WHERE parent_id = $1 AND node_type = 'COUNTRY' AND enabled = true ORDER BY name",
            [office.id]
          );
          officesWithCountries.push({ ...office, countries: countries.map((country) => ({ id: country.id, name: country.name })) });
        }

        await client.query(`
          INSERT INTO collection_plan_scope (id, plan_id, region_id, region_name_snapshot, region_owner_snapshot, office_country_snapshot)
          VALUES ($1, $2, $3, $4, $5, $6)
        `, [
          crypto.randomUUID(), planId, region.id, region.name, region.owner_name,
          JSON.stringify({ offices: officesWithCountries })
        ]);

        // 初始化区域提交记录
        const { rows: scopeRows } = await client.query(
          'SELECT id FROM collection_plan_scope WHERE plan_id = $1 AND region_id = $2',
          [planId, region.id]
        );
        await client.query(`
          INSERT INTO demand_submission (plan_scope_id, status)
          VALUES ($1, 'NOT_STARTED')
        `, [scopeRows[0].id]);
      }

      await writeAudit(client, userId, 'PLAN_CREATED', 'COLLECTION_PLAN', planId, null, { productId: input.productId, regionIds: input.regionIds });
      await client.query('COMMIT');
      return (await this.getPlan(planId, ROLES.GTM, userId))!;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  },

  // 下发计划
  async releasePlan(planId: string, userId: string, version?: number): Promise<CollectionPlan> {
    const client = await getClient();
    try {
      await client.query('BEGIN');

      const { rows: existing } = await client.query(`
        SELECT cp.*, pd.gtm_owner_id FROM collection_plan cp
        JOIN product_domain pd ON cp.domain_id = pd.id
        WHERE cp.id = $1
      `, [planId]);
      if (existing.length === 0) {
        throw new NotFoundError('收集计划不存在');
      }
      if (version !== undefined && Number(existing[0].version) !== Number(version)) {
        throw new VersionConflictError();
      }
      if (existing[0].status !== PLAN_STATUS.READY_TO_RELEASE) {
        throw new PlanStateConflictError('仅待下发状态的计划可以下发');
      }
      if (existing[0].gtm_owner_id !== userId) {
        throw new ForbiddenError('只能下发自己负责领域的收集计划');
      }

      await client.query(`
        UPDATE collection_plan
        SET status = $1, released_by = $2, released_at = NOW(), version = version + 1, updated_at = NOW()
        WHERE id = $3
      `, [PLAN_STATUS.COLLECTING, userId, planId]);

      await writeAudit(client, userId, 'PLAN_RELEASED', 'COLLECTION_PLAN', planId, { status: existing[0].status }, { status: PLAN_STATUS.COLLECTING });
      await client.query('COMMIT');
      return (await this.getPlan(planId, ROLES.GTM, userId))!;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  },

  // 保存区域草稿
  async saveDraft(planId: string, regionId: string, input: DraftSaveInput, userId: string, role: string): Promise<DemandDraft> {
    const client = await getClient();
    try {
      await client.query('BEGIN');

      // 检查计划和区域范围
      const { rows: scopeRows } = await client.query(`
        SELECT cps.*, cp.status, pd.stocking_owner_id, pd.domain_owner_id, r.owner_id as region_owner_id,
          EXISTS(SELECT 1 FROM org_node o WHERE o.parent_id = r.id AND o.node_type = 'OFFICE' AND o.owner_id = $3) as office_owned
        FROM collection_plan_scope cps
        JOIN collection_plan cp ON cps.plan_id = cp.id
        JOIN product_domain pd ON cp.domain_id = pd.id
        JOIN org_node r ON cps.region_id = r.id
        WHERE cps.plan_id = $1 AND cps.region_id = $2
      `, [planId, regionId, userId]);
      if (scopeRows.length === 0) {
        throw new ForbiddenError('该区域不在此计划范围内');
      }
      const scope = scopeRows[0];
      assertScopeActor(scope, role, userId);
      if (![PLAN_STATUS.COLLECTING, PLAN_STATUS.DOMAIN_REVIEW].includes(scope.status)) {
        throw new PlanStateConflictError('当前计划状态不允许编辑需求');
      }

      // 检查提交状态
      const { rows: submissionRows } = await client.query(
        'SELECT * FROM demand_submission WHERE plan_scope_id = $1',
        [scope.id]
      );
      const submission = submissionRows[0];
      if (input.version !== undefined && Number(submission.version) !== Number(input.version)) {
        throw new VersionConflictError();
      }
      if (submission.status === 'SUBMITTED') {
        throw new PlanStateConflictError('已提交的需求不能直接修改，请联系领域负责人退回后编辑');
      }

      // 校验需求项
      for (const item of input.items) {
        if (item.quantity > 0 && !item.basis?.trim()) {
          throw new ValidationError(`数量大于0的需求项必须填写需求依据`);
        }
        if (item.quantity < 0) {
          throw new ValidationError('需求数量不能为负数');
        }
      }

      // 获取产品SKU映射
      const { rows: planProduct } = await client.query('SELECT product_id FROM collection_plan WHERE id = $1', [planId]);
      const { rows: skus } = await client.query(
        'SELECT id, model, bom_code FROM product_sku WHERE product_id = $1',
        [planProduct[0].product_id]
      );
      const skuMap = new Map(skus.map(s => [s.id, s]));

      // 删除原有需求项
      await client.query('DELETE FROM demand_item WHERE submission_id = $1', [submission.id]);

      // 插入新需求项
      for (const item of input.items) {
        const sku = skuMap.get(item.productItemKey);
        await client.query(`
          INSERT INTO demand_item (submission_id, product_sku_id, provisional_item_key, office_id, quantity, demand_basis, planned_use_date, note)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        `, [
          submission.id,
          sku ? item.productItemKey : null,
          sku ? null : item.productItemKey,
          item.officeId || null,
          item.quantity,
          item.basis || null,
          item.plannedUseDate || null,
          item.note || null,
        ]);
      }

      // 更新提交状态为草稿
      const { rows: updatedSubmission } = await client.query(`
        UPDATE demand_submission
        SET status = 'DRAFT', saved_by = $1, saved_at = NOW(), version = version + 1, updated_at = NOW()
        WHERE id = $2
        RETURNING *
      `, [userId, submission.id]);

      await writeAudit(client, userId, 'DEMAND_DRAFT_SAVED', 'DEMAND_SUBMISSION', submission.id, { version: submission.version }, { version: updatedSubmission[0].version });
      await client.query('COMMIT');

      // 获取完整草稿数据
      const { rows: items } = await client.query(`
        SELECT di.id, di.product_sku_id, di.provisional_item_key, di.office_id, di.quantity, di.demand_basis, di.planned_use_date, di.note,
          ps.model, ps.bom_code
        FROM demand_item di
        LEFT JOIN product_sku ps ON di.product_sku_id = ps.id
        WHERE di.submission_id = $1
      `, [updatedSubmission[0].id]);

      return {
        id: updatedSubmission[0].id,
        planId,
        regionId,
        status: updatedSubmission[0].status,
        version: Number(updatedSubmission[0].version),
        savedBy: userId,
        savedAt: updatedSubmission[0].saved_at,
        submittedBy: updatedSubmission[0].submitted_by,
        submittedAt: updatedSubmission[0].submitted_at,
        items: items.map(i => ({
          id: i.id,
          productItemKey: i.product_sku_id || i.provisional_item_key,
          skuModel: i.model,
          bomCode: i.bom_code,
          quantity: Number(i.quantity),
          basis: i.demand_basis,
          plannedUseDate: i.planned_use_date,
          note: i.note,
          officeId: i.office_id,
        })),
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  },

  // 提交区域需求
  async submitRegion(planId: string, regionId: string, userId: string, role: string, version?: number): Promise<CollectionPlan> {
    const client = await getClient();
    try {
      await client.query('BEGIN');

      const { rows: scopeRows } = await client.query(`
        SELECT cps.*, cp.status, pd.stocking_owner_id, pd.domain_owner_id, r.owner_id as region_owner_id,
          EXISTS(SELECT 1 FROM org_node o WHERE o.parent_id = r.id AND o.node_type = 'OFFICE' AND o.owner_id = $3) as office_owned
        FROM collection_plan_scope cps
        JOIN collection_plan cp ON cps.plan_id = cp.id
        JOIN product_domain pd ON cp.domain_id = pd.id
        JOIN org_node r ON cps.region_id = r.id
        WHERE cps.plan_id = $1 AND cps.region_id = $2
      `, [planId, regionId, userId]);
      if (scopeRows.length === 0) {
        throw new ForbiddenError('该区域不在此计划范围内');
      }
      const scope = scopeRows[0];
      assertScopeActor(scope, role, userId);
      if (scope.status !== PLAN_STATUS.COLLECTING) {
        throw new PlanStateConflictError('当前计划状态不允许提交需求');
      }

      const { rows: submissionRows } = await client.query(
        'SELECT * FROM demand_submission WHERE plan_scope_id = $1',
        [scope.id]
      );
      const submission = submissionRows[0];
      if (version !== undefined && Number(submission.version) !== Number(version)) {
        throw new VersionConflictError();
      }
      if (submission.status !== 'DRAFT') {
        throw new ValidationError('请先保存需求草稿再提交');
      }

      // 校验所有需求项
      const { rows: items } = await client.query('SELECT * FROM demand_item WHERE submission_id = $1', [submission.id]);
      for (const item of items) {
        if (Number(item.quantity) > 0 && !item.demand_basis?.trim()) {
          throw new ValidationError('存在数量大于0但未填写需求依据的项，请补充后提交');
        }
      }

      // 更新为已提交状态
      await client.query(`
        UPDATE demand_submission
        SET status = 'SUBMITTED', submitted_by = $1, submitted_at = NOW(), version = version + 1, updated_at = NOW()
        WHERE id = $2
      `, [userId, submission.id]);

      // 检查是否所有区域都已提交，更新计划状态
      const { rows: submittedCount } = await client.query(`
        SELECT COUNT(*) as count FROM demand_submission ds
        JOIN collection_plan_scope cps ON ds.plan_scope_id = cps.id
        WHERE cps.plan_id = $1 AND ds.status = 'SUBMITTED'
      `, [planId]);
      const { rows: totalCount } = await client.query(
        'SELECT COUNT(*) as count FROM collection_plan_scope WHERE plan_id = $1',
        [planId]
      );

      if (Number(submittedCount[0].count) === Number(totalCount[0].count)) {
        await client.query(`
          UPDATE collection_plan
          SET status = $1, version = version + 1, updated_at = NOW()
          WHERE id = $2
        `, [PLAN_STATUS.DOMAIN_REVIEW, planId]);
      } else {
        await client.query(`
          UPDATE collection_plan SET version = version + 1, updated_at = NOW() WHERE id = $1
        `, [planId]);
      }

      await writeAudit(client, userId, 'REGION_DEMAND_SUBMITTED', 'DEMAND_SUBMISSION', submission.id, { status: submission.status }, { status: 'SUBMITTED' });
      await client.query('COMMIT');
      return (await this.getPlan(planId, role, userId))!;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  },

  // 领域反馈GTM
  async submitDomainFeedback(planId: string, input: DomainFeedbackInput, userId: string): Promise<CollectionPlan> {
    const client = await getClient();
    try {
      await client.query('BEGIN');

      const { rows: planRows } = await client.query(`
        SELECT cp.*, pd.domain_owner_id FROM collection_plan cp
        JOIN product_domain pd ON cp.domain_id = pd.id
        WHERE cp.id = $1
      `, [planId]);
      if (planRows.length === 0) {
        throw new NotFoundError('收集计划不存在');
      }
      const plan = planRows[0];
      if (plan.domain_owner_id !== userId) {
        throw new ForbiddenError('只能反馈自己负责领域的收集计划');
      }
      if (input.version !== undefined && Number(plan.version) !== Number(input.version)) {
        throw new VersionConflictError();
      }
      if (plan.status !== PLAN_STATUS.DOMAIN_REVIEW) {
        throw new PlanStateConflictError('仅待领域反馈状态的计划可以提交反馈');
      }
      // 校验所有区域已提交
      const { rows: submittedCount } = await client.query(`
        SELECT COUNT(*) as count FROM demand_submission ds
        JOIN collection_plan_scope cps ON ds.plan_scope_id = cps.id
        WHERE cps.plan_id = $1 AND ds.status = 'SUBMITTED'
      `, [planId]);
      const { rows: totalCount } = await client.query(
        'SELECT COUNT(*) as count FROM collection_plan_scope WHERE plan_id = $1',
        [planId]
      );
      if (Number(submittedCount[0].count) !== Number(totalCount[0].count)) {
        throw new PlanStateConflictError('还有区域未提交需求，无法反馈GTM');
      }

      // 计算总需求量
      const { rows: totalRows } = await client.query(`
        SELECT COALESCE(SUM(di.quantity), 0) as total FROM demand_item di
        JOIN demand_submission ds ON di.submission_id = ds.id
        JOIN collection_plan_scope cps ON ds.plan_scope_id = cps.id
        WHERE cps.plan_id = $1 AND ds.status = 'SUBMITTED'
      `, [planId]);
      const totalQuantity = Number(totalRows[0].total) || 0;

      // 保存反馈快照
      const { rows: snapshotRows } = await client.query(`
        SELECT cp.product_id, di.product_sku_id, di.provisional_item_key, ps.model, ps.bom_code,
          r.id as region_id, r.name as region_name, di.quantity, di.demand_basis,
          di.planned_use_date, di.note
        FROM demand_item di
        JOIN demand_submission ds ON di.submission_id = ds.id
        JOIN collection_plan_scope cps ON ds.plan_scope_id = cps.id
        JOIN collection_plan cp ON cps.plan_id = cp.id
        JOIN org_node r ON cps.region_id = r.id
        LEFT JOIN product_sku ps ON di.product_sku_id = ps.id
        WHERE cps.plan_id = $1 AND ds.status = 'SUBMITTED'
        ORDER BY r.name, ps.model, di.provisional_item_key
      `, [planId]);

      await client.query(`
        INSERT INTO domain_feedback (plan_id, note, total_quantity, summary_snapshot, confirmed_by, confirmed_at)
        VALUES ($1, $2, $3, $4, $5, NOW())
        ON CONFLICT (plan_id) DO UPDATE
        SET note = $2, total_quantity = $3, summary_snapshot = $4, confirmed_by = $5, confirmed_at = NOW(), version = domain_feedback.version + 1, updated_at = NOW()
      `, [planId, input.note, totalQuantity, JSON.stringify({ items: snapshotRows }), userId]);

      // 确认需求只来源于本次正式反馈快照；重复反馈时先替换同计划事实，避免重复累计。
      await client.query("DELETE FROM execution_fact WHERE source_type = 'CONFIRMED_DEMAND' AND source_id = $1", [planId]);
      for (const item of snapshotRows) {
        await client.query(`
          INSERT INTO execution_fact (id, source_type, source_id, product_id, product_sku_id, region_id, quantity, occurred_at, dimension_snapshot)
          VALUES ($1, 'CONFIRMED_DEMAND', $2, $3, $4, $5, $6, NOW(), $7)
        `, [crypto.randomUUID(), planId, item.product_id, item.product_sku_id, item.region_id, Number(item.quantity), JSON.stringify({ feedbackPlanId: planId, provisionalItemKey: item.provisional_item_key })]);
      }

      // 更新计划状态
      await client.query(`
        UPDATE collection_plan
        SET status = $1, demand_total = $2, version = version + 1, updated_at = NOW()
        WHERE id = $3
      `, [PLAN_STATUS.GTM_CLOSURE, totalQuantity, planId]);

      await writeAudit(client, userId, 'DOMAIN_FEEDBACK_SUBMITTED', 'COLLECTION_PLAN', planId, { status: plan.status }, { status: PLAN_STATUS.GTM_CLOSURE, totalQuantity });
      await client.query('COMMIT');
      return (await this.getPlan(planId, ROLES.MSS_DOMAIN_OWNER, userId))!;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  },

  // 导出排产Excel
  async createExport(planId: string, userId: string): Promise<{ id: string; fileName: string; rowCount: number; exportedAt: string; planVersion: number; mimeType: string; contentBase64: string }> {
    const client = await getClient();
    try {
      await client.query('BEGIN');

      const { rows: planRows } = await client.query(`
        SELECT cp.*, p.name as product_name, pd.name as domain_name, pd.gtm_owner_id,
          gu.display_name as gtm_name, su.display_name as stocking_owner_name,
          df.summary_snapshot, df.confirmed_at, fu.display_name as feedback_owner
        FROM collection_plan cp
        JOIN product p ON cp.product_id = p.id
        JOIN product_domain pd ON cp.domain_id = pd.id
        JOIN app_user gu ON pd.gtm_owner_id = gu.id
        JOIN app_user su ON pd.stocking_owner_id = su.id
        JOIN domain_feedback df ON cp.id = df.plan_id
        JOIN app_user fu ON df.confirmed_by = fu.id
        WHERE cp.id = $1
      `, [planId]);
      if (planRows.length === 0) {
        throw new NotFoundError('收集计划不存在');
      }
      const plan = planRows[0];
      if (plan.gtm_owner_id !== userId) {
        throw new ForbiddenError('只能导出自己负责领域的收集计划');
      }
      if (![PLAN_STATUS.GTM_CLOSURE, PLAN_STATUS.EXPORTED].includes(plan.status)) {
        throw new PlanStateConflictError('仅待GTM收口或已导出状态的计划可以导出');
      }

      const snapshot = typeof plan.summary_snapshot === 'string' ? JSON.parse(plan.summary_snapshot) : plan.summary_snapshot;
      const exportRows = (snapshot?.items || []).map((item: any) => ({
        '计划编号': plan.plan_no,
        '产品': plan.product_name,
        '产品领域': plan.domain_name,
        'SKU/产品项': item.model || item.provisional_item_key || `${plan.product_name}（型号待补充）`,
        'BOM编码': item.bom_code || '待补充',
        'MSS区域': item.region_name,
        '代表处': '区域汇总',
        '国家/地区': '',
        '确认需求数量(Pcs)': Number(item.quantity),
        '需求依据': item.demand_basis || '',
        '计划使用时间': item.planned_use_date || '',
        '备注': item.note || '',
        'GTM': plan.gtm_name,
        '领域接口人': plan.stocking_owner_name,
        '领域反馈人': plan.feedback_owner,
        '反馈时间': plan.confirmed_at,
      }));

      const exportId = crypto.randomUUID();
      const fileName = `${plan.plan_no}_${planRows[0].product_id}_排产需求_${new Date().toISOString().slice(0, 10)}.xlsx`;
      const workbook = XLSX.utils.book_new();
      const worksheet = XLSX.utils.json_to_sheet(exportRows);
      XLSX.utils.book_append_sheet(workbook, worksheet, '排产需求');
      const contentBase64 = XLSX.write(workbook, { type: 'base64', bookType: 'xlsx' });

      await client.query(`
        INSERT INTO production_export (id, plan_id, plan_version, file_name, data_snapshot, row_count, exported_by, exported_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
      `, [exportId, planId, Number(plan.version) + 1, fileName, JSON.stringify(exportRows), exportRows.length, userId]);

      // 更新计划状态为已导出
      if (plan.status !== PLAN_STATUS.EXPORTED) {
        await client.query(`
          UPDATE collection_plan SET status = $1, version = version + 1, updated_at = NOW() WHERE id = $2
        `, [PLAN_STATUS.EXPORTED, planId]);
      }

      await writeAudit(client, userId, 'PRODUCTION_EXPORT_CREATED', 'COLLECTION_PLAN', planId, { status: plan.status }, { fileName, rowCount: exportRows.length });
      await client.query('COMMIT');
      return {
        id: exportId,
        fileName,
        rowCount: exportRows.length,
        exportedAt: new Date().toISOString(),
        planVersion: Number(plan.version) + 1,
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        contentBase64,
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  },

  // 获取区域草稿
  async getDraft(planId: string, regionId: string, userId: string, role: string): Promise<DemandDraft | null> {
    const { rows: scopeRows } = await query(`
      SELECT cps.id, pd.stocking_owner_id, pd.domain_owner_id, r.owner_id as region_owner_id,
        EXISTS(SELECT 1 FROM org_node o WHERE o.parent_id = r.id AND o.node_type = 'OFFICE' AND o.owner_id = $3) as office_owned
      FROM collection_plan_scope cps
      JOIN collection_plan cp ON cp.id = cps.plan_id
      JOIN product_domain pd ON pd.id = cp.domain_id
      JOIN org_node r ON r.id = cps.region_id
      WHERE cps.plan_id = $1 AND cps.region_id = $2
    `, [planId, regionId, userId]);
    if (scopeRows.length === 0) return null;
    assertScopeActor(scopeRows[0], role, userId);

    const { rows: submissionRows } = await query(
      'SELECT * FROM demand_submission WHERE plan_scope_id = $1',
      [scopeRows[0].id]
    );
    if (submissionRows.length === 0) return null;
    const submission = submissionRows[0];

    const { rows: items } = await query(`
      SELECT di.id, di.product_sku_id, di.provisional_item_key, di.office_id, di.quantity, di.demand_basis, di.planned_use_date, di.note,
        ps.model, ps.bom_code
      FROM demand_item di
      LEFT JOIN product_sku ps ON di.product_sku_id = ps.id
      WHERE di.submission_id = $1
    `, [submission.id]);

    return {
      id: submission.id,
      planId,
      regionId,
      status: submission.status,
      version: Number(submission.version),
      savedBy: submission.saved_by,
      savedAt: submission.saved_at,
      submittedBy: submission.submitted_by,
      submittedAt: submission.submitted_at,
      items: items.map(i => ({
        id: i.id,
        productItemKey: i.product_sku_id || i.provisional_item_key,
        skuModel: i.model,
        bomCode: i.bom_code,
        quantity: Number(i.quantity),
        basis: i.demand_basis,
        plannedUseDate: i.planned_use_date,
        note: i.note,
        officeId: i.office_id,
      })),
    };
  }
};
