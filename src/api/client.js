// 默认走浏览器同源地址，由本地Vite或生产反向代理转发到API。
// 这样从局域网其他电脑访问时，不会把localhost错误地解析为访问者自己的电脑。
const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || '/api/v1').replace(/\/$/, '');

// Token和用户状态管理
let authToken = localStorage.getItem('mss_token') || '';
let currentUser = JSON.parse(localStorage.getItem('mss_current_user') || 'null');
let onLogoutCallback = null;

export const auth = {
  // 登录成功后保存token和用户信息
  setAuth(token, user) {
    authToken = token;
    currentUser = user;
    localStorage.setItem('mss_token', token);
    localStorage.setItem('mss_current_user', JSON.stringify(user));
  },
  // 登出，清除本地状态
  logout() {
    authToken = '';
    currentUser = null;
    localStorage.removeItem('mss_token');
    localStorage.removeItem('mss_current_user');
    if (onLogoutCallback) onLogoutCallback();
  },
  getToken() {
    return authToken;
  },
  getCurrentUser() {
    return currentUser;
  },
  // 设置登出回调，401时自动触发
  setLogoutCallback(callback) {
    onLogoutCallback = callback;
  },
  // 更新当前用户信息
  updateUser(user) {
    currentUser = user;
    localStorage.setItem('mss_current_user', JSON.stringify(user));
  },
  // 角色标签映射
  ROLE_LABELS: {
    ADMIN: '系统管理员',
    GTM: 'GTM',
    MSS_DOMAIN_OWNER: 'MSS领域接口人',
    REGIONAL_OWNER: '区域/代表处接口人',
    STOCKING_OWNER: '备货接口人',
  },
};

// 默认请求头，带上Authorization token
function getDefaultHeaders() {
  const headers = {
    'Content-Type': 'application/json',
  };
  if (authToken) {
    headers['Authorization'] = `Bearer ${authToken}`;
  }
  return headers;
}

async function request(path, options = {}) {
  const url = `${API_BASE_URL}${path}`;
  const config = {
    ...options,
    headers: {
      ...getDefaultHeaders(),
      ...options.headers,
    },
  };

  try {
    const response = await fetch(url, config);

    // 401未授权，自动登出
    if (response.status === 401) {
      auth.logout();
      const data = await response.json().catch(() => ({}));
      throw new Error(data.message || '登录已过期，请重新登录');
    }

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.message || '请求失败');
    }

    return data.data;
  } catch (error) {
    console.error('API request failed:', error);
    throw error;
  }
}

