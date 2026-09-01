import { useEffect, useState } from "react";
import {
  IconAlertTriangleFilled, IconArrowRight, IconBuildingWarehouse, IconCheck,
  IconBuilding, IconChevronDown, IconChevronRight, IconCircleCheckFilled, IconClipboardCheck, IconClockHour4,
  IconCode, IconCopy, IconDatabaseImport, IconDownload, IconFileSpreadsheet,
  IconFlag, IconHierarchy3, IconLink, IconMapPin, IconNotes, IconPackage, IconPlus,
  IconSearch, IconSend, IconShieldCheck, IconUpload, IconUsers, IconWorld, IconX,
} from "@tabler/icons-react";
import { api } from "./api/client.js";

function PageHeader({ title, description, action }) {
  return <section className="ops-heading"><div><h1>{title}</h1><p>{description}</p></div>{action}</section>;
}

function MetricStrip({ items }) {
  return <section className="metric-strip" aria-label="关键指标">{items.map(({ label, value, unit, hint, tone, icon: Icon }) => <div className="metric-item" key={label}><span className={`metric-icon metric-${tone || "blue"}`}><Icon size={20} stroke={1.8} /></span><div><span className="metric-label">{label}</span><div className="metric-value">{value}<small>{unit}</small></div><span className="metric-hint">{hint}</span></div></div>)}</section>;
}

function Dialog({ title, description, onClose, children, footer, wide = false }) {
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className={`operation-modal ${wide ? "operation-modal-wide" : ""}`} role="dialog" aria-modal="true" aria-label={title}><div className="modal-header"><div><h2>{title}</h2><p>{description}</p></div><button className="icon-button" type="button" onClick={onClose} aria-label="关闭"><IconX size={22} /></button></div>{children}<div className="modal-actions">{footer}</div></section></div>;
}

function FlowTrack() {
  const steps = [
    ["1", "产品建档", "GTM维护产品名称，BOM可后补"],
    ["2", "计划下发", "GTM选择MSS领域与区域"],
    ["3", "区域收集", "领域接口人汇总各区域需求"],
    ["4", "领域反馈", "领域确认后反馈给GTM"],
    ["5", "导出排产", "GTM导出Excel给产品线"],
  ];
  return <section className="ops-surface collection-flow"><div className="surface-title"><div><h2>新品样机需求收集流程</h2><p>以收集计划为主线，所有区域在同一批次内反馈</p></div><span className="scope-path"><IconCircleCheckFilled size={17} />流程口径已统一</span></div><div className="collection-flow-track">{steps.map(([number, title, note], index) => <div className="collection-flow-step" key={title}><span>{number}</span><div><strong>{title}</strong><small>{note}</small></div>{index < steps.length - 1 && <IconArrowRight size={18} />}</div>)}</div></section>;
}

const getPlanStatusClass = (status) => {
  if (["待GTM收口", "已导出", "已反馈"].includes(status)) return "badge-success";
  if (["收集中", "待领域反馈"].includes(status)) return "badge-info";
  return "badge-warning";
};

