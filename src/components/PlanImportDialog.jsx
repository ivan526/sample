import { useEffect, useRef, useState } from 'react';
import { IconDownload, IconUpload, IconX } from '@tabler/icons-react';
import { api } from '../api/client.js';
import { parsePlanImportWorkbook } from '../utils/planImportExcel.js';
import './plan-import.css';
const errorText=e=>e.details?.length?`${e.message}：${e.details.slice(0,12).join('；')}`:e.message;
const deadline=()=>{const d=new Date();d.setDate(d.getDate()+7);const z=n=>String(n).padStart(2,'0');return `${d.getFullYear()}-${z(d.getMonth()+1)}-${z(d.getDate())}T${z(d.getHours())}:${z(d.getMinutes())}`;};
export default function PlanImportDialog({products,stages,onClose,onImported,showToast}){
  const [form,setForm]=useState(()=>({productId:products[0]?.id||'',stage:stages[0]||'',sourceReference:'',deadline:deadline(),note:''}));
  const [rows,setRows]=useState([]),[fileName,setFileName]=useState(''),[preview,setPreview]=useState(null),[payload,setPayload]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const input=useRef(null),dialog=useRef(null);
  useEffect(()=>{const previous=document.activeElement;dialog.current?.querySelector('select')?.focus();return()=>previous?.focus();},[]);
  const change=(key,value)=>{setForm(f=>({...f,[key]:value}));setPreview(null);setPayload(null);setError('');};
  const download=async()=>{
    setBusy(true);setError('');try{const data=await api.getPlanImportTemplate(form.productId);const bytes=Uint8Array.from(atob(data.fileBase64),c=>c.charCodeAt(0)),url=URL.createObjectURL(new Blob([bytes],{type:data.contentType}));const a=document.createElement('a');a.href=url;a.download=data.fileName;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch(e){setError(errorText(e));}finally{setBusy(false);}
  };
  const upload=async file=>{
    setPreview(null);setPayload(null);setError('');setRows([]);setFileName('');if(!file)return;
    if(file.size>10*1024*1024){setError('Excel文件不能超过10MB');return;}
    setBusy(true);try{const XLSX=await import('xlsx'),parsed=parsePlanImportWorkbook(XLSX,await file.arrayBuffer());setRows(parsed);setFileName(file.name);}catch(e){setError(errorText(e));}finally{setBusy(false);if(input.current)input.current.value='';}
  };
  const validate=async()=>{
    if(!form.productId||!form.stage||!form.sourceReference.trim()||!form.deadline||!rows.length){setError('请选择产品、阶段、截止时间，填写线下计划编号，并上传模板');return;}
    const request={...form,sourceReference:form.sourceReference.trim(),deadline:new Date(form.deadline).toISOString(),fileName,rows};
    setBusy(true);setError('');setPreview(null);setPayload(null);try{const result=await api.previewPlanImport(request);setPreview(result);if(result.valid)setPayload(request);}catch(e){setError(errorText(e));}finally{setBusy(false);}
  };
  const commit=async()=>{
    if(!preview?.valid||!payload)return;setBusy(true);setError('');let result;
    try{result=await api.commitPlanImport({...payload,confirmed:true,previewHash:preview.previewHash});}
    catch(e){setError(errorText(e));setPreview(null);setPayload(null);setBusy(false);return;}
    try{await onImported(result);}catch(e){showToast(`计划已导入，列表刷新失败：${e.message}`,'warning');}
    setBusy(false);onClose();showToast(result.replayed?'该线下计划已导入，已返回原计划，未重复累计':'线下需求计划已导入，正式需求和执行统计已同步');
  };
  return <div className="modal-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget&&!busy)onClose();}}><section ref={dialog} className="operation-modal operation-modal-xwide plan-import-dialog" onKeyDown={e=>{if(e.key==='Escape'&&!busy){e.preventDefault();onClose();}if(e.key==='Tab'){const elements=[...dialog.current.querySelectorAll('button:not(:disabled),input:not(:disabled):not([hidden]),select:not(:disabled),[tabindex="0"]')].filter(el=>el.getClientRects().length);const first=elements[0],last=elements.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}}}} role="dialog" aria-modal="true" aria-labelledby="plan-import-title" aria-busy={busy}>
    <div className="modal-header"><div><h2 id="plan-import-title">导入线下需求计划</h2><p>将已在线下确认的需求接入正式计划，后续查询、导出及执行统计与正常收集一致。</p></div><button type="button" className="icon-button" disabled={busy} onClick={onClose} aria-label="关闭导入"><IconX size={22}/></button></div>
    <fieldset disabled={busy} className="plan-import-fields"><label>产品<select aria-label="产品" value={form.productId} onChange={e=>change('productId',e.target.value)}>{products.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label><label>样机阶段<select aria-label="样机阶段" value={form.stage} onChange={e=>change('stage',e.target.value)}>{stages.map(s=><option key={s}>{s}</option>)}</select></label><label>线下计划编号（用于去重）<input aria-label="线下计划编号（用于去重）" maxLength={128} value={form.sourceReference} onChange={e=>change('sourceReference',e.target.value)} placeholder="如 OFFLINE-WATCH-V3-202610"/></label><label>收集截止时间<input aria-label="收集截止时间" type="datetime-local" value={form.deadline} onChange={e=>change('deadline',e.target.value)}/></label><label className="plan-import-note">计划说明<input aria-label="计划说明" maxLength={500} value={form.note} onChange={e=>change('note',e.target.value)} placeholder="可选，说明线下跟踪来源"/></label></fieldset>
    <div className="plan-import-guide"><strong>1. 下载模板　2. 填写“需求明细”　3. 上传校验　4. 确认导入</strong><p>一份文件对应一个产品和阶段。国家留空表示代表处共享配额；型号重名时填写模板参考页中的SKU ID。只导入文件涉及的领域，未涉及领域不会代为确认。</p><p>可选填写历史累计申请/发货数量，作为累计基线接入；这部分历史发货请勿再次通过TSMP或发货API重复入账。</p></div>
    <div className="plan-import-file"><button type="button" className="button button-secondary compact-button" disabled={busy||!form.productId} onClick={download}><IconDownload size={17}/>下载导入模板</button><button type="button" className="button button-secondary compact-button" disabled={busy} onClick={()=>input.current?.click()}><IconUpload size={17}/>上传Excel</button><input ref={input} hidden type="file" accept=".xlsx,.xls" aria-label="上传线下需求Excel" onChange={e=>upload(e.target.files?.[0])}/><span>{fileName?`${fileName} · ${rows.length}条需求`:'尚未选择文件'}</span></div>
    {error&&<div className="plan-import-error" role="alert">{error}</div>}
    {preview&&<div className="plan-import-preview" aria-live="polite"><div className="plan-import-result"><strong>{preview.valid?preview.replayed?'此计划已导入，将返回原计划，不重复入账':'校验通过，可导入正式需求':`校验发现${preview.errorCount}项错误`}</strong><span>{preview.rowCount}条 · {preview.domainCount}个领域 · {preview.regionCount}个区域</span></div>
      {!preview.valid&&<small>下方仅为已匹配行的参考合计，修正错误后请重新校验。</small>}
      <div className="plan-import-totals"><span>确认需求 <strong>{preview.totals.demandQuantity.toLocaleString()}</strong></span><span>累计申请 <strong>{preview.totals.appliedQuantity.toLocaleString()}</strong></span><span>累计发货 <strong>{preview.totals.shippedQuantity.toLocaleString()}</strong></span></div>
      {!!preview.errors.length&&<ul className="plan-import-issues" role="alert">{preview.errors.map((e,i)=><li key={i}>{e.row?`Excel第${e.row}行`:'计划'}：{e.message}</li>)}{preview.errorCount>preview.errors.length&&<li>仅展示前{preview.errors.length}项，请修正后重新校验。</li>}</ul>}
      {!!preview.warnings.length&&<ul className="plan-import-warnings">{preview.warnings.map((w,i)=><li key={i}>{w}</li>)}</ul>}
      {!!preview.items.length&&<div className="plain-table-wrap plan-import-table" tabIndex={0} role="region" aria-label="导入预览表格"><table className="plain-table"><thead><tr>{['Excel行','型号 / BOM','领域','区域 / 代表处 / 国家','需求','累计申请','累计发货'].map(v=><th key={v}>{v}</th>)}</tr></thead><tbody>{preview.items.map((r,i)=><tr key={i}><td>{r.sourceRowNo}</td><td><strong>{r.productModel||'产品级需求'}</strong><small>{r.bomCode||'BOM待补'}</small></td><td>{r.mssDomainName}</td><td>{r.regionName} / {r.officeName}<small>{r.countryName||'代表处共享配额'}</small></td><td>{r.quantity}</td><td>{r.appliedQuantity}</td><td>{r.shippedQuantity}</td></tr>)}</tbody></table></div>}
      {preview.previewTruncated&&<small>预览展示前100条；确认后整批导入全部{preview.rowCount}条。</small>}
      {preview.valid&&<p className="plan-import-final-note">确认后建立“待GTM收口”的正式计划，并保留线下来源和导入人；不会覆盖原在线计划。后续修改需沿用正式退回/变更流程。</p>}
    </div>}
    <div className="modal-actions"><span role="status">{busy?'正在处理，请稍候…':''}</span><button type="button" className="button button-secondary compact-button" disabled={busy} onClick={onClose}>取消</button><button type="button" className="button button-secondary compact-button" disabled={busy||!rows.length} onClick={validate}>校验并预览</button><button type="button" className="button button-primary compact-button" disabled={busy||!preview?.valid||!payload} onClick={commit}>{preview?.replayed?'返回已导入计划':'确认导入正式计划'}</button></div>
  </section></div>;
}
