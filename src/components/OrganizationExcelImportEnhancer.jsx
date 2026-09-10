import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { IconAlertTriangleFilled, IconCheck, IconDownload, IconFileSpreadsheet, IconUpload, IconX } from "@tabler/icons-react";
import * as XLSX from "xlsx";
import { api, auth } from "../api/client.js";

const HEADER_ALIASES = {
  region: ["区域", "区域名称", "地区部", "region", "regionName"],
  regionOwner: ["区域接口人", "区域负责人", "区域Owner", "regionOwner", "region_owner"],
  office: ["代表处", "代表处名称", "office", "officeName"],
  officeOwner: ["代表处接口人", "代表处负责人", "代表处Owner", "officeOwner", "office_owner"],
  countries: ["国家/地区", "国家地区", "国家", "覆盖国家/地区", "countries", "country"],
  enabled: ["状态", "组织状态", "enabled"],
};

const normalize = (value) => String(value ?? "").trim().replace(/\s+/g, " ").toLowerCase();
const splitValues = (value) => String(value ?? "").split(/[,，、;；\n]+/).map((item) => item.trim()).filter(Boolean);
const findHeader = (headers, aliases) => headers.find((header) => aliases.some((alias) => normalize(header) === normalize(alias)));
const getCell = (row, headers, field) => {
  const header = findHeader(headers, HEADER_ALIASES[field]);
  return header ? row[header] : "";
};

function parseEnabled(value, fallback = true) {
  const key = normalize(value);
  if (!key) return fallback;
  return !["停用", "禁用", "disabled", "false", "0"].includes(key);
}

function resolveOwner(value, users, label) {
  const key = normalize(value);
  if (!key) return { value: "", error: "" };
  const matches = (users || []).filter((user) => normalize(user.employeeNo) === key || normalize(user.displayName) === key);
  if (matches.length === 0) return { value, error: `${label}“${value}”不存在，请先导入用户并设置为“区域/代表处接口人”。` };
  if (matches.length > 1) return { value, error: `${label}“${value}”存在多个同名用户，请填写工号。` };
  if (matches[0].role !== "REGIONAL_OWNER") return { value, error: `${label}“${value}”的角色不是“区域/代表处接口人”。` };
  if (matches[0].enabled === false) return { value, error: `${label}“${value}”账号已停用。` };
  return { value, error: "" };
}

function findRegion(organizations, name) {
  const matches = (organizations || []).filter((item) => normalize(item.name) === normalize(name));
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) return { error: `区域“${name}”存在多个同名配置，请先在配置管理中消除重复。` };
  return null;
}

function findOffice(region, name) {
  const matches = (region?.offices || []).filter((item) => normalize(item.name) === normalize(name));
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) return { error: `区域“${region.name}”下代表处“${name}”存在多个同名配置。` };
  return null;
}