export function CollectionPlanPage({ products = [], organizations = [], plans = [], onCreatePlan, onReleasePlan, onExportPlan, onOpenProgress, showToast }) {
  const [query, setQuery] = useState("");
  const [newPlanOpen, setNewPlanOpen] = useState(false);
  const [planForm, setPlanForm] = useState({ productId: products[0]?.id || "", deadline: "2026-09-20T18:00", scope: "全部MSS区域" });
  useEffect(() => { if (!planForm.productId && products[0]?.id) setPlanForm((current) => ({ ...current, productId: products[0].id })); }, [products, planForm.productId]);
  const productById = (id) => products.find((item) => item.id === id);
  const visiblePlans = plans.filter((plan) => {
    const product = productById(plan.productId);
    return `${plan.id}${product?.name || ""}${product?.category || ""}${plan.scope}${plan.status}`.toLowerCase().includes(query.toLowerCase());
  });
  const missingBomProducts = products.filter((product) => !product.skus?.length || product.skus.some((sku) => !sku.bom)).length;
  const pendingRegions = plans.filter((plan) => ["收集中", "待领域反馈"].includes(plan.status)).reduce((sum, plan) => sum + Math.max(0, (plan.total || 0) - (plan.submittedRegions?.length || 0)), 0);

  const createPlan = async () => {
    const product = productById(planForm.productId);
    if (!product) return;
    try {
      await onCreatePlan({ productId: product.id, regionIds: organizations.filter((item) => item.enabled).map((item) => item.id), deadline: new Date(planForm.deadline).toISOString() });
      setNewPlanOpen(false);
    } catch (error) { showToast(error.message, "warning"); }
  };

  return <main className="workspace workspace-no-footer">
    <PageHeader title="需求收集 · 计划管理" description="GTM工作台：创建并下发新品计划，查看收集进度，接收领域反馈后导出排产" action={<div className="heading-actions"><span className="workbench-badge"><IconShieldCheck size={17} />GTM工作台</span><button className="button button-primary compact-button" type="button" onClick={() => setNewPlanOpen(true)}><IconPlus size={18} />新建收集计划</button></div>} />
    <MetricStrip items={[
      { label: "进行中计划", value: plans.filter((item) => ["收集中", "待领域反馈", "待GTM收口"].includes(item.status)).length, unit: "个", hint: `${products.length}个新品项目`, icon: IconClipboardCheck },
      { label: "待区域反馈", value: pendingRegions, unit: "个", hint: "按计划范围统计", tone: "amber", icon: IconClockHour4 },
      { label: "已收集需求", value: plans.reduce((sum, item) => sum + Number(item.demand || 0), 0).toLocaleString(), unit: "Pcs", hint: "等待产品线排产", icon: IconPackage },
      { label: "BOM待补充", value: missingBomProducts, unit: "个产品", hint: "不影响先发起收集", tone: missingBomProducts ? "amber" : "blue", icon: IconAlertTriangleFilled },
      { label: "覆盖组织", value: organizations.length, unit: "个区域", hint: `${organizations.reduce((sum, item) => sum + (item.offices?.length || 0), 0)}个代表处`, icon: IconWorld },
    ]} />
    <FlowTrack />
    <section className="ops-surface plan-surface"><div className="surface-title"><div><h2>我负责的收集计划</h2><p>这里只保留GTM需要管理和收口的动作，不进入区域填报</p></div><span className="surface-summary">共 <strong>{visiblePlans.length}</strong> 条计划</span></div><div className="ops-toolbar"><label className="search-box wide-search"><IconSearch size={19} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索计划、产品、领域或状态" /></label><span className="toolbar-spacer" /><span className="config-sync-hint"><IconUsers size={17} />计划下发 → 查看进度 → 接收反馈 → 导出排产</span></div>
      <div className="plain-table-wrap"><table className="plain-table collection-plan-table"><thead><tr><th>计划 / 产品</th><th>下发范围</th><th>收集进度</th><th>需求汇总</th><th>BOM准备度</th><th>当前节点</th><th>截止时间</th><th>GTM操作</th></tr></thead><tbody>{visiblePlans.map((plan) => { const product = productById(plan.productId); const missing = !product?.skus.length || product.skus.some((sku) => !sku.bom); const submitted = plan.submittedRegions.length; const percent = Math.round(submitted / Math.max(1, plan.total) * 100); return <tr key={plan.id}><td><strong>{product?.name || "未配置产品"}</strong><small>{plan.planNo} · {product?.category || "待配置领域"} · GTM {product?.gtm || "待配置"}</small></td><td><strong>{plan.scope}</strong><small>领域接口人统一收集</small></td><td><span className="plan-progress"><span><i style={{ width: `${percent}%` }} /></span><strong>{submitted}/{plan.total}</strong></span></td><td><strong>{plan.demand.toLocaleString()} Pcs</strong><small>{submitted ? "区域数据持续汇总" : "尚未形成数据"}</small></td><td><span className={`bom-readiness ${missing ? "bom-pending" : "bom-ready"}`}>{missing ? <IconAlertTriangleFilled size={15} /> : <IconCircleCheckFilled size={15} />}{missing ? "可后补" : "已完整"}</span><small>{product?.skus.length || 0}个型号 / {product?.skus.filter((sku) => sku.bom).length || 0}个BOM</small></td><td><span className={`status-badge ${getPlanStatusClass(plan.status)}`}>{plan.status}</span></td><td>{plan.deadline}</td><td><div className="config-actions plan-actions">{plan.status === "产品建档" && <button className="table-action" type="button" onClick={() => showToast("请先在配置管理补充产品基本信息", "warning")}>完善产品</button>}{plan.status === "待下发" && <button className="table-action" type="button" onClick={() => onReleasePlan(plan)}><IconSend size={15} />下发计划</button>}{["收集中", "待领域反馈"].includes(plan.status) && <button className="table-action" type="button" onClick={() => onOpenProgress(plan.id, "progress")}><IconChevronRight size={15} />查看收集进度</button>}{["待GTM收口", "已导出"].includes(plan.status) && <><button className="table-action" type="button" onClick={() => onOpenProgress(plan.id, "feedback")}><IconNotes size={15} />查看领域反馈</button><button className="table-action muted-action" type="button" onClick={() => onExportPlan(plan)}><IconDownload size={15} />{plan.status === "已导出" ? "重新导出" : "导出排产"}</button></>}</div></td></tr>; })}{!visiblePlans.length && <tr><td className="empty-cell" colSpan="8">暂无符合条件的收集计划</td></tr>}</tbody></table></div>
    </section>
    {newPlanOpen && <Dialog title="新建需求收集计划" description="选择新品项目并确定本轮收集范围与截止时间" onClose={() => setNewPlanOpen(false)} footer={<><button className="button button-secondary compact-button" type="button" onClick={() => setNewPlanOpen(false)}>取消</button><button className="button button-primary compact-button" type="button" onClick={createPlan}>创建计划</button></>}><div className="dialog-form"><label>新品项目<select value={planForm.productId} onChange={(event) => setPlanForm((current) => ({ ...current, productId: event.target.value }))}>{products.map((product) => <option value={product.id} key={product.id}>{product.category}｜{product.name}</option>)}</select></label><label>下发范围<select value={planForm.scope} onChange={(event) => setPlanForm((current) => ({ ...current, scope: event.target.value }))}><option>全部MSS区域</option></select></label><label>收集截止时间<input type="datetime-local" value={planForm.deadline} onChange={(event) => setPlanForm((current) => ({ ...current, deadline: event.target.value }))} /></label><p><IconCircleCheckFilled size={17} />创建后由GTM确认并下发给对应MSS领域接口人</p></div></Dialog>}
  </main>;
}

function RoleFlow({ items }) {
  return <section className="role-flow" aria-label="当前角色流程">{items.map((item, index) => <div key={item.title} className={item.active ? "role-flow-active" : ""}><span>{index + 1}</span><div><strong>{item.title}</strong><small>{item.note}</small></div>{index < items.length - 1 && <IconChevronRight size={17} />}</div>)}</section>;
}

