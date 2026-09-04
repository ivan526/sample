import { useEffect, useMemo, useState } from "react";
import {
  IconAlertTriangleFilled, IconArrowRight, IconBoxMultiple, IconBuildingWarehouse,
  IconCalendarEvent, IconCheck, IconChecks, IconChevronDown, IconChevronRight,
  IconCircleCheckFilled, IconClipboardCheck, IconClockHour4, IconDownload,
  IconListDetails, IconMapPin, IconPackage, IconPencil, IconPlus, IconRefresh, IconSearch,
  IconSettings, IconShieldCheck, IconTruckDelivery, IconUsers, IconWorld, IconX,
} from "@tabler/icons-react";
import { TsmpImportPanel } from "./BusinessFlowPages.jsx";
import { api } from "./api/client.js";

const totalFields = (items) => items.reduce((sum, item) => ({
  demand: sum.demand + item.demand, stocked: sum.stocked + item.stocked, applied: sum.applied + item.applied,
  shipped: sum.shipped + item.shipped, inventory: sum.inventory + item.inventory, batches: sum.batches + item.batches,
}), { demand: 0, stocked: 0, applied: 0, shipped: 0, inventory: 0, batches: 0 });

function PageHeader({ title, description, action }) { return <section className="ops-heading"><div><h1>{title}</h1><p>{description}</p></div>{action}</section>; }
function ProductFilter({ products, value, onChange, label = "全部产品" }) { return <select className="page-select" value={value} onChange={(event) => onChange(event.target.value)} aria-label="选择产品"><option value="all">{label}</option>{products.filter((item) => item.enabled).map((item) => <option key={item.id} value={item.id}>{item.category ? `${item.category}｜` : ""}{item.name}</option>)}</select>; }
function MetricStrip({ items }) { return <section className="metric-strip" aria-label="关键指标">{items.map(({ label, value, unit, hint, tone, icon: Icon }) => <div className="metric-item" key={label}><span className={`metric-icon metric-${tone || "blue"}`}><Icon size={20} stroke={1.8} /></span><div><span className="metric-label">{label}</span><div className="metric-value">{value}<small>{unit}</small></div><span className="metric-hint">{hint}</span></div></div>)}</section>; }
function ProgressBar({ value, tone = "blue" }) { return <span className="progress-bar" aria-label={`${value}%`}><i className={`progress-fill progress-${tone}`} style={{ width: `${Math.min(100, Math.max(0, value))}%` }} /></span>; }
function DualProgress({ applied, shipped }) { return <span className="dual-progress"><span><i>申</i><ProgressBar value={applied} /><small>{applied}%</small></span><span><i>发</i><ProgressBar value={shipped} tone={shipped < 75 ? "amber" : "blue"} /><small>{shipped}%</small></span></span>; }
function StatusBadge({ children }) { const tone = ["已审批", "已核对", "已完成", "启用中"].includes(children) ? "success" : ["需关注", "有差异", "待申请", "已停用"].includes(children) ? "warning" : "info"; return <span className={`status-badge badge-${tone}`}>{children}</span>; }
function Dialog({ title, description, onClose, children, footer, wide = false }) { return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className={`operation-modal ${wide ? "operation-modal-wide" : ""}`} role="dialog" aria-modal="true" aria-label={title}><div className="modal-header"><div><h2>{title}</h2><p>{description}</p></div><button className="icon-button" type="button" onClick={onClose} aria-label="关闭"><IconX size={22} /></button></div>{children}<div className="modal-actions">{footer}</div></section></div>; }

const ROLE_SCOPE_COPY = {
  ADMIN: ["全局数据范围", "管理员可查看全部产品、领域、区域与代表处数据"],
  GTM: ["GTM责任范围", "仅汇总当前账号负责品类下的产品与执行数据"],
  MSS_DOMAIN_OWNER: ["MSS领域责任范围", "仅汇总当前账号负责MSS领域的数据"],
  REGIONAL_OWNER: ["区域责任范围", "仅展示当前账号负责区域或代表处的数据"],
  STOCKING_OWNER: ["备货品类责任范围", "仅展示当前账号作为备货接口人负责品类的数据"],
};
function DataScopeNotice({ currentUser, detail }) { const [title, description] = ROLE_SCOPE_COPY[currentUser?.role] || ROLE_SCOPE_COPY.ADMIN; const Icon = currentUser?.role === "ADMIN" ? IconWorld : IconShieldCheck; return <section className="data-scope-notice"><Icon size={19} /><div><strong>{title}</strong><span>{description}{detail ? `；${detail}` : ""}</span></div><span>{currentUser?.roleLabel || "系统管理员"}</span></section>; }

export function OverviewPage({ products, onNavigate, currentUser }) {
  const [productId, setProductId] = useState("all");
  const [overview, setOverview] = useState(null);
  const [loadError, setLoadError] = useState("");
  useEffect(() => {
    let active = true;
    setLoadError("");
    api.getOverview(productId).then((data) => { if (active) setOverview(data); }).catch((error) => { if (active) { setOverview(null); setLoadError(error.message); } });
    return () => { active = false; };
  }, [productId]);
  const sourceMetrics = overview?.metrics || {};
  const totals = {
    demand: Number(sourceMetrics.confirmedDemand || 0), stocked: Number(sourceMetrics.productionScheduled || 0),
    applied: Number(sourceMetrics.tsmpApplied || 0), shipped: Number(sourceMetrics.tsmpShipped || 0),
    inventory: Number(sourceMetrics.availableInventory || 0), batches: Number(sourceMetrics.shipmentCount || 0),
  };
  const appliedRate = totals.demand ? Math.round(totals.applied / totals.demand * 1000) / 10 : 0;
  const stockedRate = totals.demand ? Math.round(totals.stocked / totals.demand * 1000) / 10 : 0;
  const rows = (overview?.rows || []).map((item) => ({ ...item, inventory: item.available, shipped: item.shipped || 0 }));
  const selectedCount = productId === "all" ? Number(overview?.process?.[0]?.value || 0) : (overview ? 1 : 0);
  const metrics = [
    { label: "已确认需求", value: totals.demand.toLocaleString(), unit: "Pcs", hint: `${selectedCount}个产品 · GTM已收口`, icon: IconClipboardCheck },
    { label: "产品线已排产", value: totals.stocked.toLocaleString(), unit: "Pcs", hint: `排产满足率 ${stockedRate}%`, icon: IconPackage },
    { label: "TSMP已申请", value: totals.applied.toLocaleString(), unit: "Pcs", hint: `需求申请率 ${appliedRate}%`, icon: IconChecks },
    { label: "TSMP累计发货", value: totals.shipped.toLocaleString(), unit: "Pcs", hint: "来自TSMP导入匹配", icon: IconTruckDelivery },
    { label: "当前可用库存", value: totals.inventory.toLocaleString(), unit: "Pcs", hint: "跨产品库存汇总", tone: "amber", icon: IconBuildingWarehouse },
  ];
  const stages = (overview?.process || []).map((item) => [item.label, item.value, item.unit, item.state]);
  return <main className="workspace workspace-no-footer">
    <PageHeader title="运营总览" description="贯通新品需求收集、产品线排产、TSMP发货与库存执行情况" action={<ProductFilter products={products} value={productId} onChange={setProductId} />} />
    <DataScopeNotice currentUser={currentUser} detail="指标、产品列表和关注事项使用同一权限口径" />
    {loadError && <p className="warning-text" role="alert">总览数据加载失败：{loadError}</p>}
    <MetricStrip items={metrics} />
    <section className="ops-surface process-surface"><div className="surface-title"><div><h2>{productId === "all" ? "新品备货全流程" : "产品执行链路"}</h2><p>需求与发货数据分别来自收集计划和TSMP导出</p></div><button className="text-button" type="button" onClick={() => onNavigate("执行情况")}>查看执行明细<IconChevronRight size={17} /></button></div><div className="process-track">{stages.map(([label, value, unit, state], index) => <div className={`process-step step-${state}`} key={label}><span className="step-index">{state === "done" ? <IconCheck size={16} /> : index + 1}</span><div><strong>{label}</strong><span>{value.toLocaleString()} {unit}</span></div>{index < stages.length - 1 && <IconArrowRight className="step-arrow" size={20} />}</div>)}</div></section>
    <div className="overview-grid"><section className="ops-surface product-execution"><div className="surface-title"><div><h2>{productId === "all" ? "产品执行情况" : "SKU执行情况"}</h2><p>{productId === "all" ? "先按产品对比，选择产品后查看SKU" : "需求、备货、申请和库存统一对照"}</p></div><span className="surface-summary">整体申请率 <strong>{appliedRate}%</strong></span></div><div className="plain-table-wrap"><table className="plain-table"><thead><tr><th>{productId === "all" ? "产品" : "SKU"}</th><th>需求</th><th>已备货</th><th>已申请</th><th>可用库存</th><th>执行进度</th><th>状态</th></tr></thead><tbody>{rows.map((item) => <tr key={item.name}><td><strong>{item.name}</strong><small>{item.meta}</small></td><td>{item.demand}</td><td>{item.stocked}</td><td>{item.applied}</td><td>{item.inventory}</td><td><span className="progress-cell"><ProgressBar value={item.progress} tone={item.status === "需关注" ? "amber" : "blue"} /><small>{item.progress}%</small></span></td><td><StatusBadge>{item.status}</StatusBadge></td></tr>)}{!rows.length && <tr><td className="empty-cell" colSpan="7">当前范围暂无已确认的执行数据</td></tr>}</tbody></table></div></section>
      <aside className="overview-side"><section className="ops-surface compact-surface"><div className="surface-title"><div><h2>库存匹配情况</h2><p>{productId === "all" ? "按产品查看库存覆盖" : "按SKU查看库存覆盖"}</p></div><button className="text-button" type="button" onClick={() => onNavigate("库存核对")}>查看库存<IconChevronRight size={17} /></button></div>{rows.slice(0, 4).map((item) => { const gap = Math.max(1, item.applied - item.shipped); const coverage = Math.min(100, Math.round(item.inventory / gap * 100)); return <div className="coverage-row" key={item.name}><div><strong>{item.name}</strong><span>{coverage >= 80 ? "充足" : coverage >= 60 ? "需关注" : "需补充"}</span></div><ProgressBar value={coverage} tone={coverage < 70 ? "amber" : "blue"} /><small>{coverage}%</small></div>; })}</section>
        <section className="ops-surface compact-surface attention-surface"><div className="surface-title"><div><h2>需关注</h2><p>按影响程度优先处理</p></div></div><button type="button" onClick={() => onNavigate("执行情况")}><IconAlertTriangleFilled size={18} /><span><strong>{Number(overview?.attention?.find((item) => item.code === "DEMAND_NOT_APPLIED")?.value || 0).toLocaleString()}台需求尚未申请</strong><small>可按产品下钻到代表处和国家</small></span><IconChevronRight size={17} /></button><button type="button" onClick={() => onNavigate("库存核对")}><IconAlertTriangleFilled size={18} /><span><strong>{Number(overview?.attention?.find((item) => item.code === "INVENTORY_DIFF")?.value || 0).toLocaleString()}台库存存在差异</strong><small>等待备货接口人核对说明</small></span><IconChevronRight size={17} /></button></section></aside>
    </div>
  </main>;
}

