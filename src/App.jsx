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
import { api, adaptCatalogData, adaptPlanData, auth } from "./api/client.js";
import LoginPage from "./LoginPage.jsx";
import ErrorBoundary from "./components/ErrorBoundary.jsx";

function rowsForProduct(product, regionId, previousRows = []) {
  const demandUnits = product?.skus?.length ? product.skus : [{ sku: `${product?.name || "产品"}（型号待补充）`, bom: "", provisional: true }];
  return demandUnits.map((sku) => {
    const previous = previousRows.find((item) => item.sku === sku.sku);
    if (previous) return { ...previous, bom: sku.bom };
    return { ...sku, qty: 0, basis: "", date: "", note: "" };
  });
}

function buildDemandRows(products, organizations) {
  return Object.fromEntries(products.map((product) => [product.id, Object.fromEntries(organizations.map((region) => [
    region.id,
    Object.fromEntries((region.offices || []).map((office) => [office.id, rowsForProduct(product, region.id)]))
  ]))]));
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
  const [products, setProducts] = useState([]);
  const [domains, setDomains] = useState([]);
  const [mssDomains, setMssDomains] = useState([]);
  const [organizations, setOrganizations] = useState([]);
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
  const [selectedProductId, setSelectedProductId] = useState(null);
  const [activeRegion, setActiveRegion] = useState(null);
  const [activeOffice, setActiveOffice] = useState(null);
  const [rowsByProduct, setRowsByProduct] = useState({});

  // 页面状态
  const [search, setSearch] = useState("");
  const [activeNav, setActiveNav] = useState("运营总览");
  const [collectionView, setCollectionView] = useState("plans");
  const [collectionPlans, setCollectionPlans] = useState([]);
  const [selectedPlanId, setSelectedPlanId] = useState(null);
  const [draftVersion, setDraftVersion] = useState(undefined);
  const [taskInitialTab, setTaskInitialTab] = useState("progress");
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState("307\t405\t170\t109");
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [toast, setToast] = useState({ message: "", type: "success" });
  const [savedAt, setSavedAt] = useState("--:--");
  const [submittedScopes, setSubmittedScopes] = useState([]);

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
        // 加载业务数据
        await Promise.all([loadCatalog(), loadUsers(), loadPlans()]);
        setAuthenticated(true);
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
    // 加载业务数据
    await Promise.all([loadCatalog(), loadUsers(), loadPlans()]);
    setAuthenticated(true);
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
      const { products: apiProducts, domains: apiDomains, mssDomains: apiMssDomains, organizations: apiOrgs, dictionaries: apiDicts } = adaptCatalogData(catalog);
      setProducts(apiProducts);
      setDomains(apiDomains);
      setMssDomains(apiMssDomains || catalog.mssDomains || []);
      setOrganizations(apiOrgs);
      setSelectedProductId((current) => apiProducts.some((item) => item.id === current) ? current : apiProducts[0]?.id || null);
      setActiveRegion((current) => apiOrgs.some((item) => item.id === current) ? current : apiOrgs[0]?.id || null);
      if (apiDicts && Object.keys(apiDicts).length) setDictionaries(apiDicts);
      // 更新需求行数据，新增产品也能生成行
      setRowsByProduct(buildDemandRows(apiProducts, apiOrgs));
    } catch (error) {
      console.warn('Failed to load catalog from API:', error);
      throw error;
    } finally {
      setCatalogLoading(false);
    }
  };

  const loadPlans = async () => {
    try {
      const planList = (await api.getPlans()).map(adaptPlanData);
      setCollectionPlans(planList);
      setSubmittedScopes(planList.flatMap((plan) => plan.submittedRegions.map((regionId) => `${plan.productId}:${regionId}`)));
      setSelectedPlanId((current) => current && planList.some((plan) => plan.id === current) ? current : planList[0]?.id || null);
    } catch (error) {
      console.warn('Failed to load collection plans:', error);
      setCollectionPlans([]);
    }
  };

  useEffect(() => {
    if (currentUser?.role !== 'REGIONAL_OWNER' || !collectionPlans.length) return;
    const firstPlan = collectionPlans[0];
    setSelectedPlanId(firstPlan.id);
    setSelectedProductId(firstPlan.productId);
    if (firstPlan.regionProgress?.[0]?.regionId) setActiveRegion(firstPlan.regionProgress[0].regionId);
  }, [currentUser?.role, collectionPlans]);

  const resolvedProducts = useMemo(() => products.map((item) => {
    const domain = domains.find((entry) => entry.id === item.categoryId);
    return { ...item, category: domain?.name || "未配置领域", gtm: domain?.gtm || "待配置", domainOwner: domain?.domainOwner || item.domainOwner || "待配置", stockingOwner: domain?.stockingOwner || "待配置" };
  }), [products, domains]);
  const regions = useMemo(() => organizations.filter((item) => item.enabled).map((item) => ({ id: item.id, name: item.name, owner: item.owner })), [organizations]);
  const product = resolvedProducts.find((item) => item.id === selectedProductId) || resolvedProducts[0] || { id: '', name: '暂无产品', category: '待配置', stage: '待配置', gtm: '待配置', stockingOwner: '待配置', skus: [], enabled: false };
  const selectedPlan = collectionPlans.find((item) => item.id === selectedPlanId) || collectionPlans[0];
  const region = regions.find((item) => item.id === activeRegion) || { id: '', name: '暂无区域', owner: '待配置' };
  const fullRegion = organizations.find((item) => item.id === activeRegion) || { offices: [] };
  const offices = fullRegion.offices || [];
  const office = offices.find((item) => item.id === activeOffice) || offices[0] || { id: '', name: '暂无代表处', owner: '待配置' };
  // 自动选择当前区域下第一个代表处
  useEffect(() => {
    if (offices.length && (!activeOffice || !offices.find(o => o.id === activeOffice))) {
      setActiveOffice(offices[0].id);
    }
  }, [activeRegion, offices, activeOffice]);
  // 当前用户头像和名称
  const userProfile = useMemo(() => {
    if (!currentUser) return { initial: '?', name: '未登录' };
    return {
      initial: currentUser.name?.charAt(0) || '?',
      name: currentUser.name || '未命名用户',
      role: currentUser.roleLabel,
    };
  }, [currentUser]);
  const currentRegionRows = rowsByProduct[product.id]?.[activeRegion] || {};
  const rows = currentRegionRows[activeOffice] || [];
  const allRegionRows = Object.values(currentRegionRows).flat();
  const visibleRows = rows.filter((row) => `${row.sku}${row.bom}`.toLowerCase().includes(search.toLowerCase()));
  const officeTotal = rows.reduce((sum, row) => sum + Number(row.qty || 0), 0);
  const total = allRegionRows.reduce((sum, row) => sum + Number(row.qty || 0), 0);
  const missingBasis = allRegionRows.filter((row) => Number(row.qty) > 0 && !row.basis).length;
  const completedSkus = allRegionRows.filter((row) => Number(row.qty) > 0).length;

  const regionStatuses = useMemo(() => Object.fromEntries(regions.map((item) => {
    if (submittedScopes.includes(`${product.id}:${item.id}`)) return [item.id, "submitted"];
    const itemRegionRows = Object.values(rowsByProduct[product.id]?.[item.id] || {}).flat();
    return [item.id, itemRegionRows.some((row) => Number(row.qty) > 0) ? "editing" : "idle"];
  })), [product.id, rowsByProduct, submittedScopes]);

  // 计算每个代表处的填报状态
  const officeStatuses = useMemo(() => Object.fromEntries(offices.map((o) => {
    const officeRows = currentRegionRows[o.id] || [];
    return [o.id, officeRows.some((row) => Number(row.qty) > 0) ? "editing" : "idle"];
  })), [offices, currentRegionRows]);

  const updateRow = (rowIndex, field, value) => setRowsByProduct((current) => {
    const currentProductRows = current[product.id] || {};
    const currentRegionRowsData = currentProductRows[activeRegion] || {};
    const currentOfficeRows = currentRegionRowsData[activeOffice] || [];
    return {
      ...current,
      [product.id]: {
        ...currentProductRows,
        [activeRegion]: {
          ...currentRegionRowsData,
          [activeOffice]: currentOfficeRows.map((row, index) => index === rowIndex ? { ...row, [field]: field === "qty" ? Math.max(0, Number(value)) : value } : row)
        }
      }
    };
  });
  const showToast = (message, type = "success") => { setToast({ message, type }); window.setTimeout(() => setToast({ message: "", type: "success" }), 3200); };

  useEffect(() => {
    if (collectionView !== "entry" || !selectedPlanId || !activeRegion || !offices.length) return;
    let active = true;
    api.getDraft(selectedPlanId, activeRegion).then((draft) => {
      if (!active) return;
      const targetPlan = collectionPlans.find((item) => item.id === selectedPlanId);
      const targetProduct = resolvedProducts.find((item) => item.id === targetPlan?.productId);
      if (!targetProduct) return;
      // 初始化所有代表处的默认空行
      const nextOfficeRows = Object.fromEntries(offices.map((o) => [o.id, rowsForProduct(targetProduct, activeRegion)]));
      // 填充草稿数据，按officeId分组
      draft.items.forEach((item) => {
        const targetOfficeId = item.officeId || offices[0].id; // 兼容旧数据无officeId的情况
        const officeRows = nextOfficeRows[targetOfficeId];
        if (!officeRows) return;
        const rowIndex = officeRows.findIndex((row) => row.id === item.productItemKey || row.sku === item.skuModel);
        if (rowIndex >= 0) {
          officeRows[rowIndex] = {
            ...officeRows[rowIndex],
            qty: item.quantity,
            basis: item.basis || "",
            date: item.plannedUseDate || "",
            note: item.note || "",
            officeId: targetOfficeId
          };
        }
      });
      // 给所有行加上officeId
      Object.entries(nextOfficeRows).forEach(([officeId, rows]) => {
        rows.forEach(row => row.officeId = officeId);
      });
      setRowsByProduct((current) => ({
        ...current,
        [targetProduct.id]: {
          ...current[targetProduct.id],
          [activeRegion]: nextOfficeRows
        }
      }));
      setDraftVersion(draft.version);
    }).catch((error) => showToast(error.message, "warning"));
    return () => { active = false; };
  }, [collectionView, selectedPlanId, activeRegion, offices]);

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
  const addMssDomain = async (mssDomain) => {
    try {
      await api.createMssDomain(mssDomain);
      showToast(`${mssDomain.name}MSS业务领域已创建`);
      await loadCatalog();
    } catch (error) {
      showToast(error.message || 'MSS领域创建失败', 'warning');
    }
  };
  const updateMssDomain = async (mssDomain) => {
    try {
      await api.updateMssDomain(mssDomain);
      showToast(`${mssDomain.name}MSS业务领域已更新`);
      await loadCatalog();
    } catch (error) {
      showToast(error.message || 'MSS领域更新失败', 'warning');
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
  const saveDraft = async (silent = false) => {
    if (!selectedPlanId) return null;
    const draft = await api.saveDraft(selectedPlanId, activeRegion, {
      version: draftVersion,
      items: allRegionRows.map((row) => ({
        productItemKey: row.id || row.sku,
        quantity: Number(row.qty || 0),
        basis: row.basis || "",
        plannedUseDate: row.date || undefined,
        note: row.note || "",
        officeId: row.officeId || activeOffice
      })),
    });
    setDraftVersion(draft.version);
    const time = new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false }); setSavedAt(time);
    if (!silent) showToast(`${product.name} · ${region.name}需求草稿已保存`);
    return draft;
  };
  const submit = async () => {
    if (missingBasis > 0) { showToast(`还有${missingBasis}项需求依据待完善`, "warning"); document.querySelector(".field-error")?.focus(); return; }
    try {
      const draft = await saveDraft(true);
      await api.submitRegion(selectedPlanId, activeRegion, draft?.version);
      await loadPlans();
      showToast(`${product.name} · ${region.name}需求已提交至领域接口人`);
    } catch (error) { showToast(error.message, "warning"); }
  };

  useEffect(() => {
    if (collectionView !== "entry" || !selectedPlanId || !["MSS_DOMAIN_OWNER", "REGIONAL_OWNER"].includes(currentUser?.role)) return;
    const timer = window.setTimeout(() => { saveDraft(true).catch(() => {}); }, 2000);
    return () => window.clearTimeout(timer);
  }, [rows, collectionView, selectedPlanId, activeRegion]);
  const applyPaste = () => {
    const values = pasteText.trim().split(/[\t,，\s]+/).map(Number).filter((value) => Number.isFinite(value));
    if (values.length < rows.length) { showToast(`请粘贴${rows.length}个SKU对应的数量（当前${office.name}）`, "warning"); return; }
    setRowsByProduct((current) => {
      const currentProductRows = current[product.id] || {};
      const currentRegionRowsData = currentProductRows[activeRegion] || {};
      const currentOfficeRows = currentRegionRowsData[activeOffice] || [];
      return {
        ...current,
        [product.id]: {
          ...currentProductRows,
          [activeRegion]: {
            ...currentRegionRowsData,
            [activeOffice]: currentOfficeRows.map((row, index) => ({ ...row, qty: Math.max(0, values[index]) }))
          }
        }
      };
    });
    setPasteOpen(false); showToast(`已从Excel填入${office.name}${rows.length}个SKU数量`);
  };
  const downloadTemplate = () => {
    const lines = rows.map((item) => `${item.sku},${item.bom || "待补充"},,,,`).join("\n");
    const url = URL.createObjectURL(new Blob([`\ufeffSKU,BOM编码,需求数量(Pcs),需求依据,计划使用时间,备注\n${lines}`], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = `${product.name}样机需求填报模板.csv`; anchor.click(); URL.revokeObjectURL(url); showToast(`${product.name}填报模板已下载`);
  };

  const createCollectionPlan = async (payload) => {
    const created = adaptPlanData(await api.createPlan(payload));
    await loadPlans();
    showToast(`${created.product?.name || "新品"}收集计划已创建`);
    return created;
  };
  const releaseCollectionPlan = async (plan) => {
    try { await api.releasePlan(plan.id, plan.version); await loadPlans(); showToast("收集计划已下发至对应MSS领域接口人"); }
    catch (error) { showToast(error.message, "warning"); }
  };
  const exportCollectionPlan = async (plan) => {
    try {
      const result = await api.exportPlan(plan.id);
      const binary = atob(result.contentBase64); const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bytes], { type: result.mimeType })); const anchor = document.createElement("a"); anchor.href = url; anchor.download = result.fileName; anchor.click(); URL.revokeObjectURL(url);
      await loadPlans(); showToast(`已导出${result.rowCount}条正式需求，可提交产品线排产`);
    } catch (error) { showToast(error.message, "warning"); }
  };
  const feedbackCollectionPlan = async (plan, note) => {
    await api.submitDomainFeedback(plan.id, { confirmed: true, note, version: plan.version });
    await loadPlans();
  };

  // 加载中状态
  if (loading || catalogLoading) {
    return <ErrorBoundary><div className="login-container">
      <div className="login-card" style={{ textAlign: 'center' }}>
        <div style={{ fontSize: '18px', fontWeight: 500 }}>{loading ? '登录中...' : '加载配置数据...'}</div>
      </div>
    </div></ErrorBoundary>;
  }

  // 未登录显示登录页
  if (!authenticated || !currentUser) {
    return <ErrorBoundary><LoginPage onLogin={handleLogin} loading={loading} /></ErrorBoundary>;
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
    {activeNav === "需求收集" && collectionView === "plans" && <CollectionPlanPage products={resolvedProducts} organizations={organizations} plans={collectionPlans} onCreatePlan={createCollectionPlan} onReleasePlan={releaseCollectionPlan} onExportPlan={exportCollectionPlan} showToast={showToast} onOpenProgress={(planId, tab) => { setSelectedPlanId(planId); setTaskInitialTab(tab); setCollectionView("task-detail"); }} />}
    {activeNav === "需求收集" && collectionView === "tasks" && <DomainTaskPage products={resolvedProducts} organizations={organizations} plans={collectionPlans} onOpenTask={(planId, tab) => { setSelectedPlanId(planId); setTaskInitialTab(tab); setCollectionView("task-detail"); }} />}
    {activeNav === "需求收集" && collectionView === "regional-tasks" && <RegionalTaskPage products={resolvedProducts} organizations={organizations} plans={collectionPlans} activeRegion={activeRegion} onOpenEntry={(planId, regionId) => { const plan = collectionPlans.find((item) => item.id === planId); if (plan) setSelectedProductId(plan.productId); setSelectedPlanId(planId); setActiveRegion(regionId); setCollectionView("entry"); }} />}
    {activeNav === "需求收集" && collectionView === "task-detail" && <CollectionTaskDetailPage role={currentUser.role} plan={selectedPlan} products={resolvedProducts} organizations={organizations} rowsByProduct={rowsByProduct} initialTab={taskInitialTab} showToast={showToast} onBack={() => setCollectionView(currentUser.role === "GTM" || currentUser.role === "ADMIN" ? "plans" : "tasks")} onOpenEntry={(planId, regionId) => { const plan = collectionPlans.find((item) => item.id === planId); if (plan) setSelectedProductId(plan.productId); setSelectedPlanId(planId); setActiveRegion(regionId); setCollectionView("entry"); }} onFeedback={feedbackCollectionPlan} />}
    {activeNav === "发货审批" && <ShipmentApprovalPage showToast={showToast} />}
    {activeNav === "执行情况" && <ExecutionPage products={resolvedProducts} organizations={organizations} showToast={showToast} permissions={currentUser.permissions} />}
    {activeNav === "库存核对" && <InventoryPage products={resolvedProducts} showToast={showToast} />}
    {activeNav === "配置管理" && <ConfigurationPage products={products} domains={domains} mssDomains={mssDomains} organizations={organizations} dictionaries={dictionaries} users={users} currentUserRole={currentUser.role} canEdit={currentUser.permissions.includes('config:write')} canManageMss={currentUser.role === 'ADMIN'} canManageUsers={currentUser.permissions.includes('user:manage')} onAddProduct={addProduct} onUpdateProduct={updateProduct} onAddDomain={addDomain} onUpdateDomain={updateDomain} onAddMssDomain={addMssDomain} onUpdateMssDomain={updateMssDomain} onAddOrganization={addOrganization} onUpdateOrganization={updateOrganization} onAddDictionaryItem={addDictionaryItem} onUpdateDictionaryItem={updateDictionaryItem} onDeleteDictionaryItem={deleteDictionaryItem} onAddUser={addUser} onUpdateUser={updateUser} />}
    {activeNav === "提醒中心" && <main className="workspace">
      <section className="page-heading"><h1>提醒中心</h1><p>待处理事项、截止提醒、异常告警将在这里展示</p></section>
      <section className="ops-surface" style={{ textAlign: 'center', padding: '80px 20px', color: '#6b7280' }}>
        <IconBell size={48} style={{ marginBottom: '16px', opacity: 0.3 }} />
        <h3>功能建设中</h3>
        <p>后续版本将上线：需求截止提醒、库存差异告警、待审批事项、异常数据预警等功能</p>
      </section>
    </main>}
    {activeNav === "数据明细" && <main className="workspace">
      <section className="page-heading"><h1>数据明细</h1><p>全链路需求、发货、库存、执行明细查询与导出</p></section>
      <section className="ops-surface" style={{ textAlign: 'center', padding: '80px 20px', color: '#6b7280' }}>
        <IconChartBar size={48} style={{ marginBottom: '16px', opacity: 0.3 }} />
        <h3>功能建设中</h3>
        <p>后续版本将上线：多维度数据筛选、明细导出、自定义报表等功能</p>
      </section>
    </main>}

    {activeNav === "需求收集" && collectionView === "entry" && <main className="workspace">
      <section className="page-heading demand-page-heading"><div><button className="back-to-plan" type="button" onClick={() => setCollectionView(currentUser.role === "MSS_DOMAIN_OWNER" ? "task-detail" : currentUser.role === "REGIONAL_OWNER" ? "regional-tasks" : "plans")}><IconChevronDown size={17} />返回{currentUser.role === "MSS_DOMAIN_OWNER" ? "领域任务" : currentUser.role === "REGIONAL_OWNER" ? "我的填报任务" : "收集计划"}</button><h1>{product.name} · {region.name}需求填报</h1><div className="batch-meta" aria-label="批次信息"><span>产品领域</span><strong>{product.category}</strong><i>·</i><span>样机阶段</span><strong>{product.stage}</strong><i>·</i><span>GTM接口人</span><strong>{product.gtm}</strong><i>·</i><span>领域接口人</span><strong>{product.domainOwner || "待配置"}</strong><i>·</i><span>区域接口人</span><strong>{region?.owner || "待配置"}</strong><i>·</i><span>代表处接口人</span><strong>{office?.owner || "待配置"}</strong><i>·</i><span>截止</span><strong className="deadline">{selectedPlan?.deadline || product.deadline}</strong></div></div><label className="product-switch"><span>当前收集计划</span><select value={product.id} onChange={(event) => selectDemandProduct(event.target.value)} aria-label="选择需求产品">{resolvedProducts.filter((item) => item.enabled).map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select><small>{currentUser.role === "MSS_DOMAIN_OWNER" ? "领域接口人可代区域录入" : "提交后进入领域汇总"}</small></label></section>
      <section className="content-frame"><div className="main-panel">
        <div className="region-tabs" role="tablist" aria-label="MKT区域">{regions.map((item) => <button type="button" role="tab" aria-selected={activeRegion === item.id} key={item.id} className={activeRegion === item.id ? "region-active" : ""} onClick={() => setActiveRegion(item.id)}>{item.name}<StatusDot status={regionStatuses[item.id]} /></button>)}</div>
        <div className="region-tabs office-tabs" role="tablist" aria-label="代表处" style={{marginTop: '8px', paddingLeft: '16px'}}>{offices.map((item) => <button type="button" role="tab" aria-selected={activeOffice === item.id} key={item.id} className={activeOffice === item.id ? "region-active" : ""} onClick={() => setActiveOffice(item.id)}>{item.name.replace("代表处", "")}<StatusDot status={officeStatuses[item.id]} /></button>)}</div>
        <div className="form-section"><h2>{region.name} · {office.name}需求填报 <span className="section-product-tag">{product.name} · {product.skus.length ? `${product.skus.length}个SKU` : "产品级需求"} · 当前代表处小计：{officeTotal.toLocaleString()} Pcs</span></h2><p className="entry-recipient">当前数据将提交至：<strong>{product.category}领域接口人 {product.domainOwner || "待配置"}</strong>，由领域接口人统一检查后反馈GTM。</p><div className="table-toolbar"><label className="search-box"><IconSearch size={19} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索产品型号或BOM编码" /></label><button className="button button-outline" type="button" onClick={() => setPasteOpen(true)}><IconFileSpreadsheet size={19} />从Excel粘贴</button><button className="text-button" type="button" onClick={downloadTemplate}><IconDownload size={18} />下载填报模板</button><span className="toolbar-hint">BOM未就绪时可先按产品级收集</span></div>
          <div className="demand-table-wrap"><table className="demand-table"><thead><tr><th>SKU</th><th>BOM编码</th><th>需求数量(Pcs)<sup>*</sup></th><th>需求依据<sup>*</sup></th><th>计划使用时间</th><th>备注</th><th>状态</th></tr></thead><tbody>
            {visibleRows.map((row) => { const rowIndex = rows.findIndex((item) => item.sku === row.sku); const incomplete = Number(row.qty) <= 0 || !row.basis; return <tr key={row.sku} className={incomplete ? "row-incomplete" : ""}><td className="sku-cell">{row.sku}{row.description && <small style={{display: 'block', color: '#6b7280', fontSize: '12px', marginTop: '2px', fontWeight: 'normal'}}>{row.description}</small>}{row.provisional && <small className="provisional-note">产品线信息可后补</small>}</td><td>{row.bom || <span className="bom-placeholder">待产品线补充</span>}</td><td><input className={`quantity-input ${Number(row.qty) <= 0 ? "field-error" : ""}`} type="number" min="0" value={row.qty} onChange={(event) => updateRow(rowIndex, "qty", event.target.value)} aria-label={`${row.sku}需求数量`} /></td><td><select className={!row.basis && Number(row.qty) > 0 ? "field-error" : ""} value={row.basis} onChange={(event) => updateRow(rowIndex, "basis", event.target.value)} aria-label={`${row.sku}需求依据`}>{basisOptions.map((option) => <option key={option} value={option}>{option || "请选择需求依据"}</option>)}</select>{!row.basis && Number(row.qty) > 0 && <span className="inline-error"><IconAlertTriangle size={15} />请补充需求依据</span>}</td><td><label className="date-field"><input type="text" inputMode="numeric" value={row.date} onChange={(event) => updateRow(rowIndex, "date", event.target.value)} placeholder="YYYY-MM-DD" aria-label={`${row.sku}计划使用时间`} /><IconCalendar size={18} /></label></td><td><input className="note-input" value={row.note} onChange={(event) => updateRow(rowIndex, "note", event.target.value)} placeholder="请输入" aria-label={`${row.sku}备注`} /></td><td><span className={incomplete ? "state-text state-warning" : "state-text state-ready"}><StatusDot status={incomplete ? "editing" : "submitted"} />{incomplete ? "待完善" : "已填写"}</span></td></tr>; })}
            {visibleRows.length === 0 && <tr><td className="empty-cell" colSpan="7">未找到匹配的SKU或BOM编码</td></tr>}
          </tbody><tfoot><tr><td colSpan="2">{product.name} · {region.name}合计</td><td colSpan="5"><strong>{total.toLocaleString()} Pcs</strong></td></tr></tfoot></table></div>
        </div>
      </div><aside className="support-panel"><section className="check-section"><h3>提交前检查</h3><ul><li><IconCircleCheckFilled className="check-icon" size={20} /><span>{completedSkus}/{allRegionRows.length}个填报项已填写（共{offices.length}个代表处）</span></li><li>{missingBasis ? <IconAlertTriangleFilled className="warning-icon" size={20} /> : <IconCircleCheckFilled className="check-icon" size={20} />}<span>{missingBasis ? `${missingBasis}项需求依据待补充` : "需求依据已完整"}</span></li><li><IconCircleCheckFilled className="check-icon" size={20} /><span>区域接口人 {region.owner}</span></li><li><IconCircleCheckFilled className="check-icon" size={20} /><span>当前代表处接口人 {office.owner}</span></li><li><IconCircleCheckFilled className="check-icon" size={20} /><span>区域预计合计</span><strong>{total.toLocaleString()} Pcs</strong></li></ul></section><section className="progress-section"><h3>本产品其他区域</h3><ul>{regions.filter((item) => item.id !== activeRegion).slice(0, 3).map((item) => <li key={item.id}><span>{item.name}</span><span className={`progress-label label-${regionStatuses[item.id]}`}><StatusDot status={regionStatuses[item.id]} />{regionStatuses[item.id] === "submitted" ? "已提交" : regionStatuses[item.id] === "editing" ? "填报中" : "未开始"}</span></li>)}</ul></section></aside></section>
    </main>}

    {activeNav === "需求收集" && collectionView === "entry" && <footer className="sticky-actions"><div className="save-state"><IconCircleCheck size={24} /><span>已自动保存</span><strong>{savedAt}</strong></div><div className={`validation-state ${missingBasis ? "has-warning" : "all-clear"}`}>{missingBasis ? <IconAlertTriangle size={22} /> : <IconCheck size={22} />}<span>{missingBasis ? `还有${missingBasis}项待完善` : currentUser.role === "MSS_DOMAIN_OWNER" ? "提交后将反馈GTM收口" : "提交后进入领域汇总"}</span></div><div className="footer-buttons"><button className="button button-secondary" type="button" onClick={saveDraft}>保存草稿</button><button className="button button-primary" type="button" onClick={submit}>{currentUser.role === "MSS_DOMAIN_OWNER" ? `将${region.name}纳入领域汇总` : "提交至领域接口人"}</button></div></footer>}
    {pasteOpen && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setPasteOpen(false); }}><section className="paste-modal" role="dialog" aria-modal="true" aria-labelledby="paste-title"><div className="modal-header"><div><h2 id="paste-title">从Excel粘贴数量</h2><p>{product.name}共{rows.length}个SKU，请按下方顺序粘贴一整行。</p></div><button className="icon-button" type="button" onClick={() => setPasteOpen(false)} aria-label="关闭"><IconX size={22} /></button></div><div className="paste-order" style={{ gridTemplateColumns: `repeat(${Math.min(rows.length, 4)}, 1fr)` }}>{rows.map((item) => <span key={item.sku}>{item.sku}</span>)}</div><textarea autoFocus value={pasteText} onChange={(event) => setPasteText(event.target.value)} aria-label="粘贴Excel数量" /><div className="modal-actions"><button className="button button-secondary" type="button" onClick={() => setPasteOpen(false)}>取消</button><button className="button button-primary" type="button" onClick={applyPaste}>填入{rows.length}个SKU</button></div></section></div>}
    <Toast message={toast.message} type={toast.type} onClose={() => setToast({ message: "", type: "success" })} />
  </div></ErrorBoundary>;
}