export function DomainTaskPage({ products = [], organizations = [], plans = [], onOpenTask }) {
  const [query, setQuery] = useState("");
  const domainPlans = plans.filter((plan) => {
    return !["产品建档", "待下发"].includes(plan.status);
  });
  const assignedProduct = products.find((item) => item.id === domainPlans[0]?.productId);
  const visible = domainPlans.filter((plan) => {
    const product = products.find((item) => item.id === plan.productId);
    return `${plan.id}${product?.name || ""}${plan.status}`.toLowerCase().includes(query.toLowerCase());
  });
  const pendingRegions = domainPlans.reduce((sum, plan) => sum + Math.max(0, (plan.total || 0) - (plan.submittedRegions?.length || 0)), 0);
  const feedbackPending = domainPlans.filter((item) => item.status === "待领域反馈").length;
  return <main className="workspace workspace-no-footer">
    <PageHeader title="需求收集 · 我的领域任务" description="MSS领域接口人工作台：组织区域收集、检查领域汇总，并将完整结果反馈给GTM" action={<span className="workbench-badge"><IconHierarchy3 size={17} />{assignedProduct?.category || "当前"}领域 · {assignedProduct?.domainOwner || "接口人"}</span>} />
    <MetricStrip items={[
      { label: "进行中任务", value: domainPlans.filter((item) => ["收集中", "待领域反馈"].includes(item.status)).length, unit: "个", hint: "仅展示本领域计划", icon: IconClipboardCheck },
      { label: "待区域提交", value: pendingRegions, unit: "个", hint: "可继续跟进收集", tone: "amber", icon: IconClockHour4 },
      { label: "待反馈GTM", value: feedbackPending, unit: "个", hint: "区域已全部收齐", tone: feedbackPending ? "amber" : "blue", icon: IconSend },
      { label: "已汇总需求", value: domainPlans.reduce((sum, item) => sum + Number(item.demand || 0), 0).toLocaleString(), unit: "Pcs", hint: `${assignedProduct?.category || "当前"}领域当前批次`, icon: IconPackage },
      { label: "覆盖组织", value: organizations.length, unit: "个区域", hint: `${organizations.reduce((sum, item) => sum + (item.offices?.length || 0), 0)}个代表处`, icon: IconWorld },
    ]} />
    <RoleFlow items={[
      { title: "接收GTM计划", note: "只接收本领域计划" },
      { title: "组织区域收集", note: "跟进区域、代表处和国家", active: true },
      { title: "检查领域汇总", note: "核对缺失与异常" },
      { title: "反馈给GTM", note: "形成正式交接" },
    ]} />
    <section className="ops-surface domain-task-surface"><div className="surface-title"><div><h2>我的收集任务</h2><p>一条任务对应GTM下发给本领域的一条收集计划</p></div><span className="surface-summary">共 <strong>{visible.length}</strong> 条任务</span></div><div className="ops-toolbar"><label className="search-box wide-search"><IconSearch size={19} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索计划、产品或任务状态" /></label><span className="toolbar-spacer" /><span className="config-sync-hint"><IconShieldCheck size={17} />本页不提供新建计划</span></div>
      <div className="plain-table-wrap"><table className="plain-table domain-task-table"><thead><tr><th>计划 / 产品</th><th>GTM下发信息</th><th>区域进度</th><th>领域需求</th><th>领域任务状态</th><th>截止时间</th><th>下一步</th></tr></thead><tbody>{visible.map((plan) => { const product = products.find((item) => item.id === plan.productId); const submitted = plan.submittedRegions.length; const taskStatus = plan.status === "待领域反馈" ? "待反馈" : ["待GTM收口", "已导出"].includes(plan.status) ? "已反馈" : "收集中"; return <tr key={plan.id}><td><strong>{product?.name}</strong><small>{plan.id} · {product?.stage}</small></td><td><strong>GTM {product?.gtm}</strong><small>{plan.scope}</small></td><td><span className="plan-progress"><span><i style={{ width: `${submitted / Math.max(1, plan.total) * 100}%` }} /></span><strong>{submitted}/{plan.total}</strong></span><small>{submitted === plan.total ? "区域已全部收齐" : `还有${plan.total - submitted}个区域待提交`}</small></td><td><strong>{plan.demand.toLocaleString()} Pcs</strong><small>{product?.skus.length || 0}个SKU</small></td><td><span className={`status-badge ${getPlanStatusClass(taskStatus)}`}>{taskStatus}</span></td><td>{plan.deadline}</td><td><button className="table-action" type="button" onClick={() => onOpenTask(plan.id, taskStatus === "待反馈" ? "feedback" : "progress")}><IconChevronRight size={15} />{taskStatus === "待反馈" ? "检查并反馈" : taskStatus === "已反馈" ? "查看已反馈" : "继续收集"}</button></td></tr>; })}</tbody></table></div>
    </section>
  </main>;
}

