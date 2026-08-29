import { randomUUID } from "node:crypto";
import {
  DomainError, PLAN_STATUS, PLAN_STATUS_LABELS, ROLE_LABELS, ROLES,
  buildExecutionView, normalizeText, requireRole, sumDemandItems, transitionPlan, validateDemandItems,
} from "../shared/domain.mjs";
import { seed as defaultSeed } from "./seed.mjs";

const jsonHeaders = {
  "content-type": "application/json; charset=utf-8",
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "content-type,x-role,x-user-id,x-region-id,x-request-id,idempotency-key",
  "access-control-allow-methods": "GET,POST,PUT,OPTIONS",
};

function clone(value) {
  return structuredClone(value);
}

function response(status, requestId, data = null, code = "OK", message = "success", details = undefined) {
  const body = { code, message, data, requestId };
  if (details?.length) body.details = details;
  return new Response(JSON.stringify(body), { status, headers: jsonHeaders });
}

async function readBody(request) {
  if (["GET", "HEAD"].includes(request.method)) return {};
  const text = await request.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new DomainError("VALIDATION_ERROR", "请求体必须是合法JSON", 422);
  }
}

function productWithOwners(store, product) {
  const domain = store.domains.find((item) => item.id === product.domainId);
  return {
    ...product,
    domain: domain?.name || "未配置领域",
    gtm: domain?.gtm || "待配置",
    stockingOwner: domain?.stockingOwner || "待配置",
  };
}

function draftKey(planId, regionId) {
  return `${planId}:${regionId}`;
}

function planDemandTotal(store, plan, submittedOnly = false) {
  return plan.regionIds.reduce((total, regionId) => {
    const draft = store.drafts[draftKey(plan.id, regionId)];
    if (!draft || (submittedOnly && draft.status !== "SUBMITTED")) return total;
    return total + sumDemandItems(draft.items || []);
  }, 0);
}

function enrichPlan(store, plan) {
  const product = productWithOwners(store, store.products.find((item) => item.id === plan.productId) || { id: plan.productId, name: "未配置产品", domainId: "" });
  const regionProgress = plan.regionIds.map((regionId) => {
    const region = store.organizations.find((item) => item.id === regionId);
    const draft = store.drafts[draftKey(plan.id, regionId)];
    return {
      regionId,
      regionName: region?.name || regionId,
      owner: region?.owner || "待配置",
      officeCount: region?.offices.length || 0,
      countryCount: region?.offices.reduce((sum, office) => sum + office.countries.length, 0) || 0,
      status: draft?.status || "NOT_STARTED",
      demand: draft ? sumDemandItems(draft.items) : 0,
    };
  });
  return {
    ...plan,
    statusLabel: PLAN_STATUS_LABELS[plan.status],
    product,
    submittedRegionIds: plan.submittedRegionIds,
    submittedCount: plan.submittedRegionIds.length,
    totalRegions: plan.regionIds.length,
    draftDemandTotal: planDemandTotal(store, plan, false),
    confirmedDemandTotal: store.feedbacks[plan.id]?.totalQuantity || (plan.status === PLAN_STATUS.GTM_CLOSURE || plan.status === PLAN_STATUS.EXPORTED ? plan.demandTotal : 0),
    regionProgress,
    feedback: store.feedbacks[plan.id] || null,
  };
}

function ensureFound(item, message = "资源不存在") {
  if (!item) throw new DomainError("NOT_FOUND", message, 404);
  return item;
}

function ensureVersion(current, provided) {
  if (provided == null) return;
  if (Number(provided) !== Number(current)) throw new DomainError("VERSION_CONFLICT", "数据已被他人更新，请刷新后重试", 409);
}

function nextId(prefix, items) {
  return `${prefix}-${String(items.length + 1).padStart(3, "0")}`;
}

