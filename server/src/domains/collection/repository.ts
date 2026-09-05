import { query, getClient, type DbClient } from '../../config/db.js';
import { NotFoundError, VersionConflictError, PlanStateConflictError, ForbiddenError, ValidationError } from '../../shared/errors.js';
import { PLAN_STATUS, ROLES } from '../../shared/types.js';
import type { CreatePlanInput, DraftSaveInput, DomainDispatchInput, DomainFeedbackInput, RegionChangeRequestInput, RegionChangeDecisionInput } from './schemas.js';
import * as XLSX from 'xlsx';

export interface CollectionPlan {
  id: string;
  viewId: string;
  planNo: string;
  productId: string;
  domainId: string;
  mssDomainId?: string;
  domainTaskId?: string;
  taskStatus?: string;
  taskVersion?: number;
  selectedSkuIds: string[];
  stage: string;
  status: PLAN_STATUS;
  deadline: string;
  note?: string;
  demandTotal: number;
  createdBy: string;
  createdAt: string;
  releasedBy?: string;
  releasedAt?: string;
  version: number;
  cancelledAt?: string;
  archivedAt?: string;
  product: {
    id: string; name: string; domain: string; gtm: string; stockingOwner: string; skuCount: number;
    skus: Array<{ id: string; model: string; bomCode: string; description: string }>;
  };
  mssDomain?: { id: string; name: string; owner: string };
  domainTasks: Array<{
    id: string; mssDomainId: string; mssDomainName: string; owner: string; status: string;
    selectedSkuIds: string[]; regionIds: string[]; totalRegions: number; submittedRegions: number; demandTotal: number; version: number;
  }>;
  submittedRegions: string[];
  submittedRegionCount: number;
  totalRegions: number;
  regionProgress: Array<{
    domainTaskId: string; mssDomainId: string; mssDomainName: string; regionId: string; regionName: string;
    owner: string; officeCount: number; countryCount: number; status: 'NOT_STARTED' | 'DRAFT' | 'SUBMITTED' | 'RETURNED'; demand: number; submittedAt?: string;
    version: number; revisionNo: number; changePending: boolean; canRequestChange: boolean; reopenReason?: string; reopenType?: string;
    changeRequest?: { id: string; type: string; status: string; reason: string; requestedAt: string; requestedBy: string; version: number };
  }>;
  feedback?: { note: string; totalQuantity: number; confirmedBy: string; confirmedAt: string; items: any[] } | null;
  draftDemandTotal: number;
  exportCount: number;
  pendingChangeCount: number;
}

export interface DemandDraft {
  id: string;
  planId: string;
  domainTaskId: string;
  regionId: string;
  status: 'NOT_STARTED' | 'DRAFT' | 'SUBMITTED' | 'RETURNED';
  version: number;
  savedBy: string;
  savedAt: string;
  submittedBy?: string;
  submittedAt?: string;
  revisionNo: number;
  changePending: boolean;
  reopenedBy?: string;
  reopenedAt?: string;
  reopenReason?: string;
  reopenType?: string;
  changeRequest?: { id: string; type: string; status: string; reason: string; requestedAt: string; requestedBy: string; version: number };
  items: Array<{ id: string; productItemKey: string; skuModel?: string; bomCode?: string; quantity: number; basis?: string; plannedUseDate?: string; note?: string; officeId?: string }>;
}

export interface PlanListOptions {
  page?: number;
  pageSize?: number;
  sortBy?: 'createdAt' | 'deadline' | 'updatedAt' | 'demand' | 'progress';
  sortOrder?: 'asc' | 'desc';
  includeArchived?: boolean;
}

function parseJson(value: unknown): any {
  if (!value) return {};
  if (typeof value === 'object') return value;
  try { return JSON.parse(String(value)); } catch { return {}; }
}

async function writeAudit(client: DbClient, actorId: string, action: string, entityType: string, entityId: string, beforeData: unknown, afterData: unknown) {
  await client.query(`
    INSERT INTO audit_log (id, actor_id, action, entity_type, entity_id, before_data, after_data)
    VALUES ($1, $2, $3, $4, $5, $6, $7)
  `, [crypto.randomUUID(), actorId, action, entityType, entityId, beforeData ? JSON.stringify(beforeData) : null, afterData ? JSON.stringify(afterData) : null]);
}

async function buildSubmissionSnapshot(client: DbClient, submissionId: string) {
  const { rows } = await client.query<any>(`
    SELECT item.id, item.product_sku_id, item.provisional_item_key, item.office_id, item.quantity,
      item.demand_basis, item.planned_use_date, item.note, sku.model, sku.bom_code
    FROM collection_plan_domain_demand_item item
    LEFT JOIN product_sku sku ON sku.id = item.product_sku_id
    WHERE item.submission_id = $1 ORDER BY item.office_id, sku.model, item.provisional_item_key
  `, [submissionId]);
  return { items: rows.map((item) => ({ ...item, quantity: Number(item.quantity) })) };
}

async function invalidateDomainFeedback(client: DbClient, taskId: string, userId: string, reason: string, changeRequestId?: string) {
  const { rows } = await client.query<any>('SELECT * FROM collection_plan_domain_feedback WHERE domain_task_id = $1', [taskId]);
  const feedback = rows[0];
  if (!feedback) return false;
  await client.query(`
    INSERT INTO collection_plan_domain_feedback_history (
      id, original_feedback_id, domain_task_id, note, total_quantity, summary_snapshot,
      confirmed_by, confirmed_at, feedback_version, invalidated_by, invalidated_at,
      invalidation_reason, change_request_id
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), $11, $12)
  `, [crypto.randomUUID(), feedback.id, taskId, feedback.note, Number(feedback.total_quantity), feedback.summary_snapshot,
    feedback.confirmed_by, feedback.confirmed_at, Number(feedback.version), userId, reason, changeRequestId || null]);
  await client.query('DELETE FROM collection_plan_domain_feedback WHERE id = $1', [feedback.id]);
  await client.query("DELETE FROM execution_fact WHERE source_type = 'CONFIRMED_DEMAND' AND source_id = $1", [taskId]);
  return true;
}

async function reopenRegionSubmission(client: DbClient, scope: any, submission: any, userId: string, reason: string, reopenType: string, changeRequestId?: string) {
  const feedbackInvalidated = await invalidateDomainFeedback(client, scope.domain_task_id, userId, reason, changeRequestId);
  await client.query(`
    UPDATE collection_plan_domain_submission
    SET status = 'RETURNED', change_pending = false, returned_by = $1, returned_at = NOW(), return_reason = $2,
      reopened_by = $1, reopened_at = NOW(), reopen_reason = $2, reopen_type = $3,
      version = version + 1, updated_at = NOW()
    WHERE id = $4
  `, [userId, reason, reopenType, submission.id]);
  await client.query("UPDATE collection_plan_domain_task SET status = 'COLLECTING', version = version + 1, updated_at = NOW() WHERE id = $1", [scope.domain_task_id]);
  await refreshParentPlan(client, scope.plan_id || scope.collection_plan_id);
  return feedbackInvalidated;
}

function assertScopeActor(scope: any, role: string, userId: string) {
  if (role === ROLES.ADMIN) return;
  if (role === ROLES.MSS_DOMAIN_OWNER && scope.mss_owner_id === userId) return;
  if (role === ROLES.REGIONAL_OWNER && (scope.region_owner_id === userId || Boolean(scope.office_owned))) return;
  throw new ForbiddenError('无权处理该领域或区域的需求');
}

async function refreshParentPlan(client: DbClient, planId: string) {
  const { rows } = await client.query(`
    SELECT COUNT(*) as total,
      SUM(CASE WHEN status = 'FEEDBACK_SUBMITTED' THEN 1 ELSE 0 END) as feedback_count,
      SUM(CASE WHEN status = 'READY_TO_FEEDBACK' THEN 1 ELSE 0 END) as ready_count,
      COALESCE((SELECT SUM(total_quantity) FROM collection_plan_domain_feedback f
        JOIN collection_plan_domain_task t2 ON t2.id = f.domain_task_id WHERE t2.plan_id = $1), 0) as demand_total
    FROM collection_plan_domain_task WHERE plan_id = $1
  `, [planId]);
  const total = Number(rows[0]?.total || 0);
  const feedbackCount = Number(rows[0]?.feedback_count || 0);
  const readyCount = Number(rows[0]?.ready_count || 0);
  const status = total > 0 && feedbackCount === total
    ? PLAN_STATUS.GTM_CLOSURE
    : total > 0 && feedbackCount + readyCount === total
      ? PLAN_STATUS.DOMAIN_REVIEW
      : PLAN_STATUS.COLLECTING;
  await client.query(
    'UPDATE collection_plan SET status = $1, demand_total = $2, version = version + 1, updated_at = NOW() WHERE id = $3',
    [status, Number(rows[0]?.demand_total || 0), planId]
  );
}

