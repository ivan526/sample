export const ROLES = Object.freeze({
  GTM: "GTM",
  MSS_DOMAIN_OWNER: "MSS_DOMAIN_OWNER",
  REGIONAL_OWNER: "REGIONAL_OWNER",
  STOCKING_OWNER: "STOCKING_OWNER",
});

export const ROLE_LABELS = Object.freeze({
  [ROLES.GTM]: "GTM",
  [ROLES.MSS_DOMAIN_OWNER]: "MSS领域接口人",
  [ROLES.REGIONAL_OWNER]: "区域/代表处接口人",
  [ROLES.STOCKING_OWNER]: "备货接口人",
});

export const PLAN_STATUS = Object.freeze({
  PRODUCT_DRAFT: "PRODUCT_DRAFT",
  READY_TO_RELEASE: "READY_TO_RELEASE",
  COLLECTING: "COLLECTING",
  DOMAIN_REVIEW: "DOMAIN_REVIEW",
  GTM_CLOSURE: "GTM_CLOSURE",
  EXPORTED: "EXPORTED",
});

export const PLAN_STATUS_LABELS = Object.freeze({
  [PLAN_STATUS.PRODUCT_DRAFT]: "产品建档",
  [PLAN_STATUS.READY_TO_RELEASE]: "待下发",
  [PLAN_STATUS.COLLECTING]: "收集中",
  [PLAN_STATUS.DOMAIN_REVIEW]: "待领域反馈",
  [PLAN_STATUS.GTM_CLOSURE]: "待GTM收口",
  [PLAN_STATUS.EXPORTED]: "已导出",
});

const transitions = Object.freeze({
  [PLAN_STATUS.PRODUCT_DRAFT]: [PLAN_STATUS.READY_TO_RELEASE],
  [PLAN_STATUS.READY_TO_RELEASE]: [PLAN_STATUS.COLLECTING],
  [PLAN_STATUS.COLLECTING]: [PLAN_STATUS.DOMAIN_REVIEW],
  [PLAN_STATUS.DOMAIN_REVIEW]: [PLAN_STATUS.GTM_CLOSURE],
  [PLAN_STATUS.GTM_CLOSURE]: [PLAN_STATUS.EXPORTED],
  [PLAN_STATUS.EXPORTED]: [PLAN_STATUS.EXPORTED],
});

export class DomainError extends Error {
  constructor(code, message, status = 400, details = []) {
    super(message);
    this.name = "DomainError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export function requireRole(actualRole, allowedRoles) {
  if (!allowedRoles.includes(actualRole)) {
    throw new DomainError("FORBIDDEN", `角色${actualRole || "未知"}无权执行该操作`, 403);
  }
}

export function transitionPlan(plan, nextStatus) {
  const allowed = transitions[plan.status] || [];
  if (!allowed.includes(nextStatus)) {
    throw new DomainError(
      "PLAN_STATE_CONFLICT",
      `计划不能从${PLAN_STATUS_LABELS[plan.status] || plan.status}变更为${PLAN_STATUS_LABELS[nextStatus] || nextStatus}`,
      409,
    );
  }
  return { ...plan, status: nextStatus, version: plan.version + 1, updatedAt: new Date().toISOString() };
}

export function validateDemandItems(items) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new DomainError("VALIDATION_ERROR", "需求明细不能为空", 422, ["items至少包含一项"]);
  }
  const errors = [];
  const normalized = items.map((item, index) => {
    const quantity = Number(item.quantity);
    if (!item.productItemKey) errors.push(`第${index + 1}项缺少productItemKey`);
    if (!Number.isInteger(quantity) || quantity < 0) errors.push(`第${index + 1}项数量必须为非负整数`);
    if (quantity > 0 && !String(item.basis || "").trim()) errors.push(`第${index + 1}项数量大于0时必须填写需求依据`);
    return {
      productItemKey: String(item.productItemKey || ""),
      quantity: Number.isFinite(quantity) ? quantity : 0,
      basis: String(item.basis || ""),
      plannedUseDate: item.plannedUseDate || null,
      note: String(item.note || "").slice(0, 500),
    };
  });
  if (errors.length) throw new DomainError("VALIDATION_ERROR", "需求明细校验失败", 422, errors);
  return normalized;
}

