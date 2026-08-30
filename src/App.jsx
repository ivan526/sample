import { useMemo, useState, useEffect } from "react";
import {
  IconAlertTriangle, IconAlertTriangleFilled, IconBell, IconCalendar, IconChartBar,
  IconCheck, IconChevronDown, IconCircleCheck, IconCircleCheckFilled, IconClipboardText,
  IconDatabase, IconDownload, IconFileSpreadsheet, IconLayoutDashboard, IconPlayerPlay,
  IconSearch, IconSettings, IconX, IconLogout,
} from "@tabler/icons-react";
import { ConfigurationPage, ExecutionPage, InventoryPage, OverviewPage } from "./OperationalPages.jsx";
import {
  CollectionPlanPage, CollectionTaskDetailPage, DomainTaskPage, RegionalTaskPage, ShipmentApprovalPage,
} from "./BusinessFlowPages.jsx";
import { baseDomains, baseOrganizations, baseProducts } from "./productData.js";
import { api, adaptCatalogData, auth } from "./api/client.js";
import LoginPage from "./LoginPage.jsx";
import ErrorBoundary from "./components/ErrorBoundary.jsx";

const demandSeeds = {
  "chitu-b19": {
    europe: [[307, "新品上市体验", "2025-12-15"], [405, "重点客户PoC", "2025-12-20"], [170, "零售门店评测", "2025-12-30"], [109, "", "2026-01-05"]],
    eurasia: [[50, "新品上市体验", "2026-12-18"], [50, "渠道体验", "2026-12-22"], [50, "重点客户PoC", "2026-12-28"], [20, "零售门店评测", "2027-01-05"]],
    sea: [[120, "新品上市体验", "2026-12-18"], [150, "渠道体验", "2026-12-22"], [80, "零售门店评测", "2026-12-30"], [60, "重点客户PoC", "2027-01-05"]],
    latam: [[90, "新品上市体验", "2026-12-20"], [120, "重点客户PoC", "2026-12-24"], [60, "零售门店评测", "2026-12-30"], [40, "渠道体验", "2027-01-06"]],
    mea: [[100, "新品上市体验", "2026-12-18"], [125, "重点客户PoC", "2026-12-23"], [70, "渠道体验", "2026-12-29"], [45, "零售门店评测", "2027-01-05"]],
    china: [[80, "新品上市体验", "2026-12-16"], [90, "重点客户PoC", "2026-12-21"], [50, "零售门店评测", "2026-12-27"], [41, "渠道体验", "2027-01-03"]],
  },
  "chitu-b21": {
    europe: [[180, "新品上市体验", "2026-02-12"], [210, "重点客户PoC", "2026-02-18"], [96, "渠道体验", "2026-02-25"]],
    eurasia: [[60, "渠道体验", "2026-02-18"], [70, "新品上市体验", "2026-02-22"], [35, "重点客户PoC", "2026-02-28"]],
    sea: [[90, "新品上市体验", "2026-02-15"], [110, "零售门店评测", "2026-02-20"], [48, "渠道体验", "2026-02-28"]],
    latam: [[55, "新品上市体验", "2026-02-18"], [65, "重点客户PoC", "2026-02-24"], [30, "渠道体验", "2026-03-02"]],
    mea: [[45, "新品上市体验", "2026-02-20"], [56, "重点客户PoC", "2026-02-26"], [30, "零售门店评测", "2026-03-04"]],
  },
  "chitu-pad-x": {
    europe: [[128, "重点客户PoC", "2026-03-08"], [156, "零售门店评测", "2026-03-12"]],
    sea: [[80, "新品上市体验", "2026-03-10"], [96, "渠道体验", "2026-03-15"]],
  },
};

function rowsForProduct(product, regionId, previousRows = []) {
  const seed = demandSeeds[product.id]?.[regionId] || [];
  const demandUnits = product.skus.length ? product.skus : [{ sku: `${product.name}（型号待补充）`, bom: "", provisional: true }];
  return demandUnits.map((sku, index) => {
    const previous = previousRows.find((item) => item.sku === sku.sku);
    if (previous) return { ...previous, bom: sku.bom };
    const [qty = 0, basis = "", date = ""] = seed[index] || [];
    return { ...sku, qty, basis, date, note: "" };
  });
}

function buildDemandRows(products, organizations) {
  return Object.fromEntries(products.map((product) => [product.id, Object.fromEntries(organizations.map((region) => [region.id, rowsForProduct(product, region.id)]))]));
}

// 导航菜单配置，带权限标识
const allNavItems = [
  { label: "运营总览", icon: IconLayoutDashboard, permission: 'overview:read' },
  { label: "需求收集", icon: IconFileSpreadsheet, permission: 'demand:read' },
  { label: "发货审批", icon: IconClipboardText, permission: 'shipment:approve' },
  { label: "执行情况", icon: IconPlayerPlay, permission: 'execution:read' },
  { label: "库存核对", icon: IconDatabase, permission: 'inventory:manage' },
  { label: "提醒中心", icon: IconBell, permission: 'overview:read' },
  { label: "数据明细", icon: IconChartBar, permission: 'execution:read' },
  { label: "配置管理", icon: IconSettings, permission: 'config:read' },
];
// 角色默认首页
const DEFAULT_HOME = {
  ADMIN: "运营总览",
  GTM: "需求收集",
  MSS_DOMAIN_OWNER: "需求收集",
  REGIONAL_OWNER: "需求收集",
  STOCKING_OWNER: "发货审批",
};
const basisOptions = ["", "新品上市体验", "重点客户PoC", "零售门店评测", "渠道体验", "其他"];
// 后端状态码转前端显示
const STATUS_MAP = {
  PRODUCT_DRAFT: '产品建档',
  READY_TO_RELEASE: '待下发',
  COLLECTING: '收集中',
  DOMAIN_REVIEW: '待领域反馈',
  GTM_CLOSURE: '待GTM收口',
  EXPORTED: '已导出'
};

