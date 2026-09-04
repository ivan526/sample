import { useEffect, useState } from "react";
import {
  IconAlertTriangleFilled, IconArrowRight, IconBuildingWarehouse, IconCheck,
  IconBuilding, IconChevronDown, IconChevronRight, IconCircleCheckFilled, IconClipboardCheck, IconClockHour4,
  IconCode, IconCopy, IconDatabaseImport, IconDownload, IconFileSpreadsheet,
  IconFlag, IconHierarchy3, IconLink, IconMapPin, IconNotes, IconPackage, IconPlus,
  IconSearch, IconSend, IconShieldCheck, IconUpload, IconUsers, IconWorld, IconX,
} from "@tabler/icons-react";
import { api } from "./api/client.js";
import { parseTsmpWorksheet } from "./utils/tsmpExcel.js";

function PageHeader({ title, description, action }) {
  return <section className="ops-heading"><div><h1>{title}</h1><p>{description}</p></div>{action}</section>;
}

function MetricStrip({ items }) {
  return <section className="metric-strip" aria-label="关键指标">{items.map(({ label, value, unit, hint, tone, icon: Icon }) => <div className="metric-item" key={label}><span className={`metric-icon metric-${tone || "blue"}`}><Icon size={20} stroke={1.8} /></span><div><span className="metric-label">{label}</span><div className="metric-value">{value}<small>{unit}</small></div><span className="metric-hint">{hint}</span></div></div>)}</section>;
}

function Dialog({ title, description, onClose, children, footer, wide = false, extraWide = false }) {
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className={`operation-modal ${wide ? "operation-modal-wide" : ""} ${extraWide ? "operation-modal-xwide" : ""}`} role="dialog" aria-modal="true" aria-label={title}><div className="modal-header"><div><h2>{title}</h2><p>{description}</p></div><button className="icon-button" type="button" onClick={onClose} aria-label="关闭"><IconX size={22} /></button></div>{children}<div className="modal-actions">{footer}</div></section></div>;
}

function FlowTrack() {
  const steps = [
    ["1", "产品建档", "GTM维护产品名称，BOM可后补"],
    ["2", "GTM下发", "一个计划发送给全部MSS领域"],
    ["3", "领域下发", "各领域选择型号和区域"],
    ["4", "区域收集", "区域按领域任务填报需求"],
    ["5", "汇总排产", "领域反馈后GTM统一导出"],
  ];
  return <section className="ops-surface collection-flow"><div className="surface-title"><div><h2>新品样机需求收集流程</h2><p>以收集计划为主线，所有区域在同一批次内反馈</p></div><span className="scope-path"><IconCircleCheckFilled size={17} />流程口径已统一</span></div><div className="collection-flow-track">{steps.map(([number, title, note], index) => <div className="collection-flow-step" key={title}><span>{number}</span><div><strong>{title}</strong><small>{note}</small></div>{index < steps.length - 1 && <IconArrowRight size={18} />}</div>)}</div></section>;
}

const getPlanStatusClass = (status) => {
  if (["待GTM收口", "已导出", "已反馈"].includes(status)) return "badge-success";
  if (["收集中", "待领域反馈", "区域收集中", "待反馈GTM"].includes(status)) return "badge-info";
  if (["待下发区域"].includes(status)) return "badge-warning";
  return "badge-warning";
};