export function RegionalTaskPage({ products = [], organizations = [], plans = [], activeRegion, onOpenEntry }) {
  const region = organizations.find((item) => item.id === activeRegion) || organizations[0];
  const visiblePlans = plans.filter((plan) => ["收集中", "待领域反馈", "待GTM收口", "已导出"].includes(plan.status));
  if (!region) return <main className="workspace workspace-no-footer"><PageHeader title="需求收集 · 我的区域填报" description="当前账号尚未配置负责区域，请联系管理员完成区域接口人配置" /></main>;
  const countryCount = (region.offices || []).reduce((sum, office) => sum + (office.countries?.length || 0), 0);
  return <main className="workspace workspace-no-footer">
    <PageHeader title="需求收集 · 我的区域填报" description="区域/代表处接口人工作台：仅填写本区域范围内的产品需求，提交后进入MSS领域汇总" action={<span className="workbench-badge"><IconMapPin size={17} />{region.name} · 接口人{region.owner}</span>} />
    <MetricStrip items={[
      { label: "待填报任务", value: visiblePlans.filter((plan) => !plan.submittedRegions.includes(region.id)).length, unit: "个", hint: "来自MSS领域接口人", tone: "amber", icon: IconClipboardCheck },
      { label: "已提交任务", value: visiblePlans.filter((plan) => plan.submittedRegions.includes(region.id)).length, unit: "个", hint: "已纳入领域汇总", icon: IconCircleCheckFilled },
      { label: "区域代表处", value: region.offices.length, unit: "个", hint: region.offices.map((item) => item.name.replace("代表处", "")).join("、"), icon: IconBuilding },
      { label: "国家/地区", value: countryCount, unit: "个", hint: "按组织配置自动带入", icon: IconFlag },
      { label: "当前区域", value: region.name.replace("MKT", ""), unit: "MKT", hint: `区域接口人 ${region.owner}`, icon: IconWorld },
    ]} />
    <RoleFlow items={[
      { title: "接收区域任务", note: "来自领域接口人" },
      { title: "汇总代表处需求", note: "可细化到国家", active: true },
      { title: "提交区域结果", note: "进入领域汇总" },
    ]} />
    <section className="ops-surface domain-task-surface"><div className="surface-title"><div><h2>我的填报任务</h2><p>仅展示当前区域有权限处理的新品计划</p></div><span className="surface-summary">共 <strong>{visiblePlans.length}</strong> 条任务</span></div><div className="plain-table-wrap"><table className="plain-table regional-task-table"><thead><tr><th>计划 / 产品</th><th>来源</th><th>本区域组织范围</th><th>产品项</th><th>填报状态</th><th>截止时间</th><th>操作</th></tr></thead><tbody>{visiblePlans.map((plan) => { const product = products.find((item) => item.id === plan.productId); const submitted = plan.submittedRegions.includes(region.id); return <tr key={plan.id}><td><strong>{product?.name}</strong><small>{plan.id} · {product?.stage}</small></td><td><strong>{product?.category}领域</strong><small>领域接口人 {product?.domainOwner || "待配置"}</small></td><td><span className="org-count"><IconBuilding size={16} />{region.offices.length}个代表处</span><span className="org-count"><IconFlag size={16} />{countryCount}个国家/地区</span></td><td><strong>{product?.skus.length || 1}项</strong><small>{product?.skus.length ? "按SKU填报" : "可先按产品填报"}</small></td><td><span className={`status-badge ${submitted ? "badge-success" : "badge-warning"}`}>{submitted ? "已提交" : "待填报"}</span></td><td>{plan.deadline}</td><td><button className="table-action" type="button" onClick={() => onOpenEntry(plan.id, region.id)}><IconChevronRight size={15} />{submitted ? "查看并调整" : "进入填报"}</button></td></tr>; })}</tbody></table></div></section>
  </main>;
}

