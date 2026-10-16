import { useEffect, useState } from 'react';
import { IconDownload, IconSearch, IconShieldCheck, IconRefresh } from '@tabler/icons-react';
import { api } from './api/client';
import './shipment-records.css';
const initial = { productId:'',handler:'',from:'',to:'',stage:'',mssDomainId:'',regionId:'',officeId:'',countryId:'',sourceSystem:'',keyword:'' };
const tabs = {details:'发货详单',summary:'发货汇总',logs:'接口日志'};
const groups = {region:'区域',office:'代表处',country:'国家 / 地区',sku:'产品型号 / BOM',domain:'MSS业务领域',stage:'样机阶段',handler:'处理人',product:'产品',application:'申请单'};
const statuses = {SUCCESS:'入账成功',REPLAY:'重复调用',FAILURE:'调用失败'};
const fmt = n => Number(n || 0).toLocaleString('zh-CN');
const date = value => value && !Number.isNaN(new Date(value).getTime()) ? new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).format(new Date(value)) : '未提供';
const Time = ({label,value}) => <span className="sd-time-line"><span>{label}</span><time dateTime={value || undefined}>{date(value)}</time></span>;
const Line = ({main,sub}) => <><strong>{main || '未记录'}</strong>{sub && <small>{sub}</small>}</>;
export default function ShipmentRecordsPage({currentUser,showToast}) {
  const [tab,setTab] = useState('details'), [draft,setDraft] = useState(initial), [filters,setFilters] = useState(initial);
  const [groupBy,setGroupBy] = useState('region'), [outcome,setOutcome] = useState(''), [page,setPage] = useState(1);
  const [drill,setDrill] = useState(null), [options,setOptions] = useState({}), [response,setResult] = useState(null);
  const [loading,setLoading] = useState(true), [error,setError] = useState(''), [exporting,setExporting] = useState(false), [reload,setReload] = useState(0);
  const stocking = currentUser?.role === 'STOCKING_OWNER';
  const params = {...filters,groupBy,...(drill?{groupBy:drill.groupBy,groupValue:drill.value}:{}),outcome,tab,page,pageSize:20};
  useEffect(()=>{let live=true;api.getShipmentOptions().then(data=>{if(live)setOptions(data);}).catch(e=>{if(live)setError(e.message);});return()=>{live=false;};},[reload,currentUser?.id]);
  useEffect(()=>{
    let live=true;setLoading(true);setError('');
    api.getShipments(params).then(data=>{if(live)setResult({...data,_tab:tab});}).catch(e=>{if(live){setResult(null);setError(e.message);}}).finally(()=>{if(live)setLoading(false);});
    return()=>{live=false;};
  },[filters,tab,groupBy,outcome,page,drill,reload,currentUser?.id]);
  const update = (key,value) => setDraft(d=>({...d,[key]:value,...(key==='regionId'?{officeId:'',countryId:''}:key==='officeId'?{countryId:''}:{})}));
  const select = (key,label,values=options[key] || []) => <label className="sd-field" key={key}>{label}<select value={draft[key]} onChange={e=>update(key,e.target.value)}><option value="">全部{label}</option>{values.map(o=><option key={o.value} value={o.value}>{o.label}{o.employeeNo?` · ${o.employeeNo}`:''}</option>)}</select></label>;
  const changeTab = key => {if(key===tab)return;setLoading(true);setResult(null);setError('');setTab(key);setPage(1);};
  const submit = e => {e.preventDefault();if(draft.from&&draft.to&&draft.from>draft.to){showToast('开始日期不能晚于结束日期');return;}setFilters({...draft});setDrill(null);setPage(1);};
  const reset = () => {setDraft(initial);setFilters(initial);setDrill(null);setOutcome('');setPage(1);};
  const download = async () => {
    setExporting(true);
    try {const data=await api.exportShipments(params);const url=URL.createObjectURL(new Blob([data.content],{type:'text/csv;charset=utf-8'}));const link=document.createElement('a');link.href=url;link.download=data.fileName;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);showToast(`已导出${data.rowCount}条记录`);}
    catch(e){showToast(e.message);}finally{setExporting(false);}
  };
  const result=response?._tab===tab?response:null;
  const totals=result?.totals || {}, items=result?.items || [];
  const scope = stocking ? ['本人处理记录',`仅展示归属${currentUser?.displayName || '本人'}记录账号的发货；人员信息按外部传入值展示`] : currentUser?.role==='GTM' ? ['本人负责产品','查看当前负责产品的全部处理人发货记录'] : ['全局数据范围','查看全部产品、全部处理人的发货记录'];
  return <main className="workspace workspace-no-footer shipment-records-page">
    <div className="sd-heading"><div><h1>发货审批</h1><p>查询发货详单和汇总，追溯每笔同步记录</p></div><button className="button button-secondary" onClick={download} disabled={exporting||loading||!!error}><IconDownload size={17}/>{exporting?'导出中…':'导出当前结果'}</button></div>
    <div className="sd-access"><IconShieldCheck size={18}/><strong>{scope[0]}</strong><span>{scope[1]}</span></div>
    <section className="sd-stats" aria-label="当前筛选范围的有效发货汇总">{[['累计发货数量','shippedQuantity','Pcs','当前筛选范围'],['有效发货记录','recordCount','笔','按业务流水去重'],['涉及申请单','applicationCount','单','同来源同申请单计1单'],['覆盖国家 / 地区','countryCount','个','按实际发货去向']].map(([label,key,unit,note])=><div className="sd-stat" key={key}><span>{label}</span><strong>{loading?'—':fmt(totals[key])}<small>{unit}</small></strong><small>{note}</small></div>)}</section>
    <section className="sd-surface">
      <div className="sd-tabs" role="tablist" aria-label="发货审批功能">{Object.entries(tabs).map(([key,label])=><button key={key} id={`shipment-tab-${key}`} role="tab" aria-selected={tab===key} aria-controls="shipment-panel" tabIndex={tab===key?0:-1} onKeyDown={e=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(e.key)){e.preventDefault();const keys=Object.keys(tabs),i=keys.indexOf(tab),next=e.key==='Home'?keys[0]:e.key==='End'?keys.at(-1):keys[(i+(e.key==='ArrowRight'?1:2))%3];changeTab(next);document.getElementById(`shipment-tab-${next}`)?.focus();}}} onClick={()=>changeTab(key)}>{label}{key==='details'&&<span className="sd-count">{fmt(totals.recordCount)}</span>}</button>)}</div>
      <form className="sd-filter" onSubmit={submit}><div className="sd-filter-grid">
        {(options.productId?.length>1 || draft.productId) && select('productId','产品')}
        {select('handler','处理人')}
        <label className="sd-field">发货日期 · 从<input type="date" value={draft.from} max={draft.to||undefined} onChange={e=>update('from',e.target.value)}/></label><label className="sd-field">发货日期 · 至<input type="date" value={draft.to} min={draft.from||undefined} onChange={e=>update('to',e.target.value)}/></label>
        {select('stage','样机阶段')}{select('mssDomainId','MSS业务领域')}{select('regionId','区域')}
        {select('officeId','代表处',(options.officeId||[]).filter(o=>!draft.regionId||o.regionId===draft.regionId))}
        {select('countryId','国家 / 地区',(options.countryId||[]).filter(o=>(!draft.regionId||o.regionId===draft.regionId)&&(!draft.officeId||o.officeId===draft.officeId)))}
        {select('sourceSystem','来源系统')}
        <label className="sd-field sd-keyword">申请单号 / 发货单号 / 申请人 / 处理人 / 型号 / BOM<input type="search" placeholder="输入关键信息查询" value={draft.keyword} onChange={e=>update('keyword',e.target.value)}/></label>
      </div><div className="sd-filter-bottom"><span>汇总仅计入成功入账的发货，重试和失败不重复计数</span><div className="sd-actions"><button className="button button-secondary" type="button" onClick={reset}>重置</button><button className="button button-primary" type="submit"><IconSearch size={16}/>查询</button></div></div></form>
      <div id="shipment-panel" role="tabpanel" aria-labelledby={`shipment-tab-${tab}`} aria-busy={loading}>
        <div className="sd-toolbar"><div><strong>{tabs[tab]}</strong><span>{tab==='details'?'一笔有效发货一条记录':tab==='summary'?'按所选维度汇总有效发货':'包含成功、重复调用和失败记录'}</span></div>{tab==='summary'?<label>汇总维度 <select aria-label="汇总维度" value={groupBy} onChange={e=>{setGroupBy(e.target.value);setDrill(null);setPage(1);}}>{Object.entries(groups).map(([value,label])=><option key={value} value={value}>按{label}</option>)}</select></label>:tab==='logs'?<select aria-label="筛选调用结果" value={outcome} onChange={e=>{setOutcome(e.target.value);setPage(1);}}><option value="">全部结果</option>{Object.entries(statuses).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select>:<span>共 {fmt(result?.total)} 笔</span>}</div>
        {drill && <div className="sd-drill">已下钻：{groups[drill.groupBy]} · {drill.label}<button type="button" onClick={()=>{setDrill(null);setPage(1);}}>清除下钻</button></div>}
        {error?<div className="sd-empty" role="alert">{error}<button className="button button-secondary" onClick={()=>setReload(v=>v+1)}><IconRefresh size={16}/>重试</button></div>:loading?<div className="sd-empty" role="status">正在加载发货记录…</div>:<>
          <div className="sd-table-wrap" tabIndex={0} role="region" aria-label={`${tabs[tab]}表格，可横向滚动`}><table className={`sd-table sd-table-${tab}`}><colgroup>{(tab==='details'?[230,235,215,250,150,240,105]:tab==='summary'?[270,120,100,100,210,100]:[210,240,270,200,240]).map((width,index)=><col key={index} style={{width}}/>)}</colgroup><thead>{tab==='details'?<tr>{['发货 / 入账时间','申请单 / 申请人','处理人','产品型号 / BOM','领域 / 阶段','发货去向','本次发货'].map(h=><th key={h}>{h}</th>)}</tr>:tab==='summary'?<tr>{[groups[groupBy],'发货数量','有效记录','申请单数','最近发货','操作'].map(h=><th key={h}>{h}</th>)}</tr>:<tr>{['接收时间','来源系统','业务流水号','处理结果','数量影响'].map(h=><th key={h}>{h}</th>)}</tr>}</thead><tbody>
          {!items.length?<tr><td colSpan={tab==='details'?7:tab==='summary'?6:5} className="sd-empty">当前权限与筛选条件下暂无{tabs[tab]}</td></tr>:items.map(r=>tab==='details'?<tr key={r.id}><td><Time label="发货" value={r.shippedAt}/>{r.shippedAtSource==='RECEIVED_AT'&&<small>未传发货时间，按接收时间记录</small>}<Time label="入账" value={r.recordedAt}/></td><td><Line main={r.applicationNo} sub={[r.applicantName,r.applicantEmployeeNo].filter(Boolean).join(' · ')}/><Time label="申请" value={r.appliedAt}/></td><td><Line main={r.handlerName || r.handlerEmployeeNo} sub={r.handlerName?r.handlerEmployeeNo:null}/><Time label="处理" value={r.handledAt}/></td><td><Line main={r.productModel||r.productName} sub={`BOM ${r.bomCode||'待补'}`}/></td><td><Line main={r.mssDomainName} sub={r.stage}/></td><td><Line main={r.officeName} sub={[r.regionName,r.countryName].filter(Boolean).join(' / ')}/></td><td className="sd-numeric">{fmt(r.shippedQuantity)}<small>Pcs</small></td></tr>:tab==='summary'?<tr key={r.value}><td><Line main={r.label} sub={r.description}/></td><td className="sd-numeric">{fmt(r.shippedQuantity)}</td><td>{fmt(r.recordCount)}</td><td>{fmt(r.applicationCount)}</td><td>{date(r.latestShippedAt)}</td><td><button className="sd-link" onClick={()=>{setDrill({groupBy,value:r.value,label:r.label});changeTab('details');}}>查看详单</button></td></tr>:<tr key={r.id}><td><Time label="接收" value={r.receivedAt}/>{r.recordedAt&&<Time label="入账" value={r.recordedAt}/>}</td><td><Line main={r.sourceSystem||'INTEGRATION_API'} sub={`处理人：${r.handlerName||'未记录'} ${r.handlerEmployeeNo||''}`}/></td><td><Line main={r.idempotencyKey} sub={r.requestId}/></td><td><span className={`sd-tag sd-${r.outcome.toLowerCase()}`}>{statuses[r.outcome]}</span>{r.outcome==='FAILURE'&&<small>{r.message}</small>}</td><td>{r.outcome==='SUCCESS'?`申请 +${fmt(r.quantityAdded)} / 发货 +${fmt(r.quantityAdded)}`:r.outcome==='REPLAY'?'未重复入账':'未入账'}</td></tr>)}
          </tbody></table></div>
          {tab!=='logs'&&<div className="sd-total"><span>当前筛选合计</span><strong>{fmt(totals.shippedQuantity)} Pcs</strong></div>}
          <div className="sd-table-footer"><span>时间均为北京时间{tab==='logs'?' · 失败和重试不增加申请与发货数量':''}</span><div className="sd-actions"><span>共 {fmt(result?.total)} 条 · 第 {page} / {Math.max(1,Math.ceil((result?.total||0)/20))} 页</span><button className="button button-secondary" disabled={page===1} onClick={()=>setPage(v=>v-1)}>上一页</button><button className="button button-secondary" disabled={page*20>=(result?.total||0)} onClick={()=>setPage(v=>v+1)}>下一页</button></div></div>
        </>}
      </div>
    </section>
  </main>;
}