function parseRows(sourceRows, organizations, users) {
  const headers = sourceRows.length ? Object.keys(sourceRows[0]) : [];
  const required = ["region"].filter((field) => !findHeader(headers, HEADER_ALIASES[field]));
  if (required.length) return { rows: [], fileError: "Excel缺少必填列：区域" };

  const groups = new Map();
  sourceRows.forEach((source, index) => {
    const rowNo = index + 2;
    const regionName = String(getCell(source, headers, "region")).trim();
    const regionOwner = String(getCell(source, headers, "regionOwner")).trim();
    const officeName = String(getCell(source, headers, "office")).trim();
    const officeOwner = String(getCell(source, headers, "officeOwner")).trim();
    const countries = splitValues(getCell(source, headers, "countries"));
    const enabledRaw = getCell(source, headers, "enabled");
    const errors = [];

    if (!regionName) errors.push("区域不能为空");
    if (!officeName && countries.length) errors.push("填写国家/地区时必须同时填写代表处");
    const regionOwnerResolved = resolveOwner(regionOwner, users, "区域接口人");
    const officeOwnerResolved = resolveOwner(officeOwner, users, "代表处接口人");
    if (regionOwnerResolved.error) errors.push(regionOwnerResolved.error);
    if (officeOwnerResolved.error) errors.push(officeOwnerResolved.error);

    const regionKey = normalize(regionName);
    if (!groups.has(regionKey)) {
      groups.set(regionKey, {
        rowNos: [],
        regionName,
        regionOwner: regionOwnerResolved.value,
        enabled: parseEnabled(enabledRaw, true),
        enabledSpecified: Boolean(String(enabledRaw ?? "").trim()),
        offices: new Map(),
        errors: [],
      });
    }
    const group = groups.get(regionKey);
    group.rowNos.push(rowNo);
    group.errors.push(...errors);

    if (regionOwnerResolved.value && group.regionOwner && normalize(group.regionOwner) !== normalize(regionOwnerResolved.value)) {
      group.errors.push(`区域“${regionName}”的区域接口人填写不一致：${group.regionOwner} / ${regionOwnerResolved.value}`);
    } else if (regionOwnerResolved.value) {
      group.regionOwner = regionOwnerResolved.value;
    }
    if (group.enabledSpecified && String(enabledRaw ?? "").trim() && group.enabled !== parseEnabled(enabledRaw, true)) {
      group.errors.push(`区域“${regionName}”的状态填写不一致`);
    } else if (String(enabledRaw ?? "").trim()) {
      group.enabled = parseEnabled(enabledRaw, true);
      group.enabledSpecified = true;
    }

    if (officeName) {
      const officeKey = normalize(officeName);
      if (!group.offices.has(officeKey)) {
        group.offices.set(officeKey, {
          rowNos: [],
          name: officeName,
          owner: officeOwnerResolved.value,
          enabled: parseEnabled(enabledRaw, true),
          enabledSpecified: Boolean(String(enabledRaw ?? "").trim()),
          countries: new Set(),
          errors: [],
        });
      }
      const office = group.offices.get(officeKey);
      office.rowNos.push(rowNo);
      office.errors.push(...errors);
      if (officeOwnerResolved.value && office.owner && normalize(office.owner) !== normalize(officeOwnerResolved.value)) {
        office.errors.push(`代表处“${officeName}”的接口人填写不一致：${office.owner} / ${officeOwnerResolved.value}`);
      } else if (officeOwnerResolved.value) {
        office.owner = officeOwnerResolved.value;
      }
      if (office.enabledSpecified && String(enabledRaw ?? "").trim() && office.enabled !== parseEnabled(enabledRaw, true)) {
        office.errors.push(`代表处“${officeName}”的状态填写不一致`);
      } else if (String(enabledRaw ?? "").trim()) {
        office.enabled = parseEnabled(enabledRaw, true);
        office.enabledSpecified = true;
      }
      countries.forEach((country) => office.countries.add(country));
    }
  });

  const result = [];
  for (const group of groups.values()) {
    const existing = findRegion(organizations, group.regionName);
    const errors = [...group.errors];
    if (existing?.error) errors.push(existing.error);
    const currentRegion = existing?.id ? existing : null;
    const existingOffices = currentRegion?.offices || [];
    const officesByKey = new Map(existingOffices.map((office) => [normalize(office.name), office]));

    for (const officeGroup of group.offices.values()) {
      const existingOffice = currentRegion ? findOffice(currentRegion, officeGroup.name) : null;
      if (existingOffice?.error) errors.push(existingOffice.error);
      const baseOffice = existingOffice?.id ? existingOffice : null;
      if (baseOffice) {
        officesByKey.set(normalize(baseOffice.name), {
          ...baseOffice,
          owner: officeGroup.owner || baseOffice.owner || "",
          enabled: officeGroup.enabledSpecified ? officeGroup.enabled : baseOffice.enabled !== false,
          countries: [...new Set([...(baseOffice.countries || []), ...officeGroup.countries])],
        });
      } else if (!officesByKey.has(normalize(officeGroup.name))) {
        officesByKey.set(normalize(officeGroup.name), {
          name: officeGroup.name,
          owner: officeGroup.owner || "",
          enabled: officeGroup.enabled,
          countries: [...officeGroup.countries],
        });
      }
      errors.push(...officeGroup.errors);
    }

    result.push({
      rowNos: group.rowNos,
      regionName: group.regionName,
      owner: group.regionOwner || currentRegion?.owner || "",
      enabled: group.enabledSpecified ? group.enabled : currentRegion?.enabled !== false,
      id: currentRegion?.id,
      version: currentRegion?.version,
      offices: [...officesByKey.values()].map((office) => ({
        id: office.id,
        name: office.name,
        owner: office.owner || "",
        enabled: office.enabled !== false,
        countries: [...new Set(office.countries || [])],
      })),
      errors: [...new Set(errors)],
    });
  }
  return { rows: result, fileError: "" };
}