export function CollectionTaskDetailPage({ role, plan, products = [], organizations = [], rowsByProduct = {}, initialTab = "progress", onBack, onOpenEntry, onFeedback, showToast }) {
  const [activeTab, setActiveTab] = useState(initialTab);
  const [feedbackNote, setFeedbackNote] = useState("已完成本领域全部区域需求核对，区域反馈数据无遗漏，可供GTM汇总排产。");
  const [confirmed, setConfirmed] = useState(true);
  if (!plan) return null;
  const product = products.find((item) => item.id === plan.productId) || { name: "未配置产品", category: "待配置", gtm: "待配置", domainOwner: "待配置", skus: [] };
  const submittedCount = plan.submittedRegions?.length || 0;
  const allSubmitted = submittedCount >= (plan.total || 0);
  const skuUnits = product?.skus?.length ? product.skus : [{ sku: `${product?.name || "产品"}（型号待补充）`, bom: "" }];
  const regionDemand = (regionId) => {
    const officeRowsMap = rowsByProduct[plan.productId]?.[regionId] || {};
    const localRows = Object.values(officeRowsMap).flat();
    const localTotal = localRows.reduce((sum, row) => sum + Number(row.qty || 0), 0);
    return localTotal || Number(plan.regionProgress?.find((item) => item.regionId === regionId)?.demand || 0);
  };
  const totalDemand = organizations.reduce((sum, region) => sum + regionDemand(region.id), 0);
  const displayDemand = plan.demand || totalDemand;
  const isGtm = role === "GTM";
  const feedbackReady = ["待GTM收口", "已导出"].includes(plan.status);
  const submitFeedback = async () => {
    if (!allSubmitted || !confirmed) { showToast("请先完成全部区域收集并确认汇总结果", "warning"); return; }
    try { await onFeedback(plan, feedbackNote); showToast(`${product?.name}领域汇总已正式反馈给GTM`); } catch (error) { showToast(error.message, "warning"); }
  };
  return <main className="workspace workspace-no-footer">
    <section className="task-detail-heading"><div><button className="back-to-plan" type="button" onClick={onBack}><IconChevronDown size={17} />返回{isGtm ? "计划管理" : "我的领域任务"}</button><div className="detail-title-line"><h1>{product?.name}需求收集</h1><span className={`status-badge ${getPlanStatusClass(plan.status)}`}>{plan.status}</span></div><div className="batch-meta"><span>计划编号</span><strong>{plan.planNo}</strong><i>·</i><span>产品领域</span><strong>{product?.category}</strong><i>·</i><span>GTM</span><strong>{product?.gtm}</strong><i>·</i><span>领域接口人</span><strong>{product?.domainOwner || "待配置"}</strong><i>·</i><span>截止</span><strong className="deadline">{plan.deadline}</strong></div></div><span className="workbench-badge">{isGtm ? <IconShieldCheck size={17} /> : <IconHierarchy3 size={17} />}{isGtm ? "GTM只读查看" : "MSS领域任务"}</span></section>
    <section className="task-summary-strip"><div><span>区域完成</span><strong>{submittedCount}/{plan.total || 0}</strong><small>{allSubmitted ? "已全部收齐" : `还差${(plan.total || 0) - submittedCount}个区域`}</small></div><div><span>代表处覆盖</span><strong>{organizations.reduce((sum, item) => sum + (item.offices?.length || 0), 0)}</strong><small>按组织配置自动汇总</small></div><div><span>国家/地区覆盖</span><strong>{organizations.reduce((sum, item) => sum + (item.offices || []).reduce((officeSum, office) => officeSum + (office.countries?.length || 0), 0), 0)}</strong><small>可逐级追溯</small></div><div><span>当前汇总需求</span><strong>{displayDemand.toLocaleString()} Pcs</strong><small>{skuUnits.length}个产品项</small></div></section>
    <section className="ops-surface task-detail-surface"><div className="task-tabs" role="tablist" aria-label="收集任务详情"><button type="button" role="tab" aria-selected={activeTab === "progress"} className={activeTab === "progress" ? "task-tab-active" : ""} onClick={() => setActiveTab("progress")}><IconHierarchy3 size={18} />{isGtm ? "收集进度" : "区域收集进度"}</button><button type="button" role="tab" aria-selected={activeTab === "summary"} className={activeTab === "summary" ? "task-tab-active" : ""} onClick={() => setActiveTab("summary")}><IconFileSpreadsheet size={18} />领域需求汇总</button><button type="button" role="tab" aria-selected={activeTab === "feedback"} className={activeTab === "feedback" ? "task-tab-active" : ""} onClick={() => setActiveTab("feedback")}><IconSend size={18} />{isGtm ? "领域反馈" : "反馈GTM"}{!isGtm && plan.status === "待领域反馈" && <span className="task-tab-dot" />}</button></div>
      {activeTab === "progress" && <div className="task-tab-panel"><div className="surface-title compact-surface-title"><div><h2>区域—代表处—国家收集进度</h2><p>{isGtm ? "GTM仅查看完成度，不进入区域数据录入" : "点击区域进入收集；代表处和国家范围来自组织配置"}</p></div><span className="scope-path"><IconWorld size={17} />组织口径已同步</span></div><div className="plain-table-wrap"><table className="plain-table region-progress-table"><thead><tr><th>MKT区域</th><th>区域接口人</th><th>代表处 / 国家</th><th>区域需求</th><th>提交状态</th><th>{isGtm ? "查看" : "领域操作"}</th></tr></thead><tbody>{organizations.slice(0, plan.total).map((region) => { const submitted = (plan.submittedRegions || []).includes(region.id); const officeCount = region.offices?.length || 0; const countryCount = (region.offices || []).reduce((sum, office) => sum + (office.countries?.length || 0), 0); return <tr key={region.id}><td><strong>{region.name}</strong><small>{region.id.toUpperCase()}</small></td><td><strong>{region.owner || "待配置"}</strong><small>区域备货接口人</small></td><td><span className="org-count"><IconBuilding size={16} />{officeCount}个代表处</span><span className="org-count"><IconFlag size={16} />{countryCount}个国家/地区</span></td><td><strong>{regionDemand(region.id).toLocaleString()} Pcs</strong><small>{skuUnits.length}个产品项</small></td><td><span className={`status-badge ${submitted ? "badge-success" : regionDemand(region.id) ? "badge-warning" : ""}`}>{submitted ? "已提交" : regionDemand(region.id) ? "填报中" : "未开始"}</span></td><td><button className="table-action" type="button" onClick={() => onOpenEntry(plan.id, region.id)}><IconChevronRight size={15} />{isGtm ? "查看区域汇总" : submitted ? "查看并调整" : "进入区域收集"}</button></td></tr>; })}</tbody></table></div></div>}
      {activeTab === "summary" && <div className="task-tab-panel"><div className="surface-title compact-surface-title"><div><h2>领域需求汇总</h2><p>默认按产品查看，再展开到SKU；各区域数据自动横向汇总</p></div><span className={`summary-readiness ${allSubmitted ? "summary-ready" : "summary-pending"}`}>{allSubmitted ? <IconCircleCheckFilled size={17} /> : <IconClockHour4 size={17} />}{allSubmitted ? "区域已全部收齐" : `还有${plan.total - submittedCount}个区域待提交`}</span></div><div className="plain-table-wrap"><table className="plain-table domain-summary-table"><thead><tr><th>产品 / SKU</th><th>BOM编码</th>{organizations.slice(0, plan.total).map((region) => <th key={region.id}>{region.name.replace("MKT", "")}</th>)}<th>领域合计</th></tr></thead><tbody><tr className="domain-product-row"><td><strong>{product?.name}</strong><small>{product?.stage}</small></td><td>{product?.skus.length ? `${product.skus.length}个BOM` : "待补充"}</td>{organizations.slice(0, plan.total).map((region) => <td key={region.id}><strong>{regionDemand(region.id).toLocaleString()}</strong></td>)}<td><strong>{totalDemand.toLocaleString()} Pcs</strong></td></tr>{skuUnits.map((sku) => <tr key={sku.sku}><td><span className="sku-indent">{sku.sku}</span>{sku.description && <small style={{display: 'block', color: '#6b7280', fontSize: '11px', marginTop: '1px'}}>{sku.description}</small>}</td><td>{sku.bom || <span className="bom-placeholder">待补充</span>}</td>{organizations.slice(0, plan.total).map((region) => { const row = Object.values(rowsByProduct[plan.productId]?.[region.id] || {}).flat().find((item) => item.sku === sku.sku); return <td key={region.id}>{Number(row?.qty || 0).toLocaleString()}</td>; })}<td><strong>{organizations.slice(0, plan.total).reduce((sum, region) => { const rows = Object.values(rowsByProduct[plan.productId]?.[region.id] || {}).flat(); const row = rows.find((item) => item.sku === sku.sku); return sum + Number(row?.qty || 0); }, 0).toLocaleString()}</strong></td></tr>)}</tbody></table></div></div>}
      {activeTab === "feedback" && <div className="feedback-layout"><section className="feedback-main"><div className="surface-title compact-surface-title"><div><h2>{isGtm ? "领域反馈结果" : "提交领域汇总给GTM"}</h2><p>{isGtm ? "查看MSS领域接口人提交的正式汇总与说明" : "提交后GTM将收到正式反馈，并可进行收口与导出排产"}</p></div></div>{isGtm && !feedbackReady ? <div className="feedback-empty"><IconClockHour4 size={32} /><strong>等待领域接口人正式反馈</strong><span>区域虽已收齐，但尚未形成与GTM的正式交接。</span></div> : <><div className="feedback-kpis"><div><span>产品</span><strong>{product?.name}</strong></div><div><span>区域完成</span><strong>{submittedCount}/{plan.total}</strong></div><div><span>领域总需求</span><strong>{displayDemand.toLocaleString()} Pcs</strong></div><div><span>BOM准备度</span><strong>{product?.skus.length ? "已完整" : "可后补"}</strong></div></div><label className="feedback-note"><span>领域反馈说明</span><textarea value={feedbackNote} onChange={(event) => setFeedbackNote(event.target.value)} readOnly={isGtm} /></label>{!isGtm && <label className="feedback-confirm"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} /><span>我已检查区域、代表处及国家范围，确认需求数据完整且可反馈给GTM。</span></label>}<div className={`feedback-callout ${allSubmitted ? "feedback-callout-ready" : ""}`}>{allSubmitted ? <IconCircleCheckFilled size={21} /> : <IconAlertTriangleFilled size={21} />}<div><strong>{allSubmitted ? "已满足领域反馈条件" : "暂不能反馈GTM"}</strong><p>{allSubmitted ? "全部区域均已提交，汇总结果可正式交接。" : `还有${plan.total - submittedCount}个区域未提交，请完成收集后再反馈。`}</p></div>{!isGtm && <button className="button button-primary compact-button" type="button" disabled={!allSubmitted || !confirmed || feedbackReady} onClick={submitFeedback}><IconSend size={18} />{feedbackReady ? "已反馈GTM" : "提交领域汇总给GTM"}</button>}</div></>}</section><aside className="feedback-checklist"><h3>反馈检查清单</h3><ul><li className={allSubmitted ? "check-done" : ""}><IconCircleCheckFilled size={18} /><span>全部区域完成提交</span><strong>{submittedCount}/{plan.total}</strong></li><li className="check-done"><IconCircleCheckFilled size={18} /><span>产品与SKU已汇总</span><strong>{skuUnits.length}项</strong></li><li className="check-done"><IconCircleCheckFilled size={18} /><span>代表处范围已覆盖</span><strong>{organizations.reduce((sum, item) => sum + item.offices.length, 0)}个</strong></li><li className="check-done"><IconCircleCheckFilled size={18} /><span>异常说明</span><strong>无</strong></li></ul></aside></div>}
    </section>
  </main>;
}