export function sumDemandItems(items) {
  return items.reduce((sum, item) => sum + Number(item.quantity || 0), 0);
}

export function sumMetrics(items) {
  return items.reduce((totals, item) => ({
    demand: totals.demand + Number(item.demand || 0),
    stocked: totals.stocked + Number(item.stocked || 0),
    applied: totals.applied + Number(item.applied || 0),
    shipped: totals.shipped + Number(item.shipped || 0),
    inventory: totals.inventory + Number(item.inventory || 0),
    shipmentCount: totals.shipmentCount + Number(item.shipmentCount || 0),
  }), { demand: 0, stocked: 0, applied: 0, shipped: 0, inventory: 0, shipmentCount: 0 });
}

export function withExecutionDerived(metrics) {
  return {
    ...metrics,
    remainingToApply: Math.max(0, metrics.demand - metrics.applied),
    remainingToShip: Math.max(0, metrics.applied - metrics.shipped),
    overApplied: Math.max(0, metrics.applied - metrics.demand),
    overShipped: Math.max(0, metrics.shipped - metrics.applied),
    applicationRate: metrics.demand ? Math.round(metrics.applied / metrics.demand * 1000) / 10 : null,
    shipmentRate: metrics.applied ? Math.round(metrics.shipped / metrics.applied * 1000) / 10 : null,
  };
}

export function normalizeText(value) {
  return String(value || "").trim().toLocaleLowerCase("zh-CN");
}

export function matchesExecutionScope(row, filters = {}) {
  const { productId, regionId, officeId, country, keyword } = filters;
  if (productId && productId !== "all" && row.productId !== productId) return false;
  if (regionId && row.regionId !== regionId) return false;
  if (officeId && row.officeId !== officeId) return false;
  if (country && row.country !== country) return false;
  if (keyword) {
    const haystack = normalizeText(`${row.productName} ${row.sku} ${row.bom}`);
    if (!haystack.includes(normalizeText(keyword))) return false;
  }
  return true;
}

export function buildExecutionView({ rows, products, domains, organizations, filters = {} }) {
  const scopedRows = rows.filter((row) => matchesExecutionScope(row, filters));
  const productMap = new Map();
  for (const row of scopedRows) {
    const key = `${row.productId}:${row.sku}`;
    if (!productMap.has(row.productId)) productMap.set(row.productId, new Map());
    const skuMap = productMap.get(row.productId);
    const current = skuMap.get(key) || { sku: row.sku, bom: row.bom, demand: 0, stocked: 0, applied: 0, shipped: 0, inventory: 0, shipmentCount: 0 };
    for (const field of ["demand", "stocked", "applied", "shipped", "inventory", "shipmentCount"]) current[field] += Number(row[field] || 0);
    skuMap.set(key, current);
  }
  const output = [...productMap.entries()].map(([productId, skuMap]) => {
    const product = products.find((item) => item.id === productId) || { id: productId, name: productId, domainId: "" };
    const domain = domains.find((item) => item.id === product.domainId) || {};
    const skus = [...skuMap.values()].map((item) => ({ ...item, metrics: withExecutionDerived(item) }));
    return {
      id: product.id,
      name: product.name,
      stage: product.stage,
      domain: domain.name || "未配置领域",
      gtm: domain.gtm || "待配置",
      stockingOwner: domain.stockingOwner || "待配置",
      metrics: withExecutionDerived(sumMetrics(skus)),
      skus,
    };
  });
  const scopeParts = [];
  const region = organizations.find((item) => item.id === filters.regionId);
  if (region) scopeParts.push(region.name);
  if (filters.officeId) {
    const office = organizations.flatMap((item) => item.offices).find((item) => item.id === filters.officeId);
    if (office) scopeParts.push(office.name);
  }
  if (filters.country) scopeParts.push(filters.country);
  return {
    scopeLabel: scopeParts.length ? scopeParts.join(" / ") : "全球MSS",
    metrics: withExecutionDerived(sumMetrics(scopedRows)),
    products: output,
  };
}
