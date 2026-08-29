import { query, getClient } from '../../config/db.js';
import { NotFoundError, VersionConflictError, PlanStateConflictError, ForbiddenError, ValidationError } from '../../shared/errors.js';
import { PLAN_STATUS } from '../../shared/types.js';
import type { CreatePlanInput, DraftSaveInput, DomainFeedbackInput } from './schemas.js';

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
  }>;
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
    if (role === 'MSS_DOMAIN_OWNER') {
      params.push(userId);
      conditions.push(`pd.stocking_owner_id = $${params.length}`);
    }
    if (role === 'REGIONAL_OWNER') {
      params.push(regionId || '');
      conditions.push(`cps.region_id = $${params.length}`);
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
        totalRegions: Number(plan.total_regions) || 0,
        regionProgress: planProgress.map(p => ({
          regionId: p.region_id,
          regionName: p.region_name_snapshot,
          owner: p.region_owner_snapshot || '待配置',
          officeCount: (p.office_country_snapshot?.offices || []).length,
          countryCount: (p.office_country_snapshot?.offices || []).reduce((sum: number, o: any) => sum + (o.countries?.length || 0), 0),
          status: p.status || 'NOT_STARTED',
          demand: Number(p.demand) || 0,
          submittedAt: p.submitted_at,
        })),
        feedback: feedback ? {
          note: feedback.note,
          totalQuantity: Number(feedback.total_quantity),
          confirmedBy: feedback.confirmer_name,
          confirmedAt: feedback.confirmed_at,
        } : null,
        draftDemandTotal: Number(plan.draft_total_demand) || 0,
      };
    });
  },

  // 获取计划详情
  async getPlan(planId: string): Promise<CollectionPlan | null> {
    const plans = await this.listPlans('', '', undefined, undefined, undefined, undefined);
    return plans.find(p => p.id === planId) || null;
  },

  // 创建收集计划
  async createPlan(input: CreatePlanInput, userId: string): Promise<CollectionPlan> {
    const client = await getClient();
    try {
      await client.query('BEGIN');

      // 检查产品是否存在
      const { rows: productRows } = await client.query(`
        SELECT p.*, pd.id as domain_id FROM product p
        JOIN product_domain pd ON p.domain_id = pd.id
        WHERE p.id = $1 AND p.enabled = true
      `, [input.productId]);
      if (productRows.length === 0) {
        throw new NotFoundError('产品不存在或已停用');
      }
      const product = productRows[0];

      // 检查区域是否存在
      const { rows: regionRows } = await client.query(`
        SELECT n.*, u.display_name as owner_name
        FROM org_node n
        LEFT JOIN app_user u ON n.owner_id = u.id
        WHERE n.id = ANY($1) AND n.node_type = 'REGION' AND n.enabled = true
      `, [input.regionIds]);
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
          SELECT o.id, o.name, u.display_name as owner,
            ARRAY(SELECT c.name FROM org_node c WHERE c.parent_id = o.id AND c.node_type = 'COUNTRY' AND c.enabled = true) as countries
          FROM org_node o
          LEFT JOIN app_user u ON o.owner_id = u.id
          WHERE o.parent_id = $1 AND o.node_type = 'OFFICE' AND o.enabled = true
        `, [region.id]);

        await client.query(`
          INSERT INTO collection_plan_scope (id, plan_id, region_id, region_name_snapshot, region_owner_snapshot, office_country_snapshot)
          VALUES ($1, $2, $3, $4, $5, $6)
        `, [
          crypto.randomUUID(), planId, region.id, region.name, region.owner_name,
          JSON.stringify({ offices: offices.map(o => ({ name: o.name, owner: o.owner, countries: o.countries })) })
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

      await client.query('COMMIT');
      return (await this.getPlan(planId))!;
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

      const { rows: existing } = await client.query('SELECT * FROM collection_plan WHERE id = $1', [planId]);
      if (existing.length === 0) {
        throw new NotFoundError('收集计划不存在');
      }
      if (version !== undefined && Number(existing[0].version) !== Number(version)) {
        throw new VersionConflictError();
      }
      if (existing[0].status !== PLAN_STATUS.READY_TO_RELEASE) {
        throw new PlanStateConflictError('仅待下发状态的计划可以下发');
      }

      await client.query(`
        UPDATE collection_plan
        SET status = $1, released_by = $2, released_at = NOW(), version = version + 1, updated_at = NOW()
        WHERE id = $3
      `, [PLAN_STATUS.COLLECTING, userId, planId]);

      await client.query('COMMIT');
      return (await this.getPlan(planId))!;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  },

  // 保存区域草稿
  async saveDraft(planId: string, regionId: string, input: DraftSaveInput, userId: string): Promise<DemandDraft> {
    const client = await getClient();
    try {
      await client.query('BEGIN');

      // 检查计划和区域范围
      const { rows: scopeRows } = await client.query(`
        SELECT cps.*, cp.status FROM collection_plan_scope cps
        JOIN collection_plan cp ON cps.plan_id = cp.id
        WHERE cps.plan_id = $1 AND cps.region_id = $2
      `, [planId, regionId]);
      if (scopeRows.length === 0) {
        throw new ForbiddenError('该区域不在此计划范围内');
      }
      const scope = scopeRows[0];
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
          INSERT INTO demand_item (submission_id, product_sku_id, provisional_item_key, quantity, demand_basis, planned_use_date, note)
          VALUES ($1, $2, $3, $4, $5, $6, $7)
        `, [
          submission.id,
          sku ? item.productItemKey : null,
          sku ? null : item.productItemKey,
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

      await client.query('COMMIT');

      // 获取完整草稿数据
      const { rows: items } = await client.query(`
        SELECT di.id, di.product_sku_id, di.provisional_item_key, di.quantity, di.demand_basis, di.planned_use_date, di.note,
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
  async submitRegion(planId: string, regionId: string, userId: string, version?: number): Promise<CollectionPlan> {
    const client = await getClient();
    try {
      await client.query('BEGIN');

      const { rows: scopeRows } = await client.query(`
        SELECT cps.*, cp.status FROM collection_plan_scope cps
        JOIN collection_plan cp ON cps.plan_id = cp.id
        WHERE cps.plan_id = $1 AND cps.region_id = $2
      `, [planId, regionId]);
      if (scopeRows.length === 0) {
        throw new ForbiddenError('该区域不在此计划范围内');
      }
      const scope = scopeRows[0];
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

      await client.query('COMMIT');
      return (await this.getPlan(planId))!;
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
        SELECT cp.*, pd.stocking_owner_id FROM collection_plan cp
        JOIN product_domain pd ON cp.domain_id = pd.id
        WHERE cp.id = $1
      `, [planId]);
      if (planRows.length === 0) {
        throw new NotFoundError('收集计划不存在');
      }
      const plan = planRows[0];
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
      const { rows: skuRows } = await client.query(`
        SELECT ps.model, ps.bom_code, r.name as region_name, SUM(di.quantity) as quantity,
          array_agg(DISTINCT di.demand_basis) FILTER (WHERE di.demand_basis IS NOT NULL) as bases
        FROM demand_item di
        JOIN demand_submission ds ON di.submission_id = ds.id
        JOIN collection_plan_scope cps ON ds.plan_scope_id = cps.id
        JOIN org_node r ON cps.region_id = r.id
        LEFT JOIN product_sku ps ON di.product_sku_id = ps.id
        WHERE cps.plan_id = $1 AND ds.status = 'SUBMITTED'
        GROUP BY ps.model, ps.bom_code, r.name
      `, [planId]);

      await client.query(`
        INSERT INTO domain_feedback (plan_id, note, total_quantity, summary_snapshot, confirmed_by, confirmed_at)
        VALUES ($1, $2, $3, $4, $5, NOW())
        ON CONFLICT (plan_id) DO UPDATE
        SET note = $2, total_quantity = $3, summary_snapshot = $4, confirmed_by = $5, confirmed_at = NOW(), version = domain_feedback.version + 1, updated_at = NOW()
      `, [planId, input.note, totalQuantity, JSON.stringify({ items: skuRows }), userId]);

      // 更新计划状态
      await client.query(`
        UPDATE collection_plan
        SET status = $1, demand_total = $2, version = version + 1, updated_at = NOW()
        WHERE id = $3
      `, [PLAN_STATUS.GTM_CLOSURE, totalQuantity, planId]);

      await client.query('COMMIT');
      return (await this.getPlan(planId))!;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  },

  // 导出排产Excel
  async createExport(planId: string, userId: string): Promise<{ id: string; fileName: string; rowCount: number; exportedAt: string; planVersion: number }> {
    const client = await getClient();
    try {
      await client.query('BEGIN');

      const { rows: planRows } = await client.query('SELECT * FROM collection_plan WHERE id = $1', [planId]);
      if (planRows.length === 0) {
        throw new NotFoundError('收集计划不存在');
      }
      const plan = planRows[0];
      if (![PLAN_STATUS.GTM_CLOSURE, PLAN_STATUS.EXPORTED].includes(plan.status)) {
        throw new PlanStateConflictError('仅待GTM收口或已导出状态的计划可以导出');
      }

      // 获取导出数据
      const { rows: exportRows } = await client.query(`
        SELECT cp.plan_no, p.name as product_name, pd.name as domain_name,
          ps.model as sku, ps.bom_code, r.name as region, o.name as office, c.name as country,
          di.quantity, di.demand_basis, di.planned_use_date, di.note,
          gu.display_name as gtm, su.display_name as stocking_owner, df.confirmed_at as feedback_time
        FROM collection_plan cp
        JOIN product p ON cp.product_id = p.id
        JOIN product_domain pd ON cp.domain_id = pd.id
        JOIN app_user gu ON pd.gtm_owner_id = gu.id
        JOIN app_user su ON pd.stocking_owner_id = su.id
        JOIN domain_feedback df ON cp.id = df.plan_id
        JOIN collection_plan_scope cps ON cp.id = cps.plan_id
        JOIN org_node r ON cps.region_id = r.id
        JOIN demand_submission ds ON cps.id = ds.plan_scope_id
        JOIN demand_item di ON ds.id = di.submission_id
        LEFT JOIN product_sku ps ON di.product_sku_id = ps.id
        LEFT JOIN org_node o ON o.parent_id = r.id AND o.node_type = 'OFFICE'
        LEFT JOIN org_node c ON c.parent_id = o.id AND c.node_type = 'COUNTRY'
        WHERE cp.id = $1 AND ds.status = 'SUBMITTED'
      `, [planId]);

      const exportId = crypto.randomUUID();
      const fileName = `${plan.plan_no}_${planRows[0].product_id}_排产需求_${new Date().toISOString().slice(0, 10)}.xlsx`;

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

      await client.query('COMMIT');
      return {
        id: exportId,
        fileName,
        rowCount: exportRows.length,
        exportedAt: new Date().toISOString(),
        planVersion: Number(plan.version) + 1,
      };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  },

  // 获取区域草稿
  async getDraft(planId: string, regionId: string): Promise<DemandDraft | null> {
    const { rows: scopeRows } = await query(`
      SELECT id FROM collection_plan_scope WHERE plan_id = $1 AND region_id = $2
    `, [planId, regionId]);
    if (scopeRows.length === 0) return null;

    const { rows: submissionRows } = await query(
      'SELECT * FROM demand_submission WHERE plan_scope_id = $1',
      [scopeRows[0].id]
    );
    if (submissionRows.length === 0) return null;
    const submission = submissionRows[0];

    const { rows: items } = await query(`
      SELECT di.id, di.product_sku_id, di.provisional_item_key, di.quantity, di.demand_basis, di.planned_use_date, di.note,
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
      })),
    };
  }
};