const approvalSeeds = [
  { applyNo: "TSMP-260829-0186", applicant: "Martin Chen", product: "Chitu-B19F", region: "欧洲MKT", office: "德国代表处", qty: 36, demand: 128, applied: 72, remaining: 56, inventory: 88, verdict: "需求内，可发货" },
  { applyNo: "TSMP-260829-0172", applicant: "Sofia Wang", product: "Chitu-B21W", region: "东南亚MKT", office: "东南亚代表处", qty: 24, demand: 40, applied: 28, remaining: 12, inventory: 36, verdict: "超出需求12台" },
  { applyNo: "TSMP-260829-0164", applicant: "Daniel Li", product: "Chitu-PadX-Pro", region: "拉美MKT", office: "巴西代表处", qty: 12, demand: 0, applied: 0, remaining: 0, inventory: 20, verdict: "未找到收集需求" },
];

export function ShipmentApprovalPage({ showToast }) {
  const [applyNo, setApplyNo] = useState("TSMP-260829-0186");
  const [selected, setSelected] = useState(approvalSeeds[0]);
  const [bookmarkletOpen, setBookmarkletOpen] = useState(false);
  const lookup = () => {
    const match = approvalSeeds.find((item) => item.applyNo.toLowerCase() === applyNo.trim().toLowerCase());
    setSelected(match || null); showToast(match ? "已读取TSMP申请并完成需求核对" : "未查询到该申请单，请检查编号或接口权限", match ? "success" : "warning");
  };
  const copyConclusion = () => {
    if (!selected) return;
    navigator.clipboard?.writeText(`${selected.applyNo}：${selected.product}申请${selected.qty}台，${selected.region}/${selected.office}剩余需求${selected.remaining}台；核对结论：${selected.verdict}`);
    showToast("核对结论已复制，可粘贴到TSMP审批意见");
  };
  const copyBookmarklet = () => {
    navigator.clipboard?.writeText("javascript:(()=>{window.postMessage({type:'MSS_TSMP_QUERY'},'*')})()");
    showToast("Bookmarklet安装脚本已复制");
  };
  const isPass = selected?.qty <= selected?.remaining && selected?.demand > 0;
  return <main className="workspace workspace-no-footer">
    <PageHeader title="TSMP发货审批核对" description="在TSMP审批时，核对申请人所在区域的已确认需求与可发额度" action={<button className="button button-outline" type="button" onClick={() => setBookmarkletOpen(true)}><IconCode size={18} />安装Bookmarklet</button>} />
    <MetricStrip items={[
      { label: "今日待核对", value: 12, unit: "单", hint: "来自TSMP审批队列", icon: IconClipboardCheck },
      { label: "需求内申请", value: 9, unit: "单", hint: "可正常进入发货审批", icon: IconShieldCheck },
      { label: "超需求申请", value: 2, unit: "单", hint: "建议补充业务说明", tone: "amber", icon: IconAlertTriangleFilled },
      { label: "未匹配需求", value: 1, unit: "单", hint: "需联系领域接口人", tone: "amber", icon: IconLink },
      { label: "可用库存", value: 176, unit: "Pcs", hint: "当前查询产品口径", icon: IconBuildingWarehouse },
    ]} />
    <section className="ops-surface approval-query-surface"><div className="surface-title"><div><h2>申请单快速核对</h2><p>Bookmarklet会自动读取当前TSMP审批单号，也支持手工输入</p></div><span className="scope-path"><IconCircleCheckFilled size={17} />接口状态正常</span></div><div className="approval-query"><label><span>TSMP申请单号</span><div><input value={applyNo} onChange={(event) => setApplyNo(event.target.value)} placeholder="输入TSMP申请单号" onKeyDown={(event) => { if (event.key === "Enter") lookup(); }} /><button className="button button-primary compact-button" type="button" onClick={lookup}><IconSearch size={18} />查询并核对</button></div></label><div className="approval-match-rule"><span>自动核对口径</span><strong>产品型号</strong><IconChevronRight size={16} /><strong>申请人所属区域</strong><IconChevronRight size={16} /><strong>代表处</strong><IconChevronRight size={16} /><strong>确认需求余额</strong></div></div></section>
    <div className="approval-layout"><section className="ops-surface approval-result"><div className="surface-title"><div><h2>核对结果</h2><p>{selected ? `申请单 ${selected.applyNo}` : "未找到匹配的申请单"}</p></div>{selected && <span className={`approval-verdict ${isPass ? "verdict-pass" : "verdict-warning"}`}>{isPass ? <IconCircleCheckFilled size={18} /> : <IconAlertTriangleFilled size={18} />}{selected.verdict}</span>}</div>{selected ? <><div className="approval-profile"><div><span>申请人</span><strong>{selected.applicant}</strong></div><div><span>产品型号</span><strong>{selected.product}</strong></div><div><span>申请组织</span><strong>{selected.region}</strong><small>{selected.office}</small></div><div><span>本次申请</span><strong>{selected.qty} Pcs</strong></div></div><div className="quota-compare"><div><span>已确认需求</span><strong>{selected.demand}</strong><small>Pcs</small></div><IconArrowRight size={18} /><div><span>此前已申请</span><strong>{selected.applied}</strong><small>Pcs</small></div><IconArrowRight size={18} /><div className="quota-highlight"><span>剩余可申请</span><strong>{selected.remaining}</strong><small>Pcs</small></div><IconArrowRight size={18} /><div><span>当前可用库存</span><strong>{selected.inventory}</strong><small>Pcs</small></div></div><div className="approval-recommendation"><IconShieldCheck size={21} /><div><strong>{isPass ? "建议按正常流程审批发货" : "建议暂缓并补充说明"}</strong><p>{isPass ? `本次申请${selected.qty}台，未超过该区域剩余需求${selected.remaining}台，且库存可支持。` : selected.demand ? `本次申请超过剩余需求${Math.max(0, selected.qty - selected.remaining)}台，请确认新增业务场景或调整数量。` : "当前产品、区域和代表处组合未匹配到已反馈需求，请联系领域接口人确认。"}</p></div><button className="button button-outline compact-button" type="button" onClick={copyConclusion}><IconCopy size={17} />复制核对结论</button></div></> : <div className="empty-approval"><IconSearch size={28} /><strong>未找到申请单</strong><span>请确认编号，或检查Bookmarklet是否已获得内部接口权限</span></div>}</section>
      <aside className="ops-surface approval-guide"><div className="surface-title"><div><h2>近期待核对申请</h2><p>点击后快速带入查询</p></div></div>{approvalSeeds.map((item) => <button type="button" key={item.applyNo} className={selected?.applyNo === item.applyNo ? "approval-seed-active" : ""} onClick={() => { setApplyNo(item.applyNo); setSelected(item); }}><span><strong>{item.applyNo}</strong><small>{item.applicant} · {item.product}</small></span><span>{item.region}<small>{item.qty} Pcs</small></span><IconChevronRight size={17} /></button>)}</aside>
    </div>
    {bookmarkletOpen && <Dialog wide title="安装TSMP审批核对 Bookmarklet" description="一次安装，后续可在TSMP审批页面直接唤起需求核对" onClose={() => setBookmarkletOpen(false)} footer={<><button className="button button-secondary compact-button" type="button" onClick={() => setBookmarkletOpen(false)}>关闭</button><button className="button button-primary compact-button" type="button" onClick={copyBookmarklet}><IconCopy size={17} />复制安装脚本</button></>}><div className="bookmarklet-steps"><div><span>1</span><strong>复制脚本</strong><p>点击下方按钮复制Bookmarklet代码。</p></div><IconArrowRight size={18} /><div><span>2</span><strong>新建浏览器书签</strong><p>名称填写“样机需求核对”。</p></div><IconArrowRight size={18} /><div><span>3</span><strong>粘贴到网址栏</strong><p>在TSMP审批页点击书签即可查询。</p></div></div><div className="bookmarklet-code"><IconCode size={19} /><code>{"javascript:(()=>{/* MSS TSMP QUERY */})()"}</code><span>生产环境需配置内部接口地址与权限校验</span></div></Dialog>}
  </main>;
}