function downloadTemplate() {
  const headers = ["区域", "区域接口人", "代表处", "代表处接口人", "国家/地区", "状态"];
  const sample = [
    ["中国终端业务部", "区域接口人工号", "中国终端Marketing部", "代表处接口人工号", "中国、香港", "启用"],
    ["中国终端业务部", "区域接口人工号", "中国终端Retail部", "代表处接口人工号", "中国大陆", "启用"],
    ["欧洲地区部", "", "欧洲代表处", "代表处接口人工号", "德国、法国", "启用"],
  ];
  const guide = [
    ["字段", "是否必填", "填写说明"],
    ["区域", "是", "区域名称；已有区域按名称更新，不存在则创建"],
    ["区域接口人", "否", "可填写工号或姓名；必须是启用状态的“区域/代表处接口人”"],
    ["代表处", "否", "填写代表处时必须归属于本行区域；可与国家/地区配合填写"],
    ["代表处接口人", "否", "可填写工号或姓名；必须是启用状态的“区域/代表处接口人”"],
    ["国家/地区", "否", "多个国家/地区用顿号、逗号或分号分隔；只增量合并，不会删除Excel未填写的已有国家"],
    ["状态", "否", "启用/停用；留空沿用已有状态，新建默认启用"],
    ["更新规则", "—", "按区域分组；Excel可只维护部分代表处，不会因此停用未出现在Excel中的已有代表处"],
  ];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([headers, ...sample]), "组织导入");
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(guide), "填写说明");
  XLSX.writeFile(workbook, "区域与代表处批量导入模板.xlsx");
}