function buildOverview(store, productId) {
  const execution = buildExecutionView({
    rows: store.executionRows,
    products: store.products,
    domains: store.domains,
    organizations: store.organizations,
    filters: { productId },
  });
  const selectedProducts = productId && productId !== "all" ? store.products.filter((item) => item.id === productId) : store.products.filter((item) => item.enabled);
  const metrics = execution.metrics;
  const rows = productId && productId !== "all"
    ? execution.products.flatMap((product) => product.skus.map((sku) => ({ type: "sku", name: sku.sku, meta: `BOM ${sku.bom}`, ...sku.metrics })))
    : execution.products.map((product) => ({ type: "product", name: product.name, meta: `${product.domain} · ${product.stage} · ${product.skus.length}个SKU`, ...product.metrics }));
  return {
    productId: productId || "all",
    metrics,
    process: [
      { code: "PRODUCT", label: "新品建档", value: selectedProducts.length, unit: "个项目", state: "done" },
      { code: "DEMAND", label: "需求收集", value: metrics.demand, unit: "Pcs", state: "done" },
      { code: "PRODUCTION", label: "产品线排产", value: metrics.stocked, unit: "Pcs", state: "current" },
      { code: "SHIPMENT", label: "TSMP发货", value: metrics.shipped, unit: "Pcs", state: "current" },
      { code: "MATCH", label: "执行匹配", value: metrics.shipped, unit: "Pcs", state: "pending" },
    ],
    rows,
    attention: [
      { code: "DEMAND_NOT_APPLIED", value: metrics.remainingToApply, unit: "Pcs", target: "执行情况" },
      { code: "INVENTORY_DIFF", value: 26, unit: "Pcs", target: "库存核对" },
    ],
  };
}