export function CollectionPlanPage({ products = [], stages = [], mssDomains = [], organizations = [], plans = [], onCreatePlan, onReleasePlan, onExportPlan, onOpenProgress, showToast }) {
  const [query, setQuery] = useState("");
  const [newPlanOpen, setNewPlanOpen] = useState(false);
  const [planForm, setPlanForm] = useState({ productId: products[0]?.id || "", stage: stages[0] || "", deadline: "2026-09-20T18:00", note: "" });
  useEffect(() => { if (!planForm.productId && products[0]?.id) setPlanForm((current) => ({ ...current, productId: products[0].id })); }, [products, planForm.productId]);
  useEffect(() => { if (!planForm.stage && stages[0]) setPlanForm((current) => ({ ...current, stage: stages[0] })); }, [stages, planForm.stage]);
  const productById = (id) => products.find((item) => item.id === id);
  const visiblePlans = plans.filter((plan) => {
    const product = productById(plan.productId);
    return `${plan.id}${product?.name || ""}${product?.category || ""}${plan.stage}${plan.scope}${plan.status}`.toLowerCase().includes(query.toLowerCase());
  });
  const missingBomProducts = products.filter((product) => !product.skus?.length || product.skus.some((sku) => !sku.bom)).length;
  const pendingRegions = plans.filter((plan) => ["收集中", "待领域反馈"].includes(plan.status)).reduce((sum, plan) => sum + Math.max(0, (plan.total || 0) - (plan.submittedRegions?.length || 0)), 0);

  const createPlan = async () => {
    const product = productById(planForm.productId);
    if (!product || !planForm.stage || !planForm.deadline) { showToast("请选择产品、样机阶段和收集截止时间", "warning"); return; }
    try {
      await onCreatePlan({ productId: product.id, stage: planForm.stage, deadline: new Date(planForm.deadline).toISOString(), note: planForm.note.trim() });
      setNewPlanOpen(false);
    } catch (error) { showToast(error.message, "warning"); }
  };

  return <main className="workspace workspace-no-footer">
    <PageHeader title="需求收集 · 计划管理" description="GTM工作台：创建并下发新品计划，查看收集进度，接收领域反馈后导出排产" action={<div className="heading-actions"><span className="workbench-badge"><IconShieldCheck size={17} />GTM工作台</span><button className="button button-primary compact-button" type="button" onClick={() => setNewPlanOpen(true)}><IconPlus size={18} />新建收集计划</button></div>} />
    <MetricStrip items={[
      { label: "进行中计划", value: plans.filter((item) => ["收集中", "待领域反馈", "待GTM收口"].includes(item.status)).length, unit: "个", hint: `${products.length}个新品项目`, icon: IconClipboardCheck },
      { label: "待领域下发", value: plans.reduce((sum, item) => sum + (item.domainTasks || []).filter((task) => task.status === "PENDING_DISPATCH").length, 0), unit: "个领域", hint: "领域需选择型号和区域", tone: "amber", icon: IconClockHour4 },
      { label: "已收集需求", value: plans.reduce((sum, item) => sum + Number(item.demand || 0), 0).toLocaleString(), unit: "Pcs", hint: "等待产品线排产", icon: IconPackage },
      { label: "BOM待补充", value: missingBomProducts, unit: "个产品", hint: "不影响先发起收集", tone: missingBomProducts ? "amber" : "blue", icon: IconAlertTriangleFilled },
      { label: "覆盖组织", value: organizations.length, unit: "个区域", hint: `${organizations.reduce((sum, item) => sum + (item.offices?.length || 0), 0)}个代表处`, icon: IconWorld },
    ]} />
    <FlowTrack />
    <section className="ops-surface plan-surface"><div className="surface-title"><div><h2>我负责的收集计划</h2><p>这里只保留GTM需要管理和收口的动作，不进入区域填报</p></div><span className="surface-summary">共 <strong>{visiblePlans.length}</strong> 条计划</span></div><div className="ops-toolbar"><label className="search-box wide-search"><IconSearch size={19} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索计划、产品、领域或状态" /></label><span className="toolbar-spacer" /><span className="config-sync-hint"><IconUsers size={17} />计划下发 → 查看进度 → 接收反馈 → 导出排产</span></div>
      <div className="plain-table-wrap"><table className="plain-table collection-plan-table"><thead><tr><th>计划 / 产品</th><th>MSS领域任务</th><th>区域收集进度</th><th>需求汇总</th><th>BOM准备度</th><th>当前节点</th><th>截止时间</th><th>GTM操作</th></tr></thead><tbody>{visiblePlans.map((plan) => { const product = productById(plan.productId); const missing = !product?.skus.length || product.skus.some((sku) => !sku.bom); const tasks = plan.domainTasks || []; const feedbackCount = tasks.filter((task) => task.status === "FEEDBACK_SUBMITTED").length; const dispatchedCount = tasks.filter((task) => task.status !== "PENDING_DISPATCH").length; const submitted = plan.submittedRegionCount || 0; const percent = Math.round(submitted / Math.max(1, plan.total) * 100); return <tr key={plan.viewId}><td><strong>{product?.name || "未配置产品"} · {plan.stage}</strong><small>{plan.planNo} · {product?.category || "待配置品类"} · GTM {product?.gtm || "待配置"}</small></td><td><strong>{tasks.length || mssDomains.filter((item) => item.enabled).length}个领域</strong><small>{plan.status === "待下发" ? "下发后由各领域配置范围" : `${dispatchedCount}个已下发区域 · ${feedbackCount}个已反馈`}</small></td><td><span className="plan-progress"><span><i style={{ width: `${percent}%` }} /></span><strong>{submitted}/{plan.total}</strong></span><small>按领域—区域任务统计</small></td><td><strong>{plan.demand.toLocaleString()} Pcs</strong><small>{submitted ? "各领域数据持续汇总" : "尚未形成数据"}</small></td><td><span className={`bom-readiness ${missing ? "bom-pending" : "bom-ready"}`}>{missing ? <IconAlertTriangleFilled size={15} /> : <IconCircleCheckFilled size={15} />}{missing ? "可后补" : "已完整"}</span><small>{product?.skus.length || 0}个型号 / {product?.skus.filter((sku) => sku.bom).length || 0}个BOM</small></td><td><span className={`status-badge ${getPlanStatusClass(plan.status)}`}>{plan.status}</span></td><td>{plan.deadline}</td><td><div className="config-actions plan-actions">{plan.status === "待下发" && <button className="table-action" type="button" onClick={() => onReleasePlan(plan)}><IconSend size={15} />下发全部领域</button>}{["收集中", "待领域反馈"].includes(plan.status) && <button className="table-action" type="button" onClick={() => onOpenProgress(plan.viewId, "progress")}><IconChevronRight size={15} />查看领域进度</button>}{["待GTM收口", "已导出"].includes(plan.status) && <><button className="table-action" type="button" onClick={() => onOpenProgress(plan.viewId, "feedback")}><IconNotes size={15} />查看领域反馈</button><button className="table-action muted-action" type="button" onClick={() => onExportPlan(plan)}><IconDownload size={15} />{plan.status === "已导出" ? "重新导出" : "导出排产"}</button></>}</div></td></tr>; })}{!visiblePlans.length && <tr><td className="empty-cell" colSpan="8">暂无符合条件的收集计划</td></tr>}</tbody></table></div>
    </section>
    {newPlanOpen && <Dialog title="新建需求收集计划" description="GTM只设置产品、样机阶段和总截止时间；下发时系统自动生成全部MSS领域任务" onClose={() => setNewPlanOpen(false)} footer={<><button className="button button-secondary compact-button" type="button" onClick={() => setNewPlanOpen(false)}>取消</button><button className="button button-primary compact-button" type="button" onClick={createPlan}>创建计划</button></>}><div className="dialog-form"><label>新品项目<select value={planForm.productId} onChange={(event) => setPlanForm((current) => ({ ...current, productId: event.target.value }))}>{products.map((product) => <option value={product.id} key={product.id}>{product.category}｜{product.name}</option>)}</select></label><label>样机阶段<sup>*</sup><select value={planForm.stage} onChange={(event) => setPlanForm((current) => ({ ...current, stage: event.target.value }))}><option value="">请选择样机阶段</option>{stages.map((stage) => <option value={stage} key={stage}>{stage}</option>)}</select></label><label>收集截止时间<sup>*</sup><input type="datetime-local" value={planForm.deadline} onChange={(event) => setPlanForm((current) => ({ ...current, deadline: event.target.value }))} /></label><label>计划说明<textarea value={planForm.note} onChange={(event) => setPlanForm((current) => ({ ...current, note: event.target.value }))} placeholder="补充本批次收集要求（可选）" /></label><div className="dispatch-summary"><IconUsers size={18} /><span><strong>将下发至全部启用MSS业务领域</strong><small>{mssDomains.filter((item) => item.enabled).map((item) => item.name).join("、") || "暂无启用领域"}</small></span></div><p><IconCircleCheckFilled size={17} />各领域接口人收到后，自行选择部分或全部型号及收集区域</p></div></Dialog>}
  </main>;
}

function RoleFlow({ items }) {
  return <section className="role-flow" aria-label="当前角色流程">{items.map((item, index) => <div key={item.title} className={item.active ? "role-flow-active" : ""}><span>{index + 1}</span><div><strong>{item.title}</strong><small>{item.note}</small></div>{index < items.length - 1 && <IconChevronRight size={17} />}</div>)}</section>;
}