export function ExecutionPage({ products, organizations, showToast, permissions = [], currentUser }) {
  const canImportTsmp = permissions.includes('import:tsmp');
  const [query, setQuery] = useState(""); const [region, setRegion] = useState(""); const [office, setOffice] = useState(""); const [country, setCountry] = useState(""); const [productId, setProductId] = useState("all"); const [openProducts, setOpenProducts] = useState({}); const [execution, setExecution] = useState(null); const [reloadKey, setReloadKey] = useState(0); const [loadError, setLoadError] = useState("");
  const selectedRegion = organizations.find((item) => item.id === region);
  const officeOptions = selectedRegion?.offices?.filter((item) => item.enabled !== false) || [];
  const selectedOffice = officeOptions.find((item) => item.id === office);
  const countryOptions = selectedOffice?.countries || [];
  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(() => {
      setLoadError("");
      api.getExecution({ productId, regionId: region, officeId: office, country, keyword: query }).then((data) => { if (active) setExecution(data); }).catch((error) => { if (active) { setExecution(null); setLoadError(error.message); } });
    }, 180);
    return () => { active = false; window.clearTimeout(timer); };
  }, [productId, region, office, country, query, reloadKey]);
  const productRows = (execution?.products || []).map((item) => ({ ...item, category: item.domain, batches: item.metrics.shipmentCount, skus: item.skus.map((sku) => ({ ...sku, batches: sku.shipmentCount })) }));
  const visibleSkus = productRows.flatMap((item) => item.skus);
  const sourceMetrics = execution?.metrics || {};
  const totals = { demand: Number(sourceMetrics.demand || 0), stocked: Number(sourceMetrics.stocked || 0), applied: Number(sourceMetrics.applied || 0), shipped: Number(sourceMetrics.shipped || 0), inventory: productRows.reduce((sum, item) => sum + Number(item.metrics.inventory || 0), 0), batches: Number(sourceMetrics.shipmentCount || 0) };
  const scopeLabel = execution?.scopeLabel || "全球MSS";
  const setRegionScope = (value) => { setRegion(value); setOffice(""); setCountry(""); }; const setOfficeScope = (value) => { setOffice(value); setCountry(""); };
  const exportCsv = () => {
    const lines = [["产品", "SKU", "BOM", "确认需求", "累计申请", "累计发货", "可用库存", "发货批次"], ...productRows.flatMap((item) => item.skus.map((sku) => [item.name, sku.sku, sku.bom, sku.demand, sku.applied, sku.shipped, sku.inventory, sku.batches]))];
    const csv = `\uFEFF${lines.map((line) => line.map((value) => `"${String(value ?? "").replaceAll('"', '""')}"`).join(",")).join("\n")}`;
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" })); const anchor = document.createElement("a"); anchor.href = url; anchor.download = `执行匹配明细-${scopeLabel.replaceAll(" / ", "-")}.csv`; anchor.click(); URL.revokeObjectURL(url); showToast(`${scopeLabel}执行明细已导出`);
  };
  return <main className="workspace workspace-no-footer">
    <PageHeader title="执行情况" description="导入TSMP发货数据，并按产品型号、发货区域和代表处匹配已确认需求" action={<button className="button button-outline" type="button" onClick={exportCsv}><IconDownload size={18} />导出匹配明细</button>} />
    <DataScopeNotice currentUser={currentUser} detail={canImportTsmp ? "可导入TSMP并查看匹配结果" : "当前账号只读，不显示TSMP导入入口"} />
    {loadError && <p className="warning-text" role="alert">执行数据加载失败：{loadError}</p>}
    <MetricStrip items={[{ label: "确认需求", value: totals.demand.toLocaleString(), unit: "Pcs", hint: `${productRows.length}个产品 · ${scopeLabel}`, icon: IconClipboardCheck }, { label: "累计申请", value: totals.applied.toLocaleString(), unit: "Pcs", hint: `占确认需求 ${totals.demand ? Math.round(totals.applied / totals.demand * 100) : 0}%`, icon: IconChecks }, { label: "累计发货", value: totals.shipped.toLocaleString(), unit: "Pcs", hint: `分${totals.batches}批次发出`, icon: IconTruckDelivery }, { label: "剩余待申请", value: Math.max(0, totals.demand - totals.applied).toLocaleString(), unit: "Pcs", hint: "需求 - 累计申请", tone: "amber", icon: IconClockHour4 }, { label: "剩余待发", value: Math.max(0, totals.applied - totals.shipped).toLocaleString(), unit: "Pcs", hint: "累计申请 - 累计发货", tone: "amber", icon: IconPackage }]} />
    {canImportTsmp && <TsmpImportPanel showToast={showToast} onImported={() => setReloadKey((value) => value + 1)} />}
    <section className="ops-surface scope-surface"><div className="surface-title"><div><h2>组织范围</h2><p>可从区域继续下钻到代表处和国家/地区</p></div><span className="scope-path"><IconWorld size={17} />当前：<strong>{scopeLabel}</strong></span></div><div className="scope-controls"><label><span>区域</span><select value={region} onChange={(event) => setRegionScope(event.target.value)} aria-label="区域范围"><option value="">全部区域</option>{organizations.filter((item) => item.enabled).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><IconChevronRight className="scope-arrow" size={18} /><label><span>代表处</span><select value={office} disabled={!region} onChange={(event) => setOfficeScope(event.target.value)} aria-label="代表处范围"><option value="">全部代表处</option>{officeOptions.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><IconChevronRight className="scope-arrow" size={18} /><label><span>国家/地区</span><select value={country} disabled={!office} onChange={(event) => setCountry(event.target.value)} aria-label="国家范围"><option value="">全部国家/地区</option>{countryOptions.map((item) => <option key={item} value={item}>{item}</option>)}</select></label><span className="scope-help"><IconMapPin size={17} />筛选后，产品和SKU数据同步收敛</span></div></section>
    <section className="ops-surface execution-surface"><div className="surface-title"><div><h2>产品执行跟踪</h2><p>默认按产品汇总，展开后查看SKU的申请与累计发货</p></div><span className="surface-summary">{scopeLabel} · <strong>{productRows.length}</strong> 个产品 / {visibleSkus.length}个SKU</span></div><div className="ops-toolbar"><label className="search-box wide-search"><IconSearch size={19} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索产品、SKU或BOM" /></label><ProductFilter products={products} value={productId} onChange={setProductId} /><span className="toolbar-spacer" /><span className="hierarchy-hint">产品 <IconChevronRight size={15} /> SKU</span></div>
      <div className="plain-table-wrap"><table className="plain-table execution-table execution-tracking-table"><thead><tr><th>产品 / SKU</th><th>确认需求</th><th>累计申请</th><th>累计发货</th><th>剩余待申请</th><th>剩余待发</th><th>可用库存</th><th>申请 / 发货进度</th><th>发货批次</th></tr></thead><tbody>{productRows.map((item) => { const productTotal = { ...item.metrics, batches: item.metrics.shipmentCount }; const open = Boolean(openProducts[item.id]); return <MemoRows key={item.id} product={item} totals={productTotal} open={open} onToggle={() => setOpenProducts((current) => ({ ...current, [item.id]: !current[item.id] }))} />; })}{!productRows.length && <tr><td className="empty-cell" colSpan="9">未找到匹配的产品、SKU或BOM</td></tr>}</tbody></table></div>
    </section>
  </main>;
}

function MemoRows({ product, totals, open, onToggle }) {
  return <><tr className="product-summary-row" onClick={onToggle}><td><button className="tree-toggle" type="button" aria-expanded={open} aria-label={`${open ? "收起" : "展开"}${product.name}`}>{open ? <IconChevronDown size={18} /> : <IconChevronRight size={18} />}<span><strong>{product.name}</strong><small>{product.category} · GTM {product.gtm} · 备货 {product.stockingOwner}</small><small>{product.skus.length}个SKU</small></span></button></td><td><strong>{totals.demand.toLocaleString()}</strong></td><td><strong>{totals.applied.toLocaleString()}</strong></td><td><strong>{totals.shipped.toLocaleString()}</strong></td><td className="number-warning">{Math.max(0, totals.demand - totals.applied).toLocaleString()}</td><td className="number-warning">{Math.max(0, totals.applied - totals.shipped).toLocaleString()}</td><td>{totals.inventory.toLocaleString()}</td><td><DualProgress applied={totals.demand ? Math.round(totals.applied / totals.demand * 100) : 0} shipped={totals.applied ? Math.round(totals.shipped / totals.applied * 100) : 0} /></td><td><strong>{totals.batches}批</strong><small>累计发货</small></td></tr>{open && product.skus.map((item) => { const { demand, applied, shipped, inventory } = item; return <tr className="sku-tracking-row" key={item.sku}><td><span className="sku-identity"><strong>{item.sku}</strong><small>BOM {item.bom}</small></span></td><td>{demand}</td><td>{applied}</td><td>{shipped}</td><td className={demand - applied > 0 ? "number-warning" : ""}>{Math.max(0, demand - applied)}</td><td className={applied - shipped > 0 ? "number-warning" : ""}>{Math.max(0, applied - shipped)}</td><td>{inventory}</td><td><DualProgress applied={demand ? Math.round(applied / demand * 100) : 0} shipped={applied ? Math.round(shipped / applied * 100) : 0} /></td><td><strong>{item.batches}批</strong><small>累计批次</small></td></tr>; })}</>;
}

export function InventoryPage({ products, showToast, currentUser }) {
  const [items, setItems] = useState([]); const [onlyDiff, setOnlyDiff] = useState(false); const [query, setQuery] = useState(""); const [productId, setProductId] = useState("all"); const [selected, setSelected] = useState(null); const [actualQty, setActualQty] = useState(0); const [reason, setReason] = useState(""); const [loadError, setLoadError] = useState(""); const [executionGaps, setExecutionGaps] = useState({});
  useEffect(() => {
    let active = true;
    setLoadError("");
    Promise.all([api.getInventory({ productId }), api.getExecution({ productId })]).then(([inventory, execution]) => {
      if (!active) return;
      setItems(inventory.items || []);
      setExecutionGaps(Object.fromEntries((execution.products || []).flatMap((product) => product.skus.map((sku) => [sku.id || sku.sku, Math.max(0, sku.applied - sku.shipped)]))));
    }).catch((error) => { if (active) setLoadError(error.message); });
    return () => { active = false; };
  }, [productId]);
  const productName = (id) => products.find((item) => item.id === id)?.name || "未配置产品";
  const scopedItems = useMemo(() => items, [items]);
  const visible = useMemo(() => scopedItems.filter((item) => (!onlyDiff || item.system !== item.actual) && `${productName(item.productId)}${products.find((product) => product.id === item.productId)?.category || ""}${item.sku}${item.bom}${item.warehouse}`.toLowerCase().includes(query.toLowerCase())), [scopedItems, onlyDiff, query, products]);
  const inventoryTotals = scopedItems.reduce((sum, item) => ({ system: sum.system + item.system, actual: sum.actual + item.actual, locked: sum.locked + item.locked, available: sum.available + item.available, diff: sum.diff + Math.abs(item.actual - item.system) }), { system: 0, actual: 0, locked: 0, available: 0, diff: 0 });
  const openCheck = (item) => { setSelected(item); setActualQty(item.actual); setReason(item.system === item.actual ? "账实一致" : "待确认物流在途"); };
  const finishCheck = async () => {
    try {
      const updated = await api.checkInventory(selected.id, { actualQuantity: Number(actualQty), reason, version: selected.version });
      setItems((current) => current.map((item) => item.id === selected.id ? updated : item)); showToast(`${selected.sku} · ${selected.warehouse} 库存核对已闭环`); setSelected(null);
    } catch (error) { showToast(error.message, "warning"); }
  };
  const alertItems = scopedItems.filter((item) => item.system !== item.actual);
  return <main className="workspace workspace-no-footer">
    <PageHeader title="库存核对" description="按产品核对系统库存、实物库存与需求占用，及时闭环差异" action={<button className="button button-outline" type="button" onClick={() => showToast("已发起本轮库存盘点任务")}><IconRefresh size={18} />发起盘点</button>} />
    <DataScopeNotice currentUser={currentUser} detail="跨品类库存不会出现在列表中，越权核对会被拒绝" />
    {loadError && <p className="warning-text" role="alert">库存数据加载失败：{loadError}</p>}
    <MetricStrip items={[{ label: "系统总库存", value: inventoryTotals.system.toLocaleString(), unit: "Pcs", hint: `${productId === "all" ? products.filter((item) => item.enabled).length : 1}个产品 · ${scopedItems.length}条库存`, icon: IconBuildingWarehouse }, { label: "实物库存", value: inventoryTotals.actual.toLocaleString(), unit: "Pcs", hint: `账实差异${inventoryTotals.diff}台`, tone: inventoryTotals.diff ? "amber" : "blue", icon: IconPackage }, { label: "已锁定库存", value: inventoryTotals.locked.toLocaleString(), unit: "Pcs", hint: "用于已审批需求", icon: IconClipboardCheck }, { label: "可用库存", value: inventoryTotals.available.toLocaleString(), unit: "Pcs", hint: "可支持后续申请", icon: IconChecks }, { label: "待核对差异", value: inventoryTotals.diff.toLocaleString(), unit: "Pcs", hint: `涉及${alertItems.length}条库存`, tone: "amber", icon: IconAlertTriangleFilled }]} />
    <div className="inventory-layout"><section className="ops-surface inventory-surface"><div className="surface-title"><div><h2>库存核对明细</h2><p>产品、SKU与仓库统一核对</p></div><span className="surface-summary">共 <strong>{visible.length}</strong> 条</span></div><div className="ops-toolbar"><label className="search-box wide-search"><IconSearch size={19} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索领域、产品、SKU、BOM或仓库" /></label><ProductFilter products={products} value={productId} onChange={setProductId} /><select aria-label="仓库筛选" defaultValue="全部仓库"><option>全部仓库</option><option>欧洲中心仓</option><option>深圳中心仓</option><option>东南亚区域仓</option></select><label className="switch-label"><input type="checkbox" checked={onlyDiff} onChange={(event) => setOnlyDiff(event.target.checked)} /><span>仅看差异</span></label></div><div className="plain-table-wrap"><table className="plain-table inventory-table multi-inventory-table"><thead><tr><th>产品 / SKU</th><th>仓库</th><th>系统库存</th><th>实物库存</th><th>已锁定</th><th>可用库存</th><th>差异</th><th>最后核对</th><th>状态</th><th>操作</th></tr></thead><tbody>{visible.map((item) => { const diff = item.actual - item.system; const itemProduct = products.find((product) => product.id === item.productId); return <tr key={item.id}><td><strong>{productName(item.productId)}</strong><small>{itemProduct?.category} · {item.sku} · BOM {item.bom}</small></td><td>{item.warehouse}</td><td>{item.system}</td><td>{item.actual}</td><td>{item.locked}</td><td>{item.available}</td><td className={diff !== 0 ? "number-warning" : ""}>{diff > 0 ? `+${diff}` : diff}</td><td>{item.updated}</td><td><StatusBadge>{item.status}</StatusBadge></td><td><button className="table-action" type="button" onClick={() => openCheck(item)}>{diff !== 0 ? "处理差异" : "查看核对"}</button></td></tr>; })}{!visible.length && <tr><td className="empty-cell" colSpan="10">当前筛选范围内暂无库存记录</td></tr>}</tbody></table></div></section>
      <aside className="inventory-side"><section className="ops-surface compact-surface"><div className="surface-title"><div><h2>库存与需求匹配</h2><p>{productId === "all" ? "跨产品库存覆盖" : "当前产品SKU覆盖"}</p></div></div>{scopedItems.slice(0, 4).map((item) => { const gap = Math.max(1, executionGaps[item.skuId] || 0); const rate = Math.min(100, Math.round(item.available / gap * 100)); return <div className="coverage-row" key={item.id}><div><strong>{item.sku}</strong><span>{item.available} / {gap} Pcs</span></div><ProgressBar value={rate} tone={rate < 75 ? "amber" : "blue"} /><small>{rate}%</small></div>; })}</section><section className="ops-surface compact-surface attention-surface inventory-alerts"><div className="surface-title"><div><h2>核对提醒</h2><p>{alertItems.length}项差异等待处理</p></div></div>{alertItems.slice(0, 3).map((item) => <button type="button" key={item.id} onClick={() => { setOnlyDiff(true); openCheck(item); }}><IconAlertTriangleFilled size={18} /><span><strong>{item.warehouse}差异 {item.actual - item.system}台</strong><small>{productName(item.productId)} · {item.sku}</small></span><IconChevronRight size={17} /></button>)}{!alertItems.length && <div className="empty-alert"><IconCircleCheckFilled size={20} />当前产品库存已全部核对</div>}</section></aside>
    </div>
    {selected && <Dialog title="库存核对" description={`${productName(selected.productId)} · ${selected.sku} · ${selected.warehouse}`} onClose={() => setSelected(null)} footer={<><button className="button button-secondary compact-button" type="button" onClick={() => setSelected(null)}>取消</button><button className="button button-primary compact-button" type="button" onClick={finishCheck}>完成核对</button></>}><div className="dialog-summary"><div><span>系统库存</span><strong>{selected.system} Pcs</strong></div><div><span>当前实物库存</span><strong>{selected.actual} Pcs</strong></div><div><span>当前差异</span><strong className={selected.actual !== selected.system ? "warning-text" : ""}>{selected.actual - selected.system} Pcs</strong></div></div><div className="dialog-form"><label>核对后的实物库存（Pcs）<input type="number" min="0" value={actualQty} onChange={(event) => setActualQty(event.target.value)} /></label><label>差异原因<select value={reason} onChange={(event) => setReason(event.target.value)}><option>账实一致</option><option>待确认物流在途</option><option>出入库记录延迟</option><option>盘点数量修正</option><option>其他</option></select></label><p><IconCircleCheckFilled size={17} />核对后将记录操作时间、核对人及差异说明</p></div></Dialog>}
  </main>;
}

const emptyProduct = (domains) => ({ id: `product-${Date.now()}`, name: "", categoryId: domains[0]?.id || "", supply: "待产品线确认", deadline: "待计划下发", enabled: true, skus: [{ _uid: `sku-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, sku: "", bom: "", description: "" }] });
const emptyDomain = () => ({ id: `domain-${Date.now()}`, name: "", gtm: "", stockingOwner: "", description: "", enabled: true });
const emptyMssDomain = () => ({ id: `mss-${Date.now()}`, code: "", name: "", mssOwner: "", description: "", enabled: true });
const emptyRegion = () => ({ id: `region-${Date.now()}`, name: "", owner: "", enabled: true, offices: [] });
const emptyOffice = () => ({ id: `office-${Date.now()}`, name: "", owner: "", countries: "" });

// 字典类型映射
const DICT_TYPE_MAP = {
  SAMPLE_STAGE: { name: "样机阶段", description: "创建需求收集计划时选择的样机阶段" },
  MSS_DOMAIN: { name: "MSS领域", description: "收集计划下发与用户权限使用的MSS业务领域" },
  DEMAND_BASIS: { name: "需求依据", description: "样机需求的申请原因类型" },
};
const emptyDictItem = () => ({ id: "", dictType: "SAMPLE_STAGE", code: "", name: "", sortOrder: 0, description: "", enabled: true });

const emptyUser = (domains = [], mssDomains = []) => ({ id: "", employeeNo: "", displayName: "", role: "REGIONAL_OWNER", password: "", productDomainIds: [], mssDomainIds: mssDomains[0]?.id ? [mssDomains[0].id] : [], enabled: true });

// 角色选项
const ROLE_OPTIONS = [
  { value: "ADMIN", label: "系统管理员" },
  { value: "GTM", label: "GTM" },
  { value: "MSS_DOMAIN_OWNER", label: "MSS领域接口人" },
  { value: "REGIONAL_OWNER", label: "区域/代表处接口人" },
  { value: "STOCKING_OWNER", label: "备货接口人" },
];

export function ConfigurationPage({ products = [], domains = [], mssDomains = [], organizations = [], dictionaries = {}, users = [], currentUserRole = 'ADMIN', canEdit: canEditProducts = true, canManageMss = false, canManageUsers = false, onAddProduct, onUpdateProduct, onAddDomain, onUpdateDomain, onAddMssDomain, onUpdateMssDomain, onAddOrganization, onUpdateOrganization, onAddDictionaryItem, onUpdateDictionaryItem, onDeleteDictionaryItem, onAddUser, onUpdateUser }) {
  const canEditMasters = currentUserRole === 'ADMIN';
  const tabStorageKey = `mss-config-active-tab:${currentUserRole}`;
  const [activeTab, setActiveTab] = useState(() => typeof window === "undefined" ? "products" : window.sessionStorage.getItem(tabStorageKey) || "products");
  const selectTab = (tabId) => {
    setActiveTab(tabId);
    if (typeof window !== "undefined") window.sessionStorage.setItem(tabStorageKey, tabId);
    setQuery("");
  };
  const canEdit = activeTab === 'products' ? canEditProducts : canEditMasters;
  const [query, setQuery] = useState("");
  const [editingProduct, setEditingProduct] = useState(null); const [productForm, setProductForm] = useState(() => emptyProduct(domains)); const [productError, setProductError] = useState("");

  // 新建产品时，当品类加载完成后自动设置默认值。
  useEffect(() => {
    if (editingProduct === 'new' && domains.length > 0) {
      setProductForm(prev => {
        // GTM用户默认选中第一个（也是唯一的）自己负责的品类；其他角色如果没选也默认选第一个
        const defaultCategoryId = currentUserRole === 'GTM' ? domains[0].id : (prev.categoryId || domains[0].id);
        if (prev.categoryId === defaultCategoryId) {
          return prev;
        }
        return {
          ...prev,
          categoryId: defaultCategoryId
        };
      });
    }
  }, [domains, currentUserRole, editingProduct]);
  const [editingDomain, setEditingDomain] = useState(null); const [domainForm, setDomainForm] = useState(emptyDomain()); const [domainError, setDomainError] = useState("");
  const [editingMssDomain, setEditingMssDomain] = useState(null); const [mssDomainForm, setMssDomainForm] = useState(emptyMssDomain()); const [mssDomainError, setMssDomainError] = useState("");
  const [organizationModal, setOrganizationModal] = useState(null); const [organizationForm, setOrganizationForm] = useState(emptyRegion()); const [organizationError, setOrganizationError] = useState("");
  const [expandedRegions, setExpandedRegions] = useState({ europe: true });
  const [editingDictItem, setEditingDictItem] = useState(null); const [dictItemForm, setDictItemForm] = useState(emptyDictItem()); const [dictItemError, setDictItemError] = useState("");
  const [activeDictType, setActiveDictType] = useState("SAMPLE_STAGE");
  const [editingUser, setEditingUser] = useState(null); const [userForm, setUserForm] = useState(() => emptyUser(domains, mssDomains)); const [userError, setUserError] = useState("");

  const domainFor = (product) => domains.find((item) => item.id === product.categoryId);
  const visibleProducts = products.filter((item) => { const domain = domainFor(item); return `${item.name}${domain?.name || ""}${domain?.gtm || ""}${domain?.stockingOwner || ""}${(item.skus || []).map((sku) => `${sku.sku}${sku.bom}`).join("")}`.toLowerCase().includes(query.toLowerCase()); });
  const visibleDomains = domains.filter((item) => `${item.name}${item.description}${item.gtm}${item.stockingOwner}`.toLowerCase().includes(query.toLowerCase()));
  const visibleOrganizations = organizations.filter((item) => `${item.name}${item.owner}${(item.offices || []).map((office) => `${office.name}${office.owner}${(office.countries || []).join("")}`).join("")}`.toLowerCase().includes(query.toLowerCase()));
  const officeTotal = organizations.reduce((sum, item) => sum + (item.offices?.length || 0), 0);
  const countryTotal = organizations.reduce((sum, item) => sum + (item.offices || []).reduce((count, office) => count + (office.countries?.length || 0), 0), 0);

  const openProduct = (product) => { setProductForm(product ? { ...product, skus: product.skus.map((sku, idx) => ({ ...sku, _uid: sku._uid || `sku-existing-${product.id}-${idx}-${Math.random().toString(36).slice(2, 6)}`, description: sku.description || "" })) } : emptyProduct(domains)); setEditingProduct(product?.id || "new"); setProductError(""); };
  const updateProductField = (field, value) => setProductForm((current) => ({ ...current, [field]: value }));
  const updateSku = (index, field, value) => setProductForm((current) => ({ ...current, skus: current.skus.map((sku, skuIndex) => skuIndex === index ? { ...sku, [field]: value } : sku) }));
  const removeSku = (index) => setProductForm((current) => ({ ...current, skus: current.skus.filter((_, skuIndex) => skuIndex !== index) }));
  const saveProduct = () => {
    const validSkus = productForm.skus.filter((sku) => sku.sku.trim()).map((sku) => {
      const { _uid, ...skuData } = sku;
      return { ...skuData, sku: sku.sku.trim(), bom: sku.bom.trim(), description: (sku.description || "").trim() };
    });
    if (!productForm.name.trim() || !productForm.categoryId) { setProductError("请填写产品名称并选择所属领域；产品型号和BOM编码可在产品线确认后补充。"); return; }
    const payload = { ...productForm, name: productForm.name.trim(), skus: validSkus };
    if (editingProduct === "new") onAddProduct(payload); else onUpdateProduct(payload); setEditingProduct(null);
  };

  const openDomain = (domain) => { setDomainForm(domain ? { ...domain } : emptyDomain()); setEditingDomain(domain?.id || "new"); setDomainError(""); };
  const saveDomain = () => {
    if (!domainForm.name.trim() || !domainForm.gtm.trim() || !domainForm.stockingOwner.trim()) { setDomainError("请完整填写品类名称、GTM接口人和备货接口人。"); return; }
    const payload = { ...domainForm, name: domainForm.name.trim(), gtm: domainForm.gtm.trim(), domainOwner: undefined, stockingOwner: domainForm.stockingOwner.trim() };
    if (editingDomain === "new") onAddDomain(payload); else onUpdateDomain(payload); setEditingDomain(null);
  };

  const openMssDomain = (mssDomain) => { setMssDomainForm(mssDomain ? { ...mssDomain } : emptyMssDomain()); setEditingMssDomain(mssDomain?.id || "new"); setMssDomainError(""); };
  const saveMssDomain = () => {
    if (!mssDomainForm.name.trim() || !mssDomainForm.code.trim() || !mssDomainForm.mssOwner.trim()) { setMssDomainError("请完整填写领域名称、编码和MSS接口人。"); return; }
    const payload = { ...mssDomainForm, code: mssDomainForm.code.trim(), name: mssDomainForm.name.trim(), mssOwner: mssDomainForm.mssOwner.trim(), description: (mssDomainForm.description || "").trim() };
    if (editingMssDomain === "new") onAddMssDomain(payload); else onUpdateMssDomain(payload); setEditingMssDomain(null);
  };

  const openRegion = (region) => { setOrganizationModal({ type: "region", id: region?.id || "new" }); setOrganizationForm(region ? { ...region, offices: region.offices.map((office) => ({ ...office, countries: [...office.countries] })) } : emptyRegion()); setOrganizationError(""); };
  const openOffice = (region, office) => { setOrganizationModal({ type: "office", regionId: region.id, id: office?.id || "new" }); setOrganizationForm(office ? { ...office, countries: office.countries.join("、") } : emptyOffice()); setOrganizationError(""); };
  const saveOrganization = () => {
    if (!organizationForm.name.trim() || !organizationForm.owner.trim()) { setOrganizationError("请完整填写名称和接口人。"); return; }
    if (organizationModal.type === "region") {
      const payload = { ...organizationForm, name: organizationForm.name.trim(), owner: organizationForm.owner.trim() };
      if (organizationModal.id === "new") onAddOrganization(payload); else onUpdateOrganization(payload);
      setExpandedRegions((current) => ({ ...current, [payload.id]: true }));
    } else {
      const countries = organizationForm.countries.split(/[,，、\n]+/).map((item) => item.trim()).filter(Boolean);
      if (!countries.length) { setOrganizationError("请至少配置1个国家/地区。"); return; }
      const region = organizations.find((item) => item.id === organizationModal.regionId);
      const office = { ...organizationForm, name: organizationForm.name.trim(), owner: organizationForm.owner.trim(), countries };
      const offices = organizationModal.id === "new" ? [...region.offices, office] : region.offices.map((item) => item.id === office.id ? office : item);
      onUpdateOrganization({ ...region, offices }); setExpandedRegions((current) => ({ ...current, [region.id]: true }));
    }
    setOrganizationModal(null);
  };

  // 字典相关逻辑
  const openDictItem = (item) => {
    setDictItemForm(item ? { ...item } : { ...emptyDictItem(), dictType: activeDictType });
    setEditingDictItem(item?.id || "new");
    setDictItemError("");
  };
  const saveDictItem = () => {
    if (!dictItemForm.code.trim() || !dictItemForm.name.trim()) { setDictItemError("请填写编码和名称"); return; }
    const payload = { ...dictItemForm, code: dictItemForm.code.trim(), name: dictItemForm.name.trim() };
    if (editingDictItem === "new") onAddDictionaryItem(payload); else onUpdateDictionaryItem(payload);
    setEditingDictItem(null);
  };
  const dictTotal = Object.values(dictionaries).reduce((sum, items) => sum + items.length, 0);
  const visibleDictItems = (dictionaries[activeDictType] || []).filter(item => `${item.code}${item.name}${item.description}`.toLowerCase().includes(query.toLowerCase()));

  // 用户管理逻辑
  const openUser = (user) => {
    setUserForm(user ? { ...user, productDomainIds: user.productDomainIds || [], mssDomainIds: user.mssDomainIds || [] } : emptyUser(domains, mssDomains));
    setEditingUser(user?.id || "new");
    setUserError("");
  };
  const saveUser = () => {
    if (!userForm.employeeNo.trim() || !userForm.displayName.trim() || !userForm.role) {
      setUserError("请填写工号、姓名并选择角色");
      return;
    }
    if (editingUser === "new" && (userForm.password || "").trim().length < 8) {
      setUserError("请设置至少8位的初始密码");
      return;
    }
    if (["GTM", "STOCKING_OWNER"].includes(userForm.role) && !(userForm.productDomainIds || []).length) {
      setUserError("请至少选择一个负责产品品类");
      return;
    }
    if (["MSS_DOMAIN_OWNER", "REGIONAL_OWNER"].includes(userForm.role) && !(userForm.mssDomainIds || []).length) {
      setUserError("请至少选择一个MSS业务领域");
      return;
    }
    const payload = {
      ...userForm,
      employeeNo: userForm.employeeNo.trim(),
      displayName: userForm.displayName.trim(),
    };
    // 编辑时密码留空则不修改
    if (editingUser !== "new" && !payload.password?.trim()) {
      delete payload.password;
    }
    if (editingUser === "new") onAddUser(payload); else onUpdateUser(payload);
    setEditingUser(null);
  };
  const changeUserRole = (role) => setUserForm((current) => ({
    ...current,
    role,
    productDomainIds: ["GTM", "STOCKING_OWNER"].includes(role) ? (current.productDomainIds?.length ? current.productDomainIds : (domains[0]?.id ? [domains[0].id] : [])) : [],
    mssDomainIds: ["MSS_DOMAIN_OWNER", "REGIONAL_OWNER"].includes(role) ? (current.mssDomainIds?.length ? current.mssDomainIds : (mssDomains[0]?.id ? [mssDomains[0].id] : [])) : [],
  }));
  const toggleUserScope = (field, scopeId) => setUserForm((current) => ({
    ...current,
    [field]: (current[field] || []).includes(scopeId) ? current[field].filter((id) => id !== scopeId) : [...(current[field] || []), scopeId],
  }));
  const visibleUsers = users.filter(item => `${item.employeeNo}${item.displayName}`.toLowerCase().includes(query.toLowerCase()));

  const tabAction = activeTab === "products" ? { label: "新增产品", onClick: () => openProduct(null), show: canEdit }
    : activeTab === "domains" ? { label: "新增品类", onClick: () => openDomain(null), show: canEditMasters }
    : activeTab === "mss-domains" ? { label: "新增MSS领域", onClick: () => openMssDomain(null), show: canManageMss }
    : activeTab === "dictionaries" ? { label: "新增字典项", onClick: () => openDictItem(null), show: canEditMasters }
    : activeTab === "organizations" ? { label: "新增区域", onClick: () => openRegion(null), show: canEditMasters }
    : { label: "新增用户", onClick: () => openUser(null), show: canManageUsers };
  const searchPlaceholder = activeTab === "products" ? "搜索产品、品类、责任人、SKU或BOM"
    : activeTab === "domains" ? "搜索品类或责任人"
    : activeTab === "mss-domains" ? "搜索MSS领域或接口人"
    : activeTab === "dictionaries" ? "搜索编码、名称或描述"
    : activeTab === "organizations" ? "搜索区域、代表处、国家或接口人"
    : "搜索工号或姓名";
  const activeDomain = domains.find((item) => item.id === productForm.categoryId);
  return <main className="workspace workspace-no-footer">
    <PageHeader title="配置管理" description="维护产品领域、责任人、组织架构及基础枚举数据，确保需求、执行和库存使用同一口径" action={tabAction.show ? <button className="button button-primary compact-button add-product-button" type="button" onClick={tabAction.onClick}><IconPlus size={18} />{tabAction.label}</button> : <span className="readonly-hint">只读模式</span>} />
    <MetricStrip items={[{ label: "启用产品", value: products.filter((item) => item.enabled).length, unit: "个", hint: `${products.reduce((sum, item) => sum + item.skus.length, 0)}个SKU`, icon: IconBoxMultiple }, { label: "产品领域", value: domains.filter((item) => item.enabled).length, unit: "个", hint: "按领域归属GTM", icon: IconSettings }, { label: "基础数据项", value: dictTotal, unit: "项", hint: "样机阶段/领域/需求依据等枚举", icon: IconListDetails }, { label: "系统用户", value: users.length, unit: "人", hint: "各角色接口人账号", icon: IconUsers }, { label: "区域 / 代表处", value: `${organizations.length}/${officeTotal}`, unit: "区/处", hint: `覆盖${countryTotal}个国家/地区`, icon: IconWorld }]} />
    <div className="config-tabs" role="tablist" aria-label="配置类型">
      {[
        ["products", "产品配置", products.length],
        ["domains", "产品品类（GTM/备货）", domains.length],
        ["mss-domains", "MSS业务领域", mssDomains.length],
        ["dictionaries", "基础数据", dictTotal],
        ...(canManageUsers ? [["users", "用户管理", users.length]] : []),
        ["organizations", "区域与代表处", officeTotal]
      ].map(([id, label, count]) => <button type="button" role="tab" aria-selected={activeTab === id} className={activeTab === id ? "config-tab-active" : ""} key={id} onClick={() => selectTab(id)}>{label}<span>{count}</span></button>)}
    </div>
    <section className="ops-surface config-surface">
      <div className="surface-title"><div><h2>{activeTab === "products" ? "产品主数据" : activeTab === "domains" ? "产品品类（GTM/备货）" : activeTab === "mss-domains" ? "MSS业务领域" : activeTab === "dictionaries" ? "基础枚举数据" : activeTab === "users" ? "系统用户管理" : "区域与代表处"}</h2><p>{activeTab === "products" ? "产品选择所属品类后，自动继承该品类的GTM和备货接口人" : activeTab === "domains" ? "同一产品品类由固定GTM和备货接口人负责" : activeTab === "mss-domains" ? "MSS领域负责人按业务线划分权限，可跨产品品类查看负责领域下的所有产品需求" : activeTab === "dictionaries" ? "维护样机阶段、MSS领域、需求依据等系统枚举值，全平台统一使用" : activeTab === "users" ? "维护系统各角色用户账号，配置后可分配到对应领域和区域" : "维护区域、代表处及国家/地区的组织层级和接口人"}</p></div><span className="surface-summary">{activeTab === "products" ? `共 ${visibleProducts.length} 个产品` : activeTab === "domains" ? `共 ${visibleDomains.length} 个品类` : activeTab === "mss-domains" ? `共 ${mssDomains.length} 个MSS领域` : activeTab === "dictionaries" ? `共 ${dictTotal} 个配置项` : activeTab === "users" ? `共 ${visibleUsers.length} 个用户` : `共 ${visibleOrganizations.length} 个区域 / ${officeTotal}个代表处`}</span></div>
      <div className="ops-toolbar"><label className="search-box wide-search config-search"><IconSearch size={19} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={searchPlaceholder} /></label><span className="config-sync-hint"><IconSettings size={17} />全平台统一配置口径</span></div>
      {activeTab === "products" && <div className="plain-table-wrap"><table className="plain-table config-table product-config-table"><thead><tr><th>产品名称</th><th>所属品类</th><th>样机提供时间</th><th>责任人</th><th>型号 / BOM</th><th>默认截止</th><th>状态</th>{canEdit && <th>操作</th>}</tr></thead><tbody>{visibleProducts.map((item) => { const domain = domainFor(item); const missingBom = !item.skus.length || item.skus.some((sku) => !sku.bom); return <tr key={item.id}><td><strong>{item.name}</strong><small>{item.id}</small></td><td><span className="domain-chip">{domain?.name || "待配置"}</span></td><td>{item.supply || "待产品线确认"}</td><td><strong>GTM · {domain?.gtm || "待配置"}</strong><small>备货 · {domain?.stockingOwner || "待配置"}</small></td><td><strong>{item.skus.length ? `${item.skus.length}个型号` : "产品立项阶段"}</strong><small className={missingBom ? "warning-text" : ""}>{missingBom ? "BOM待产品线补充" : item.skus.map((sku) => `${sku.sku}${sku.bom ? ` / ${sku.bom}` : ''}${sku.description ? ` (${sku.description})` : ''}`).join("、")}</small></td><td>{item.deadline || "待计划下发"}</td><td><StatusBadge>{item.enabled ? "启用中" : "已停用"}</StatusBadge></td>{canEdit && <td><div className="config-actions"><button className="table-action" type="button" onClick={() => openProduct(item)}><IconPencil size={15} />编辑</button><button className="table-action muted-action" type="button" onClick={() => onUpdateProduct({ ...item, enabled: !item.enabled })}>{item.enabled ? "停用" : "启用"}</button></div></td>}</tr>; })}{!visibleProducts.length && <tr><td className="empty-cell" colSpan={canEdit ? 8 : 7}>未找到匹配的产品配置</td></tr>}</tbody></table></div>}
      {activeTab === "domains" && <div className="plain-table-wrap"><table className="plain-table config-table domain-config-table"><thead><tr><th>产品品类</th><th>品类说明</th><th>GTM接口人</th><th>备货接口人</th><th>关联产品</th><th>状态</th>{canEdit && <th>操作</th>}</tr></thead><tbody>{visibleDomains.map((item) => { const linked = products.filter((product) => product.categoryId === item.id); return <tr key={item.id}><td><strong>{item.name}</strong><small>{item.id}</small></td><td>{item.description || "—"}</td><td><span className="owner-cell"><i>{item.gtm?.slice(0, 1) || "?"}</i><span><strong>{item.gtm || "待配置"}</strong><small>GTM负责人</small></span></span></td><td><span className="owner-cell"><i>{item.stockingOwner?.slice(0, 1) || "?"}</i><span><strong>{item.stockingOwner || "待配置"}</strong><small>备货执行衔接</small></span></span></td><td><strong>{linked.length}个产品</strong><small>{linked.map((product) => product.name).join("、") || "暂无关联"}</small></td><td><StatusBadge>{item.enabled ? "启用中" : "已停用"}</StatusBadge></td>{canEdit && <td><div className="config-actions"><button className="table-action" type="button" onClick={() => openDomain(item)}><IconPencil size={15} />编辑</button><button className="table-action muted-action" type="button" onClick={() => onUpdateDomain({ ...item, enabled: !item.enabled })}>{item.enabled ? "停用" : "启用"}</button></div></td>}</tr>; })}{!visibleDomains.length && <tr><td className="empty-cell" colSpan={canEdit ? 7 : 6}>未找到匹配的品类配置</td></tr>}</tbody></table></div>}
      {activeTab === "mss-domains" && <div className="plain-table-wrap"><table className="plain-table config-table domain-config-table"><thead><tr><th>MSS业务领域</th><th>领域编码</th><th>领域说明</th><th>MSS接口人</th><th>关联计划产品</th><th>状态</th>{canManageMss && <th>操作</th>}</tr></thead><tbody>{mssDomains.map((item) => <tr key={item.id}><td><strong>{item.name}</strong><small>{item.id}</small></td><td><code>{item.code}</code></td><td>{item.description || "—"}</td><td><span className="owner-cell"><i>{item.mssOwner?.slice(0, 1) || "?"}</i><span><strong>{item.mssOwner || "待配置"}</strong><small>需求审核负责人（跨品类）</small></span></span></td><td><strong>{item.productCount || 0}个产品</strong><small>按收集计划统计</small></td><td><StatusBadge>{item.enabled ? "启用中" : "已停用"}</StatusBadge></td>{canManageMss && <td><div className="config-actions"><button className="table-action" type="button" onClick={() => openMssDomain(item)}><IconPencil size={15} />编辑</button><button className="table-action muted-action" type="button" onClick={() => onUpdateMssDomain({ ...item, enabled: !item.enabled })}>{item.enabled ? "停用" : "启用"}</button></div></td>}</tr>)}{!mssDomains.length && <tr><td className="empty-cell" colSpan={canManageMss ? 7 : 6}>未找到匹配的MSS领域配置</td></tr>}</tbody></table></div>}
      {activeTab === "users" && <div className="plain-table-wrap"><table className="plain-table config-table"><thead><tr><th>工号</th><th>姓名</th><th>角色</th><th>负责范围</th><th>最后登录</th><th>状态</th>{canEdit && <th>操作</th>}</tr></thead><tbody>{visibleUsers.map((item) => {
        const roleLabel = ROLE_OPTIONS.find(r => r.value === item.role)?.label || item.role;
        return <tr key={item.id}>
          <td><code>{item.employeeNo}</code></td>
          <td><strong>{item.displayName}</strong></td>
          <td><span className="domain-chip">{roleLabel}</span></td>
          <td>{item.scopeNames?.length ? item.scopeNames.map((name) => <span className="domain-chip user-scope-chip" key={name}>{name}</span>) : "—"}</td>
          <td>{item.lastLoginAt ? new Date(item.lastLoginAt).toLocaleString('zh-CN') : '从未登录'}</td>
          <td><StatusBadge>{item.enabled ? "启用中" : "已停用"}</StatusBadge></td>
          {canEdit && <td><div className="config-actions"><button className="table-action" type="button" onClick={() => openUser(item)}><IconPencil size={15} />编辑</button><button className="table-action muted-action" type="button" onClick={() => onUpdateUser({ ...item, enabled: !item.enabled })}>{item.enabled ? "停用" : "启用"}</button></div></td>}
        </tr>;
      })}{!visibleUsers.length && <tr><td className="empty-cell" colSpan={canEdit ? 7 : 6}>未找到匹配的用户</td></tr>}</tbody></table></div>}
      {activeTab === "organizations" && <div className="plain-table-wrap"><table className="plain-table config-table organization-config-table"><thead><tr><th>组织层级</th><th>接口人</th><th>覆盖国家/地区</th><th>下级数量</th><th>状态</th>{canEdit && <th>操作</th>}</tr></thead><tbody>{visibleOrganizations.map((region) => { const open = Boolean(expandedRegions[region.id]); return <OrganizationRows key={region.id} region={region} open={open} canEdit={canEdit} onToggle={() => setExpandedRegions((current) => ({ ...current, [region.id]: !current[region.id] }))} onEditRegion={() => openRegion(region)} onAddOffice={() => openOffice(region, null)} onEditOffice={(office) => openOffice(region, office)} />; })}{!visibleOrganizations.length && <tr><td className="empty-cell" colSpan={canEdit ? 6 : 5}>未找到匹配的区域或代表处配置</td></tr>}</tbody></table></div>}
      {activeTab === "dictionaries" && <div>
        <div className="dict-type-tabs">
          {Object.entries(DICT_TYPE_MAP).map(([type, config]) => (
            <button key={type} type="button" className={activeDictType === type ? "dict-type-active" : ""} onClick={() => { setActiveDictType(type); setQuery(""); }}>
              {config.name} <span>{(dictionaries[type] || []).length}</span>
            </button>
          ))}
        </div>
        <div className="plain-table-wrap"><table className="plain-table config-table"><thead><tr><th>编码</th><th>名称</th><th>排序</th><th>说明</th><th>状态</th>{canEdit && <th>操作</th>}</tr></thead><tbody>{visibleDictItems.map((item) => <tr key={item.id}><td><code>{item.code}</code></td><td><strong>{item.name}</strong></td><td>{item.sortOrder}</td><td>{item.description || "—"}</td><td><StatusBadge>{item.enabled ? "启用中" : "已停用"}</StatusBadge></td>{canEdit && <td><div className="config-actions"><button className="table-action" type="button" onClick={() => openDictItem(item)}><IconPencil size={15} />编辑</button><button className="table-action muted-action" type="button" onClick={() => onUpdateDictionaryItem({ ...item, enabled: !item.enabled })}>{item.enabled ? "停用" : "启用"}</button></div></td>}</tr>)}{!visibleDictItems.length && <tr><td className="empty-cell" colSpan={canEdit ? 6 : 5}>未找到匹配的配置项</td></tr>}</tbody></table></div>
      </div>}
    </section>

    {editingProduct && <Dialog wide title={editingProduct === "new" ? "新增新品项目" : "编辑产品配置"} description="新品启动时维护产品名称和所属品类，产品型号与BOM编码可在产品线确认后补充" onClose={() => setEditingProduct(null)} footer={<><button className="button button-secondary compact-button" type="button" onClick={() => setEditingProduct(null)}>取消</button><button className="button button-primary compact-button" type="button" onClick={saveProduct}>{editingProduct === "new" ? "创建产品" : "保存更新"}</button></>}><div className="config-form"><div className="config-form-grid"><label>产品名称<sup>*</sup><input value={productForm.name} onChange={(event) => updateProductField("name", event.target.value)} placeholder="例如 Chitu B23新品项目" /></label><label>所属产品品类<sup>*</sup><select value={productForm.categoryId} onChange={(event) => updateProductField("categoryId", event.target.value)} aria-label="所属产品品类" disabled={currentUserRole === 'GTM' && domains.length === 1}>{(currentUserRole !== 'GTM' || domains.length > 1) && <option value="">请选择产品品类</option>}{domains.map((item) => <option value={item.id} key={item.id}>{item.name}（GTM：{item.gtm}）</option>)}</select></label><label>预计样机提供时间（可选）<input value={productForm.supply} onChange={(event) => updateProductField("supply", event.target.value)} placeholder="待产品线确认" /></label><label>计划默认截止（可选）<input value={productForm.deadline} onChange={(event) => updateProductField("deadline", event.target.value)} placeholder="在收集计划中设置" /></label></div>{activeDomain && <div className="responsibility-preview"><span>责任人自动带出</span><div><strong>{activeDomain.name}</strong><i>GTM · {activeDomain.gtm}</i><i>备货接口人 · {activeDomain.stockingOwner}</i></div></div>}<div className="sku-builder"><div><span><h3>产品型号与BOM</h3><small>均可后补；有型号但暂无BOM时，只填写型号即可</small></span><button className="text-button" type="button" onClick={() => setProductForm((current) => ({ ...current, skus: [...current.skus, { _uid: `sku-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, sku: "", bom: "", description: "" }] }))}><IconPlus size={16} />添加型号</button></div>{productForm.skus.map((sku, index) => <div className="sku-builder-row" key={sku._uid} style={{display: 'grid', gridTemplateColumns: '28px 1fr 1fr 36px', gap: '8px 10px', alignItems: 'center', marginBottom: '10px'}}>
  <span>{index + 1}</span>
  <input value={sku.sku} onChange={(event) => updateSku(index, "sku", event.target.value)} placeholder="产品型号（可后补）" aria-label={`第${index + 1}个产品型号`} />
  <input value={sku.bom} onChange={(event) => updateSku(index, "bom", event.target.value)} placeholder="BOM编码（可后补）" aria-label={`第${index + 1}个BOM编码`} />
  <button type="button" onClick={() => removeSku(index)} disabled={productForm.skus.length === 1} aria-label={`删除第${index + 1}个产品型号`} style={{padding: '6px', display: 'flex', alignItems: 'center', justifyContent: 'center'}}><IconX size={17} /></button>
  <input style={{gridColumn: '2 / span 2'}} value={sku.description} onChange={(event) => updateSku(index, "description", event.target.value)} placeholder="产品描述（配置/规格说明，可选）" aria-label={`第${index + 1}个产品描述`} />
</div>)}</div>{productError && <p className="config-error"><IconAlertTriangleFilled size={16} />{productError}</p>}</div></Dialog>}
    {editingDomain && <Dialog title={editingDomain === "new" ? "新增产品品类" : "编辑品类与责任人"} description="产品按品类继承GTM与备货接口人；MSS接口人在“MSS业务领域”中独立配置" onClose={() => setEditingDomain(null)} footer={<><button className="button button-secondary compact-button" type="button" onClick={() => setEditingDomain(null)}>取消</button><button className="button button-primary compact-button" type="button" onClick={saveDomain}>{editingDomain === "new" ? "创建品类" : "保存更新"}</button></>}><div className="dialog-form"><label>品类名称<input value={domainForm.name} onChange={(event) => setDomainForm((current) => ({ ...current, name: event.target.value }))} placeholder="例如 PC" /></label><label>品类说明<input value={domainForm.description} onChange={(event) => setDomainForm((current) => ({ ...current, description: event.target.value }))} placeholder="填写该品类覆盖的产品类型" /></label><div className="two-field-row"><label>GTM接口人<sup>*</sup><input value={domainForm.gtm} onChange={(event) => setDomainForm((current) => ({ ...current, gtm: event.target.value }))} placeholder="请输入已创建的GTM姓名或工号" /></label><label>备货接口人<sup>*</sup><input value={domainForm.stockingOwner} onChange={(event) => setDomainForm((current) => ({ ...current, stockingOwner: event.target.value }))} placeholder="请输入已创建的备货接口人" /></label></div>{domainError && <p className="config-error"><IconAlertTriangleFilled size={16} />{domainError}</p>}</div></Dialog>}
    {editingMssDomain && <Dialog title={editingMssDomain === "new" ? "新增MSS业务领域" : "编辑MSS业务领域"} description="MSS领域负责人按业务线划分权限，可跨产品品类审核对应领域的需求" onClose={() => setEditingMssDomain(null)} footer={<><button className="button button-secondary compact-button" type="button" onClick={() => setEditingMssDomain(null)}>取消</button><button className="button button-primary compact-button" type="button" onClick={saveMssDomain}>{editingMssDomain === "new" ? "创建领域" : "保存更新"}</button></>}><div className="dialog-form"><div className="two-field-row"><label>领域名称<sup>*</sup><input value={mssDomainForm.name} onChange={(event) => setMssDomainForm((current) => ({ ...current, name: event.target.value }))} placeholder="例如 MKT领域" /></label><label>领域编码<sup>*</sup><input value={mssDomainForm.code} onChange={(event) => setMssDomainForm((current) => ({ ...current, code: event.target.value }))} placeholder="例如 mkt" disabled={editingMssDomain !== "new"} /></label></div><label>MSS接口人<sup>*</sup><input value={mssDomainForm.mssOwner} onChange={(event) => setMssDomainForm((current) => ({ ...current, mssOwner: event.target.value }))} placeholder="负责该业务领域需求审核的接口人姓名" /></label><label>领域说明<input value={mssDomainForm.description} onChange={(event) => setMssDomainForm((current) => ({ ...current, description: event.target.value }))} placeholder="填写该MSS领域覆盖的业务场景" /></label>{mssDomainError && <p className="config-error"><IconAlertTriangleFilled size={16} />{mssDomainError}</p>}</div></Dialog>}
    {organizationModal && <Dialog title={organizationModal.type === "region" ? `${organizationModal.id === "new" ? "新增" : "编辑"}区域` : `${organizationModal.id === "new" ? "新增" : "编辑"}代表处`} description={organizationModal.type === "region" ? "配置区域名称及MSS领域接口人" : `所属区域：${organizations.find((item) => item.id === organizationModal.regionId)?.name}`} onClose={() => setOrganizationModal(null)} footer={<><button className="button button-secondary compact-button" type="button" onClick={() => setOrganizationModal(null)}>取消</button><button className="button button-primary compact-button" type="button" onClick={saveOrganization}>保存配置</button></>}><div className="dialog-form"><label>{organizationModal.type === "region" ? "区域名称" : "代表处名称"}<input value={organizationForm.name} onChange={(event) => setOrganizationForm((current) => ({ ...current, name: event.target.value }))} placeholder={organizationModal.type === "region" ? "例如 北美MKT" : "例如 美国代表处"} /></label><label>{organizationModal.type === "region" ? "区域接口人" : "代表处接口人"}<input value={organizationForm.owner} onChange={(event) => setOrganizationForm((current) => ({ ...current, owner: event.target.value }))} placeholder="请输入姓名或工号" /></label>{organizationModal.type === "office" && <label>覆盖国家/地区<input value={organizationForm.countries} onChange={(event) => setOrganizationForm((current) => ({ ...current, countries: event.target.value }))} placeholder="多个国家用顿号或逗号分隔" /></label>}{organizationError && <p className="config-error"><IconAlertTriangleFilled size={16} />{organizationError}</p>}</div></Dialog>}
    {editingDictItem && <Dialog title={editingDictItem === "new" ? `新增${DICT_TYPE_MAP[activeDictType].name}` : `编辑${DICT_TYPE_MAP[dictItemForm.dictType].name}`} description={DICT_TYPE_MAP[dictItemForm.dictType].description} onClose={() => setEditingDictItem(null)} footer={<><button className="button button-secondary compact-button" type="button" onClick={() => setEditingDictItem(null)}>取消</button><button className="button button-primary compact-button" type="button" onClick={saveDictItem}>{editingDictItem === "new" ? "创建配置项" : "保存更新"}</button></>}><div className="dialog-form"><label>所属类型<select value={dictItemForm.dictType} onChange={(event) => setDictItemForm((current) => ({ ...current, dictType: event.target.value }))} disabled={editingDictItem !== "new"}>{Object.entries(DICT_TYPE_MAP).map(([type, config]) => <option key={type} value={type}>{config.name}</option>)}</select></label><div className="two-field-row"><label>编码<sup>*</sup><input value={dictItemForm.code} onChange={(event) => setDictItemForm((current) => ({ ...current, code: event.target.value }))} placeholder="例如 EVT" disabled={editingDictItem !== "new"} /></label><label>排序<input type="number" value={dictItemForm.sortOrder} onChange={(event) => setDictItemForm((current) => ({ ...current, sortOrder: Number(event.target.value) }))} placeholder="数字越小越靠前" /></label></div><label>显示名称<sup>*</sup><input value={dictItemForm.name} onChange={(event) => setDictItemForm((current) => ({ ...current, name: event.target.value }))} placeholder="例如 工程样机（EVT）" /></label><label>说明（可选）<input value={dictItemForm.description} onChange={(event) => setDictItemForm((current) => ({ ...current, description: event.target.value }))} placeholder="对该配置项的补充说明" /></label>{dictItemError && <p className="config-error"><IconAlertTriangleFilled size={16} />{dictItemError}</p>}</div></Dialog>}
    {editingUser && <Dialog title={editingUser === "new" ? "新增用户" : "编辑用户"} description="用户账号可分配到领域、区域作为接口人" onClose={() => setEditingUser(null)} footer={<><button className="button button-secondary compact-button" type="button" onClick={() => setEditingUser(null)}>取消</button><button className="button button-primary compact-button" type="button" onClick={saveUser}>{editingUser === "new" ? "创建用户" : "保存更新"}</button></>}><div className="dialog-form">
      <div className="two-field-row">
        <label>工号<sup>*</sup><input value={userForm.employeeNo} onChange={(event) => setUserForm((current) => ({ ...current, employeeNo: event.target.value }))} placeholder="请输入工号" disabled={editingUser !== "new"} /></label>
        <label>姓名<sup>*</sup><input value={userForm.displayName} onChange={(event) => setUserForm((current) => ({ ...current, displayName: event.target.value }))} placeholder="请输入姓名" /></label>
      </div>
      <div className="two-field-row">
        <label>角色<sup>*</sup>
          <select value={userForm.role} onChange={(event) => changeUserRole(event.target.value)}>
            {ROLE_OPTIONS.map(role => <option key={role.value} value={role.value}>{role.label}</option>)}
          </select>
        </label>
        <label>{editingUser === "new" ? "初始密码" : "重置密码"}<input type="password" value={userForm.password || ''} onChange={(event) => setUserForm((current) => ({ ...current, password: event.target.value }))} placeholder={editingUser === "new" ? "至少8位" : "留空则不修改密码"} /></label>
      </div>
      {["GTM", "STOCKING_OWNER"].includes(userForm.role) && <fieldset className="scope-picker"><legend>负责产品品类<sup>*</sup></legend><p>可多选，数据来自“产品品类”配置</p><div>{domains.filter((item) => item.enabled || userForm.productDomainIds?.includes(item.id)).map((item) => <label key={item.id}><input type="checkbox" checked={userForm.productDomainIds?.includes(item.id) || false} onChange={() => toggleUserScope("productDomainIds", item.id)} /><span><strong>{item.name}</strong><small>{item.description || "产品品类"}</small></span></label>)}</div></fieldset>}
      {["MSS_DOMAIN_OWNER", "REGIONAL_OWNER"].includes(userForm.role) && <fieldset className="scope-picker"><legend>所属MSS业务领域<sup>*</sup></legend><p>可多选，数据来自“MSS业务领域”配置</p><div>{mssDomains.filter((item) => item.enabled || userForm.mssDomainIds?.includes(item.id)).map((item) => <label key={item.id}><input type="checkbox" checked={userForm.mssDomainIds?.includes(item.id) || false} onChange={() => toggleUserScope("mssDomainIds", item.id)} /><span><strong>{item.name}</strong><small>{item.description || item.code}</small></span></label>)}</div></fieldset>}
      <label>账号状态
        <select value={userForm.enabled ? "enabled" : "disabled"} onChange={(event) => setUserForm((current) => ({ ...current, enabled: event.target.value === "enabled" }))}>
          <option value="enabled">启用</option>
          <option value="disabled">停用</option>
        </select>
      </label>
      {editingUser === "new" && <p className="config-hint">请设置一次性初始密码，并提醒用户首次登录后修改</p>}
      {userError && <p className="config-error"><IconAlertTriangleFilled size={16} />{userError}</p>}
    </div></Dialog>}
  </main>;
}