export function createApp(initialSeed = defaultSeed) {
  const store = clone(initialSeed);
  store.exports ||= [];

  async function handle(request) {
    const requestId = request.headers.get("x-request-id") || randomUUID();
    try {
      if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: jsonHeaders });
      const url = new URL(request.url);
      if (url.pathname === "/healthz") return response(200, requestId, { status: "ok" });
      if (!url.pathname.startsWith("/api/v1")) throw new DomainError("NOT_FOUND", "接口不存在", 404);
      const path = url.pathname.slice("/api/v1".length) || "/";
      const role = request.headers.get("x-role") || "";
      const actor = request.headers.get("x-user-id") || "local-user";
      const body = await readBody(request);

      if (request.method === "GET" && path === "/meta") {
        return response(200, requestId, { roles: ROLE_LABELS, planStatuses: PLAN_STATUS_LABELS });
      }

      if (request.method === "GET" && path === "/config/catalog") {
        return response(200, requestId, {
          domains: clone(store.domains),
          products: store.products.map((item) => productWithOwners(store, item)),
          organizations: clone(store.organizations),
        });
      }

      if (request.method === "GET" && path === "/overview") {
        return response(200, requestId, buildOverview(store, url.searchParams.get("productId") || "all"));
      }

      if (request.method === "GET" && path === "/execution") {
        const execution = buildExecutionView({
          rows: store.executionRows,
          products: store.products,
          domains: store.domains,
          organizations: store.organizations,
          filters: {
            productId: url.searchParams.get("productId") || "all",
            regionId: url.searchParams.get("regionId") || "",
            officeId: url.searchParams.get("officeId") || "",
            country: url.searchParams.get("country") || "",
            keyword: url.searchParams.get("keyword") || "",
          },
        });
        return response(200, requestId, execution);
      }

      if (request.method === "POST" && path === "/execution/imports") {
        requireRole(role, [ROLES.STOCKING_OWNER]);
        if (!body.fileName) throw new DomainError("VALIDATION_ERROR", "fileName不能为空", 422);
        const rows = Array.isArray(body.rows) ? body.rows : [];
        const fingerprints = new Set();
        let matchedRows = 0; let mappingRequiredRows = 0; let unmatchedRows = 0; let duplicateRows = 0;
        for (const row of rows) {
          const fingerprint = row.externalKey || `${row.applicationNo}|${row.sku}|${row.region}|${row.office}|${row.shippedAt}|${row.shippedQty}`;
          if (fingerprints.has(fingerprint)) { duplicateRows += 1; continue; }
          fingerprints.add(fingerprint);
          const productMatch = store.products.some((product) => product.skus.some((sku) => normalizeText(sku.model) === normalizeText(row.sku)));
          const regionMatch = store.organizations.find((region) => normalizeText(region.name) === normalizeText(row.region));
          const officeMatch = regionMatch?.offices.some((office) => normalizeText(office.name) === normalizeText(row.office));
          if (productMatch && officeMatch && Number.isInteger(Number(row.shippedQty)) && Number(row.shippedQty) > 0) matchedRows += 1;
          else if (productMatch && (regionMatch || row.region || row.office)) mappingRequiredRows += 1;
          else unmatchedRows += 1;
        }
        if (!rows.length) ({ matchedRows, mappingRequiredRows, unmatchedRows, duplicateRows } = { matchedRows: 424, mappingRequiredRows: 9, unmatchedRows: 3, duplicateRows: 0 });
        const job = {
          id: nextId("IMPORT", store.imports), fileName: body.fileName, status: "COMPLETED",
          totalRows: rows.length || 436, matchedRows, mappingRequiredRows, unmatchedRows, duplicateRows,
          importedBy: actor, createdAt: new Date().toISOString(),
        };
        store.imports.push(job);
        return response(202, requestId, job);
      }

      if (request.method === "GET" && path === "/collection/plans") {
        const keyword = normalizeText(url.searchParams.get("keyword"));
        const status = url.searchParams.get("status");
        const productId = url.searchParams.get("productId");
        const regionId = url.searchParams.get("regionId") || request.headers.get("x-region-id");
        let plans = store.plans;
        if (role === ROLES.REGIONAL_OWNER && regionId) plans = plans.filter((plan) => plan.regionIds.includes(regionId));
        if (status) plans = plans.filter((plan) => plan.status === status);
        if (productId && productId !== "all") plans = plans.filter((plan) => plan.productId === productId);
        const enriched = plans.map((plan) => enrichPlan(store, plan)).filter((plan) => !keyword || normalizeText(`${plan.id} ${plan.product.name} ${plan.product.domain} ${plan.statusLabel}`).includes(keyword));
        return response(200, requestId, enriched);
      }

      if (request.method === "POST" && path === "/collection/plans") {
        requireRole(role, [ROLES.GTM]);
        const product = ensureFound(store.products.find((item) => item.id === body.productId), "产品不存在");
        if (!Array.isArray(body.regionIds) || body.regionIds.length === 0) throw new DomainError("VALIDATION_ERROR", "至少选择一个区域", 422);
        if (!body.deadline || Number.isNaN(Date.parse(body.deadline))) throw new DomainError("VALIDATION_ERROR", "截止时间不合法", 422);
        const missingRegions = body.regionIds.filter((id) => !store.organizations.some((item) => item.id === id && item.enabled));
        if (missingRegions.length) throw new DomainError("VALIDATION_ERROR", "收集范围包含无效区域", 422, missingRegions);
        const plan = {
          id: `PLAN-${new Date().getUTCFullYear()}-${String(store.plans.length + 1).padStart(3, "0")}`,
          productId: product.id,
          regionIds: [...new Set(body.regionIds)],
          submittedRegionIds: [],
          status: PLAN_STATUS.READY_TO_RELEASE,
          deadline: body.deadline,
          demandTotal: 0,
          note: String(body.note || "").slice(0, 500),
          createdBy: actor,
          createdAt: new Date().toISOString(),
          version: 1,
        };
        store.plans.push(plan);
        return response(201, requestId, enrichPlan(store, plan));
      }

      const planMatch = path.match(/^\/collection\/plans\/([^/]+)$/);
      if (request.method === "GET" && planMatch) {
        const plan = ensureFound(store.plans.find((item) => item.id === decodeURIComponent(planMatch[1])), "收集计划不存在");
        return response(200, requestId, enrichPlan(store, plan));
      }

      const releaseMatch = path.match(/^\/collection\/plans\/([^/]+)\/release$/);
      if (request.method === "POST" && releaseMatch) {
        requireRole(role, [ROLES.GTM]);
        const index = store.plans.findIndex((item) => item.id === decodeURIComponent(releaseMatch[1]));
        ensureFound(store.plans[index], "收集计划不存在");
        ensureVersion(store.plans[index].version, body.version);
        store.plans[index] = transitionPlan(store.plans[index], PLAN_STATUS.COLLECTING);
        return response(200, requestId, enrichPlan(store, store.plans[index]));
      }

      const draftMatch = path.match(/^\/collection\/plans\/([^/]+)\/regions\/([^/]+)\/draft$/);
      if (request.method === "PUT" && draftMatch) {
        requireRole(role, [ROLES.MSS_DOMAIN_OWNER, ROLES.REGIONAL_OWNER]);
        const plan = ensureFound(store.plans.find((item) => item.id === decodeURIComponent(draftMatch[1])), "收集计划不存在");
        const regionId = decodeURIComponent(draftMatch[2]);
        if (!plan.regionIds.includes(regionId)) throw new DomainError("FORBIDDEN", "该区域不在计划范围内", 403);
        if (![PLAN_STATUS.COLLECTING, PLAN_STATUS.DOMAIN_REVIEW].includes(plan.status)) throw new DomainError("PLAN_STATE_CONFLICT", "当前计划不可编辑区域需求", 409);
        const key = draftKey(plan.id, regionId);
        const previous = store.drafts[key];
        ensureVersion(previous?.version || 0, body.version);
        const items = validateDemandItems(body.items);
        store.drafts[key] = { status: "DRAFT", items, version: (previous?.version || 0) + 1, savedBy: actor, savedAt: new Date().toISOString(), submittedAt: null };
        return response(200, requestId, store.drafts[key]);
      }

      const submitMatch = path.match(/^\/collection\/plans\/([^/]+)\/regions\/([^/]+)\/submit$/);
      if (request.method === "POST" && submitMatch) {
        requireRole(role, [ROLES.MSS_DOMAIN_OWNER, ROLES.REGIONAL_OWNER]);
        const planIndex = store.plans.findIndex((item) => item.id === decodeURIComponent(submitMatch[1]));
        const plan = ensureFound(store.plans[planIndex], "收集计划不存在");
        const regionId = decodeURIComponent(submitMatch[2]);
        if (!plan.regionIds.includes(regionId)) throw new DomainError("FORBIDDEN", "该区域不在计划范围内", 403);
        const key = draftKey(plan.id, regionId);
        const draft = ensureFound(store.drafts[key], "请先保存需求草稿");
        ensureVersion(draft.version, body.version);
        validateDemandItems(draft.items);
        store.drafts[key] = { ...draft, status: "SUBMITTED", submittedBy: actor, submittedAt: new Date().toISOString(), version: draft.version + 1 };
        const submittedRegionIds = [...new Set([...plan.submittedRegionIds, regionId])];
        let updated = { ...plan, submittedRegionIds, version: plan.version + 1, updatedAt: new Date().toISOString() };
        if (submittedRegionIds.length === plan.regionIds.length && plan.status === PLAN_STATUS.COLLECTING) updated = transitionPlan(updated, PLAN_STATUS.DOMAIN_REVIEW);
        updated.demandTotal = planDemandTotal(store, updated, false);
        store.plans[planIndex] = updated;
        return response(200, requestId, enrichPlan(store, updated));
      }

      const feedbackMatch = path.match(/^\/collection\/plans\/([^/]+)\/domain-feedback$/);
      if (request.method === "POST" && feedbackMatch) {
        requireRole(role, [ROLES.MSS_DOMAIN_OWNER]);
        const planIndex = store.plans.findIndex((item) => item.id === decodeURIComponent(feedbackMatch[1]));
        const plan = ensureFound(store.plans[planIndex], "收集计划不存在");
        ensureVersion(plan.version, body.version);
        if (plan.status !== PLAN_STATUS.DOMAIN_REVIEW || plan.submittedRegionIds.length !== plan.regionIds.length) throw new DomainError("REGIONS_INCOMPLETE", "全部区域提交后才能反馈GTM", 409);
        if (body.confirmed !== true || !String(body.note || "").trim()) throw new DomainError("VALIDATION_ERROR", "请确认检查清单并填写反馈说明", 422);
        const totalQuantity = planDemandTotal(store, plan, true);
        const feedback = { planId: plan.id, note: String(body.note).slice(0, 1000), totalQuantity, confirmedBy: actor, confirmedAt: new Date().toISOString(), version: 1 };
        store.feedbacks[plan.id] = feedback;
        const updated = { ...transitionPlan(plan, PLAN_STATUS.GTM_CLOSURE), demandTotal: totalQuantity };
        store.plans[planIndex] = updated;
        return response(200, requestId, enrichPlan(store, updated));
      }

      const exportMatch = path.match(/^\/collection\/plans\/([^/]+)\/export$/);
      if (request.method === "POST" && exportMatch) {
        requireRole(role, [ROLES.GTM]);
        const planIndex = store.plans.findIndex((item) => item.id === decodeURIComponent(exportMatch[1]));
        const plan = ensureFound(store.plans[planIndex], "收集计划不存在");
        if (![PLAN_STATUS.GTM_CLOSURE, PLAN_STATUS.EXPORTED].includes(plan.status)) throw new DomainError("PLAN_STATE_CONFLICT", "收到领域正式反馈后才能导出排产", 409);
        const updated = transitionPlan(plan, PLAN_STATUS.EXPORTED);
        store.plans[planIndex] = updated;
        const product = store.products.find((item) => item.id === plan.productId);
        const exportRecord = { id: nextId("EXPORT", store.exports), planId: plan.id, planVersion: updated.version, fileName: `${plan.id}_${product?.name || "新品"}_排产需求.xlsx`, rowCount: plan.regionIds.reduce((sum, regionId) => sum + (store.drafts[draftKey(plan.id, regionId)]?.items.length || 0), 0), exportedBy: actor, exportedAt: new Date().toISOString() };
        store.exports.push(exportRecord);
        return response(200, requestId, exportRecord);
      }

      if (request.method === "POST" && path === "/config/products") {
        requireRole(role, [ROLES.GTM]);
        if (!String(body.name || "").trim() || !body.domainId) throw new DomainError("VALIDATION_ERROR", "产品名称和所属领域为必填", 422);
        ensureFound(store.domains.find((item) => item.id === body.domainId && item.enabled), "产品领域不存在或已停用");
        const product = { id: body.id || nextId("product", store.products), name: String(body.name).trim(), domainId: body.domainId, stage: body.stage || "工程样机（EVT）", supplyTimeText: body.supplyTimeText || "待产品线确认", defaultDeadline: body.defaultDeadline || null, enabled: body.enabled !== false, skus: Array.isArray(body.skus) ? body.skus.filter((item) => item.model).map((item, index) => ({ id: item.id || `${Date.now()}-${index}`, model: item.model, bomCode: item.bomCode || "" })) : [], version: 1 };
        store.products.push(product);
        return response(201, requestId, productWithOwners(store, product));
      }

      const productMatch = path.match(/^\/config\/products\/([^/]+)$/);
      if (request.method === "PUT" && productMatch) {
        requireRole(role, [ROLES.GTM]);
        const index = store.products.findIndex((item) => item.id === decodeURIComponent(productMatch[1]));
        const previous = ensureFound(store.products[index], "产品不存在");
        ensureVersion(previous.version, body.version);
        if (!String(body.name || "").trim() || !body.domainId) throw new DomainError("VALIDATION_ERROR", "产品名称和所属领域为必填", 422);
        ensureFound(store.domains.find((item) => item.id === body.domainId), "产品领域不存在");
        store.products[index] = { ...previous, ...body, id: previous.id, version: previous.version + 1 };
        return response(200, requestId, productWithOwners(store, store.products[index]));
      }

      if (request.method === "POST" && path === "/config/domains") {
        requireRole(role, [ROLES.GTM]);
        if (!body.name || !body.gtmOwner || !body.stockingOwner) throw new DomainError("VALIDATION_ERROR", "领域名称、GTM和领域备货接口人为必填", 422);
        const domain = { id: body.id || nextId("domain", store.domains), name: body.name, description: body.description || "", gtm: body.gtmOwner, stockingOwner: body.stockingOwner, enabled: body.enabled !== false, version: 1 };
        store.domains.push(domain);
        return response(201, requestId, domain);
      }

      const domainMatch = path.match(/^\/config\/domains\/([^/]+)$/);
      if (request.method === "PUT" && domainMatch) {
        requireRole(role, [ROLES.GTM]);
        const index = store.domains.findIndex((item) => item.id === decodeURIComponent(domainMatch[1]));
        const previous = ensureFound(store.domains[index], "产品领域不存在");
        ensureVersion(previous.version, body.version);
        const next = { ...previous, ...body, gtm: body.gtmOwner ?? body.gtm ?? previous.gtm, stockingOwner: body.stockingOwner ?? previous.stockingOwner, id: previous.id, version: previous.version + 1 };
        store.domains[index] = next;
        return response(200, requestId, next);
      }

      if (request.method === "POST" && path === "/config/organizations") {
        requireRole(role, [ROLES.GTM]);
        if (!body.name || !body.owner) throw new DomainError("VALIDATION_ERROR", "区域名称和接口人为必填", 422);
        const organization = { id: body.id || nextId("region", store.organizations), name: body.name, owner: body.owner, enabled: body.enabled !== false, offices: body.offices || [], version: 1 };
        store.organizations.push(organization);
        return response(201, requestId, organization);
      }

      const organizationMatch = path.match(/^\/config\/organizations\/([^/]+)$/);
      if (request.method === "PUT" && organizationMatch) {
        requireRole(role, [ROLES.GTM]);
        const index = store.organizations.findIndex((item) => item.id === decodeURIComponent(organizationMatch[1]));
        const previous = ensureFound(store.organizations[index], "区域不存在");
        ensureVersion(previous.version, body.version);
        store.organizations[index] = { ...previous, ...body, id: previous.id, version: previous.version + 1 };
        return response(200, requestId, store.organizations[index]);
      }

      throw new DomainError("NOT_FOUND", "接口不存在", 404);
    } catch (error) {
      if (error instanceof DomainError) return response(error.status, requestId, null, error.code, error.message, error.details);
      return response(500, requestId, null, "INTERNAL_ERROR", "服务暂时不可用");
    }
  }

  return { handle, store };
}