async function getTaskScope(client: DbClient, planId: string, regionId: string, domainTaskId: string | undefined, userId: string, role: string) {
  const params: any[] = [planId, regionId, userId];
  let taskCondition = '';
  if (domainTaskId) {
    params.push(domainTaskId);
    taskCondition = ` AND task.id = $${params.length}`;
  }
  const { rows } = await client.query<any>(`
    SELECT scope.*, task.id as domain_task_id, task.status as task_status, task.version as task_version,
      task.mss_domain_id, task.plan_id, md.mss_owner_id, cp.product_id, cp.domain_id, cp.status as plan_status,
      cp.deadline_at, cp.cancelled_at, cp.archived_at, pd.gtm_owner_id,
      region.owner_id as region_owner_id,
      EXISTS(SELECT 1 FROM user_scope_assignment usa WHERE usa.user_id = $3 AND usa.scope_type = 'MSS_DOMAIN' AND usa.scope_id = task.mss_domain_id) as mss_scope_owned,
      EXISTS(SELECT 1 FROM org_node office WHERE office.parent_id = region.id AND office.node_type = 'OFFICE' AND office.owner_id = $3) as office_owned
    FROM collection_plan_domain_scope scope
    JOIN collection_plan_domain_task task ON task.id = scope.domain_task_id
    JOIN collection_plan cp ON cp.id = task.plan_id
    JOIN product_domain pd ON pd.id = cp.domain_id
    JOIN mss_domain md ON md.id = task.mss_domain_id
    JOIN org_node region ON region.id = scope.region_id
    WHERE cp.id = $1 AND scope.region_id = $2${taskCondition}
  `, params);
  const accessible = rows.filter((scope) => {
    if (role === ROLES.ADMIN) return true;
    if (role === ROLES.GTM) return scope.gtm_owner_id === userId;
    if (role === ROLES.MSS_DOMAIN_OWNER) return Boolean(scope.mss_scope_owned);
    if (role === ROLES.REGIONAL_OWNER) return Boolean(scope.mss_scope_owned) && (scope.region_owner_id === userId || Boolean(scope.office_owned));
    return false;
  });
  if (!accessible.length) throw new ForbiddenError('该区域不在当前领域任务范围内');
  if (accessible[0].cancelled_at || accessible[0].archived_at) throw new PlanStateConflictError('已取消或归档的计划不能继续处理');
  if (accessible.length > 1 && !domainTaskId) throw new ValidationError('该计划在当前区域包含多个领域任务，请指定领域任务');
  return accessible[0];
}

async function buildRegionSnapshot(client: DbClient, region: any) {
  const { rows: offices } = await client.query(`
    SELECT office.id, office.name, owner.display_name as owner
    FROM org_node office LEFT JOIN app_user owner ON owner.id = office.owner_id
    WHERE office.parent_id = $1 AND office.node_type = 'OFFICE' AND office.enabled = true ORDER BY office.name
  `, [region.id]);
  const snapshotOffices = [];
  for (const office of offices) {
    const { rows: countries } = await client.query(
      "SELECT id, name FROM org_node WHERE parent_id = $1 AND node_type = 'COUNTRY' AND enabled = true ORDER BY name",
      [office.id]
    );
    snapshotOffices.push({ ...office, countries: countries.map((country) => ({ id: country.id, name: country.name })) });
  }
  return JSON.stringify({ offices: snapshotOffices });
}