function OrganizationRows({ region, open, canEdit = true, onToggle, onEditRegion, onAddOffice, onEditOffice }) {
  const countries = [...new Set(region.offices.flatMap((office) => office.countries))];
  return <><tr className="organization-region-row"><td><button className="tree-toggle" type="button" aria-expanded={open} onClick={onToggle} aria-label={`${open ? "收起" : "展开"}${region.name}`}>{open ? <IconChevronDown size={18} /> : <IconChevronRight size={18} />}<span><strong>{region.name}</strong><small>区域</small></span></button></td><td><span className="owner-cell compact-owner"><i>{region.owner.slice(0, 1)}</i><strong>{region.owner}</strong></span></td><td>{countries.join("、")}</td><td><strong>{region.offices.length}个代表处</strong><small>{countries.length}个国家/地区</small></td><td><StatusBadge>启用中</StatusBadge></td>{canEdit && <td><div className="config-actions"><button className="table-action" type="button" onClick={onEditRegion}><IconPencil size={15} />编辑区域</button><button className="table-action" type="button" onClick={onAddOffice}><IconPlus size={15} />新增代表处</button></div></td>}</tr>{open && region.offices.map((office) => <tr className="organization-office-row" key={office.id}><td><span className="organization-office-name"><IconChevronRight size={15} /><span><strong>{office.name}</strong><small>代表处</small></span></span></td><td>{office.owner}</td><td>{office.countries.join("、")}</td><td>{office.countries.length}个国家/地区</td><td><StatusBadge>启用中</StatusBadge></td>{canEdit && <td><button className="table-action" type="button" onClick={() => onEditOffice(office)}><IconPencil size={15} />编辑代表处</button></td>}</tr>)}</>;
}