export function TsmpImportPanel({ onImported, showToast }) {
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState(null);
  const [lastImport, setLastImport] = useState(null);
  const [importing, setImporting] = useState(false);
  useEffect(() => { api.getExecutionImports().then((jobs) => { if (jobs[0]) setLastImport(jobs[0]); }).catch(() => {}); }, []);
  const pick = (row, aliases) => { const key = Object.keys(row).find((name) => aliases.some((alias) => name.trim().toLowerCase() === alias.toLowerCase())); return key ? row[key] : undefined; };
  const doImport = async () => {
    if (!file) { showToast("请先选择TSMP导出的Excel文件", "warning"); return; }
    setImporting(true);
    try {
      const XLSX = await import("xlsx");
      const workbook = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true });
      const rawRows = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { defval: "" });
      if (!rawRows.length || rawRows.length > 10000) throw new Error(rawRows.length ? "单次导入不能超过10,000条" : "Excel中没有可导入的数据");
      const rows = rawRows.map((row, index) => {
        const shippedAtValue = pick(row, ["发货时间", "发货日期", "shippedAt", "shipped_at"]);
        const shippedDate = shippedAtValue ? new Date(shippedAtValue) : null;
        const mapped = {
          externalKey: String(pick(row, ["外部流水号", "流水号", "externalKey", "external_key"]) || ""),
          applicationNo: String(pick(row, ["申请单号", "TSMP申请单号", "applicationNo", "application_no"]) || ""),
          sku: String(pick(row, ["产品型号", "SKU", "sku", "model"]) || "").trim(),
          bomCode: String(pick(row, ["BOM编码", "BOM", "bomCode", "bom_code"]) || "").trim(),
          region: String(pick(row, ["发货区域", "区域", "region"]) || "").trim(),
          office: String(pick(row, ["代表处", "发货代表处", "office"]) || "").trim(),
          country: String(pick(row, ["国家/地区", "国家", "country"]) || "").trim(),
          shippedQty: Number(pick(row, ["发货数量", "数量", "shippedQty", "shipped_quantity"])),
        };
        if (shippedDate && !Number.isNaN(shippedDate.getTime())) mapped.shippedAt = shippedDate.toISOString();
        if (!mapped.sku || !mapped.region || !mapped.office || !Number.isInteger(mapped.shippedQty) || mapped.shippedQty < 1) throw new Error(`第${index + 2}行缺少产品型号、区域、代表处或有效发货数量`);
        return mapped;
      });
      const job = await api.importTsmp({ fileName: file.name, rows });
      setLastImport(job); setOpen(false); onImported?.(job); showToast(`TSMP数据已导入，${job.matchedRows}条记录完成自动匹配`);
    } catch (error) { showToast(error.message || "导入失败，请检查Excel字段", "warning"); } finally { setImporting(false); }
  };
  const fileName = file?.name || lastImport?.fileName || "尚未导入TSMP文件";
  const importedAt = lastImport?.createdAt ? new Date(lastImport.createdAt).toLocaleString("zh-CN", { hour12: false }) : "暂无";
  return <><section className="ops-surface tsmp-import-surface"><div className="surface-title"><div><h2>TSMP发货数据匹配</h2><p>导出文件按产品型号、发货区域、代表处关联已确认需求</p></div><button className="button button-primary compact-button" type="button" onClick={() => setOpen(true)}><IconUpload size={17} />导入TSMP发货数据</button></div><div className="import-overview"><div className="import-file"><IconFileSpreadsheet size={25} /><span><strong>{fileName}</strong><small>最近导入：{importedAt} · 共{lastImport?.totalRows || 0}条</small></span></div><div className="import-rule"><span>自动匹配</span><strong>产品型号</strong><IconPlus size={14} /><strong>发货区域</strong><IconPlus size={14} /><strong>代表处</strong></div><div className="import-numbers"><span><strong>{lastImport?.matchedRows || 0}</strong><small>自动匹配</small></span><span><strong>{lastImport?.mappingRequiredRows || 0}</strong><small>待维护映射</small></span><span className="warning-text"><strong>{lastImport?.unmatchedRows || 0}</strong><small>未匹配</small></span></div></div></section>{open && <Dialog wide title="导入TSMP发货数据" description="上传TSMP导出的Excel文件，系统将按三项关键字段自动关联需求" onClose={() => setOpen(false)} footer={<><button className="button button-secondary compact-button" type="button" onClick={() => setOpen(false)}>取消</button><button className="button button-primary compact-button" type="button" disabled={importing || !file} onClick={doImport}><IconDatabaseImport size={17} />{importing ? "正在导入…" : "开始导入匹配"}</button></>}><label className="import-dropzone"><IconUpload size={30} /><strong>{file ? `已选择 ${file.name}` : "选择TSMP导出的Excel文件"}</strong><span>支持 .xlsx / .xls，单次不超过10,000条</span><input type="file" accept=".xlsx,.xls" onChange={(event) => setFile(event.target.files?.[0] || null)} /></label><div className="import-field-map"><span>TSMP字段映射</span><div><strong>产品型号</strong><IconArrowRight size={16} /><i>产品/SKU主数据</i></div><div><strong>发货区域</strong><IconArrowRight size={16} /><i>MSS区域配置</i></div><div><strong>代表处</strong><IconArrowRight size={16} /><i>区域组织配置</i></div><div><strong>发货数量</strong><IconArrowRight size={16} /><i>累计发货数量</i></div></div></Dialog>}</>;
}