export function DomainTaskPage({ products = [], organizations = [], plans = [], onDispatch, onOpenTask, showToast }) {
  const [query, setQuery] = useState("");
  const [dispatchPlan, setDispatchPlan] = useState(null);
  const [selectedSkuIds, setSelectedSkuIds] = useState([]);
  const [selectedRegionIds, setSelectedRegionIds] = useState([]);
  const domainPlans = plans.filter((plan) => plan.domainTaskId);
  const assignedMssDomain = domainPlans[0]?.mssDomain;
  const visible = domainPlans.filter((plan) => {
    const product = products.find((item) => item.id === plan.productId);
    return `${plan.planNo}${product?.name || ""}${plan.mssDomain?.name || ""}${plan.taskStatusLabel || ""}`.toLowerCase().includes(query.toLowerCase());
  });
  const pendingRegions = domainPlans.reduce((sum, plan) => sum + Math.max(0, (plan.total || 0) - (plan.submittedRegionCount || 0)), 0);
  const feedbackPending = domainPlans.filter((item) => item.taskStatusCode === "READY_TO_FEEDBACK").length;
  const openDispatch = (plan) => {
    const product = products.find((item) => item.id === plan.productId);
    setDispatchPlan(plan);
    setSelectedSkuIds(plan.selectedSkuIds?.length ? plan.selectedSkuIds : (product?.skus || []).map((sku) => sku.id));
    setSelectedRegionIds(plan.regionProgress?.length ? plan.regionProgress.map((item) => item.regionId) : organizations.filter((item) => item.enabled).map((item) => item.id));
  };
  const toggle = (setter, values, id) => setter(values.includes(id) ? values.filter((item) => item !== id) : [...values, id]);
  const submitDispatch = async () => {
    const product = products.find((item) => item.id === dispatchPlan?.productId);
    if (product?.skus?.length && !selectedSkuIds.length) { showToast("请至少选择一个产品型号", "warning"); return; }
    if (!selectedRegionIds.length) { showToast("请至少选择一个区域", "warning"); return; }
    try { await onDispatch(dispatchPlan, selectedSkuIds, selectedRegionIds); setDispatchPlan(null); } catch (error) { showToast(error.message, "warning"); }
  };
  return <main className="workspace workspace-no-footer">
    <PageHeader title="需求收集 · 我的领域任务" description="接收GTM计划后，先选择本领域需要收集的产品型号和区域，再下发给区域接口人" action={<span className="workbench-badge"><IconHierarchy3 size={17} />{assignedMssDomain?.name || "当前MSS领域"} · 接口人</span>} />
    <MetricStrip items={[
      { label: "待下发区域", value: domainPlans.filter((item) => item.taskStatusCode === "PENDING_DISPATCH").length, unit: "个", hint: "需配置型号和区域", tone: "amber", icon: IconSend },
      { label: "待区域提交", value: pendingRegions, unit: "个", hint: "可继续跟进收集", tone: "amber", icon: IconClockHour4 },
      { label: "待反馈GTM", value: feedbackPending, unit: "个", hint: "区域已全部收齐", tone: feedbackPending ? "amber" : "blue", icon: IconClipboardCheck },
      { label: "已汇总需求", value: domainPlans.reduce((sum, item) => sum + Number(item.demand || 0), 0).toLocaleString(), unit: "Pcs", hint: `${assignedMssDomain?.name || "当前MSS领域"}当前批次`, icon: IconPackage },
      { label: "可选组织", value: organizations.length, unit: "个区域", hint: `${organizations.reduce((sum, item) => sum + (item.offices?.length || 0), 0)}个代表处`, icon: IconWorld },
    ]} />
    <RoleFlow items={[
      { title: "接收GTM计划", note: "全部领域同步收到" },
      { title: "选择范围并下发", note: "选择型号和区域", active: true },
      { title: "检查领域汇总", note: "核对缺失与异常" },
      { title: "反馈给GTM", note: "形成正式交接" },
    ]} />
    <section className="ops-surface domain-task-surface"><div className="surface-title"><div><h2>我的领域任务</h2><p>每条任务先完成领域下发，再进入区域收集</p></div><span className="surface-summary">共 <strong>{visible.length}</strong> 条任务</span></div><div className="ops-toolbar"><label className="search-box wide-search"><IconSearch size={19} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索计划、产品、领域或状态" /></label><span className="toolbar-spacer" /><span className="config-sync-hint"><IconShieldCheck size={17} />GTM计划 → 领域配置范围 → 区域填报</span></div>
      <div className="plain-table-wrap"><table className="plain-table domain-task-table"><thead><tr><th>计划 / 产品</th><th>本领域</th><th>已选型号 / 区域</th><th>区域进度</th><th>领域需求</th><th>任务状态</th><th>下一步</th></tr></thead><tbody>{visible.map((plan) => { const product = products.find((item) => item.id === plan.productId); const submitted = plan.submittedRegionCount || 0; return <tr key={plan.viewId}><td><strong>{product?.name}</strong><small>{plan.planNo} · {plan.stage} · GTM {product?.gtm}</small></td><td><strong>{plan.mssDomain?.name}</strong><small>接口人 {plan.mssDomain?.owner || "待配置"}</small></td><td><strong>{plan.selectedSkuIds?.length || 0}/{product?.skus?.length || 0}个型号</strong><small>{plan.total || 0}个区域</small></td><td><span className="plan-progress"><span><i style={{ width: `${submitted / Math.max(1, plan.total) * 100}%` }} /></span><strong>{submitted}/{plan.total}</strong></span><small>{plan.total ? submitted === plan.total ? "区域已全部收齐" : `还有${plan.total - submitted}个区域待提交` : "尚未下发区域"}</small></td><td><strong>{plan.demand.toLocaleString()} Pcs</strong><small>{plan.selectedSkuIds?.length || 0}个SKU</small></td><td><span className={`status-badge ${getPlanStatusClass(plan.taskStatusLabel)}`}>{plan.taskStatusLabel}</span></td><td><div className="config-actions plan-actions">{plan.taskStatusCode === "PENDING_DISPATCH" && <button className="table-action" type="button" onClick={() => openDispatch(plan)}><IconSend size={15} />配置并下发</button>}{plan.taskStatusCode === "COLLECTING" && <><button className="table-action" type="button" onClick={() => onOpenTask(plan.viewId, "progress")}><IconChevronRight size={15} />跟进收集</button>{!submitted && <button className="table-action muted-action" type="button" onClick={() => openDispatch(plan)}>调整范围</button>}</>}{plan.taskStatusCode === "READY_TO_FEEDBACK" && <button className="table-action" type="button" onClick={() => onOpenTask(plan.viewId, "feedback")}><IconSend size={15} />检查并反馈</button>}{plan.taskStatusCode === "FEEDBACK_SUBMITTED" && <button className="table-action" type="button" onClick={() => onOpenTask(plan.viewId, "feedback")}><IconNotes size={15} />查看已反馈</button>}</div></td></tr>; })}{!visible.length && <tr><td className="empty-cell" colSpan="7">暂无领域任务</td></tr>}</tbody></table></div>
    </section>
    {dispatchPlan && <Dialog wide title="配置并下发领域任务" description={`${dispatchPlan.mssDomain?.name} · ${products.find((item) => item.id === dispatchPlan.productId)?.name} · ${dispatchPlan.stage}`} onClose={() => setDispatchPlan(null)} footer={<><button className="button button-secondary compact-button" type="button" onClick={() => setDispatchPlan(null)}>取消</button><button className="button button-primary compact-button" type="button" onClick={submitDispatch}><IconSend size={17} />下发给区域接口人</button></>}><div className="dialog-form domain-dispatch-form"><fieldset className="scope-picker"><legend>选择产品型号<sup>*</sup></legend><p>可选择部分或全部型号；区域只填报本次选中的型号</p><div>{(products.find((item) => item.id === dispatchPlan.productId)?.skus || []).map((sku) => <label key={sku.id}><input type="checkbox" checked={selectedSkuIds.includes(sku.id)} onChange={() => toggle(setSelectedSkuIds, selectedSkuIds, sku.id)} /><span><strong>{sku.sku}</strong><small>{sku.bom ? `BOM ${sku.bom}` : "BOM待补充"}</small></span></label>)}</div><button className="text-button scope-select-all" type="button" onClick={() => setSelectedSkuIds((products.find((item) => item.id === dispatchPlan.productId)?.skus || []).map((sku) => sku.id))}>选择全部型号</button></fieldset><fieldset className="scope-picker"><legend>选择下发区域<sup>*</sup></legend><p>区域可多选，每个区域将收到一条本领域填报任务</p><div>{organizations.filter((region) => region.enabled).map((region) => <label key={region.id}><input type="checkbox" checked={selectedRegionIds.includes(region.id)} onChange={() => toggle(setSelectedRegionIds, selectedRegionIds, region.id)} /><span><strong>{region.name}</strong><small>{region.offices?.length || 0}个代表处</small></span></label>)}</div><button className="text-button scope-select-all" type="button" onClick={() => setSelectedRegionIds(organizations.filter((region) => region.enabled).map((region) => region.id))}>选择全部区域</button></fieldset></div></Dialog>}
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
    <section className="ops-surface domain-task-surface"><div className="surface-title"><div><h2>我的填报任务</h2><p>仅展示领域接口人已下发到当前区域的任务</p></div><span className="surface-summary">共 <strong>{visiblePlans.length}</strong> 条任务</span></div><div className="plain-table-wrap"><table className="plain-table regional-task-table"><thead><tr><th>计划 / 产品</th><th>来源领域</th><th>本区域组织范围</th><th>本次产品型号</th><th>填报状态</th><th>截止时间</th><th>操作</th></tr></thead><tbody>{visiblePlans.map((plan) => { const product = products.find((item) => item.id === plan.productId); const submitted = plan.submittedRegions.includes(region.id); return <tr key={plan.viewId}><td><strong>{product?.name}</strong><small>{plan.planNo} · {plan.stage}</small></td><td><strong>{plan.mssDomain?.name || "待配置MSS领域"}</strong><small>领域接口人 {plan.mssDomain?.owner || "待配置"}</small></td><td><span className="org-count"><IconBuilding size={16} />{region.offices.length}个代表处</span><span className="org-count"><IconFlag size={16} />{countryCount}个国家/地区</span></td><td><strong>{plan.selectedSkuIds?.length || 1}项</strong><small>{product?.skus.length ? `领域从${product.skus.length}个型号中选择` : "可先按产品填报"}</small></td><td><span className={`status-badge ${submitted ? "badge-success" : "badge-warning"}`}>{submitted ? "已提交" : "待填报"}</span></td><td>{plan.deadline}</td><td><button className="table-action" type="button" onClick={() => onOpenEntry(plan.viewId, region.id)}><IconChevronRight size={15} />{submitted ? "查看已提交" : "进入填报"}</button></td></tr>; })}</tbody></table></div></section>
  </main>;
}