export const collectionRepository = {
  async listPlans(role: string, userId: string, keyword?: string, status?: string, productId?: string, regionId?: string, options?: PlanListOptions): Promise<CollectionPlan[] | { items: CollectionPlan[]; total: number }> {
    const conditions: string[] = [];
    const params: any[] = [];
    if (status === 'CANCELLED') conditions.push('cp.cancelled_at IS NOT NULL');
    else if (status) { params.push(status); conditions.push(`cp.status = $${params.length} AND cp.cancelled_at IS NULL`); }
    if (!options?.includeArchived) conditions.push('cp.archived_at IS NULL');
    if (productId && productId !== 'all') { params.push(productId); conditions.push(`cp.product_id = $${params.length}`); }
    if (keyword) { params.push(`%${keyword}%`); conditions.push(`(p.name ILIKE $${params.length} OR cp.plan_no ILIKE $${params.length} OR pd.name ILIKE $${params.length})`); }
    if (role === ROLES.GTM) { params.push(userId); conditions.push(`pd.gtm_owner_id = $${params.length}`); }
    if (role === ROLES.MSS_DOMAIN_OWNER) {
      params.push(userId);
      conditions.push(`EXISTS (
        SELECT 1 FROM collection_plan_domain_task task
        JOIN user_scope_assignment usa ON usa.scope_type = 'MSS_DOMAIN' AND usa.scope_id = task.mss_domain_id
        WHERE task.plan_id = cp.id AND usa.user_id = $${params.length}
      )`);
      conditions.push(`cp.status IN ('COLLECTING', 'DOMAIN_REVIEW', 'GTM_CLOSURE', 'EXPORTED')`);
    }
    if (role === ROLES.REGIONAL_OWNER) {
      params.push(userId);
      conditions.push(`EXISTS (
        SELECT 1 FROM collection_plan_domain_task task
        JOIN collection_plan_domain_scope scope ON scope.domain_task_id = task.id
        JOIN org_node region ON region.id = scope.region_id
        WHERE task.plan_id = cp.id AND task.status <> 'PENDING_DISPATCH'
          AND EXISTS (SELECT 1 FROM user_scope_assignment usa WHERE usa.user_id = $${params.length} AND usa.scope_type = 'MSS_DOMAIN' AND usa.scope_id = task.mss_domain_id)
          AND (region.owner_id = $${params.length} OR EXISTS (SELECT 1 FROM org_node office WHERE office.parent_id = region.id AND office.owner_id = $${params.length}))
      )`);
      if (regionId) { params.push(regionId); conditions.push(`EXISTS (SELECT 1 FROM collection_plan_domain_task task JOIN collection_plan_domain_scope scope ON scope.domain_task_id = task.id WHERE task.plan_id = cp.id AND scope.region_id = $${params.length})`); }
    }
    if (role === ROLES.STOCKING_OWNER) {
      params.push(userId);
      conditions.push(`pd.stocking_owner_id = $${params.length}`);
      conditions.push(`cp.status IN ('DOMAIN_REVIEW', 'GTM_CLOSURE', 'EXPORTED')`);
    }
    if (![ROLES.GTM, ROLES.ADMIN].includes(role as ROLES)) conditions.push('cp.cancelled_at IS NULL');
    const countParams = [...params];
    const { rows: countRows } = options?.page ? await query<any>(`
      SELECT COUNT(*) as total FROM collection_plan cp
      JOIN product p ON p.id = cp.product_id
      JOIN product_domain pd ON pd.id = cp.domain_id
      ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''}
    `, countParams) : { rows: [{ total: 0 }] };
    const total = Number(countRows[0]?.total || 0);
    const sortExpressions: Record<string, string> = {
      createdAt: 'cp.created_at', deadline: 'cp.deadline_at', updatedAt: 'cp.updated_at',
      demand: `(SELECT COALESCE(SUM(item.quantity), 0) FROM collection_plan_domain_demand_item item JOIN collection_plan_domain_submission submission ON submission.id = item.submission_id JOIN collection_plan_domain_scope scope ON scope.id = submission.domain_scope_id JOIN collection_plan_domain_task task ON task.id = scope.domain_task_id WHERE task.plan_id = cp.id)`,
      progress: `(SELECT COUNT(*) FROM collection_plan_domain_submission submission JOIN collection_plan_domain_scope scope ON scope.id = submission.domain_scope_id JOIN collection_plan_domain_task task ON task.id = scope.domain_task_id WHERE task.plan_id = cp.id AND submission.status = 'SUBMITTED')`,
    };
    const sortExpression = sortExpressions[options?.sortBy || 'updatedAt'];
    const sortOrder = options?.sortOrder === 'asc' ? 'ASC' : 'DESC';
    let pageClause = '';
    if (options?.page) {
      const pageSize = Math.min(100, Math.max(1, Number(options.pageSize) || 20));
      const page = Math.max(1, Number(options.page));
      params.push(pageSize, (page - 1) * pageSize);
      pageClause = `LIMIT $${params.length - 1} OFFSET $${params.length}`;
    }
    const { rows: plans } = await query<any>(`
      SELECT cp.*, p.name as product_name, pd.name as domain_name, pd.gtm_owner_id,
        gtm.display_name as gtm_name, stocking.display_name as stocking_owner_name,
        (SELECT COUNT(*) FROM product_sku sku WHERE sku.product_id = p.id AND sku.enabled = true) as sku_count,
        (SELECT COUNT(*) FROM production_export export_record WHERE export_record.plan_id = cp.id) as export_count,
        (SELECT COUNT(*) FROM collection_plan_region_change_request change_request
          JOIN collection_plan_domain_submission change_submission ON change_submission.id = change_request.submission_id
          JOIN collection_plan_domain_scope change_scope ON change_scope.id = change_submission.domain_scope_id
          JOIN collection_plan_domain_task change_task ON change_task.id = change_scope.domain_task_id
          WHERE change_task.plan_id = cp.id AND change_request.status = 'PENDING') as pending_change_count
      FROM collection_plan cp
      JOIN product p ON p.id = cp.product_id
      JOIN product_domain pd ON pd.id = cp.domain_id
      LEFT JOIN app_user gtm ON gtm.id = pd.gtm_owner_id
      LEFT JOIN app_user stocking ON stocking.id = pd.stocking_owner_id
      ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''}
      ORDER BY ${sortExpression} ${sortOrder}, cp.created_at DESC
      ${pageClause}
    `, params);

    const results: CollectionPlan[] = [];
    for (const plan of plans) {
      const taskParams: any[] = [plan.id];
      let taskWhere = 'task.plan_id = $1';
      if (role === ROLES.MSS_DOMAIN_OWNER) {
        taskParams.push(userId);
        taskWhere += ` AND EXISTS (SELECT 1 FROM user_scope_assignment usa WHERE usa.user_id = $${taskParams.length} AND usa.scope_type = 'MSS_DOMAIN' AND usa.scope_id = task.mss_domain_id)`;
      }
      if (role === ROLES.REGIONAL_OWNER) {
        taskParams.push(userId);
        taskWhere += ` AND EXISTS (SELECT 1 FROM user_scope_assignment usa WHERE usa.user_id = $${taskParams.length} AND usa.scope_type = 'MSS_DOMAIN' AND usa.scope_id = task.mss_domain_id)`;
        taskWhere += ` AND EXISTS (SELECT 1 FROM collection_plan_domain_scope scope JOIN org_node region ON region.id = scope.region_id WHERE scope.domain_task_id = task.id AND (region.owner_id = $${taskParams.length} OR EXISTS (SELECT 1 FROM org_node office WHERE office.parent_id = region.id AND office.owner_id = $${taskParams.length})))`;
      }
      const { rows: tasks } = await query<any>(`
        SELECT task.*, md.name as mss_domain_name, owner.display_name as owner_name,
          (SELECT COUNT(*) FROM collection_plan_domain_scope scope WHERE scope.domain_task_id = task.id) as total_regions,
          (SELECT COUNT(*) FROM collection_plan_domain_submission submission JOIN collection_plan_domain_scope scope ON scope.id = submission.domain_scope_id WHERE scope.domain_task_id = task.id AND submission.status = 'SUBMITTED') as submitted_regions,
          (SELECT COALESCE(SUM(item.quantity), 0) FROM collection_plan_domain_demand_item item JOIN collection_plan_domain_submission submission ON submission.id = item.submission_id JOIN collection_plan_domain_scope scope ON scope.id = submission.domain_scope_id WHERE scope.domain_task_id = task.id) as draft_total
        FROM collection_plan_domain_task task
        JOIN mss_domain md ON md.id = task.mss_domain_id
        LEFT JOIN app_user owner ON owner.id = md.mss_owner_id
        WHERE ${taskWhere}
        ORDER BY md.name
      `, taskParams);
      const { rows: productSkuRows } = await query<any>(`
        SELECT id, model, bom_code, description
        FROM product_sku
        WHERE product_id = $1 AND enabled = true
        ORDER BY created_at, id
      `, [plan.product_id]);
      const taskViews: any[] = [];
      for (const task of tasks) {
        const { rows: skuRows } = await query<any>('SELECT product_sku_id FROM collection_plan_domain_task_sku WHERE domain_task_id = $1 ORDER BY product_sku_id', [task.id]);
        const { rows: progressRows } = await query<any>(`
          SELECT scope.region_id, scope.region_name_snapshot, scope.region_owner_snapshot, scope.office_country_snapshot,
            submission.status, submission.submitted_at, submission.version as submission_version,
            submission.revision_no, submission.change_pending, submission.reopen_reason, submission.reopen_type,
            EXISTS(SELECT 1 FROM org_node region_owner WHERE region_owner.id = scope.region_id AND region_owner.owner_id = $2) as can_request_change,
            (SELECT change_request.id FROM collection_plan_region_change_request change_request
              WHERE change_request.submission_id = submission.id ORDER BY change_request.requested_at DESC LIMIT 1) as change_request_id,
            (SELECT change_request.request_type FROM collection_plan_region_change_request change_request
              WHERE change_request.submission_id = submission.id ORDER BY change_request.requested_at DESC LIMIT 1) as change_request_type,
            (SELECT change_request.status FROM collection_plan_region_change_request change_request
              WHERE change_request.submission_id = submission.id ORDER BY change_request.requested_at DESC LIMIT 1) as change_request_status,
            (SELECT change_request.reason FROM collection_plan_region_change_request change_request
              WHERE change_request.submission_id = submission.id ORDER BY change_request.requested_at DESC LIMIT 1) as change_request_reason,
            (SELECT change_request.requested_at FROM collection_plan_region_change_request change_request
              WHERE change_request.submission_id = submission.id ORDER BY change_request.requested_at DESC LIMIT 1) as change_requested_at,
            (SELECT change_request.requested_by FROM collection_plan_region_change_request change_request
              WHERE change_request.submission_id = submission.id ORDER BY change_request.requested_at DESC LIMIT 1) as change_requested_by,
            (SELECT change_request.version FROM collection_plan_region_change_request change_request
              WHERE change_request.submission_id = submission.id ORDER BY change_request.requested_at DESC LIMIT 1) as change_request_version,
            COALESCE((SELECT SUM(item.quantity) FROM collection_plan_domain_demand_item item WHERE item.submission_id = submission.id), 0) as demand
          FROM collection_plan_domain_scope scope
          LEFT JOIN collection_plan_domain_submission submission ON submission.domain_scope_id = scope.id
          WHERE scope.domain_task_id = $1 ORDER BY scope.region_name_snapshot
        `, [task.id, userId]);
        let visibleProgress = progressRows;
        if (role === ROLES.REGIONAL_OWNER) {
          const { rows: allowed } = await query<any>(`
            SELECT region.id FROM org_node region WHERE region.node_type = 'REGION' AND
              (region.owner_id = $1 OR EXISTS (SELECT 1 FROM org_node office WHERE office.parent_id = region.id AND office.owner_id = $1))
          `, [userId]);
          const allowedIds = new Set(allowed.map((item) => item.id));
          visibleProgress = progressRows.filter((item) => allowedIds.has(item.region_id));
        }
        const { rows: feedbackRows } = await query<any>(`
          SELECT feedback.*, confirmer.display_name as confirmer_name FROM collection_plan_domain_feedback feedback
          JOIN app_user confirmer ON confirmer.id = feedback.confirmed_by WHERE feedback.domain_task_id = $1
        `, [task.id]);
        const feedback = feedbackRows[0];
        let feedbackItems = feedback ? (parseJson(feedback.summary_snapshot).items || []) : [];
        if (role === ROLES.REGIONAL_OWNER && feedbackItems.length) {
          const { rows: visibleOrganizations } = await query<any>(`
            SELECT region.id as region_id, region.owner_id as region_owner_id,
              office.id as office_id, office.owner_id as office_owner_id
            FROM org_node region
            LEFT JOIN org_node office ON office.parent_id = region.id AND office.node_type = 'OFFICE'
            WHERE region.node_type = 'REGION'
              AND (region.owner_id = $1 OR office.owner_id = $1)
          `, [userId]);
          feedbackItems = feedbackItems.filter((item: any) => visibleOrganizations.some((scope: any) =>
            scope.region_id === item.region_id
              && (scope.region_owner_id === userId || scope.office_id === item.office_id)
          ));
        }
        taskViews.push({
          ...task,
          selectedSkuIds: skuRows.map((item) => item.product_sku_id),
          progress: visibleProgress,
          feedback: feedback ? { note: feedback.note, totalQuantity: feedbackItems.reduce((sum: number, item: any) => sum + Number(item.quantity || 0), 0), confirmedBy: feedback.confirmer_name, confirmedAt: feedback.confirmed_at, items: feedbackItems } : null,
        });
      }

      const activeTaskViews = [ROLES.MSS_DOMAIN_OWNER, ROLES.REGIONAL_OWNER].includes(role as ROLES) ? taskViews : [null];
      for (const activeTask of activeTaskViews) {
        const includedTasks = activeTask ? [activeTask] : taskViews;
        const progress = includedTasks.flatMap((task) => (task.progress || []).map((item: any) => {
          const snapshot = parseJson(item.office_country_snapshot);
          return {
            domainTaskId: task.id,
            mssDomainId: task.mss_domain_id,
            mssDomainName: task.mss_domain_name,
            regionId: item.region_id,
            regionName: item.region_name_snapshot,
            owner: item.region_owner_snapshot || '待配置',
            officeCount: (snapshot.offices || []).length,
            countryCount: (snapshot.offices || []).reduce((sum: number, office: any) => sum + (office.countries?.length || 0), 0),
            status: item.status || 'NOT_STARTED',
            demand: Number(item.demand) || 0,
            submittedAt: item.submitted_at,
            version: Number(item.submission_version || 0),
            revisionNo: Number(item.revision_no || 0),
            changePending: Boolean(item.change_pending),
            canRequestChange: role === ROLES.REGIONAL_OWNER && Boolean(item.can_request_change),
            reopenReason: item.reopen_reason || undefined,
            reopenType: item.reopen_type || undefined,
            changeRequest: item.change_request_id ? {
              id: item.change_request_id,
              type: item.change_request_type,
              status: item.change_request_status,
              reason: item.change_request_reason,
              requestedAt: item.change_requested_at,
              requestedBy: item.change_requested_by,
              version: Number(item.change_request_version || 0),
            } : undefined,
          };
        }));
        const feedbacks = includedTasks.map((task) => task.feedback).filter(Boolean);
        const aggregateFeedback = feedbacks.length ? {
          note: feedbacks.map((feedback) => feedback.note).join('；'),
          totalQuantity: feedbacks.reduce((sum, feedback) => sum + Number(feedback.totalQuantity || 0), 0),
          confirmedBy: feedbacks.map((feedback) => feedback.confirmedBy).join('、'),
          confirmedAt: feedbacks.map((feedback) => feedback.confirmedAt).sort().at(-1),
          items: feedbacks.flatMap((feedback) => feedback.items || []),
        } : null;
        results.push({
          id: plan.id,
          viewId: activeTask?.id || plan.id,
          planNo: plan.plan_no,
          productId: plan.product_id,
          domainId: plan.domain_id,
          mssDomainId: activeTask?.mss_domain_id,
          domainTaskId: activeTask?.id,
          taskStatus: activeTask?.status,
          taskVersion: activeTask ? Number(activeTask.version) : undefined,
          selectedSkuIds: activeTask?.selectedSkuIds || [],
          stage: plan.sample_stage,
          status: plan.status,
          deadline: plan.deadline_at,
          note: plan.note,
          demandTotal: activeTask ? Number(activeTask.draft_total || 0) : includedTasks.reduce((sum, task) => sum + Number(task.draft_total || 0), 0),
          createdBy: plan.created_by,
          createdAt: plan.created_at,
          releasedBy: plan.released_by,
          releasedAt: plan.released_at,
          version: Number(plan.version),
          cancelledAt: plan.cancelled_at || undefined,
          archivedAt: plan.archived_at || undefined,
          product: {
            id: plan.product_id,
            name: plan.product_name,
            domain: plan.domain_name,
            gtm: plan.gtm_name || '待配置',
            stockingOwner: plan.stocking_owner_name || '待配置',
            skuCount: Number(plan.sku_count || 0),
            skus: productSkuRows.map((sku) => ({
              id: sku.id,
              model: sku.model,
              bomCode: sku.bom_code || '',
              description: sku.description || '',
            })),
          },
          mssDomain: activeTask ? { id: activeTask.mss_domain_id, name: activeTask.mss_domain_name, owner: activeTask.owner_name || '待配置' } : undefined,
          domainTasks: taskViews.map((task) => ({ id: task.id, mssDomainId: task.mss_domain_id, mssDomainName: task.mss_domain_name, owner: task.owner_name || '待配置', status: task.status, selectedSkuIds: task.selectedSkuIds, regionIds: task.progress.map((item: any) => item.region_id), totalRegions: Number(task.total_regions || 0), submittedRegions: Number(task.submitted_regions || 0), demandTotal: Number(task.draft_total || 0), version: Number(task.version) })),
          submittedRegions: progress.filter((item) => item.status === 'SUBMITTED').map((item) => item.regionId),
          submittedRegionCount: progress.filter((item) => item.status === 'SUBMITTED').length,
          totalRegions: progress.length,
          regionProgress: progress,
          feedback: activeTask?.feedback || aggregateFeedback,
          draftDemandTotal: includedTasks.reduce((sum, task) => sum + Number(task.draft_total || 0), 0),
          exportCount: Number(plan.export_count || 0),
          pendingChangeCount: activeTask ? progress.filter((item) => item.changePending).length : Number(plan.pending_change_count || 0),
        });
      }
    }
    return options?.page ? { items: results, total } : results;
  },

  async getPlan(planId: string, role: string = ROLES.ADMIN, userId = '', domainTaskId?: string): Promise<CollectionPlan | null> {
    const plans = await this.listPlans(role, userId) as CollectionPlan[];
    return plans.find((plan) => plan.id === planId && (!domainTaskId || plan.domainTaskId === domainTaskId || plan.domainTasks.some((task) => task.id === domainTaskId))) || null;
  },

  async createPlan(input: CreatePlanInput, userId: string, role: string): Promise<CollectionPlan> {
    const client = await getClient();
    try {
      await client.begin();
      const { rows: products } = await client.query<any>(`
        SELECT product.*, domain.gtm_owner_id FROM product product JOIN product_domain domain ON domain.id = product.domain_id
        WHERE product.id = $1 AND product.enabled = true
      `, [input.productId]);
      if (!products.length) throw new NotFoundError('产品不存在或已停用');
      if (role !== ROLES.ADMIN && products[0].gtm_owner_id !== userId) throw new ForbiddenError('只能为自己负责品类的产品创建收集计划');
      const { rows: duplicates } = await client.query(
        "SELECT id FROM collection_plan WHERE product_id = $1 AND sample_stage = $2 AND status NOT IN ('EXPORTED', 'PRODUCT_DRAFT')",
        [input.productId, input.stage]
      );
      if (duplicates.length) throw new ValidationError('该产品与样机阶段已有进行中的GTM收集计划，请勿重复创建');
      const planId = crypto.randomUUID();
      const planNo = `PLAN-${new Date().getFullYear()}${String(new Date().getMonth() + 1).padStart(2, '0')}-${String(Math.floor(Math.random() * 10000)).padStart(4, '0')}`;
      await client.query(`
        INSERT INTO collection_plan (id, plan_no, product_id, domain_id, mss_domain_id, sample_stage, status, deadline_at, note, created_by)
        VALUES ($1, $2, $3, $4, NULL, $5, $6, $7, $8, $9)
      `, [planId, planNo, input.productId, products[0].domain_id, input.stage, PLAN_STATUS.READY_TO_RELEASE, input.deadline, input.note || '', userId]);
      await writeAudit(client, userId, 'PLAN_CREATED', 'COLLECTION_PLAN', planId, null, { productId: input.productId, stage: input.stage });
      await client.commit();
      return (await this.getPlan(planId, role, userId))!;
    } catch (error) { await client.rollback(); throw error; } finally { client.release(); }
  },

  async deletePlan(planId: string, userId: string, role: string): Promise<void> {
    const client = await getClient();
    try {
      await client.begin();
      const { rows } = await client.query<any>(`SELECT cp.*, pd.gtm_owner_id FROM collection_plan cp JOIN product_domain pd ON pd.id = cp.domain_id WHERE cp.id = $1`, [planId]);
      if (!rows.length) throw new NotFoundError('收集计划不存在');
      const plan = rows[0];
      if (role !== ROLES.ADMIN && plan.gtm_owner_id !== userId) throw new ForbiddenError('只能删除自己负责品类的计划');
      const { rows: taskRows } = await client.query<any>('SELECT COUNT(*) as count FROM collection_plan_domain_task WHERE plan_id = $1', [planId]);
      if (plan.status !== PLAN_STATUS.READY_TO_RELEASE || Number(taskRows[0]?.count || 0) > 0) throw new PlanStateConflictError('仅尚未下发且没有领域任务的计划可以删除');
      await writeAudit(client, userId, 'PLAN_DELETED', 'COLLECTION_PLAN', planId, { planNo: plan.plan_no, status: plan.status }, null);
      await client.query('DELETE FROM collection_plan WHERE id = $1', [planId]);
      await client.commit();
    } catch (error) { await client.rollback(); throw error; } finally { client.release(); }
  },

  async cancelPlan(planId: string, userId: string, role: string): Promise<CollectionPlan> {
    const client = await getClient();
    try {
      await client.begin();
      const { rows } = await client.query<any>(`SELECT cp.*, pd.gtm_owner_id FROM collection_plan cp JOIN product_domain pd ON pd.id = cp.domain_id WHERE cp.id = $1`, [planId]);
      if (!rows.length) throw new NotFoundError('收集计划不存在');
      const plan = rows[0];
      if (role !== ROLES.ADMIN && plan.gtm_owner_id !== userId) throw new ForbiddenError('只能取消自己负责品类的计划');
      if (plan.archived_at) throw new PlanStateConflictError('已归档计划不能取消');
      if (plan.cancelled_at) throw new PlanStateConflictError('计划已经取消');
      if (plan.status === PLAN_STATUS.READY_TO_RELEASE) throw new PlanStateConflictError('未下发计划请直接删除');
      const { rows: started } = await client.query<any>(`
        SELECT submission.id FROM collection_plan_domain_submission submission
        JOIN collection_plan_domain_scope scope ON scope.id = submission.domain_scope_id
        JOIN collection_plan_domain_task task ON task.id = scope.domain_task_id
        WHERE task.plan_id = $1 AND submission.status <> 'NOT_STARTED' LIMIT 1
      `, [planId]);
      if (started.length) throw new PlanStateConflictError('已有区域开始填报，不能取消，请归档计划');
      await client.query('UPDATE collection_plan SET cancelled_at = NOW(), cancelled_by = $1, version = version + 1, updated_at = NOW() WHERE id = $2', [userId, planId]);
      await writeAudit(client, userId, 'PLAN_CANCELLED', 'COLLECTION_PLAN', planId, null, { cancelledAt: new Date().toISOString() });
      await client.commit();
      return (await this.getPlan(planId, role, userId))!;
    } catch (error) { await client.rollback(); throw error; } finally { client.release(); }
  },

  async archivePlan(planId: string, userId: string, role: string): Promise<{ id: string; archivedAt: string }> {
    const client = await getClient();
    try {
      await client.begin();
      const { rows } = await client.query<any>(`SELECT cp.*, pd.gtm_owner_id FROM collection_plan cp JOIN product_domain pd ON pd.id = cp.domain_id WHERE cp.id = $1`, [planId]);
      if (!rows.length) throw new NotFoundError('收集计划不存在');
      const plan = rows[0];
      if (role !== ROLES.ADMIN && plan.gtm_owner_id !== userId) throw new ForbiddenError('只能归档自己负责品类的计划');
      if (plan.archived_at) throw new PlanStateConflictError('计划已经归档');
      const archivedAt = new Date().toISOString();
      await client.query('UPDATE collection_plan SET archived_at = NOW(), archived_by = $1, version = version + 1, updated_at = NOW() WHERE id = $2', [userId, planId]);
      await writeAudit(client, userId, 'PLAN_ARCHIVED', 'COLLECTION_PLAN', planId, null, { archivedAt });
      await client.commit();
      return { id: planId, archivedAt };
    } catch (error) { await client.rollback(); throw error; } finally { client.release(); }
  },

  async releasePlan(planId: string, userId: string, role: string, version?: number): Promise<CollectionPlan> {
    const client = await getClient();
    try {
      await client.begin();
      const { rows } = await client.query<any>(`SELECT plan.*, domain.gtm_owner_id FROM collection_plan plan JOIN product_domain domain ON domain.id = plan.domain_id WHERE plan.id = $1`, [planId]);
      if (!rows.length) throw new NotFoundError('收集计划不存在');
      const plan = rows[0];
      if (plan.cancelled_at || plan.archived_at) throw new PlanStateConflictError('已取消或归档的计划不能下发');
      if (version !== undefined && Number(plan.version) !== Number(version)) throw new VersionConflictError();
      if (plan.status !== PLAN_STATUS.READY_TO_RELEASE) throw new PlanStateConflictError('仅待下发状态的计划可以下发');
      if (role !== ROLES.ADMIN && plan.gtm_owner_id !== userId) throw new ForbiddenError('只能下发自己负责品类的收集计划');
      const { rows: domains } = await client.query<any>('SELECT id FROM mss_domain WHERE enabled = true ORDER BY name');
      if (!domains.length) throw new ValidationError('当前没有启用的MSS业务领域');
      for (const domain of domains) {
        await client.query(`INSERT INTO collection_plan_domain_task (id, plan_id, mss_domain_id) VALUES ($1, $2, $3)`, [crypto.randomUUID(), planId, domain.id]);
      }
      await client.query('UPDATE collection_plan SET status = $1, released_by = $2, released_at = NOW(), version = version + 1, updated_at = NOW() WHERE id = $3', [PLAN_STATUS.COLLECTING, userId, planId]);
      await writeAudit(client, userId, 'PLAN_RELEASED_TO_ALL_DOMAINS', 'COLLECTION_PLAN', planId, { status: plan.status }, { status: PLAN_STATUS.COLLECTING, domainCount: domains.length });
      await client.commit();
      return (await this.getPlan(planId, role, userId))!;
    } catch (error) { await client.rollback(); throw error; } finally { client.release(); }
  },

  async dispatchDomainTask(taskId: string, input: DomainDispatchInput, userId: string, role: string): Promise<CollectionPlan> {
    const client = await getClient();
    try {
      await client.begin();
      const { rows } = await client.query<any>(`
        SELECT task.*, plan.product_id, plan.id as plan_id, plan.cancelled_at, plan.archived_at, md.mss_owner_id,
          EXISTS(SELECT 1 FROM user_scope_assignment usa WHERE usa.user_id = $2 AND usa.scope_type = 'MSS_DOMAIN' AND usa.scope_id = task.mss_domain_id) as mss_scope_owned
        FROM collection_plan_domain_task task JOIN collection_plan plan ON plan.id = task.plan_id
        JOIN mss_domain md ON md.id = task.mss_domain_id WHERE task.id = $1
      `, [taskId, userId]);
      if (!rows.length) throw new NotFoundError('领域任务不存在');
      const task = rows[0];
      if (task.cancelled_at || task.archived_at) throw new PlanStateConflictError('已取消或归档的计划不能继续下发');
      if (role !== ROLES.ADMIN && !Boolean(task.mss_scope_owned)) throw new ForbiddenError('只能下发自己负责MSS领域的任务');
      if (input.version !== undefined && Number(task.version) !== Number(input.version)) throw new VersionConflictError();
      if (!['PENDING_DISPATCH', 'COLLECTING'].includes(task.status)) throw new PlanStateConflictError('当前领域任务状态不允许重新下发');
      const { rows: started } = await client.query<any>(`
        SELECT submission.id FROM collection_plan_domain_submission submission
        JOIN collection_plan_domain_scope scope ON scope.id = submission.domain_scope_id
        WHERE scope.domain_task_id = $1 AND submission.status <> 'NOT_STARTED' LIMIT 1
      `, [taskId]);
      if (started.length) throw new PlanStateConflictError('已有区域开始填报，不能修改下发范围');
      const uniqueSkuIds = [...new Set(input.productSkuIds)];
      const { rows: productSkus } = await client.query<any>('SELECT id FROM product_sku WHERE product_id = $1 AND enabled = true', [task.product_id]);
      if (productSkus.length && !uniqueSkuIds.length) throw new ValidationError('请至少选择一个产品型号');
      const validSkuIds = new Set(productSkus.map((sku) => sku.id));
      if (uniqueSkuIds.some((id) => !validSkuIds.has(id))) throw new ValidationError('部分产品型号不存在、已停用或不属于当前产品');
      const uniqueRegionIds = [...new Set(input.regionIds)];
      const placeholders = uniqueRegionIds.map((_, index) => `$${index + 1}`).join(',');
      const { rows: regions } = await client.query<any>(`
        SELECT region.*, owner.display_name as owner_name FROM org_node region
        LEFT JOIN app_user owner ON owner.id = region.owner_id
        WHERE region.id IN (${placeholders}) AND region.node_type = 'REGION' AND region.enabled = true
      `, uniqueRegionIds);
      if (regions.length !== uniqueRegionIds.length) throw new ValidationError('部分区域不存在或已停用');
      await client.query('DELETE FROM collection_plan_domain_task_sku WHERE domain_task_id = $1', [taskId]);
      await client.query('DELETE FROM collection_plan_domain_scope WHERE domain_task_id = $1', [taskId]);
      for (const skuId of uniqueSkuIds) await client.query('INSERT INTO collection_plan_domain_task_sku (domain_task_id, product_sku_id) VALUES ($1, $2)', [taskId, skuId]);
      for (const region of regions) {
        const scopeId = crypto.randomUUID();
        await client.query(`
          INSERT INTO collection_plan_domain_scope (id, domain_task_id, region_id, region_name_snapshot, region_owner_snapshot, office_country_snapshot)
          VALUES ($1, $2, $3, $4, $5, $6)
        `, [scopeId, taskId, region.id, region.name, region.owner_name, await buildRegionSnapshot(client, region)]);
        await client.query('INSERT INTO collection_plan_domain_submission (id, domain_scope_id) VALUES ($1, $2)', [crypto.randomUUID(), scopeId]);
      }
      await client.query("UPDATE collection_plan_domain_task SET status = 'COLLECTING', dispatched_by = $1, dispatched_at = NOW(), version = version + 1, updated_at = NOW() WHERE id = $2", [userId, taskId]);
      await client.query('UPDATE collection_plan SET version = version + 1, updated_at = NOW() WHERE id = $1', [task.plan_id]);
      await writeAudit(client, userId, 'DOMAIN_TASK_DISPATCHED', 'COLLECTION_PLAN_DOMAIN_TASK', taskId, null, { productSkuIds: uniqueSkuIds, regionIds: uniqueRegionIds });
      await client.commit();
      return (await this.getPlan(task.plan_id, role, userId, taskId))!;
    } catch (error) { await client.rollback(); throw error; } finally { client.release(); }
  },

  async saveDraft(planId: string, regionId: string, domainTaskId: string | undefined, input: DraftSaveInput, userId: string, role: string): Promise<DemandDraft> {
    const client = await getClient();
    try {
      await client.begin();
      const scope = await getTaskScope(client, planId, regionId, domainTaskId, userId, role);
      assertScopeActor(scope, role, userId);
      if (scope.task_status !== 'COLLECTING') throw new PlanStateConflictError('当前领域任务状态不允许编辑需求');
      const { rows } = await client.query<any>('SELECT * FROM collection_plan_domain_submission WHERE domain_scope_id = $1', [scope.id]);
      const submission = rows[0];
      if (input.version !== undefined && Number(submission.version) !== Number(input.version)) throw new VersionConflictError();
      if (submission.status === 'SUBMITTED') throw new PlanStateConflictError('已提交的需求不能直接修改，请联系领域负责人退回后编辑');
      for (const item of input.items) if (item.quantity > 0 && !item.basis?.trim()) throw new ValidationError('数量大于0的需求项必须填写需求依据');
      const { rows: skus } = await client.query<any>('SELECT id FROM product_sku WHERE product_id = $1', [scope.product_id]);
      const skuIds = new Set(skus.map((sku) => sku.id));
      const { rows: selectedSkus } = await client.query<any>('SELECT product_sku_id FROM collection_plan_domain_task_sku WHERE domain_task_id = $1', [scope.domain_task_id]);
      const selectedSkuIds = new Set(selectedSkus.map((sku) => sku.product_sku_id));
      if (input.items.some((item) => skuIds.has(item.productItemKey) && !selectedSkuIds.has(item.productItemKey))) throw new ValidationError('需求项包含本领域任务未下发的产品型号');
      const { rows: offices } = await client.query<any>("SELECT id FROM org_node WHERE parent_id = $1 AND node_type = 'OFFICE' AND enabled = true", [regionId]);
      const validOfficeIds = new Set(offices.map((office) => office.id));
      if (input.items.some((item) => !item.officeId || !validOfficeIds.has(item.officeId))) throw new ValidationError('每条需求必须归属当前区域下的有效代表处');
      const officeOnlyActor = role === ROLES.REGIONAL_OWNER && scope.region_owner_id !== userId;
      let ownedOfficeIds: string[] = [];
      if (officeOnlyActor) {
        const { rows: owned } = await client.query<any>("SELECT id FROM org_node WHERE parent_id = $1 AND node_type = 'OFFICE' AND owner_id = $2 AND enabled = true", [regionId, userId]);
        ownedOfficeIds = owned.map((office) => office.id);
        const allowed = new Set(ownedOfficeIds);
        if (input.items.some((item) => !item.officeId || !allowed.has(item.officeId))) throw new ForbiddenError('代表处接口人只能保存自己负责代表处的需求');
      }
      if (officeOnlyActor && ownedOfficeIds.length) {
        const officePlaceholders = ownedOfficeIds.map((_, index) => `$${index + 2}`).join(',');
        await client.query(`DELETE FROM collection_plan_domain_demand_item WHERE submission_id = $1 AND office_id IN (${officePlaceholders})`, [submission.id, ...ownedOfficeIds]);
      } else {
        await client.query('DELETE FROM collection_plan_domain_demand_item WHERE submission_id = $1', [submission.id]);
      }
      for (const item of input.items) {
        const isSku = skuIds.has(item.productItemKey);
        await client.query(`
          INSERT INTO collection_plan_domain_demand_item (id, submission_id, product_sku_id, provisional_item_key, office_id, quantity, demand_basis, planned_use_date, note)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        `, [crypto.randomUUID(), submission.id, isSku ? item.productItemKey : null, isSku ? null : item.productItemKey, item.officeId, item.quantity, item.basis || null, item.plannedUseDate || null, item.note || null]);
      }
      const { rows: updated } = await client.query<any>(`
        UPDATE collection_plan_domain_submission SET status = 'DRAFT', saved_by = $1, saved_at = NOW(), version = version + 1, updated_at = NOW()
        WHERE id = $2 RETURNING *
      `, [userId, submission.id]);
      await writeAudit(client, userId, 'DOMAIN_DEMAND_DRAFT_SAVED', 'COLLECTION_PLAN_DOMAIN_SUBMISSION', submission.id, { version: submission.version }, { version: updated[0].version });
      await client.commit();
      return (await this.getDraft(planId, regionId, userId, role, scope.domain_task_id))!;
    } catch (error) { await client.rollback(); throw error; } finally { client.release(); }
  },

  async submitRegion(planId: string, regionId: string, domainTaskId: string | undefined, userId: string, role: string, version?: number): Promise<CollectionPlan> {
    const client = await getClient();
    try {
      await client.begin();
      const scope = await getTaskScope(client, planId, regionId, domainTaskId, userId, role);
      assertScopeActor(scope, role, userId);
      if (role === ROLES.REGIONAL_OWNER && scope.region_owner_id !== userId) throw new ForbiddenError('代表处接口人可保存本代表处需求，区域提交由区域接口人完成');
      if (scope.task_status !== 'COLLECTING') throw new PlanStateConflictError('当前领域任务状态不允许提交需求');
      const { rows } = await client.query<any>('SELECT * FROM collection_plan_domain_submission WHERE domain_scope_id = $1', [scope.id]);
      const submission = rows[0];
      if (version !== undefined && Number(submission.version) !== Number(version)) throw new VersionConflictError();
      if (submission.status !== 'DRAFT') throw new ValidationError('请先保存需求草稿再提交');
      const revisionNo = Number(submission.revision_no || 0) + 1;
      await client.query(`
        UPDATE collection_plan_domain_submission
        SET status = 'SUBMITTED', submitted_by = $1, submitted_at = NOW(), revision_no = $2,
          change_pending = false, version = version + 1, updated_at = NOW()
        WHERE id = $3
      `, [userId, revisionNo, submission.id]);
      const snapshot = await buildSubmissionSnapshot(client, submission.id);
      const { rows: latestChanges } = await client.query<any>(`
        SELECT id FROM collection_plan_region_change_request
        WHERE submission_id = $1 AND status IN ('APPROVED', 'APPLIED')
        ORDER BY decided_at DESC, requested_at DESC LIMIT 1
      `, [submission.id]);
      await client.query(`
        INSERT INTO collection_plan_domain_submission_revision (
          id, submission_id, revision_no, data_snapshot, submitted_by, submitted_at, change_request_id
        ) VALUES ($1, $2, $3, $4, $5, NOW(), $6)
        ON CONFLICT(submission_id, revision_no) DO UPDATE SET
          data_snapshot = $4, submitted_by = $5, submitted_at = NOW(), change_request_id = $6
      `, [crypto.randomUUID(), submission.id, revisionNo, JSON.stringify(snapshot), userId, latestChanges[0]?.id || null]);
      const { rows: counts } = await client.query<any>(`
        SELECT COUNT(*) as total, SUM(CASE WHEN submission.status = 'SUBMITTED' THEN 1 ELSE 0 END) as submitted
        FROM collection_plan_domain_scope scope JOIN collection_plan_domain_submission submission ON submission.domain_scope_id = scope.id
        WHERE scope.domain_task_id = $1
      `, [scope.domain_task_id]);
      if (Number(counts[0].total) === Number(counts[0].submitted)) {
        await client.query("UPDATE collection_plan_domain_task SET status = 'READY_TO_FEEDBACK', version = version + 1, updated_at = NOW() WHERE id = $1", [scope.domain_task_id]);
      } else {
        await client.query('UPDATE collection_plan_domain_task SET version = version + 1, updated_at = NOW() WHERE id = $1', [scope.domain_task_id]);
      }
      await refreshParentPlan(client, planId);
      await writeAudit(client, userId, 'DOMAIN_REGION_DEMAND_SUBMITTED', 'COLLECTION_PLAN_DOMAIN_SUBMISSION', submission.id, { status: submission.status, revisionNo: submission.revision_no }, { status: 'SUBMITTED', revisionNo });
      await client.commit();
      return (await this.getPlan(planId, role, userId, scope.domain_task_id))!;
    } catch (error) { await client.rollback(); throw error; } finally { client.release(); }
  },

  async requestRegionChange(planId: string, regionId: string, domainTaskId: string | undefined, input: RegionChangeRequestInput, userId: string, role: string) {
    const client = await getClient();
    try {
      await client.begin();
      const scope = await getTaskScope(client, planId, regionId, domainTaskId, userId, role);
      if (role !== ROLES.REGIONAL_OWNER || scope.region_owner_id !== userId) throw new ForbiddenError('仅区域接口人可撤回或申请修改区域提交');
      const { rows } = await client.query<any>('SELECT * FROM collection_plan_domain_submission WHERE domain_scope_id = $1', [scope.id]);
      const submission = rows[0];
      if (!submission || submission.status !== 'SUBMITTED') throw new PlanStateConflictError('仅已提交的区域需求可以撤回或申请修改');
      if (input.version !== undefined && Number(submission.version) !== Number(input.version)) throw new VersionConflictError();
      const { rows: pending } = await client.query<any>("SELECT id FROM collection_plan_region_change_request WHERE submission_id = $1 AND status = 'PENDING'", [submission.id]);
      if (pending.length) throw new PlanStateConflictError('该区域已有待审批的变更申请，请勿重复提交');

      const now = Date.now();
      const beforeDeadline = Number.isFinite(new Date(scope.deadline_at).getTime()) && new Date(scope.deadline_at).getTime() >= now;
      const directWithdraw = beforeDeadline && scope.plan_status !== PLAN_STATUS.EXPORTED && scope.task_status !== 'FEEDBACK_SUBMITTED';
      const requestType = directWithdraw
        ? 'SELF_WITHDRAW'
        : scope.plan_status === PLAN_STATUS.EXPORTED
          ? 'POST_EXPORT_CHANGE'
          : scope.task_status === 'FEEDBACK_SUBMITTED'
            ? 'CHANGE_REQUEST'
            : 'REOPEN_REQUEST';
      const requestId = crypto.randomUUID();
      const snapshot = await buildSubmissionSnapshot(client, submission.id);
      await client.query(`
        INSERT INTO collection_plan_region_change_request (
          id, submission_id, request_type, status, reason, source_submission_version, source_revision_no,
          source_plan_status, source_snapshot, requested_by, requested_at, decided_by, decided_at, decision_note
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW(), $11, $12, $13)
      `, [requestId, submission.id, requestType, directWithdraw ? 'APPLIED' : 'PENDING', input.reason,
        Number(submission.version), Number(submission.revision_no || 0), scope.plan_status, JSON.stringify(snapshot), userId,
        directWithdraw ? userId : null, directWithdraw ? new Date().toISOString() : null, directWithdraw ? '截止前区域自主撤回' : null]);

      let feedbackInvalidated = false;
      if (directWithdraw) {
        feedbackInvalidated = await reopenRegionSubmission(client, scope, submission, userId, input.reason, requestType, requestId);
      } else {
        await client.query('UPDATE collection_plan_domain_submission SET change_pending = true, version = version + 1, updated_at = NOW() WHERE id = $1', [submission.id]);
        await client.query('UPDATE collection_plan SET version = version + 1, updated_at = NOW() WHERE id = $1', [planId]);
      }
      await writeAudit(client, userId, directWithdraw ? 'REGION_SUBMISSION_SELF_WITHDRAWN' : 'REGION_CHANGE_REQUESTED', 'COLLECTION_PLAN_DOMAIN_SUBMISSION', submission.id,
        { status: 'SUBMITTED', revisionNo: submission.revision_no }, { requestId, requestType, reason: input.reason, directWithdraw, feedbackInvalidated });
      await client.commit();
      return {
        mode: directWithdraw ? 'REOPENED' : 'PENDING_APPROVAL',
        request: { id: requestId, type: requestType, status: directWithdraw ? 'APPLIED' : 'PENDING', reason: input.reason },
        plan: (await this.getPlan(planId, role, userId, scope.domain_task_id))!,
      };
    } catch (error) { await client.rollback(); throw error; } finally { client.release(); }
  },

  async decideRegionChange(requestId: string, input: RegionChangeDecisionInput, userId: string, role: string) {
    const client = await getClient();
    try {
      await client.begin();
      const { rows } = await client.query<any>(`
        SELECT change_request.*, submission.status as submission_status, submission.version as submission_version,
          submission.id as submission_id, scope.id as scope_id, scope.region_id, task.id as domain_task_id,
          task.plan_id, task.mss_domain_id, task.status as task_status, md.mss_owner_id,
          EXISTS(SELECT 1 FROM user_scope_assignment usa WHERE usa.user_id = $2 AND usa.scope_type = 'MSS_DOMAIN' AND usa.scope_id = task.mss_domain_id) as mss_scope_owned
        FROM collection_plan_region_change_request change_request
        JOIN collection_plan_domain_submission submission ON submission.id = change_request.submission_id
        JOIN collection_plan_domain_scope scope ON scope.id = submission.domain_scope_id
        JOIN collection_plan_domain_task task ON task.id = scope.domain_task_id
        JOIN mss_domain md ON md.id = task.mss_domain_id
        WHERE change_request.id = $1
      `, [requestId, userId]);
      if (!rows.length) throw new NotFoundError('变更申请不存在');
      const request = rows[0];
      if (role !== ROLES.ADMIN && (role !== ROLES.MSS_DOMAIN_OWNER || !Boolean(request.mss_scope_owned))) throw new ForbiddenError('仅本MSS领域接口人可审批该变更申请');
      if (request.status !== 'PENDING') throw new PlanStateConflictError('该变更申请已处理');
      if (input.version !== undefined && Number(request.version) !== Number(input.version)) throw new VersionConflictError();
      if (request.submission_status !== 'SUBMITTED') throw new PlanStateConflictError('区域提交状态已变化，请刷新后重试');

      let feedbackInvalidated = false;
      if (input.approved) {
        const scope = { id: request.scope_id, domain_task_id: request.domain_task_id, plan_id: request.plan_id };
        const submission = { id: request.submission_id };
        feedbackInvalidated = await reopenRegionSubmission(client, scope, submission, userId, request.reason, request.request_type, requestId);
      } else {
        await client.query('UPDATE collection_plan_domain_submission SET change_pending = false, version = version + 1, updated_at = NOW() WHERE id = $1', [request.submission_id]);
        await client.query('UPDATE collection_plan SET version = version + 1, updated_at = NOW() WHERE id = $1', [request.plan_id]);
      }
      await client.query(`
        UPDATE collection_plan_region_change_request
        SET status = $1, decided_by = $2, decided_at = NOW(), decision_note = $3, version = version + 1, updated_at = NOW()
        WHERE id = $4
      `, [input.approved ? 'APPROVED' : 'REJECTED', userId, input.note, requestId]);
      await writeAudit(client, userId, input.approved ? 'REGION_CHANGE_APPROVED' : 'REGION_CHANGE_REJECTED', 'COLLECTION_PLAN_REGION_CHANGE_REQUEST', requestId,
        { status: 'PENDING' }, { status: input.approved ? 'APPROVED' : 'REJECTED', note: input.note, feedbackInvalidated });
      await client.commit();
      return (await this.getPlan(request.plan_id, role, userId, request.domain_task_id))!;
    } catch (error) { await client.rollback(); throw error; } finally { client.release(); }
  },

  async returnRegion(planId: string, regionId: string, domainTaskId: string | undefined, reason: string, userId: string, role: string, version?: number): Promise<CollectionPlan> {
    const client = await getClient();
    try {
      await client.begin();
      const scope = await getTaskScope(client, planId, regionId, domainTaskId, userId, role);
      if (role !== ROLES.ADMIN && (role !== ROLES.MSS_DOMAIN_OWNER || !Boolean(scope.mss_scope_owned))) throw new ForbiddenError('仅本MSS领域接口人可退回区域需求');
      const { rows } = await client.query<any>('SELECT * FROM collection_plan_domain_submission WHERE domain_scope_id = $1', [scope.id]);
      const submission = rows[0];
      if (submission.status !== 'SUBMITTED') throw new PlanStateConflictError('仅已提交的区域需求可以退回');
      if (version !== undefined && Number(submission.version) !== Number(version)) throw new VersionConflictError();
      const { rows: pendingChanges } = await client.query<any>("SELECT id FROM collection_plan_region_change_request WHERE submission_id = $1 AND status = 'PENDING'", [submission.id]);
      if (pendingChanges.length) throw new PlanStateConflictError('该区域有待审批的变更申请，请在领域进度中通过或驳回');
      const requestId = crypto.randomUUID();
      const snapshot = await buildSubmissionSnapshot(client, submission.id);
      await client.query(`
        INSERT INTO collection_plan_region_change_request (
          id, submission_id, request_type, status, reason, source_submission_version, source_revision_no,
          source_plan_status, source_snapshot, requested_by, requested_at, decided_by, decided_at, decision_note
        ) VALUES ($1, $2, 'MSS_RETURN', 'APPLIED', $3, $4, $5, $6, $7, $8, NOW(), $8, NOW(), $3)
      `, [requestId, submission.id, reason, Number(submission.version), Number(submission.revision_no || 0), scope.plan_status, JSON.stringify(snapshot), userId]);
      const feedbackInvalidated = await reopenRegionSubmission(client, scope, submission, userId, reason, 'MSS_RETURN', requestId);
      await writeAudit(client, userId, 'DOMAIN_REGION_DEMAND_RETURNED', 'COLLECTION_PLAN_DOMAIN_SUBMISSION', submission.id, { status: 'SUBMITTED' }, { status: 'RETURNED', reason, requestId, feedbackInvalidated });
      await client.commit();
      return (await this.getPlan(planId, role, userId, scope.domain_task_id))!;
    } catch (error) { await client.rollback(); throw error; } finally { client.release(); }
  },

  async submitDomainFeedback(taskId: string, input: DomainFeedbackInput, userId: string, role: string): Promise<CollectionPlan> {
    const client = await getClient();
    try {
      await client.begin();
      const { rows } = await client.query<any>(`
        SELECT task.*, plan.product_id, plan.id as plan_id, plan.cancelled_at, plan.archived_at, md.mss_owner_id, md.name as mss_domain_name,
          EXISTS(SELECT 1 FROM user_scope_assignment usa WHERE usa.user_id = $2 AND usa.scope_type = 'MSS_DOMAIN' AND usa.scope_id = task.mss_domain_id) as mss_scope_owned
        FROM collection_plan_domain_task task JOIN collection_plan plan ON plan.id = task.plan_id
        JOIN mss_domain md ON md.id = task.mss_domain_id WHERE task.id = $1
      `, [taskId, userId]);
      if (!rows.length) throw new NotFoundError('领域任务不存在');
      const task = rows[0];
      if (task.cancelled_at || task.archived_at) throw new PlanStateConflictError('已取消或归档的计划不能反馈');
      if (role !== ROLES.ADMIN && !Boolean(task.mss_scope_owned)) throw new ForbiddenError('只能反馈自己负责MSS领域的任务');
      if (input.version !== undefined && Number(task.version) !== Number(input.version)) throw new VersionConflictError();
      if (task.status !== 'READY_TO_FEEDBACK') throw new PlanStateConflictError('仅区域已全部提交的领域任务可以反馈GTM');
      const { rows: pendingChanges } = await client.query<any>(`
        SELECT change_request.id FROM collection_plan_region_change_request change_request
        JOIN collection_plan_domain_submission submission ON submission.id = change_request.submission_id
        JOIN collection_plan_domain_scope scope ON scope.id = submission.domain_scope_id
        WHERE scope.domain_task_id = $1 AND change_request.status = 'PENDING' LIMIT 1
      `, [taskId]);
      if (pendingChanges.length) throw new PlanStateConflictError('仍有区域变更申请待审批，处理完成后才能反馈GTM');
      const { rows: snapshotRows } = await client.query<any>(`
        SELECT plan.product_id, item.product_sku_id, item.provisional_item_key, sku.model, sku.bom_code,
          task.mss_domain_id, md.name as mss_domain_name, region.id as region_id, region.name as region_name,
          item.office_id, office.name as office_name, item.quantity, item.demand_basis, item.planned_use_date, item.note
        FROM collection_plan_domain_demand_item item
        JOIN collection_plan_domain_submission submission ON submission.id = item.submission_id AND submission.status = 'SUBMITTED'
        JOIN collection_plan_domain_scope scope ON scope.id = submission.domain_scope_id
        JOIN collection_plan_domain_task task ON task.id = scope.domain_task_id
        JOIN collection_plan plan ON plan.id = task.plan_id
        JOIN mss_domain md ON md.id = task.mss_domain_id
        JOIN org_node region ON region.id = scope.region_id
        LEFT JOIN org_node office ON office.id = item.office_id
        LEFT JOIN product_sku sku ON sku.id = item.product_sku_id
        WHERE task.id = $1 ORDER BY region.name, sku.model, item.provisional_item_key
      `, [taskId]);
      const totalQuantity = snapshotRows.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
      await client.query(`
        INSERT INTO collection_plan_domain_feedback (id, domain_task_id, note, total_quantity, summary_snapshot, confirmed_by, confirmed_at)
        VALUES ($1, $2, $3, $4, $5, $6, NOW())
        ON CONFLICT(domain_task_id) DO UPDATE SET note = $3, total_quantity = $4, summary_snapshot = $5, confirmed_by = $6, confirmed_at = NOW(), version = collection_plan_domain_feedback.version + 1, updated_at = NOW()
      `, [crypto.randomUUID(), taskId, input.note, totalQuantity, JSON.stringify({ items: snapshotRows }), userId]);
      await client.query("DELETE FROM execution_fact WHERE source_type = 'CONFIRMED_DEMAND' AND source_id = $1", [taskId]);
      for (const item of snapshotRows) {
        await client.query(`
          INSERT INTO execution_fact (id, source_type, source_id, product_id, product_sku_id, mss_domain_id, region_id, office_id, quantity, occurred_at, dimension_snapshot)
          VALUES ($1, 'CONFIRMED_DEMAND', $2, $3, $4, $5, $6, $7, $8, NOW(), $9)
        `, [crypto.randomUUID(), taskId, item.product_id, item.product_sku_id, task.mss_domain_id, item.region_id, item.office_id, Number(item.quantity), JSON.stringify({ planId: task.plan_id, domainTaskId: taskId, mssDomainId: task.mss_domain_id })]);
      }
      await client.query("UPDATE collection_plan_domain_task SET status = 'FEEDBACK_SUBMITTED', version = version + 1, updated_at = NOW() WHERE id = $1", [taskId]);
      await refreshParentPlan(client, task.plan_id);
      await writeAudit(client, userId, 'DOMAIN_TASK_FEEDBACK_SUBMITTED', 'COLLECTION_PLAN_DOMAIN_TASK', taskId, { status: task.status }, { status: 'FEEDBACK_SUBMITTED', totalQuantity });
      await client.commit();
      return (await this.getPlan(task.plan_id, role, userId, taskId))!;
    } catch (error) { await client.rollback(); throw error; } finally { client.release(); }
  },

  async createExport(planId: string, userId: string, role: string) {
    const client = await getClient();
    try {
      await client.begin();
      const { rows } = await client.query<any>(`
        SELECT plan.*, product.name as product_name, domain.name as domain_name, domain.gtm_owner_id,
          gtm.display_name as gtm_name, stocking.display_name as stocking_owner_name
        FROM collection_plan plan JOIN product product ON product.id = plan.product_id
        JOIN product_domain domain ON domain.id = plan.domain_id
        LEFT JOIN app_user gtm ON gtm.id = domain.gtm_owner_id
        LEFT JOIN app_user stocking ON stocking.id = domain.stocking_owner_id WHERE plan.id = $1
      `, [planId]);
      if (!rows.length) throw new NotFoundError('收集计划不存在');
      const plan = rows[0];
      if (plan.cancelled_at || plan.archived_at) throw new PlanStateConflictError('已取消或归档的计划不能导出');
      if (role !== ROLES.ADMIN && plan.gtm_owner_id !== userId) throw new ForbiddenError('只能导出自己负责品类的收集计划');
      if (![PLAN_STATUS.GTM_CLOSURE, PLAN_STATUS.EXPORTED].includes(plan.status)) throw new PlanStateConflictError('全部领域反馈后才能导出排产需求');
      const { rows: pendingChanges } = await client.query<any>(`
        SELECT change_request.id FROM collection_plan_region_change_request change_request
        JOIN collection_plan_domain_submission submission ON submission.id = change_request.submission_id
        JOIN collection_plan_domain_scope scope ON scope.id = submission.domain_scope_id
        JOIN collection_plan_domain_task task ON task.id = scope.domain_task_id
        WHERE task.plan_id = $1 AND change_request.status = 'PENDING' LIMIT 1
      `, [planId]);
      if (pendingChanges.length) throw new PlanStateConflictError('仍有区域变更申请待审批，处理完成后才能导出排产需求');
      const { rows: feedbackRows } = await client.query<any>(`
        SELECT feedback.summary_snapshot, feedback.confirmed_at, md.name as mss_domain_name, owner.display_name as feedback_owner
        FROM collection_plan_domain_feedback feedback
        JOIN collection_plan_domain_task task ON task.id = feedback.domain_task_id
        JOIN mss_domain md ON md.id = task.mss_domain_id
        JOIN app_user owner ON owner.id = feedback.confirmed_by WHERE task.plan_id = $1
      `, [planId]);
      const { rows: exportCounts } = await client.query<any>('SELECT COUNT(*) as total FROM production_export WHERE plan_id = $1', [planId]);
      const exportVersion = Number(exportCounts[0]?.total || 0) + 1;
      const exportRows = feedbackRows.flatMap((feedback) => (parseJson(feedback.summary_snapshot).items || []).map((item: any) => ({
        '计划编号': plan.plan_no, '导出版本': `V${exportVersion}`, '产品': plan.product_name, '样机阶段': plan.sample_stage, '产品品类': plan.domain_name,
        'MSS业务领域': feedback.mss_domain_name, 'SKU/产品项': item.model || item.provisional_item_key || `${plan.product_name}（型号待补充）`,
        'BOM编码': item.bom_code || '待补充', 'MSS区域': item.region_name, '代表处': item.office_name || '待分配代表处',
        '国家/地区': '', '确认需求数量(Pcs)': Number(item.quantity), '需求依据': item.demand_basis || '',
        '计划使用时间': item.planned_use_date || '', '备注': item.note || '', 'GTM': plan.gtm_name,
        '备货接口人': plan.stocking_owner_name, '领域反馈人': feedback.feedback_owner, '反馈时间': feedback.confirmed_at,
      })));
      const exportId = crypto.randomUUID();
      const fileName = `${plan.plan_no}_${plan.product_id}_排产需求_V${exportVersion}_${new Date().toISOString().slice(0, 10)}.xlsx`;
      const workbook = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(exportRows), '排产需求');
      const contentBase64 = XLSX.write(workbook, { type: 'base64', bookType: 'xlsx' });
      await client.query(`INSERT INTO production_export (id, plan_id, plan_version, file_name, data_snapshot, row_count, exported_by, exported_at) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`, [exportId, planId, exportVersion, fileName, JSON.stringify(exportRows), exportRows.length, userId]);
      if (plan.status !== PLAN_STATUS.EXPORTED) await client.query('UPDATE collection_plan SET status = $1, version = version + 1, updated_at = NOW() WHERE id = $2', [PLAN_STATUS.EXPORTED, planId]);
      await writeAudit(client, userId, 'PRODUCTION_EXPORT_CREATED', 'COLLECTION_PLAN', planId, { status: plan.status }, { fileName, rowCount: exportRows.length, exportVersion });
      await client.commit();
      return { id: exportId, fileName, rowCount: exportRows.length, exportedAt: new Date().toISOString(), planVersion: exportVersion, exportVersion, mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', contentBase64 };
    } catch (error) { await client.rollback(); throw error; } finally { client.release(); }
  },

  async getDraft(planId: string, regionId: string, userId: string, role: string, domainTaskId?: string): Promise<DemandDraft | null> {
    const client = await getClient();
    try {
      const scope = await getTaskScope(client, planId, regionId, domainTaskId, userId, role);
      const { rows } = await client.query<any>('SELECT * FROM collection_plan_domain_submission WHERE domain_scope_id = $1', [scope.id]);
      if (!rows.length) return null;
      const submission = rows[0];
      if (role === ROLES.GTM && (scope.gtm_owner_id !== userId || submission.status !== 'SUBMITTED')) throw new ForbiddenError('GTM仅可查看本人负责品类中已提交的区域需求');
      if (![ROLES.GTM, ROLES.ADMIN].includes(role as ROLES)) assertScopeActor(scope, role, userId);
      const { rows: items } = await client.query<any>(`
        SELECT item.*, sku.model, sku.bom_code FROM collection_plan_domain_demand_item item
        LEFT JOIN product_sku sku ON sku.id = item.product_sku_id WHERE item.submission_id = $1
      `, [submission.id]);
      const { rows: changeRequests } = await client.query<any>(`
        SELECT id, request_type, status, reason, requested_at, requested_by, version
        FROM collection_plan_region_change_request
        WHERE submission_id = $1 ORDER BY requested_at DESC LIMIT 1
      `, [submission.id]);
      const changeRequest = changeRequests[0];
      let visibleItems = items;
      if (role === ROLES.REGIONAL_OWNER && scope.region_owner_id !== userId) {
        const { rows: owned } = await client.query<any>("SELECT id FROM org_node WHERE parent_id = $1 AND node_type = 'OFFICE' AND owner_id = $2 AND enabled = true", [regionId, userId]);
        const ownedIds = new Set(owned.map((office) => office.id));
        visibleItems = items.filter((item) => ownedIds.has(item.office_id));
      }
      return {
        id: submission.id, planId, domainTaskId: scope.domain_task_id, regionId, status: submission.status,
        version: Number(submission.version), savedBy: submission.saved_by, savedAt: submission.saved_at,
        submittedBy: submission.submitted_by, submittedAt: submission.submitted_at,
        revisionNo: Number(submission.revision_no || 0), changePending: Boolean(submission.change_pending),
        reopenedBy: submission.reopened_by, reopenedAt: submission.reopened_at,
        reopenReason: submission.reopen_reason, reopenType: submission.reopen_type,
        changeRequest: changeRequest ? {
          id: changeRequest.id, type: changeRequest.request_type, status: changeRequest.status,
          reason: changeRequest.reason, requestedAt: changeRequest.requested_at,
          requestedBy: changeRequest.requested_by, version: Number(changeRequest.version),
        } : undefined,
        items: visibleItems.map((item) => ({ id: item.id, productItemKey: item.product_sku_id || item.provisional_item_key, skuModel: item.model, bomCode: item.bom_code, quantity: Number(item.quantity), basis: item.demand_basis, plannedUseDate: item.planned_use_date, note: item.note, officeId: item.office_id })),
      };
    } finally { client.release(); }
  },
};