export const api = {
  // ========== 认证接口 ==========
  // 账号密码登录
  login: (employeeNo, password) => {
    return request('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ employeeNo, password }),
    });
  },
  // 修改密码
  changePassword: (oldPassword, newPassword) => {
    return request('/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({ oldPassword, newPassword }),
    });
  },
  // 获取当前用户信息
  getCurrentUser: () => request('/config/auth/me'),

  // 配置管理
  getCatalog: () => request('/config/catalog'),

  createProduct: (product) => {
    // 前端字段转后端字段
    const payload = {
      name: product.name,
      domainId: product.categoryId,
      supplyTimeText: product.supply,
      defaultDeadline: product.deadline,
      enabled: product.enabled !== false,
      skus: (product.skus || []).filter(sku => sku.sku?.trim()).map(sku => ({
        model: sku.sku.trim(),
        bomCode: sku.bom?.trim() || '',
        description: sku.description?.trim() || '',
      })),
      version: product.version,
    };
    return request('/config/products', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  updateProduct: (product) => {
    const payload = {
      name: product.name,
      domainId: product.categoryId,
      supplyTimeText: product.supply,
      defaultDeadline: product.deadline,
      enabled: product.enabled !== false,
      skus: (product.skus || []).filter(sku => sku.sku?.trim()).map(sku => ({
        id: sku.id,
        model: sku.sku.trim(),
        bomCode: sku.bom?.trim() || '',
        description: sku.description?.trim() || '',
      })),
      version: product.version,
    };
    return request(`/config/products/${product.id}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
  },

  createDomain: (domain) => {
    const payload = {
      name: domain.name,
      description: domain.description,
      gtmOwner: domain.gtm,
      domainOwner: domain.domainOwner,
      stockingOwner: domain.stockingOwner,
      enabled: domain.enabled !== false,
      version: domain.version,
    };
    return request('/config/domains', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  updateDomain: (domain) => {
    const payload = {
      name: domain.name,
      description: domain.description,
      gtmOwner: domain.gtm,
      domainOwner: domain.domainOwner,
      stockingOwner: domain.stockingOwner,
      enabled: domain.enabled !== false,
      version: domain.version,
    };
    return request(`/config/domains/${domain.id}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
  },

  createMssDomain: (mssDomain) => {
    const payload = {
      code: mssDomain.code,
      name: mssDomain.name,
      description: mssDomain.description,
      mssOwner: mssDomain.mssOwner,
      enabled: mssDomain.enabled !== false,
      version: mssDomain.version,
    };
    return request('/config/mss-domains', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  updateMssDomain: (mssDomain) => {
    const payload = {
      code: mssDomain.code,
      name: mssDomain.name,
      description: mssDomain.description,
      mssOwner: mssDomain.mssOwner,
      enabled: mssDomain.enabled !== false,
      version: mssDomain.version,
    };
    return request(`/config/mss-domains/${mssDomain.id}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
  },

  createOrganization: (org) => {
    const payload = {
      name: org.name,
      owner: org.owner,
      enabled: org.enabled !== false,
      offices: (org.offices || []).map(office => ({
        name: office.name,
        owner: office.owner,
        enabled: office.enabled !== false,
        countries: office.countries || [],
      })),
      version: org.version,
    };
    return request('/config/organizations', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  updateOrganization: (org) => {
    const payload = {
      name: org.name,
      owner: org.owner,
      enabled: org.enabled !== false,
      offices: (org.offices || []).map(office => ({
        id: office.id,
        name: office.name,
        owner: office.owner,
        enabled: office.enabled !== false,
        countries: office.countries || [],
      })),
      version: org.version,
    };
    return request(`/config/organizations/${org.id}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
  },

  // 数据字典管理
  createDictionaryItem: (item) => {
    const payload = {
      dictType: item.dictType,
      code: item.code,
      name: item.name,
      sortOrder: item.sortOrder || 0,
      description: item.description || '',
      enabled: item.enabled !== false,
      version: item.version,
    };
    return request('/config/dictionaries', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  updateDictionaryItem: (item) => {
    const payload = {};
    // 仅传有值的字段，避免传undefined/null
    if (item.name !== undefined) payload.name = item.name;
    if (item.sortOrder !== undefined) payload.sortOrder = Number(item.sortOrder);
    if (item.description !== undefined) payload.description = item.description || '';
    if (item.enabled !== undefined) payload.enabled = Boolean(item.enabled);
    if (item.version !== undefined) payload.version = Number(item.version);
    return request(`/config/dictionaries/${item.id}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
  },

  deleteDictionaryItem: (itemId) => {
    return request(`/config/dictionaries/${itemId}`, {
      method: 'DELETE',
    });
  },

  // 用户管理
  getUserList: () => request('/config/users'),
  createUser: (user) => {
    return request('/config/users', {
      method: 'POST',
      body: JSON.stringify({
        employeeNo: user.employeeNo.trim(),
        displayName: user.displayName.trim(),
        role: user.role,
        password: user.password?.trim(),
        enabled: user.enabled !== false,
        productDomainIds: user.productDomainIds || [],
        mssDomainIds: user.mssDomainIds || [],
        organizationNodeIds: user.organizationNodeIds || [],
      }),
    });
  },
  updateUser: (user) => {
    const payload = {};
    if (user.displayName !== undefined) payload.displayName = user.displayName.trim();
    if (user.role !== undefined) payload.role = user.role;
    if (user.enabled !== undefined) payload.enabled = Boolean(user.enabled);
    if (user.password !== undefined) payload.password = user.password.trim();
    if (user.productDomainIds !== undefined) payload.productDomainIds = user.productDomainIds;
    if (user.mssDomainIds !== undefined) payload.mssDomainIds = user.mssDomainIds;
    if (user.organizationNodeIds !== undefined) payload.organizationNodeIds = user.organizationNodeIds;
    return request(`/config/users/${user.id}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
  },

  // 需求收集相关
  getPlans: (params = {}) => {
    const search = new URLSearchParams(params).toString();
    return request(`/collection/plans${search ? `?${search}` : ''}`);
  },
  createPlan: (plan) => request('/collection/plans', { method: 'POST', body: JSON.stringify(plan) }),
  getPlan: (planId, domainTaskId) => request(`/collection/plans/${planId}${domainTaskId ? `?${new URLSearchParams({ domainTaskId })}` : ''}`),
  releasePlan: (planId, version) => request(`/collection/plans/${planId}/release`, { method: 'POST', body: JSON.stringify({ version }) }),
  dispatchDomainTask: (taskId, data) => request(`/collection/domain-tasks/${taskId}/dispatch`, { method: 'POST', body: JSON.stringify(data) }),
  saveDraft: (planId, regionId, domainTaskId, data) => request(`/collection/plans/${planId}/regions/${regionId}/draft?${new URLSearchParams({ domainTaskId })}`, { method: 'PUT', body: JSON.stringify(data) }),
  getDraft: (planId, regionId, domainTaskId) => request(`/collection/plans/${planId}/regions/${regionId}/draft?${new URLSearchParams({ domainTaskId })}`),
  submitRegion: (planId, regionId, domainTaskId, version) => request(`/collection/plans/${planId}/regions/${regionId}/submit?${new URLSearchParams({ domainTaskId })}`, { method: 'POST', body: JSON.stringify({ version }) }),
  returnRegion: (planId, regionId, domainTaskId, data) => request(`/collection/plans/${planId}/regions/${regionId}/return?${new URLSearchParams({ domainTaskId })}`, { method: 'POST', body: JSON.stringify(data) }),
  submitDomainFeedback: (taskId, data) => request(`/collection/domain-tasks/${taskId}/feedback`, { method: 'POST', body: JSON.stringify(data) }),
  exportPlan: (planId) => request(`/collection/plans/${planId}/export`, { method: 'POST', body: JSON.stringify({}) }),

  // 运营总览、执行与库存
  getOverview: (productId = 'all') => request(`/overview?${new URLSearchParams({ productId })}`),
  getExecution: (params = {}) => {
    const search = new URLSearchParams(Object.entries(params).filter(([, value]) => value !== '' && value != null)).toString();
    return request(`/execution${search ? `?${search}` : ''}`);
  },
  getExecutionImports: () => request('/execution/imports'),
  importTsmp: (data) => request('/execution/imports', { method: 'POST', body: JSON.stringify(data) }),
  checkShipmentApproval: (data) => request('/shipment-approval/check', { method: 'POST', body: JSON.stringify(data) }),
  getInventory: (params = {}) => {
    const search = new URLSearchParams(Object.entries(params).filter(([, value]) => value !== '' && value != null)).toString();
    return request(`/inventory${search ? `?${search}` : ''}`);
  },
  checkInventory: (id, data) => request(`/inventory/${id}/check`, { method: 'PUT', body: JSON.stringify(data) }),
};

// 格式化日期为 M月D日 HH:mm 格式，和原有mock显示一致
function formatDeadline(isoStr) {
  if (!isoStr) return null;
  try {
    const date = new Date(isoStr);
    return `${date.getMonth() + 1}月${date.getDate()}日 ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  } catch {
    return isoStr;
  }
}

// 辅助函数：将后端返回的数据转换为前端需要的格式
export function adaptCatalogData(catalog) {
  // 转换产品：后端domainId → 前端categoryId，skus.model → sku，skus.bomCode → bom
  const products = catalog.products.map(product => ({
    id: product.id,
    name: product.name,
    categoryId: product.domainId,
    supply: product.supplyTimeText || '待产品线确认',
    deadline: formatDeadline(product.defaultDeadline) || '待计划下发',
    enabled: product.enabled,
    version: product.version,
    skus: product.skus.map(sku => ({
      id: sku.id,
      sku: sku.model,
      bom: sku.bomCode || '',
      description: sku.description || '',
    })),
    // 保留继承的责任人信息
    domain: product.domain,
    category: product.domain,
    gtm: product.gtm,
    domainOwner: product.domainOwner,
    stockingOwner: product.stockingOwner,
  }));

  // 转换产品品类（原领域）：后端gtmOwner → gtm，stockingOwner → stockingOwner
  const domains = catalog.domains.map(domain => ({
    id: domain.id,
    name: domain.name,
    description: domain.description || '',
    gtm: domain.gtmOwner,
    domainOwner: domain.domainOwner,
    stockingOwner: domain.stockingOwner,
    enabled: domain.enabled,
    version: domain.version,
    productCount: domain.productCount || 0,
  }));

  // 转换MSS业务领域
  const mssDomains = (catalog.mssDomains || []).map(md => ({
    id: md.id,
    code: md.code,
    name: md.name,
    description: md.description || '',
    mssOwner: md.mssOwner,
    enabled: md.enabled,
    version: md.version,
    productCount: md.productCount || 0,
  }));

  // 组织保持一致，后端返回结构和前端一致
  const organizations = catalog.organizations;

  // 字典数据直接返回
  const dictionaries = catalog.dictionaries || {};
  // 为了兼容旧代码，将样机阶段单独映射
  const stages = (dictionaries.SAMPLE_STAGE || []).map(item => item.name);

  return { products, domains, mssDomains, organizations, dictionaries, stages };
}

const PLAN_STATUS_LABELS = {
  PRODUCT_DRAFT: '产品建档', READY_TO_RELEASE: '待下发', COLLECTING: '收集中',
  DOMAIN_REVIEW: '待领域反馈', GTM_CLOSURE: '待GTM收口', EXPORTED: '已导出',
};

const DOMAIN_TASK_STATUS_LABELS = {
  PENDING_DISPATCH: '待下发区域', COLLECTING: '区域收集中', READY_TO_FEEDBACK: '待反馈GTM', FEEDBACK_SUBMITTED: '已反馈GTM',
};

export function adaptPlanData(plan) {
  return {
    ...plan,
    viewId: plan.viewId || plan.domainTaskId || plan.id,
    planNo: plan.planNo || plan.id,
    stage: plan.stage || '待配置',
    statusCode: plan.status,
    status: PLAN_STATUS_LABELS[plan.status] || plan.status,
    deadline: formatDeadline(plan.deadline) || '待设置',
    deadlineValue: plan.deadline,
    total: Number(plan.totalRegions || 0),
    taskStatusCode: plan.taskStatus,
    taskStatusLabel: DOMAIN_TASK_STATUS_LABELS[plan.taskStatus] || plan.taskStatus,
    scope: plan.domainTaskId ? `${plan.mssDomain?.name || '待配置MSS领域'} · ${Number(plan.totalRegions || 0)}个区域` : `${plan.domainTasks?.length || 0}个MSS业务领域`,
    demand: Number(plan.feedback?.totalQuantity ?? plan.demandTotal ?? plan.draftDemandTotal ?? 0),
    submittedRegions: plan.submittedRegions || [],
    regionProgress: plan.regionProgress || [],
  };
}