function StatusDot({ status }) { return <span className={`status-dot status-${status}`} aria-hidden="true" />; }
function Toast({ message, type = "success", onClose }) {
  if (!message) return null;
  return <div className={`toast toast-${type}`} role="status">{type === "success" ? <IconCircleCheck size={19} /> : <IconAlertTriangle size={19} />}<span>{message}</span><button type="button" onClick={onClose} aria-label="关闭提示"><IconX size={17} /></button></div>;
}

export function App() {
  // 登录状态
  const [loading, setLoading] = useState(true);
  const [authenticated, setAuthenticated] = useState(false);
  const [currentUser, setCurrentUser] = useState(null);

  // 业务数据状态
  const [products, setProducts] = useState(baseProducts);
  const [domains, setDomains] = useState(baseDomains);
  const [organizations, setOrganizations] = useState(baseOrganizations);
  const [dictionaries, setDictionaries] = useState({
    SAMPLE_STAGE: [
      { id: "evt", code: "EVT", name: "工程样机（EVT）", sortOrder: 1, enabled: true },
      { id: "dvt", code: "DVT", name: "测试样机（DVT）", sortOrder: 2, enabled: true },
      { id: "pvt", code: "PVT", name: "试生产样机（PVT）", sortOrder: 3, enabled: true },
      { id: "vn2", code: "VN2", name: "测试样机（VN2）", sortOrder: 5, enabled: true },
      { id: "mp", code: "MP", name: "量产样机（MP）", sortOrder: 6, enabled: true },
    ]
  });
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [selectedProductId, setSelectedProductId] = useState(baseProducts[0].id);
  const [activeRegion, setActiveRegion] = useState(baseOrganizations[0].id);
  const [rowsByProduct, setRowsByProduct] = useState(() => buildDemandRows(baseProducts, baseOrganizations));

  // 页面状态
  const [search, setSearch] = useState("");
  const [activeNav, setActiveNav] = useState("运营总览");
  const [collectionView, setCollectionView] = useState("plans");
  const [collectionPlans, setCollectionPlans] = useState([]);
  const [selectedPlanId, setSelectedPlanId] = useState(null);
  const [taskInitialTab, setTaskInitialTab] = useState("progress");
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState("307\t405\t170\t109");
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [toast, setToast] = useState({ message: "", type: "success" });
  const [savedAt, setSavedAt] = useState("--:--");
  const [draftVersion, setDraftVersion] = useState(null);
  const [draftLoading, setDraftLoading] = useState(false);
  const [submittedScopes, setSubmittedScopes] = useState([]);

  // 加载收集计划列表 - 移到前面避免变量提升问题
  const loadPlans = async (productsList = products, domainsList = domains) => {
    try {
      const plans = await api.getPlans();
      // 适配前端格式：转换状态为中文，补全前端需要的字段
      const adaptedPlans = plans.map(plan => {
        const product = productsList.find(p => p.id === plan.productId);
        const domain = domainsList.find(d => d.id === product?.categoryId);
        return {
          ...plan,
          status: STATUS_MAP[plan.status] || plan.status,
          deadline: plan.deadline ? new Date(plan.deadline).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '待定',
          total: plan.totalRegions || 0,
          demand: plan.demandTotal || 0,
          scope: `${domain?.name || '未知领域'} · ${plan.totalRegions || 0}个区域`,
          submittedRegions: plan.regionProgress?.filter(r => r.status === 'SUBMITTED').map(r => r.regionId) || [],
        };
      });
      setCollectionPlans(adaptedPlans);
      // 更新已提交区域列表
      const submitted = [];
      adaptedPlans.forEach(plan => {
        plan.regionProgress?.forEach(r => {
          if (r.status === 'SUBMITTED') submitted.push(`${plan.productId}:${r.regionId}`);
        });
      });
      setSubmittedScopes(submitted);
      // 默认选中第一个计划
      if (adaptedPlans.length > 0 && !selectedPlanId) {
        setSelectedPlanId(adaptedPlans[0].id);
        setSelectedProductId(adaptedPlans[0].productId);
        // 区域接口人默认选中第一个区域
        if (currentUser?.role === 'REGIONAL_OWNER' && organizations.length > 0) {
          setActiveRegion(organizations[0].id);
        }
      }
    } catch (error) {
      console.warn('Failed to load collection plans:', error);
      // 失败不抛出，降级显示空列表
    }
  };

  // 设置登出回调，401时自动触发
  useEffect(() => {
    auth.setLogoutCallback(() => {
      setAuthenticated(false);
      setCurrentUser(null);
      showToast('登录已过期，请重新登录', 'warning');
    });
  }, []);

  // 初始化：检查本地token，自动登录
  useEffect(() => {
    const initAuth = async () => {
      const token = auth.getToken();
      if (!token) {
        setLoading(false);
        return;
      }
      try {
        // 有token，拉取当前用户信息验证有效性
        const user = await api.getCurrentUser();
        setCurrentUser(user);
        auth.updateUser(user);
        setAuthenticated(true);
        // 加载业务数据
        await Promise.all([loadCatalog(), loadUsers()]);
        // 跳转到角色默认首页
        setActiveNav(DEFAULT_HOME[user.role] || "运营总览");
        setDefaultCollectionView(user.role);
      } catch (error) {
        // token无效，清除本地状态
        auth.logout();
        console.warn('Auto login failed:', error);
      } finally {
        setLoading(false);
      }
    };
    initAuth();
  }, []);

  // 登录处理
  const handleLogin = async (employeeNo, password) => {
    const result = await api.login(employeeNo, password);
    auth.setAuth(result.token, result.user);
    setCurrentUser(result.user);
    setAuthenticated(true);
    // 加载业务数据
    await Promise.all([loadCatalog(), loadUsers()]);
    // 跳转到角色默认首页
    setActiveNav(DEFAULT_HOME[result.user.role] || "运营总览");
    setDefaultCollectionView(result.user.role);
    showToast(`欢迎回来，${result.user.name}`, 'success');
  };

  // 登出处理
  const handleLogout = () => {
    auth.logout();
    setAuthenticated(false);
    setCurrentUser(null);
    showToast('已退出登录', 'success');
  };

  // 根据角色设置需求收集默认视图
  const setDefaultCollectionView = (role) => {
    if (role === "MSS_DOMAIN_OWNER") setCollectionView("tasks");
    else if (role === "REGIONAL_OWNER") {
      setCollectionView("regional-tasks");
      setSelectedProductId("chitu-b21");
      setActiveRegion("europe");
    }
    else setCollectionView("plans");
  };

  // 加载当前用户信息
  const loadCurrentUser = async () => {
    try {
      const user = await api.getCurrentUser();
      setCurrentUser(user);
      auth.updateUser(user);
    } catch (error) {
      console.warn('Failed to load current user:', error);
    }
  };

  // 加载配置主数据
  const loadCatalog = async () => {
    try {
      setCatalogLoading(true);
      const catalog = await api.getCatalog();
      const { products: apiProducts, domains: apiDomains, organizations: apiOrgs, dictionaries: apiDicts } = adaptCatalogData(catalog);
      setProducts(apiProducts);
      setDomains(apiDomains);
      setOrganizations(apiOrgs);
      if (apiDicts && Object.keys(apiDicts).length) setDictionaries(apiDicts);
      // 更新需求行数据，新增产品也能生成行
      setRowsByProduct(buildDemandRows(apiProducts, apiOrgs));
      // 加载收集计划列表
      await loadPlans(apiProducts, apiDomains);
    } catch (error) {
      console.warn('Failed to load catalog:', error);
      // API加载失败时降级为空列表，显示空状态
      setCollectionPlans([]);
      showToast('配置数据加载失败，请刷新重试', 'warning');
    } finally {
      setCatalogLoading(false);
    }
  };

  // 创建收集计划
  const createPlan = async (planData) => {
    try {
      // 转换截止时间为ISO格式
      let deadline = planData.deadline;
      if (!deadline.includes('T')) {
        // 处理 "9月20日 18:00" 这种格式
        const match = deadline.match(/(\d+)月(\d+)日\s*(\d+):(\d+)/);
        if (match) {
          const month = parseInt(match[1]) - 1;
          const day = parseInt(match[2]);
          const hour = parseInt(match[3]);
          const minute = parseInt(match[4]);
          const date = new Date();
          date.setMonth(month, day);
          date.setHours(hour, minute, 0, 0);
          deadline = date.toISOString();
        } else {
          // 默认一个月后
          const date = new Date();
          date.setMonth(date.getMonth() + 1);
          deadline = date.toISOString();
        }
      }
      const regionIds = organizations.filter(r => r.enabled).map(r => r.id);
      await api.createPlan({
        productId: planData.productId,
        regionIds,
        deadline,
        note: planData.note || ''
      });
      showToast('收集计划创建成功');
      await loadPlans();
      return true;
    } catch (error) {
      showToast(error.message || '创建计划失败', 'warning');
      return false;
    }
  };

  // 下发计划
  const releasePlan = async (planId) => {
    try {
      const plan = collectionPlans.find(p => p.id === planId);
      await api.releasePlan(planId, plan?.version);
      showToast('收集计划已下发至对应MSS领域接口人');
      await loadPlans();
    } catch (error) {
      showToast(error.message || '下发计划失败', 'warning');
    }
  };

  // 导出计划
  const exportPlan = async (plan) => {
    try {
      await api.exportPlan(plan.id);
      // 临时导出本地数据，后续替换为后端导出文件
      const product = resolvedProducts.find(p => p.id === plan.productId);
      const lines = [["收集计划", "产品", "产品领域", "产品型号", "BOM编码", "MSS区域", "需求数量(Pcs)"]];
      regions.forEach((region) => {
        const rows = rowsByProduct[plan.productId]?.[region.id] || [];
        rows.forEach((row) => lines.push([plan.planNo, product?.name || "", product?.category || "", row.sku, row.bom || "待补充", region.name, row.qty || 0]));
      });
      const csv = lines.map((line) => line.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(",")).join("\n");
      const url = URL.createObjectURL(new Blob([`﻿${csv}`], { type: "text/csv;charset=utf-8" }));
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${plan.planNo}_${product?.name || "新品"}_排产需求.csv`;
      anchor.click();
      URL.revokeObjectURL(url);
      showToast(`${product?.name || "产品"}需求已导出，可提交产品线排产`);
      await loadPlans();
    } catch (error) {
      showToast(error.message || '导出失败', 'warning');
    }
  };

  const resolvedProducts = useMemo(() => products.map((item) => {
    const domain = domains.find((entry) => entry.id === item.categoryId);
    return {
      ...item,
      category: domain?.name || "未配置领域",
      gtm: domain?.gtm || "待配置",
      domainOwner: domain?.domainOwner || item.domainOwner || "待配置",
      stockingOwner: domain?.stockingOwner || "待配置"
    };
  }), [products, domains]);
  const regions = useMemo(() => organizations.filter((item) => item.enabled).map((item) => ({ id: item.id, name: item.name, owner: item.owner })), [organizations]);
  const product = resolvedProducts.find((item) => item.id === selectedProductId) || resolvedProducts[0] || { name: '加载中', category: '', stage: '', gtm: '', domainOwner: '', skus: [] };
  const selectedPlan = collectionPlans.find((item) => item.id === selectedPlanId) || collectionPlans[0] || { deadline: '待定', demand: 0 };
  const region = regions.find((item) => item.id === activeRegion) || { name: '加载中', owner: '待配置' };

  // 加载区域草稿/已提交数据
  useEffect(() => {
    const loadDraft = async () => {
      if (collectionView !== 'entry' || !selectedPlanId || !activeRegion || !product?.id) return;
      setDraftLoading(true);
      setDraftVersion(null);
      try {
        const draft = await api.getDraft(selectedPlanId, activeRegion);
        if (draft && draft.items) {
          // 转换后端数据到前端rows格式，优先使用后端数据，没有的用默认空行
          const defaultRows = rowsForProduct(product, activeRegion);
          const mappedRows = defaultRows.map(defaultRow => {
            // 优先匹配sku id，再匹配sku名称
            const draftItem = draft.items.find(item =>
              item.productItemKey === defaultRow.id ||
              item.skuModel === defaultRow.sku
            );
            if (draftItem) {
              return {
                ...defaultRow,
                id: draftItem.id || defaultRow.id,
                sku: draftItem.skuModel || defaultRow.sku,
                bom: draftItem.bomCode || defaultRow.bom,
                qty: Number(draftItem.quantity) || 0,
                basis: draftItem.basis || '',
                date: draftItem.plannedUseDate || '',
                note: draftItem.note || '',
              };
            }
            return { ...defaultRow, qty: 0, basis: '', date: '', note: '' };
          });
          setRowsByProduct(current => ({
            ...current,
            [product.id]: {
              ...current[product.id],
              [activeRegion]: mappedRows
            }
          }));
          setDraftVersion(draft.version);
          setSavedAt(draft.savedAt ? new Date(draft.savedAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false }) : "--:--");
        } else {
          // 无草稿数据，初始化空行
          setRowsByProduct(current => ({
            ...current,
            [product.id]: {
              ...current[product.id],
              [activeRegion]: rowsForProduct(product, activeRegion)
            }
          }));
          setSavedAt("--:--");
        }
      } catch (error) {
        console.warn('Failed to load draft:', error);
        // 加载失败时使用空行
        setRowsByProduct(current => ({
          ...current,
          [product.id]: {
            ...current[product.id],
            [activeRegion]: rowsForProduct(product, activeRegion)
          }
        }));
        showToast('加载草稿数据失败', 'warning');
      } finally {
        setDraftLoading(false);
      }
    };
    loadDraft();
  }, [collectionView, selectedPlanId, activeRegion, product?.id]);
  // 当前用户头像和名称
  const userProfile = useMemo(() => {
    if (!currentUser) return { initial: '?', name: '未登录' };
    return {
      initial: currentUser.name.charAt(0),
      name: currentUser.name,
      role: currentUser.roleLabel,
    };
  }, [currentUser]);
  const rows = rowsByProduct[product.id]?.[activeRegion] || [];
  const visibleRows = rows.filter((row) => `${row.sku}${row.bom}`.toLowerCase().includes(search.toLowerCase()));
  const total = rows.reduce((sum, row) => sum + Number(row.qty || 0), 0);
  const missingBasis = rows.filter((row) => Number(row.qty) > 0 && !row.basis).length;
  const completedSkus = rows.filter((row) => Number(row.qty) > 0).length;

  const regionStatuses = useMemo(() => Object.fromEntries(regions.map((item) => {
    if (submittedScopes.includes(`${product.id}:${item.id}`)) return [item.id, "submitted"];
    const itemRows = rowsByProduct[product.id]?.[item.id] || [];
    return [item.id, itemRows.some((row) => Number(row.qty) > 0) ? "editing" : "idle"];
  })), [product.id, rowsByProduct, submittedScopes]);

  const updateRow = (rowIndex, field, value) => setRowsByProduct((current) => ({
    ...current,
    [product.id]: { ...current[product.id], [activeRegion]: current[product.id][activeRegion].map((row, index) => index === rowIndex ? { ...row, [field]: field === "qty" ? Math.max(0, Number(value)) : value } : row) },
  }));
  const showToast = (message, type = "success") => { setToast({ message, type }); window.setTimeout(() => setToast({ message: "", type: "success" }), 3200); };

  // 过滤当前角色有权限的导航菜单
  const visibleNavItems = useMemo(() => {
    if (!currentUser) return [];
    // 需求收集权限兼容：只要有任意需求相关权限就显示菜单
    const hasDemandPermission = ['demand:read', 'demand:save', 'demand:submit', 'plan:create', 'plan:review', 'plan:release'].some(p => currentUser.permissions.includes(p));
    return allNavItems.filter(item => {
      if (item.permission === 'demand:read') return hasDemandPermission;
      return currentUser.permissions.includes(item.permission);
    });
  }, [currentUser?.permissions]);

  const navigateTo = (label) => {
    const allowedLabels = visibleNavItems.map(item => item.label);
    if (!allowedLabels.includes(label)) { showToast(`当前角色无${label}模块访问权限`, "warning"); return; }
    setActiveNav(label); setPasteOpen(false);
    if (label === "需求收集") {
      // 根据当前用户角色设置默认视图
      const role = currentUser.role;
      if (role === "MSS_DOMAIN_OWNER") setCollectionView("tasks");
      else if (role === "REGIONAL_OWNER") {
        setCollectionView("regional-tasks");
        setSelectedProductId("chitu-b21");
        setActiveRegion("europe");
      }
      else setCollectionView("plans");
    }
  };
  const selectDemandProduct = (id) => { setSelectedProductId(id); setSearch(""); setPasteText(""); };
  const addProduct = async (newProduct) => {
    try {
      await api.createProduct(newProduct);
      showToast(`${newProduct.name}已创建，可开始收集需求`);
      await loadCatalog();
    } catch (error) {
      showToast(error.message || '产品创建失败', 'warning');
    }
  };
  const updateProduct = async (updatedProduct) => {
    try {
      await api.updateProduct(updatedProduct);
      showToast(`${updatedProduct.name}配置已更新`);
      await loadCatalog();
    } catch (error) {
      showToast(error.message || '产品更新失败', 'warning');
    }
  };
  const addDomain = async (domain) => {
    try {
      await api.createDomain(domain);
      showToast(`${domain.name}领域责任人配置已创建`);
      await loadCatalog();
    } catch (error) {
      showToast(error.message || '领域创建失败', 'warning');
    }
  };
  const updateDomain = async (domain) => {
    try {
      await api.updateDomain(domain);
      showToast(`${domain.name}领域责任人配置已更新`);
      await loadCatalog();
    } catch (error) {
      showToast(error.message || '领域更新失败', 'warning');
    }
  };
  const addOrganization = async (organization) => {
    try {
      await api.createOrganization(organization);
      showToast(`${organization.name}及代表处配置已创建`);
      await loadCatalog();
    } catch (error) {
      showToast(error.message || '组织创建失败', 'warning');
    }
  };
  const updateOrganization = async (organization) => {
    try {
      await api.updateOrganization(organization);
      showToast(`${organization.name}组织配置已更新`);
      await loadCatalog();
    } catch (error) {
      showToast(error.message || '组织更新失败', 'warning');
    }
  };
  // 字典项CRUD
  const addDictionaryItem = async (item) => {
    try {
      await api.createDictionaryItem(item);
      showToast(`${item.name}配置项已创建`);
      await loadCatalog();
    } catch (error) {
      showToast(error.message || '配置项创建失败', 'warning');
    }
  };
  const updateDictionaryItem = async (item) => {
    try {
      await api.updateDictionaryItem(item);
      showToast(`${item.name}配置项已更新`);
      await loadCatalog();
    } catch (error) {
      showToast(error.message || '配置项更新失败', 'warning');
    }
  };
  const deleteDictionaryItem = async (itemId) => {
    try {
      await api.deleteDictionaryItem(itemId);
      showToast('配置项已删除');
      await loadCatalog();
    } catch (error) {
      showToast(error.message || '配置项删除失败', 'warning');
    }
  };

  // 用户管理
  const [users, setUsers] = useState([]);
  const loadUsers = async () => {
    try {
      const userList = await api.getUserList();
      setUsers(userList);
    } catch (error) {
      console.warn('Failed to load users:', error);
    }
  };
  useEffect(() => {
    if (currentUser?.permissions?.includes('user:manage')) {
      loadUsers();
    }
  }, [currentUser?.permissions]);

  const addUser = async (user) => {
    try {
      await api.createUser(user);
      showToast(`用户${user.displayName}已创建`);
      await loadUsers();
    } catch (error) {
      showToast(error.message || '用户创建失败', 'warning');
    }
  };
  const updateUser = async (user) => {
    try {
      await api.updateUser(user);
      showToast(`用户信息已更新`);
      await loadUsers();
      // 如果更新的是当前用户，重新加载用户信息
      if (user.id === currentUser.id) {
        await loadCurrentUser();
      }
    } catch (error) {
      showToast(error.message || '用户更新失败', 'warning');
    }
  };
  const saveDraft = async () => {
    if (!selectedPlanId || !activeRegion || !product) return;
    try {
      // 转换为后端需要的格式
      const items = rows.map(row => ({
        productItemKey: row.id || row.sku,
        quantity: Number(row.qty) || 0,
        basis: row.basis || null,
        plannedUseDate: row.date || null,
        note: row.note || null,
      }));
      const result = await api.saveDraft(selectedPlanId, activeRegion, {
        version: draftVersion,
        items
      });
      setDraftVersion(result.version);
      const time = new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });
      setSavedAt(time);
      showToast(`${product.name} · ${region.name}需求草稿已保存`);
    } catch (error) {
      showToast(error.message || '草稿保存失败', 'warning');
    }
  };
  const submit = async () => {
    if (!selectedPlanId || !activeRegion) return;
    if (completedSkus < rows.length || missingBasis > 0) {
      showToast(`还有${rows.length - completedSkus + missingBasis}项待完善，请先补充后提交`, "warning");
      document.querySelector(".field-error")?.focus();
      return;
    }
    try {
      // 先保存最新数据，再提交
      await saveDraft();
      await api.submitRegion(selectedPlanId, activeRegion, draftVersion);
      // 更新本地状态
      setSubmittedScopes((current) => [...new Set([...current, `${product.id}:${activeRegion}`])]);
      // 重新加载计划列表，获取最新状态
      await loadPlans();
      showToast(`${product.name} · ${region.name}需求已提交至领域接口人`);
      // 如果是区域接口人，提交后返回任务列表
      if (currentUser.role === 'REGIONAL_OWNER') {
        setCollectionView('regional-tasks');
      }
    } catch (error) {
      showToast(error.message || '提交失败，请重试', 'warning');
    }
  };
  const applyPaste = () => {
    const values = pasteText.trim().split(/[\t,，\s]+/).map(Number).filter((value) => Number.isFinite(value));
    if (values.length < rows.length) { showToast(`请粘贴${rows.length}个SKU对应的数量`, "warning"); return; }
    setRowsByProduct((current) => ({ ...current, [product.id]: { ...current[product.id], [activeRegion]: current[product.id][activeRegion].map((row, index) => ({ ...row, qty: Math.max(0, values[index]) })) } }));
    setPasteOpen(false); showToast(`已从Excel填入${rows.length}个SKU数量`);
  };
  const downloadTemplate = () => {
    const lines = rows.map((item) => `${item.sku},${item.bom || "待补充"},,,,`).join("\n");
    const url = URL.createObjectURL(new Blob([`\ufeffSKU,BOM编码,需求数量(Pcs),需求依据,计划使用时间,备注\n${lines}`], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = `${product.name}样机需求填报模板.csv`; anchor.click(); URL.revokeObjectURL(url); showToast(`${product.name}填报模板已下载`);
  };

  // 加载中状态（初始加载或配置数据加载中）
  if (loading || catalogLoading) {
    return <ErrorBoundary>
      <div className="login-container">
        <div className="login-card" style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '18px', fontWeight: 500, marginBottom: '8px' }}>
            {loading ? '登录中...' : '加载配置数据...'}
          </div>
          <div style={{ fontSize: '14px', color: '#6b7280' }}>请稍候</div>
        </div>
      </div>
    </ErrorBoundary>;
  }

  // 未登录显示登录页
  if (!authenticated || !currentUser) {
    return <ErrorBoundary>
      <LoginPage onLogin={handleLogin} loading={loading} />
    </ErrorBoundary>;
  }

  return <ErrorBoundary><div className="app-shell">
    <header className="topbar"><div className="brand">MSS样机备货管理平台</div><div className="topbar-actions">
      {/* 区域选择器：所有角色都可切换查看区域数据 */}
      <label className="header-select-label">区域：<select value={activeRegion} onChange={(event) => setActiveRegion(event.target.value)} aria-label="切换区域">{regions.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label>
      <div className="header-divider" />
      <div className="notification-wrap">
        <button className="icon-button" type="button" onClick={() => setNotificationsOpen((open) => !open)} aria-label="通知"><IconBell size={24} stroke={1.75} /><span className="notification-badge">3</span></button>
        {notificationsOpen && <div className="notification-popover"><strong>提醒中心</strong><p>东南亚MKT还有1项需求依据待补充</p><p>Chitu VN2批次将在3天后截止</p></div>}
      </div>
      <div className="user-info">
        <div className="user-avatar">{userProfile.initial}</div>
        <div className="user-details">
          <div className="user-name">{userProfile.name}</div>
          <div className="user-role">{userProfile.role}</div>
        </div>
        <button className="logout-button" type="button" onClick={handleLogout} title="退出登录">
          <IconLogout size={16} /> 退出
        </button>
      </div>
    </div></header>
    <aside className={`sidebar ${activeNav !== "需求收集" || collectionView !== "entry" ? "sidebar-full" : ""}`}><nav aria-label="主导航">{visibleNavItems.map(({ label, icon: Icon }) => <button type="button" key={label} className={`nav-item ${activeNav === label ? "nav-active" : ""}`} onClick={() => navigateTo(label)}><Icon size={22} stroke={1.65} /><span>{label}</span></button>)}</nav></aside>

    {activeNav === "运营总览" && <OverviewPage products={resolvedProducts} onNavigate={navigateTo} />}
    {activeNav === "需求收集" && collectionView === "plans" && <CollectionPlanPage products={resolvedProducts} organizations={regions} rowsByProduct={rowsByProduct} plans={collectionPlans} onCreatePlan={createPlan} onReleasePlan={releasePlan} onExportPlan={exportPlan} showToast={showToast} onOpenProgress={(planId, tab) => { setSelectedPlanId(planId); setTaskInitialTab(tab); setCollectionView("task-detail"); }} />}
    {activeNav === "需求收集" && collectionView === "tasks" && <DomainTaskPage products={resolvedProducts} organizations={organizations} plans={collectionPlans} onOpenTask={(planId, tab) => { setSelectedPlanId(planId); setTaskInitialTab(tab); setCollectionView("task-detail"); }} />}
    {activeNav === "需求收集" && collectionView === "regional-tasks" && <RegionalTaskPage products={resolvedProducts} organizations={organizations} plans={collectionPlans} activeRegion={activeRegion} onOpenEntry={(planId, regionId) => { const plan = collectionPlans.find((item) => item.id === planId); if (plan) setSelectedProductId(plan.productId); setSelectedPlanId(planId); setActiveRegion(regionId); setCollectionView("entry"); }} />}
    {activeNav === "需求收集" && collectionView === "task-detail" && <CollectionTaskDetailPage role={currentUser.role} plan={selectedPlan} products={resolvedProducts} organizations={organizations} rowsByProduct={rowsByProduct} initialTab={taskInitialTab} showToast={showToast} onBack={() => setCollectionView(currentUser.role === "GTM" || currentUser.role === "ADMIN" ? "plans" : "tasks")} onOpenEntry={(planId, regionId) => { const plan = collectionPlans.find((item) => item.id === planId); if (plan) setSelectedProductId(plan.productId); setSelectedPlanId(planId); setActiveRegion(regionId); setCollectionView("entry"); }} onFeedback={(planId, demand) => setCollectionPlans((current) => current.map((item) => item.id === planId ? { ...item, demand, status: "待GTM收口" } : item))} />}
    {activeNav === "发货审批" && <ShipmentApprovalPage showToast={showToast} />}
    {activeNav === "执行情况" && <ExecutionPage products={resolvedProducts} organizations={organizations} showToast={showToast} />}
    {activeNav === "库存核对" && <InventoryPage products={resolvedProducts} showToast={showToast} />}
    {activeNav === "配置管理" && <ConfigurationPage products={products} domains={domains} organizations={organizations} dictionaries={dictionaries} users={users} canEdit={currentUser.permissions.includes('config:write')} canManageUsers={currentUser.permissions.includes('user:manage')} onAddProduct={addProduct} onUpdateProduct={updateProduct} onAddDomain={addDomain} onUpdateDomain={updateDomain} onAddOrganization={addOrganization} onUpdateOrganization={updateOrganization} onAddDictionaryItem={addDictionaryItem} onUpdateDictionaryItem={updateDictionaryItem} onDeleteDictionaryItem={deleteDictionaryItem} onAddUser={addUser} onUpdateUser={updateUser} />}

    {activeNav === "需求收集" && collectionView === "entry" && <main className="workspace">
      <section className="page-heading demand-page-heading"><div><button className="back-to-plan" type="button" onClick={() => setCollectionView(currentUser.role === "MSS_DOMAIN_OWNER" ? "task-detail" : currentUser.role === "REGIONAL_OWNER" ? "regional-tasks" : "plans")}><IconChevronDown size={17} />返回{currentUser.role === "MSS_DOMAIN_OWNER" ? "领域任务" : currentUser.role === "REGIONAL_OWNER" ? "我的填报任务" : "收集计划"}</button><h1>{product.name} · {region.name}需求填报</h1><div className="batch-meta" aria-label="批次信息"><span>产品领域</span><strong>{product.category}</strong><i>·</i><span>样机阶段</span><strong>{product.stage}</strong><i>·</i><span>GTM接口人</span><strong>{product.gtm}</strong><i>·</i><span>领域接口人</span><strong>{product.domainOwner || "待配置"}</strong><i>·</i><span>区域接口人</span><strong>{region?.owner || "待配置"}</strong><i>·</i><span>截止</span><strong className="deadline">{selectedPlan?.deadline || product.deadline}</strong></div></div><label className="product-switch"><span>当前收集计划</span><select value={product.id} onChange={(event) => selectDemandProduct(event.target.value)} aria-label="选择需求产品">{resolvedProducts.filter((item) => item.enabled).map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select><small>{currentUser.role === "MSS_DOMAIN_OWNER" ? "领域接口人可代区域录入" : "提交后进入领域汇总"}</small></label></section>
      <section className="content-frame"><div className="main-panel">
        <div className="region-tabs" role="tablist" aria-label="MKT区域">{regions.map((item) => <button type="button" role="tab" aria-selected={activeRegion === item.id} key={item.id} className={activeRegion === item.id ? "region-active" : ""} onClick={() => setActiveRegion(item.id)}>{item.name}<StatusDot status={regionStatuses[item.id]} /></button>)}</div>
        <div className="form-section"><h2>{region.name}需求填报 <span className="section-product-tag">{product.name} · {product.skus.length ? `${product.skus.length}个SKU` : "产品级需求"}</span></h2><p className="entry-recipient">当前数据将提交至：<strong>{product.category}领域接口人 {product.domainOwner || "待配置"}</strong>，由领域接口人统一检查后反馈GTM。</p><div className="table-toolbar"><label className="search-box"><IconSearch size={19} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索产品型号或BOM编码" /></label><button className="button button-outline" type="button" onClick={() => setPasteOpen(true)}><IconFileSpreadsheet size={19} />从Excel粘贴</button><button className="text-button" type="button" onClick={downloadTemplate}><IconDownload size={18} />下载填报模板</button><span className="toolbar-hint">BOM未就绪时可先按产品级收集</span></div>
          <div className="demand-table-wrap"><table className="demand-table"><thead><tr><th>SKU</th><th>BOM编码</th><th>需求数量(Pcs)<sup>*</sup></th><th>需求依据<sup>*</sup></th><th>计划使用时间</th><th>备注</th><th>状态</th></tr></thead><tbody>
            {visibleRows.map((row) => { const rowIndex = rows.findIndex((item) => item.sku === row.sku); const incomplete = Number(row.qty) <= 0 || !row.basis; return <tr key={row.sku} className={incomplete ? "row-incomplete" : ""}><td className="sku-cell">{row.sku}{row.provisional && <small className="provisional-note">产品线信息可后补</small>}</td><td>{row.bom || <span className="bom-placeholder">待产品线补充</span>}</td><td><input className={`quantity-input ${Number(row.qty) <= 0 ? "field-error" : ""}`} type="number" min="0" value={row.qty} onChange={(event) => updateRow(rowIndex, "qty", event.target.value)} aria-label={`${row.sku}需求数量`} /></td><td><select className={!row.basis && Number(row.qty) > 0 ? "field-error" : ""} value={row.basis} onChange={(event) => updateRow(rowIndex, "basis", event.target.value)} aria-label={`${row.sku}需求依据`}>{basisOptions.map((option) => <option key={option} value={option}>{option || "请选择需求依据"}</option>)}</select>{!row.basis && Number(row.qty) > 0 && <span className="inline-error"><IconAlertTriangle size={15} />请补充需求依据</span>}</td><td><label className="date-field"><input type="text" inputMode="numeric" value={row.date} onChange={(event) => updateRow(rowIndex, "date", event.target.value)} placeholder="YYYY-MM-DD" aria-label={`${row.sku}计划使用时间`} /><IconCalendar size={18} /></label></td><td><input className="note-input" value={row.note} onChange={(event) => updateRow(rowIndex, "note", event.target.value)} placeholder="请输入" aria-label={`${row.sku}备注`} /></td><td><span className={incomplete ? "state-text state-warning" : "state-text state-ready"}><StatusDot status={incomplete ? "editing" : "submitted"} />{incomplete ? "待完善" : "已填写"}</span></td></tr>; })}
            {visibleRows.length === 0 && <tr><td className="empty-cell" colSpan="7">未找到匹配的SKU或BOM编码</td></tr>}
          </tbody><tfoot><tr><td colSpan="2">{product.name} · {region.name}合计</td><td colSpan="5"><strong>{total.toLocaleString()} Pcs</strong></td></tr></tfoot></table></div>
        </div>
      </div><aside className="support-panel"><section className="check-section"><h3>提交前检查</h3><ul><li><IconCircleCheckFilled className="check-icon" size={20} /><span>{completedSkus}/{rows.length}个填报项已填写</span></li><li>{missingBasis ? <IconAlertTriangleFilled className="warning-icon" size={20} /> : <IconCircleCheckFilled className="check-icon" size={20} />}<span>{missingBasis ? `${missingBasis}项需求依据待补充` : "需求依据已完整"}</span></li><li><IconCircleCheckFilled className="check-icon" size={20} /><span>接口人 {region.owner}</span></li><li><IconCircleCheckFilled className="check-icon" size={20} /><span>预计合计</span><strong>{total.toLocaleString()} Pcs</strong></li></ul></section><section className="progress-section"><h3>本产品其他区域</h3><ul>{regions.filter((item) => item.id !== activeRegion).slice(0, 3).map((item) => <li key={item.id}><span>{item.name}</span><span className={`progress-label label-${regionStatuses[item.id]}`}><StatusDot status={regionStatuses[item.id]} />{regionStatuses[item.id] === "submitted" ? "已提交" : regionStatuses[item.id] === "editing" ? "填报中" : "未开始"}</span></li>)}</ul></section></aside></section>
    </main>}

    {activeNav === "需求收集" && collectionView === "entry" && <footer className="sticky-actions"><div className="save-state"><IconCircleCheck size={24} /><span>已自动保存</span><strong>{savedAt}</strong></div><div className={`validation-state ${missingBasis ? "has-warning" : "all-clear"}`}>{missingBasis ? <IconAlertTriangle size={22} /> : <IconCheck size={22} />}<span>{missingBasis ? `还有${missingBasis}项待完善` : currentUser.role === "MSS_DOMAIN_OWNER" ? "提交后将反馈GTM收口" : "提交后进入领域汇总"}</span></div><div className="footer-buttons"><button className="button button-secondary" type="button" onClick={saveDraft}>保存草稿</button><button className="button button-primary" type="button" onClick={submit}>{currentUser.role === "MSS_DOMAIN_OWNER" ? `将${region.name}纳入领域汇总` : "提交至领域接口人"}</button></div></footer>}
    {pasteOpen && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setPasteOpen(false); }}><section className="paste-modal" role="dialog" aria-modal="true" aria-labelledby="paste-title"><div className="modal-header"><div><h2 id="paste-title">从Excel粘贴数量</h2><p>{product.name}共{rows.length}个SKU，请按下方顺序粘贴一整行。</p></div><button className="icon-button" type="button" onClick={() => setPasteOpen(false)} aria-label="关闭"><IconX size={22} /></button></div><div className="paste-order" style={{ gridTemplateColumns: `repeat(${Math.min(rows.length, 4)}, 1fr)` }}>{rows.map((item) => <span key={item.sku}>{item.sku}</span>)}</div><textarea autoFocus value={pasteText} onChange={(event) => setPasteText(event.target.value)} aria-label="粘贴Excel数量" /><div className="modal-actions"><button className="button button-secondary" type="button" onClick={() => setPasteOpen(false)}>取消</button><button className="button button-primary" type="button" onClick={applyPaste}>填入{rows.length}个SKU</button></div></section></div>}
    <Toast message={toast.message} type={toast.type} onClose={() => setToast({ message: "", type: "success" })} />
  </div></ErrorBoundary>;
}