export function CollectionTaskDetailPage({ role, plan, products = [], organizations = [], rowsByProduct = {}, initialTab = "progress", onBack, onOpenEntry, onFeedback, showToast }) {
  const [activeTab, setActiveTab] = useState(initialTab);
  const [feedbackNote, setFeedbackNote] = useState("已完成本领域全部区域需求核对，区域反馈数据无遗漏，可供GTM汇总排产。");
  const [confirmed, setConfirmed] = useState(true);
  if (!plan) return null;
  const product = products.find((item) => item.id === plan.productId) || { name: "未配置产品", category: "待配置", gtm: "待配置", skus: [] };
  const submittedCount = plan.submittedRegions?.length || 0;
  const allSubmitted = (plan.total || 0) > 0 && submittedCount >= (plan.total || 0);
  const selectedProductSkus = plan.selectedSkuIds?.length ? product.skus.filter((sku) => plan.selectedSkuIds.includes(sku.id)) : product.skus;
  const skuUnits = selectedProductSkus.length ? selectedProductSkus : [{ sku: `${product?.name || "产品"}（型号待补充）`, bom: "" }];
  const taskOrganizations = plan.regionProgress?.length ? organizations.filter((region) => plan.regionProgress.some((progress) => progress.regionId === region.id)) : [];
  const taskRows = rowsByProduct[plan.viewId] || rowsByProduct[plan.productId] || {};
  rowsByProduct = { ...rowsByProduct, [plan.productId]: taskRows };
  const regionDemand = (regionId) => {
    const officeRowsMap = taskRows[regionId] || {};
    const localRows = Object.values(officeRowsMap).flat();
    const localTotal = localRows.reduce((sum, row) => sum + Number(row.qty || 0), 0);
    return localTotal || Number(plan.regionProgress?.find((item) => item.regionId === regionId)?.demand || 0);
  };
  const totalDemand = taskOrganizations.reduce((sum, region) => sum + regionDemand(region.id), 0);
  const displayDemand = plan.demand || totalDemand;
  const isGtm = role === "GTM" || role === "ADMIN";
  const feedbackReady = isGtm ? ["待GTM收口", "已导出"].includes(plan.status) : plan.taskStatusCode === "FEEDBACK_SUBMITTED";
  const submitFeedback = async () => {
    if (!allSubmitted || !confirmed) { showToast("请先完成全部区域收集并确认汇总结果", "warning"); return; }
    try { await onFeedback(plan, feedbackNote); showToast(`${product?.name}领域汇总已正式反馈给GTM`); } catch (error) { showToast(error.message, "warning"); }
  };
  return <main className="workspace workspace-no-footer">
    <section className="task-detail-heading"><div><button className="back-to-plan" type="button" onClick={onBack}><IconChevronDown size={17} />返回{isGtm ? "计划管理" : "我的领域任务"}</button><div className="detail-title-line"><h1>{product?.name}需求收集</h1><span className={`status-badge ${getPlanStatusClass(plan.status)}`}>{plan.status}</span></div><div className="batch-meta"><span>计划编号</span><strong>{plan.planNo}</strong><i>·</i><span>产品领域</span><strong>{product?.category}</strong><i>·</i><span>样机阶段</span><strong>{plan.stage}</strong><i>·</i><span>GTM</span><strong>{product?.gtm}</strong><i>·</i><span>MSS领域</span><strong>{plan.mssDomain?.name || "待配置"}</strong><i>·</i><span>领域接口人</span><strong>{plan.mssDomain?.owner || "待配置"}</strong><i>·</i><span>截止</span><strong className="deadline">{plan.deadline}</strong></div></div><span className="workbench-badge">{isGtm ? <IconShieldCheck size={17} /> : <IconHierarchy3 size={17} />}{isGtm ? "GTM只读查看" : "MSS领域任务"}</span></section>
    <section className="task-summary-strip"><div><span>{isGtm ? "领域反馈" : "区域完成"}</span><strong>{isGtm ? `${(plan.domainTasks || []).filter((task) => task.status === "FEEDBACK_SUBMITTED").length}/${plan.domainTasks?.length || 0}` : `${submittedCount}/${plan.total || 0}`}</strong><small>{isGtm ? "按MSS业务领域统计" : allSubmitted ? "已全部收齐" : `还差${Math.max(0, (plan.total || 0) - submittedCount)}个区域`}</small></div><div><span>代表处覆盖</span><strong>{taskOrganizations.reduce((sum, item) => sum + (item.offices?.length || 0), 0)}</strong><small>按领域下发范围汇总</small></div><div><span>{isGtm ? "领域任务" : "本次型号"}</span><strong>{isGtm ? plan.domainTasks?.length || 0 : skuUnits.length}</strong><small>{isGtm ? "全部启用MSS领域" : `产品共${product.skus.length}个型号`}</small></div><div><span>当前汇总需求</span><strong>{displayDemand.toLocaleString()} Pcs</strong><small>{isGtm ? "全部领域累计" : `${skuUnits.length}个产品项`}</small></div></section>
    <section className="ops-surface task-detail-surface"><div className="task-tabs" role="tablist" aria-label="收集任务详情"><button type="button" role="tab" aria-selected={activeTab === "progress"} className={activeTab === "progress" ? "task-tab-active" : ""} onClick={() => setActiveTab("progress")}><IconHierarchy3 size={18} />{isGtm ? "收集进度" : "区域收集进度"}</button><button type="button" role="tab" aria-selected={activeTab === "summary"} className={activeTab === "summary" ? "task-tab-active" : ""} onClick={() => setActiveTab("summary")}><IconFileSpreadsheet size={18} />领域需求汇总</button><button type="button" role="tab" aria-selected={activeTab === "feedback"} className={activeTab === "feedback" ? "task-tab-active" : ""} onClick={() => setActiveTab("feedback")}><IconSend size={18} />{isGtm ? "领域反馈" : "反馈GTM"}{!isGtm && plan.status === "待领域反馈" && <span className="task-tab-dot" />}</button></div>
      {activeTab === "progress" && <div className="task-tab-panel"><div className="surface-title compact-surface-title"><div><h2>{isGtm ? "MSS领域任务进度" : "区域—代表处—国家收集进度"}</h2><p>{isGtm ? "查看各领域的二次下发、区域收集和反馈状态" : "点击区域进入收集；代表处和国家范围来自组织配置"}</p></div><span className="scope-path"><IconWorld size={17} />组织口径已同步</span></div>{isGtm ? <div className="plain-table-wrap"><table className="plain-table region-progress-table"><thead><tr><th>MSS业务领域</th><th>领域接口人</th><th>已选型号</th><th>区域进度</th><th>需求汇总</th><th>任务状态</th></tr></thead><tbody>{(plan.domainTasks || []).map((task) => <tr key={task.id}><td><strong>{task.mssDomainName}</strong><small>{task.mssDomainId}</small></td><td>{task.owner}</td><td><strong>{task.selectedSkuIds.length}个</strong><small>{task.status === "PENDING_DISPATCH" ? "等待领域选择" : "已完成范围配置"}</small></td><td><span className="plan-progress"><span><i style={{ width: `${task.submittedRegions / Math.max(1, task.totalRegions) * 100}%` }} /></span><strong>{task.submittedRegions}/{task.totalRegions}</strong></span></td><td><strong>{task.demandTotal.toLocaleString()} Pcs</strong></td><td><span className={`status-badge ${task.status === "FEEDBACK_SUBMITTED" ? "badge-success" : task.status === "PENDING_DISPATCH" ? "badge-warning" : "badge-info"}`}>{({ PENDING_DISPATCH: "待下发区域", COLLECTING: "区域收集中", READY_TO_FEEDBACK: "待反馈GTM", FEEDBACK_SUBMITTED: "已反馈GTM" })[task.status]}</span></td></tr>)}</tbody></table></div> : <div className="plain-table-wrap"><table className="plain-table region-progress-table"><thead><tr><th>MKT区域</th><th>区域接口人</th><th>代表处 / 国家</th><th>区域需求</th><th>提交状态</th><th>领域操作</th></tr></thead><tbody>{taskOrganizations.map((region) => { const submitted = (plan.submittedRegions || []).includes(region.id); const officeCount = region.offices?.length || 0; const countryCount = (region.offices || []).reduce((sum, office) => sum + (office.countries?.length || 0), 0); return <tr key={region.id}><td><strong>{region.name}</strong><small>{region.id.toUpperCase()}</small></td><td><strong>{region.owner || "待配置"}</strong><small>区域接口人</small></td><td><span className="org-count"><IconBuilding size={16} />{officeCount}个代表处</span><span className="org-count"><IconFlag size={16} />{countryCount}个国家/地区</span></td><td><strong>{regionDemand(region.id).toLocaleString()} Pcs</strong><small>{skuUnits.length}个产品项</small></td><td><span className={`status-badge ${submitted ? "badge-success" : regionDemand(region.id) ? "badge-warning" : ""}`}>{submitted ? "已提交" : regionDemand(region.id) ? "填报中" : "未开始"}</span></td><td><button className="table-action" type="button" onClick={() => onOpenEntry(plan.viewId, region.id)}><IconChevronRight size={15} />{submitted ? "查看并调整" : "进入区域收集"}</button></td></tr>; })}</tbody></table></div>}</div>}
      {activeTab === "summary" && <div className="task-tab-panel"><div className="surface-title compact-surface-title"><div><h2>领域需求汇总</h2><p>默认按产品查看，再展开到SKU；各区域数据自动横向汇总</p></div><span className={`summary-readiness ${allSubmitted ? "summary-ready" : "summary-pending"}`}>{allSubmitted ? <IconCircleCheckFilled size={17} /> : <IconClockHour4 size={17} />}{allSubmitted ? "区域已全部收齐" : `还有${plan.total - submittedCount}个区域待提交`}</span></div><div className="plain-table-wrap"><table className="plain-table domain-summary-table"><thead><tr><th>产品 / SKU</th><th>BOM编码</th>{organizations.slice(0, plan.total).map((region) => <th key={region.id}>{region.name.replace("MKT", "")}</th>)}<th>领域合计</th></tr></thead><tbody><tr className="domain-product-row"><td><strong>{product?.name}</strong><small>{plan.stage}</small></td><td>{product?.skus.length ? `${product.skus.length}个BOM` : "待补充"}</td>{organizations.slice(0, plan.total).map((region) => <td key={region.id}><strong>{regionDemand(region.id).toLocaleString()}</strong></td>)}<td><strong>{totalDemand.toLocaleString()} Pcs</strong></td></tr>{skuUnits.map((sku) => <tr key={sku.sku}><td><span className="sku-indent">{sku.sku}</span>{sku.description && <small style={{display: 'block', color: '#6b7280', fontSize: '11px', marginTop: '1px'}}>{sku.description}</small>}</td><td>{sku.bom || <span className="bom-placeholder">待补充</span>}</td>{organizations.slice(0, plan.total).map((region) => { const row = Object.values(rowsByProduct[plan.productId]?.[region.id] || {}).flat().find((item) => item.sku === sku.sku); return <td key={region.id}>{Number(row?.qty || 0).toLocaleString()}</td>; })}<td><strong>{organizations.slice(0, plan.total).reduce((sum, region) => { const rows = Object.values(rowsByProduct[plan.productId]?.[region.id] || {}).flat(); const row = rows.find((item) => item.sku === sku.sku); return sum + Number(row?.qty || 0); }, 0).toLocaleString()}</strong></td></tr>)}</tbody></table></div></div>}
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
  const [form, setForm] = useState(() => ({ ...approvalSeeds[0] }));
  const [selected, setSelected] = useState(null);
  const [checking, setChecking] = useState(false);
  const [bookmarkletOpen, setBookmarkletOpen] = useState(false);
  const updateForm = (field, value) => setForm((current) => ({ ...current, [field]: value }));
  const lookup = async () => {
    setChecking(true);
    try {
      const result = await api.checkShipmentApproval({ applicationNo: form.applyNo, applicant: form.applicant, sku: form.product, region: form.region, office: form.office, requestedQuantity: Number(form.qty) });
      setSelected({ applyNo: result.applicationNo, applicant: result.applicant, product: result.sku.model, region: result.scope.regionName, office: result.scope.officeName, qty: result.requestedQuantity, demand: result.confirmedDemand, applied: result.appliedQuantity, shipped: result.shippedQuantity, remaining: result.remainingDemand, inventory: result.availableInventory, verdict: result.message, verdictCode: result.verdict });
      showToast("已按正式需求、累计申请与库存完成核对", result.verdict === "PASS" ? "success" : "warning");
    } catch (error) { setSelected(null); showToast(error.message, "warning"); } finally { setChecking(false); }
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
  const isPass = selected?.verdictCode === "PASS";
  return <main className="workspace workspace-no-footer">
    <PageHeader title="TSMP发货审批核对" description="在TSMP审批时，核对申请人所在区域的已确认需求与可发额度" action={<button className="button button-outline" type="button" onClick={() => setBookmarkletOpen(true)}><IconCode size={18} />安装Bookmarklet</button>} />
    <MetricStrip items={[
      { label: "确认需求", value: selected?.demand || 0, unit: "Pcs", hint: "正式领域反馈快照", icon: IconClipboardCheck },
      { label: "累计申请", value: selected?.applied || 0, unit: "Pcs", hint: "同SKU与组织口径", icon: IconShieldCheck },
      { label: "累计发货", value: selected?.shipped || 0, unit: "Pcs", hint: "TSMP匹配数据", icon: IconPackage },
      { label: "剩余可申请", value: selected?.remaining || 0, unit: "Pcs", hint: "确认需求减累计申请", tone: selected && !isPass ? "amber" : "blue", icon: IconLink },
      { label: "可用库存", value: selected?.inventory || 0, unit: "Pcs", hint: "当前查询SKU口径", icon: IconBuildingWarehouse },
    ]} />
    <section className="ops-surface approval-query-surface"><div className="surface-title"><div><h2>申请单快速核对</h2><p>Bookmarklet可传入当前TSMP申请信息，也支持手工核对</p></div><span className="scope-path"><IconCircleCheckFilled size={17} />实时业务接口</span></div><div className="approval-query approval-query-grid"><label><span>TSMP申请单号</span><input value={form.applyNo} onChange={(event) => updateForm("applyNo", event.target.value)} /></label><label><span>申请人</span><input value={form.applicant} onChange={(event) => updateForm("applicant", event.target.value)} /></label><label><span>产品型号 / SKU</span><input value={form.product} onChange={(event) => updateForm("product", event.target.value)} /></label><label><span>发货区域</span><input value={form.region} onChange={(event) => updateForm("region", event.target.value)} /></label><label><span>代表处</span><input value={form.office} onChange={(event) => updateForm("office", event.target.value)} /></label><label><span>本次申请数量</span><input type="number" min="1" value={form.qty} onChange={(event) => updateForm("qty", event.target.value)} /></label><button className="button button-primary compact-button" type="button" disabled={checking} onClick={lookup}><IconSearch size={18} />{checking ? "核对中…" : "查询并核对"}</button><div className="approval-match-rule"><span>自动核对口径</span><strong>产品型号</strong><IconChevronRight size={16} /><strong>区域</strong><IconChevronRight size={16} /><strong>代表处</strong><IconChevronRight size={16} /><strong>确认需求余额</strong></div></div></section>
    <div className="approval-layout"><section className="ops-surface approval-result"><div className="surface-title"><div><h2>核对结果</h2><p>{selected ? `申请单 ${selected.applyNo}` : "未找到匹配的申请单"}</p></div>{selected && <span className={`approval-verdict ${isPass ? "verdict-pass" : "verdict-warning"}`}>{isPass ? <IconCircleCheckFilled size={18} /> : <IconAlertTriangleFilled size={18} />}{selected.verdict}</span>}</div>{selected ? <><div className="approval-profile"><div><span>申请人</span><strong>{selected.applicant}</strong></div><div><span>产品型号</span><strong>{selected.product}</strong></div><div><span>申请组织</span><strong>{selected.region}</strong><small>{selected.office}</small></div><div><span>本次申请</span><strong>{selected.qty} Pcs</strong></div></div><div className="quota-compare"><div><span>已确认需求</span><strong>{selected.demand}</strong><small>Pcs</small></div><IconArrowRight size={18} /><div><span>此前已申请</span><strong>{selected.applied}</strong><small>Pcs</small></div><IconArrowRight size={18} /><div className="quota-highlight"><span>剩余可申请</span><strong>{selected.remaining}</strong><small>Pcs</small></div><IconArrowRight size={18} /><div><span>当前可用库存</span><strong>{selected.inventory}</strong><small>Pcs</small></div></div><div className="approval-recommendation"><IconShieldCheck size={21} /><div><strong>{isPass ? "建议按正常流程审批发货" : "建议暂缓并补充说明"}</strong><p>{isPass ? `本次申请${selected.qty}台，未超过该区域剩余需求${selected.remaining}台，且库存可支持。` : selected.demand ? `本次申请超过剩余需求${Math.max(0, selected.qty - selected.remaining)}台，请确认新增业务场景或调整数量。` : "当前产品、区域和代表处组合未匹配到已反馈需求，请联系领域接口人确认。"}</p></div><button className="button button-outline compact-button" type="button" onClick={copyConclusion}><IconCopy size={17} />复制核对结论</button></div></> : <div className="empty-approval"><IconSearch size={28} /><strong>未找到申请单</strong><span>请确认编号，或检查Bookmarklet是否已获得内部接口权限</span></div>}</section>
      <aside className="ops-surface approval-guide"><div className="surface-title"><div><h2>核对示例</h2><p>点击带入申请信息，再调用实时接口</p></div></div>{approvalSeeds.map((item) => <button type="button" key={item.applyNo} className={form.applyNo === item.applyNo ? "approval-seed-active" : ""} onClick={() => { setForm({ ...item }); setSelected(null); }}><span><strong>{item.applyNo}</strong><small>{item.applicant} · {item.product}</small></span><span>{item.region}<small>{item.qty} Pcs</small></span><IconChevronRight size={17} /></button>)}</aside>
    </div>
    {bookmarkletOpen && <Dialog wide title="安装TSMP审批核对 Bookmarklet" description="一次安装，后续可在TSMP审批页面直接唤起需求核对" onClose={() => setBookmarkletOpen(false)} footer={<><button className="button button-secondary compact-button" type="button" onClick={() => setBookmarkletOpen(false)}>关闭</button><button className="button button-primary compact-button" type="button" onClick={copyBookmarklet}><IconCopy size={17} />复制安装脚本</button></>}><div className="bookmarklet-steps"><div><span>1</span><strong>复制脚本</strong><p>点击下方按钮复制Bookmarklet代码。</p></div><IconArrowRight size={18} /><div><span>2</span><strong>新建浏览器书签</strong><p>名称填写“样机需求核对”。</p></div><IconArrowRight size={18} /><div><span>3</span><strong>粘贴到网址栏</strong><p>在TSMP审批页点击书签即可查询。</p></div></div><div className="bookmarklet-code"><IconCode size={19} /><code>{"javascript:(()=>{/* MSS TSMP QUERY */})()"}</code><span>生产环境需配置内部接口地址与权限校验</span></div></Dialog>}
  </main>;
}

export function TsmpImportPanel({ onImported, showToast }) {
  const [open, setOpen] = useState(false);
  const [file, setFile] = useState(null);
  const [lastImport, setLastImport] = useState(null);
  const [importing, setImporting] = useState(false);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailRows, setDetailRows] = useState([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailFilter, setDetailFilter] = useState("ISSUE");
  useEffect(() => { api.getExecutionImports().then((jobs) => { if (jobs[0]) setLastImport(jobs[0]); }).catch(() => {}); }, []);
  const doImport = async () => {
    if (!file) { showToast("请先选择TSMP导出的Excel文件", "warning"); return; }
    setImporting(true);
    try {
      const XLSX = await import("xlsx");
      const workbook = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true });
      const rows = parseTsmpWorksheet(XLSX, workbook.Sheets[workbook.SheetNames[0]]);
      const job = await api.importTsmp({ fileName: file.name, rows });
      setLastImport(job); setOpen(false); onImported?.(job); showToast(`TSMP数据已导入，${job.matchedRows}条记录完成自动匹配`);
    } catch (error) { showToast(error.message || "导入失败，请检查Excel字段", "warning"); } finally { setImporting(false); }
  };
  const fileName = file?.name || lastImport?.fileName || "尚未导入TSMP文件";
  const importedAt = lastImport?.createdAt ? new Date(lastImport.createdAt).toLocaleString("zh-CN", { hour12: false }) : "暂无";
  const openDetails = async (filter = "ISSUE") => {
    if (!lastImport?.id) return;
    setDetailFilter(filter); setDetailOpen(true); setDetailLoading(true);
    try { setDetailRows(await api.getExecutionImportRows(lastImport.id)); }
    catch (error) { showToast(error.message || "获取导入明细失败", "warning"); }
    finally { setDetailLoading(false); }
  };
  const visibleDetailRows = detailRows.filter((row) => detailFilter === "ALL" || (detailFilter === "ISSUE" ? ["MAPPING_REQUIRED", "UNMATCHED"].includes(row.matchStatus) : row.matchStatus === detailFilter));
  const statusLabel = { MATCHED: "已匹配", MAPPING_REQUIRED: "待维护映射", UNMATCHED: "未匹配", DUPLICATE: "重复", INVALID: "无效" };
  return <><section className="ops-surface tsmp-import-surface"><div className="surface-title"><div><h2>TSMP发货数据匹配</h2><p>按MSS领域、区域、代表处、国家和产品BOM编码关联已确认需求</p></div><button className="button button-primary compact-button" type="button" onClick={() => setOpen(true)}><IconUpload size={17} />导入TSMP发货数据</button></div><div className="import-overview"><div className="import-file"><IconFileSpreadsheet size={25} /><span><strong>{fileName}</strong><small>最近导入：{importedAt} · 共{lastImport?.totalRows || 0}条</small></span></div><div className="import-rule"><span>自动匹配</span><strong>MSS领域</strong><IconPlus size={14} /><strong>产品BOM</strong><IconPlus size={14} /><strong>组织范围</strong></div><div className="import-numbers"><button type="button" onClick={() => openDetails("MATCHED")}><strong>{lastImport?.matchedRows || 0}</strong><small>自动匹配</small></button><button type="button" onClick={() => openDetails("MAPPING_REQUIRED")}><strong>{lastImport?.mappingRequiredRows || 0}</strong><small>待维护映射</small></button><button className="warning-text" type="button" onClick={() => openDetails("UNMATCHED")}><strong>{lastImport?.unmatchedRows || 0}</strong><small>未匹配</small></button></div></div></section>{open && <Dialog wide title="导入TSMP发货数据" description="上传TSMP导出的Excel文件，系统将按下列正式字段关联需求" onClose={() => setOpen(false)} footer={<><button className="button button-secondary compact-button" type="button" onClick={() => setOpen(false)}>取消</button><button className="button button-primary compact-button" type="button" disabled={importing || !file} onClick={doImport}><IconDatabaseImport size={17} />{importing ? "正在导入…" : "开始导入匹配"}</button></>}><label className="import-dropzone"><IconUpload size={30} /><strong>{file ? `已选择 ${file.name}` : "选择TSMP导出的Excel文件"}</strong><span>支持 .xlsx / .xls，必需列：业务领域、地区部、代表处、国家/地区、BOM编码、发货数量</span><input type="file" accept=".xlsx,.xls" onChange={(event) => setFile(event.target.files?.[0] || null)} /></label><div className="import-field-map"><span>TSMP字段对应关系</span><div><strong>业务领域</strong><IconArrowRight size={16} /><i>MSS领域</i></div><div><strong>地区部</strong><IconArrowRight size={16} /><i>区域</i></div><div><strong>代表处</strong><IconArrowRight size={16} /><i>代表处</i></div><div><strong>国家/地区</strong><IconArrowRight size={16} /><i>国家</i></div><div><strong>BOM编码</strong><IconArrowRight size={16} /><i>产品BOM编码</i></div><div><strong>发货数量</strong><IconArrowRight size={16} /><i>实际发货数量</i></div></div></Dialog>}{detailOpen && <Dialog wide extraWide title="TSMP导入匹配明细" description={`${lastImport?.fileName || ""} · 点击上方指标可直接查看对应结果`} onClose={() => setDetailOpen(false)} footer={<button className="button button-secondary compact-button" type="button" onClick={() => setDetailOpen(false)}>关闭</button>}><div className="import-detail-filters">{[["ISSUE", "待处理"], ["MAPPING_REQUIRED", "待维护映射"], ["UNMATCHED", "未匹配"], ["MATCHED", "已匹配"], ["DUPLICATE", "重复"], ["ALL", "全部"]].map(([value, label]) => <button className={detailFilter === value ? "active" : ""} type="button" key={value} onClick={() => setDetailFilter(value)}>{label}<span>{detailRows.filter((row) => value === "ALL" || (value === "ISSUE" ? ["MAPPING_REQUIRED", "UNMATCHED"].includes(row.matchStatus) : row.matchStatus === value)).length}</span></button>)}</div><div className="import-detail-table-wrap">{detailLoading ? <div className="import-detail-empty">正在加载匹配明细…</div> : visibleDetailRows.length ? <table className="data-table import-detail-table"><thead><tr><th>Excel行</th><th>状态</th><th>失败原因</th><th>业务领域</th><th>地区部</th><th>代表处</th><th>国家/地区</th><th>BOM编码</th><th>发货数量</th></tr></thead><tbody>{visibleDetailRows.map((row) => <tr key={row.id}><td>{row.sourceRowNo}</td><td><span className={`import-match-status status-${row.matchStatus.toLowerCase()}`}>{statusLabel[row.matchStatus] || row.matchStatus}</span></td><td className="match-reason">{row.matchReason || "—"}</td><td>{row.mssDomain || "—"}</td><td>{row.region || "—"}</td><td>{row.office || "—"}</td><td>{row.country || "—"}</td><td>{row.bomCode || "—"}</td><td>{row.shippedQty}</td></tr>)}</tbody></table> : <div className="import-detail-empty">当前分类下没有数据</div>}</div></Dialog>}</>;
}