function OrganizationImportModal({ onClose }) {
  const [file, setFile] = useState(null);
  const [rows, setRows] = useState([]);
  const [fileError, setFileError] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const inputRef = useRef(null);

  const parseFile = async (selectedFile) => {
    setFile(selectedFile); setRows([]); setFileError(""); setResult(null);
    if (!selectedFile) return;
    if (!/\.(xlsx|xls)$/i.test(selectedFile.name)) { setFileError("仅支持 .xlsx / .xls 文件"); return; }
    try {
      const [catalog, users] = await Promise.all([api.getCatalog(), api.getUserList()]);
      const workbook = XLSX.read(await selectedFile.arrayBuffer(), { type: "array" });
      if (!workbook.SheetNames.length) throw new Error("Excel没有可读取的工作表");
      const data = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { defval: "", raw: false });
      if (!data.length) throw new Error("Excel没有数据行");
      const parsed = parseRows(data, catalog.organizations || [], users || []);
      setRows(parsed.rows); setFileError(parsed.fileError);
    } catch (error) {
      setFileError(error.message || "Excel解析失败");
    }
  };

  const invalidCount = rows.filter((row) => row.errors.length).length;
  const validCount = rows.length - invalidCount;
  const canImport = rows.length > 0 && !fileError && invalidCount === 0 && !loading;

  const importOrganizations = async () => {
    if (!canImport) return;
    setLoading(true); setResult(null);
    const success = []; const failures = [];
    for (const row of rows) {
      try {
        const payload = {
          name: row.regionName,
          owner: row.owner,
          enabled: row.enabled,
          offices: row.offices.map((office) => ({
            id: office.id,
            name: office.name,
            owner: office.owner,
            enabled: office.enabled,
            countries: office.countries,
          })),
          version: row.version,
        };
        if (row.id) await api.updateOrganization({ id: row.id, ...payload });
        else await api.createOrganization(payload);
        success.push(row);
      } catch (error) {
        failures.push({ ...row, error: error.message || "导入失败" });
      }
    }
    setResult({ success, failures });
    setLoading(false);
  };

  const allSuccess = result && result.failures.length === 0;
  return <div className="modal-backdrop" role="presentation" style={{ zIndex: 1200 }} onMouseDown={(event) => { if (event.target === event.currentTarget && !loading) onClose(); }}>
    <section className="operation-modal operation-modal-xwide" role="dialog" aria-modal="true" aria-label="Excel导入区域与代表处" style={{ maxWidth: 1120, width: "min(1120px, calc(100vw - 40px))" }}>
      <div className="modal-header"><div><h2>Excel批量导入区域与代表处</h2><p>按“区域”分组增量更新；可以一次维护多个代表处和国家/地区，未出现在Excel中的已有组织不会被删除或停用。</p></div><button className="icon-button" type="button" disabled={loading} onClick={onClose} aria-label="关闭"><IconX size={22} /></button></div>
      {!result && <>
        <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 14 }}>
          <button className="button button-secondary compact-button" type="button" onClick={downloadTemplate}><IconDownload size={17} />下载模板</button>
          <input ref={inputRef} type="file" accept=".xlsx,.xls" hidden onChange={(event) => parseFile(event.target.files?.[0])} />
          <button className="button button-primary compact-button" type="button" onClick={() => inputRef.current?.click()}><IconUpload size={17} />选择Excel</button>
          {file && <span className="muted-text"><IconFileSpreadsheet size={16} />{file.name}</span>}
        </div>
        {fileError && <div className="config-error"><IconAlertTriangleFilled size={16} />{fileError}</div>}
        {rows.length > 0 && <>
          <div className="import-summary-strip" style={{ display: "flex", gap: 10, marginBottom: 12 }}><span>区域 <strong>{rows.length}</strong></span><span>可导入 <strong>{validCount}</strong></span><span>异常 <strong>{invalidCount}</strong></span></div>
          <div className="plain-table-wrap" style={{ maxHeight: 440, overflow: "auto" }}><table className="plain-table"><thead><tr><th>Excel行</th><th>区域</th><th>接口人</th><th>代表处</th><th>国家/地区</th><th>状态</th><th>校验</th></tr></thead><tbody>{rows.map((row) => <tr key={`${row.regionName}-${row.rowNos.join("-")}`}><td>{row.rowNos.join(",")}</td><td><strong>{row.regionName}</strong><small>{row.id ? "更新" : "新增"}</small></td><td>{row.owner || "待配置"}</td><td>{row.offices.map((office) => office.name).join("、") || "—"}</td><td>{row.offices.map((office) => `${office.name}：${office.countries.join("、") || "待配置"}`).join("；") || "—"}</td><td>{row.enabled ? "启用" : "停用"}</td><td>{row.errors.length ? <span className="warning-text">{row.errors.join("；")}</span> : <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><IconCheck size={15} />通过</span>}</td></tr>)}</tbody></table></div>
        </>}
      </>}
      {result && <>
        <div className={allSuccess ? "config-success" : "config-error"} style={{ marginBottom: 14 }}><IconCheck size={17} />成功 {result.success.length} 个区域，失败 {result.failures.length} 个区域。</div>
        {result.failures.length > 0 && <div className="plain-table-wrap" style={{ maxHeight: 320, overflow: "auto" }}><table className="plain-table"><thead><tr><th>Excel行</th><th>区域</th><th>失败原因</th></tr></thead><tbody>{result.failures.map((row) => <tr key={`${row.regionName}-${row.rowNos.join("-")}`}><td>{row.rowNos.join(",")}</td><td>{row.regionName}</td><td className="warning-text">{row.error}</td></tr>)}</tbody></table></div>}
        <p className="muted-text">重新导入前可直接修正Excel后再次选择文件；成功区域会按现有组织ID继续更新。</p>
      </>}
      <div className="modal-actions"><button className="button button-secondary compact-button" type="button" disabled={loading} onClick={onClose}>{allSuccess ? "完成" : "取消"}</button>{!result && <button className="button button-primary compact-button" type="button" disabled={!canImport} onClick={importOrganizations}>{loading ? "导入中…" : `开始导入（${validCount}个区域）`}</button>}{result && !allSuccess && <button className="button button-primary compact-button" type="button" onClick={() => { setResult(null); setRows([]); setFile(null); setFileError(""); }}>重新选择Excel</button>}</div>
    </section>
  </div>;
}

export default function OrganizationExcelImportEnhancer() {
  const [open, setOpen] = useState(false);
  const [host, setHost] = useState(null);
  const observerRef = useRef(null);

  useEffect(() => {
    if (auth.getCurrentUser()?.role !== "ADMIN") return undefined;
    const sync = () => {
      const table = document.querySelector(".organization-config-table");
      const toolbar = table?.closest(".config-surface")?.querySelector(".ops-toolbar");
      if (!toolbar) return;
      let target = toolbar.querySelector("[data-org-excel-import]");
      if (!target) {
        target = document.createElement("span");
        target.dataset.orgExcelImport = "true";
        target.style.display = "inline-flex";
        target.style.marginLeft = "8px";
        toolbar.appendChild(target);
      }
      setHost((current) => current === target ? current : target);
    };
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(document.body, { childList: true, subtree: true });
    observerRef.current = observer;
    return () => observer.disconnect();
  }, []);

  if (auth.getCurrentUser()?.role !== "ADMIN") return null;
  return <>{host && createPortal(<><button className="button button-secondary compact-button" type="button" onClick={() => setOpen(true)}><IconFileSpreadsheet size={17} />Excel导入</button>{open && <OrganizationImportModal onClose={() => setOpen(false)} />}</>, host)}</>;
}
