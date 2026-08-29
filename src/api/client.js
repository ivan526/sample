const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8787/api/v1';

// 默认请求头，演示环境用X-Role模拟角色
const defaultHeaders = {
  'Content-Type': 'application/json',
  'X-Role': 'GTM', // 配置管理默认GTM角色
  'X-User-Id': 'local-user',
};

async function request(path, options = {}) {
  const url = `${API_BASE_URL}${path}`;
  const config = {
    ...options,
    headers: {
      ...defaultHeaders,
      ...options.headers,
    },
  };

  try {
    const response = await fetch(url, config);
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
  // 配置管理
  getCatalog: () => request('/config/catalog'),

  createProduct: (product) => {
    // 前端字段转后端字段
    const payload = {
      name: product.name,
      domainId: product.categoryId,
      stage: product.stage,
      supplyTimeText: product.supply,
      defaultDeadline: product.deadline,
      enabled: product.enabled !== false,
      skus: (product.skus || []).filter(sku => sku.sku?.trim()).map(sku => ({
        model: sku.sku.trim(),
        bomCode: sku.bom?.trim() || '',
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
      stage: product.stage,
      supplyTimeText: product.supply,
      defaultDeadline: product.deadline,
      enabled: product.enabled !== false,
      skus: (product.skus || []).filter(sku => sku.sku?.trim()).map(sku => ({
        id: sku.id,
        model: sku.sku.trim(),
        bomCode: sku.bom?.trim() || '',
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
      stockingOwner: domain.stockingOwner,
      enabled: domain.enabled !== false,
      version: domain.version,
    };
    return request(`/config/domains/${domain.id}`, {
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
    stage: product.stage || '工程样机（EVT）',
    supply: product.supplyTimeText || '待产品线确认',
    deadline: formatDeadline(product.defaultDeadline) || '待计划下发',
    scope: `${catalog.organizations.length}个MKT区域`, // Sprint1默认全部区域
    enabled: product.enabled,
    version: product.version,
    skus: product.skus.map(sku => ({
      id: sku.id,
      sku: sku.model,
      bom: sku.bomCode || '',
    })),
    // 保留继承的责任人信息
    domain: product.domain,
    gtm: product.gtm,
    stockingOwner: product.stockingOwner,
  }));

  // 转换领域：后端gtmOwner → gtm，stockingOwner → stockingOwner
  const domains = catalog.domains.map(domain => ({
    id: domain.id,
    name: domain.name,
    description: domain.description || '',
    gtm: domain.gtmOwner,
    stockingOwner: domain.stockingOwner,
    enabled: domain.enabled,
    version: domain.version,
    productCount: domain.productCount || 0,
  }));

  // 组织保持一致，后端返回结构和前端一致
  const organizations = catalog.organizations;

  return { products, domains, organizations };
}
