import { useEffect, useRef, useState } from 'react';
import { IconCopy, IconDownload, IconPlus, IconTrash, IconUpload } from '@tabler/icons-react';
import { downloadProductSkuTemplate, parseProductSkuWorkbook, skuPairKey } from '../utils/productSkuExcel.js';
const uid = () => `sku-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`}`;
export default function ProductSkuEditor({ rows, onChange, onBusyChange }) {
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const inputRef = useRef(null);
  const active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; onBusyChange(false); }; }, [onBusyChange]);
  const update = (index, field, value) => { setMessage(""); onChange(rows.map((row, i) => i === index ? { ...row, [field]: value } : row)); };
  const copy = (index) => {
    const { id, _uid, ...values } = rows[index];
    onChange([...rows.slice(0, index + 1), { ...values, _uid: uid() }, ...rows.slice(index + 1)]);
    setMessage('已复制到下一行；BOM未填时可直接保存，已填时请调整重复组合');
  };
  const importFile = async (event) => {
    const file = event.target.files?.[0]; event.target.value = '';
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) { setMessage('文件不能超过10MB'); return; }
    setBusy(true); onBusyChange(true);
    try {
      const imported = parseProductSkuWorkbook(await file.arrayBuffer());
      if (!active.current) return;
      const existing = rows.filter((row) => row.sku.trim() || (row.bom || '').trim() || (row.description || '').trim());
      const keys = new Set(existing.filter((row) => row.sku.trim() && (row.bom || "").normalize("NFKC").trim()).map(skuPairKey));
      const duplicates = imported.filter((row) => row.bom.normalize("NFKC").trim() && keys.has(skuPairKey(row)));
      if (duplicates.length) throw new Error(`导入数据与当前表格的型号+BOM重复：${duplicates[0].sku} / ${duplicates[0].bom || 'BOM待补充'}；本次未追加任何数据`);
      onChange([...existing, ...imported.map((row) => ({ ...row, _uid: uid() }))]);
      setMessage(`已导入${imported.length}行，请检查后保存产品；BOM编码建议在Excel中设置为文本`);
    } catch (error) { if (active.current) setMessage(error.message || 'Excel读取失败，请检查文件'); }
    finally { if (active.current) { setBusy(false); onBusyChange(false); } }
  };
  const counts = new Map();
  rows.filter((row) => row.sku.trim() && (row.bom || "").normalize("NFKC").trim()).forEach((row) => counts.set(skuPairKey(row), (counts.get(skuPairKey(row)) || 0) + 1));
  return <div className="sku-builder sku-editor"><div className="sku-editor-toolbar"><span><h3>产品型号与BOM</h3><small>BOM暂未填写时允许同名型号；填写后型号+BOM组合不可重复</small></span><div className="sku-editor-tools"><button className="text-button" type="button" disabled={busy} onClick={downloadProductSkuTemplate}><IconDownload size={16}/>下载模板</button><button className="text-button" type="button" disabled={busy} onClick={() => inputRef.current?.click()}><IconUpload size={16}/>{busy ? '正在读取…' : 'Excel导入'}</button><input ref={inputRef} type="file" accept=".xlsx,.xls,.csv" hidden aria-label="导入产品型号Excel" onChange={importFile}/><button className="text-button" type="button" disabled={busy} onClick={() => onChange([...rows, { _uid: uid(), sku: '', bom: '', description: '' }])}><IconPlus size={16}/>添加型号</button></div></div>
    {message && <p className="sku-editor-message" role="status">{message}</p>}
    {rows.map((row,index) => <div className={`sku-editor-row ${row.sku.trim() && counts.get(skuPairKey(row)) > 1 ? 'sku-pair-duplicate' : ''}`} key={row._uid}><span className="sku-editor-number">{index + 1}</span><input disabled={busy} aria-label={`第${index + 1}行产品型号`} value={row.sku} onChange={(e) => update(index,'sku',e.target.value)} placeholder="产品型号"/><input disabled={busy} aria-label={`第${index + 1}行BOM编码`} value={row.bom} onChange={(e) => update(index,'bom',e.target.value)} placeholder="BOM编码（可后补）"/><div className="sku-editor-actions"><button type="button" className="icon-button" title="向下复制" aria-label={`向下复制第${index + 1}行`} disabled={busy} onClick={() => copy(index)}><IconCopy size={18}/></button><button type="button" className="icon-button" title="删除此行" aria-label={`删除第${index + 1}行`} disabled={busy} onClick={() => onChange(rows.filter((_,i) => i !== index))}><IconTrash size={18}/></button></div><input className="sku-editor-description" disabled={busy} aria-label={`第${index + 1}行型号描述`} value={row.description || ''} onChange={(e) => update(index,'description',e.target.value)} placeholder="型号描述/配置说明（可选）"/></div>)}
  </div>;
}
