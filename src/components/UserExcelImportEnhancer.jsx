import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { IconAlertTriangleFilled, IconCheck, IconDownload, IconFileSpreadsheet, IconRefresh, IconUpload, IconX } from "@tabler/icons-react";
import * as XLSX from "xlsx";
import { api, auth } from "../api/client.js";

const ROLE_ALIASES = {
  ADMIN: "ADMIN", "系统管理员": "ADMIN", "管理员": "ADMIN",
  GTM: "GTM",
  MSS_DOMAIN_OWNER: "MSS_DOMAIN_OWNER", "MSS领域接口人": "MSS_DOMAIN_OWNER", "MSS领域负责人": "MSS_DOMAIN_OWNER", "MSS负责人": "MSS_DOMAIN_OWNER",
  REGIONAL_OWNER: "REGIONAL_OWNER", "区域/代表处接口人": "REGIONAL_OWNER", "区域接口人": "REGIONAL_OWNER", "代表处接口人": "REGIONAL_OWNER",
  STOCKING_OWNER: "STOCKING_OWNER", "备货接口人": "STOCKING_OWNER", "备货负责人": "STOCKING_OWNER",
};

const HEADER_ALIASES = {
  employeeNo: ["工号", "员工工号", "employeeNo", "employee_no"],
  displayName: ["姓名", "员工姓名", "displayName", "name"],
  role: ["角色", "用户角色", "role"],
  password: ["初始密码", "密码", "password"],
  productDomains: ["产品品类", "负责产品品类", "产品范围", "productDomains"],
  mssDomains: ["MSS业务领域", "负责MSS业务领域", "MSS领域", "mssDomains"],
  organizations: ["区域/代表处", "负责区域/代表处", "组织范围", "区域范围", "organizations"],
  enabled: ["状态", "账号状态", "enabled"],
};

const ROLE_LABELS = {
  ADMIN: "系统管理员",
  GTM: "GTM",
  MSS_DOMAIN_OWNER: "MSS领域接口人",
  REGIONAL_OWNER: "区域/代表处接口人",
  STOCKING_OWNER: "备货接口人",
};

const normalize = (value) => String(value ?? "").trim().replace(/\s+/g, " ").toLowerCase();
const splitValues = (value) => String(value ?? "").split(/[,，、;；\n]+/).map((item) => item.trim()).filter(Boolean);
const findHeader = (headers, aliases) => headers.find((header) => aliases.some((alias) => normalize(header) === normalize(alias)));

function parseRole(value) {
  const key = String(value ?? "").trim();
  return ROLE_ALIASES[key] || ROLE_ALIASES[normalize(key)] || null;
}

function resolveByName(value, items, label) {
  const key = normalize(value);
  const matches = items.filter((item) => normalize(item.name) === key || normalize(item.id) === key);
  if (matches.length === 1) return matches[0].id;
  if (matches.length > 1) return { error: `${label}“${value}”存在多个同名配置，请使用ID。` };
  return { error: `未找到${label}“${value}”，请先在配置管理中维护。` };
}

function buildOrganizationOptions(organizations) {
  const options = [];
  for (const region of organizations || []) {
    options.push({ id: region.id, name: region.name, path: region.name, type: "REGION" });
    for (const office of region.offices || []) {
      options.push({ id: office.id, name: office.name, path: `${region.name}/${office.name}`, type: "OFFICE", regionName: region.name });
    }
  }
  return options;
}

function resolveOrganizations(value, organizations) {
  const options = buildOrganizationOptions(organizations);
  const result = [];
  for (const token of splitValues(value)) {
    const key = normalize(token);
    let matches = options.filter((item) => normalize(item.path) === key || normalize(item.id) === key);
    if (!matches.length) {
      matches = options.filter((item) => normalize(item.name) === key);
    }
    if (matches.length === 0) return { error: `未找到区域/代表处“${token}”，请使用“区域/代表处”格式，例如“中国终端业务部/中国终端Marketing部”。` };
    if (matches.length > 1) return { error: `区域/代表处“${token}”存在多个同名配置，请使用“区域/代表处”完整路径。` };
    result.push(matches[0].id);
  }
  return { ids: [...new Set(result)] };
}

function getCell(row, headers, field) {
  const header = findHeader(headers, HEADER_ALIASES[field]);
  return header ? row[header] : "";
}

function parseRows(rows, catalog, users) {
  const headers = rows.length ? Object.keys(rows[0]) : [];
  const missing = ["employeeNo", "displayName", "role"].filter((field) => !findHeader(headers, HEADER_ALIASES[field]));
  if (missing.length) return { rows: [], fileError: `Excel缺少必填列：${missing.map((field) => HEADER_ALIASES[field][0]).join("、")}` };

  const existingByEmployeeNo = new Map((users || []).map((user) => [normalize(user.employeeNo), user]));
  const seen = new Set();
  const result = rows.map((source, index) => {
    const excelRow = index + 2;
    const employeeNo = String(getCell(source, headers, "employeeNo")).trim();
    const displayName = String(getCell(source, headers, "displayName")).trim();
    const role = parseRole(getCell(source, headers, "role"));
    const password = String(getCell(source, headers, "password")).trim();
    const enabledValue = normalize(getCell(source, headers, "enabled"));
    const errors = [];
    if (!employeeNo) errors.push("工号不能为空");
    if (!displayName) errors.push("姓名不能为空");
    if (!role) errors.push(`角色“${getCell(source, headers, "role") || ""}”无效`);
    if (seen.has(normalize(employeeNo))) errors.push("Excel内工号重复");
    seen.add(normalize(employeeNo));

    const existing = existingByEmployeeNo.get(normalize(employeeNo));
    if (!existing && password.length < 8) errors.push("新用户初始密码至少8位");
    if (existing && password && password.length < 8) errors.push("重置密码至少8位");

    let productDomainIds = [];
    let mssDomainIds = [];
    let organizationNodeIds = [];
    const productValue = getCell(source, headers, "productDomains");
    const mssValue = getCell(source, headers, "mssDomains");
    const organizationValue = getCell(source, headers, "organizations");

    if (["GTM", "STOCKING_OWNER"].includes(role)) {
      if (!splitValues(productValue).length) errors.push("该角色至少需要一个产品品类");
      for (const token of splitValues(productValue)) {
        const found = resolveByName(token, catalog.domains || [], "产品品类");
        if (found?.error) errors.push(found.error); else productDomainIds.push(found);
      }
    } else if (productValue) {
      errors.push("当前角色不需要产品品类范围，请留空该列");
    }

    if (["MSS_DOMAIN_OWNER", "REGIONAL_OWNER"].includes(role)) {
      if (!splitValues(mssValue).length) errors.push("该角色至少需要一个MSS业务领域");
      for (const token of splitValues(mssValue)) {
        const found = resolveByName(token, catalog.mssDomains || [], "MSS业务领域");
        if (found?.error) errors.push(found.error); else mssDomainIds.push(found);
      }
    } else if (mssValue) {
      errors.push("当前角色不需要MSS业务领域范围，请留空该列");
    }

    if (role === "REGIONAL_OWNER") {
      if (!splitValues(organizationValue).length) errors.push("区域/代表处接口人至少需要一个区域或代表处范围");
      else {
        const found = resolveOrganizations(organizationValue, catalog.organizations || []);
        if (found.error) errors.push(found.error); else organizationNodeIds = found.ids;
      }
    } else if (organizationValue) {
      errors.push("只有区域/代表处接口人需要填写区域/代表处范围，请留空该列");
    }

    if (role === "ADMIN" && (productValue || mssValue || organizationValue)) errors.push("系统管理员不需要配置数据范围，请留空范围列");

    const enabled = ["停用", "禁用", "disabled", "false", "0"].includes(enabledValue) ? false : true;
    return {
      rowNo: excelRow,
      employeeNo,
      displayName,
      role,
      roleLabel: ROLE_LABELS[role] || role || "—",
      password,
      enabled,
      productDomainIds: [...new Set(productDomainIds)],
      mssDomainIds: [...new Set(mssDomainIds)],
      organizationNodeIds: [...new Set(organizationNodeIds)],
      productDomainNames: splitValues(productValue),
      mssDomainNames: splitValues(mssValue),
      organizationNames: splitValues(organizationValue),
      existing,
      errors,
    };
  });
  return { rows: result, fileError: "" };
}

function downloadTemplate() {
  const headers = ["工号", "姓名", "角色", "初始密码", "产品品类", "MSS业务领域", "区域/代表处", "状态"];
  const guide = [
    ["字段", "是否必填", "填写说明"],
    ["工号", "是", "新用户唯一工号；已有工号会按更新处理"],
    ["姓名", "是", "用户姓名"],
    ["角色", "是", "系统管理员/GTM/MSS领域接口人/区域/代表处接口人/备货接口人，也支持英文角色编码"],
    ["初始密码", "新用户必填", "至少8位；已有用户留空表示不修改密码"],
    ["产品品类", "GTM/备货必填", "多个用顿号分隔，名称必须与配置管理一致"],
    ["MSS业务领域", "MSS领域/区域接口人必填", "多个用顿号分隔；MSS领域接口人不需要区域范围"],
    ["区域/代表处", "区域接口人必填", "可填区域名、唯一代表处名，或使用“区域/代表处”完整路径；多个用顿号分隔"],
    ["状态", "否", "启用/停用，留空默认为启用"],
  ];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([headers]), "用户导入");
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(guide), "填写说明");
  XLSX.writeFile(workbook, "用户批量导入模板.xlsx");
}

function UserImportModal({ onClose, onFinished }) {
  const [file, setFile] = useState(null);
  const [rows, setRows] = useState([]);
  const [fileError, setFileError] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const inputRef = useRef(null);

  const parseFile = async (selectedFile) => {
    setFile(selectedFile); setRows([]); setFileError(""); setResult(null);
    if (!selectedFile) return;
    const ext = selectedFile.name.toLowerCase();
    if (!ext.endsWith(".xlsx") && !ext.endsWith(".xls")) { setFileError("仅支持 .xlsx / .xls 文件"); return; }
    try {
      const [catalog, users] = await Promise.all([api.getCatalog(), api.getUserList()]);
      const workbook = XLSX.read(await selectedFile.arrayBuffer(), { type: "array" });
      if (!workbook.SheetNames.length) throw new Error("Excel没有可读取的工作表");
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      const data = XLSX.utils.sheet_to_json(sheet, { defval: "", raw: false });
      if (!data.length) throw new Error("Excel没有数据行");
      const parsed = parseRows(data, catalog, users);
      setRows(parsed.rows);
      setFileError(parsed.fileError);
    } catch (error) {
      setFileError(error.message || "Excel解析失败");
    }
  };

  const invalidCount = rows.filter((row) => row.errors.length).length;
  const validCount = rows.length - invalidCount;
  const newCount = rows.filter((row) => !row.existing).length;
  const updateCount = rows.filter((row) => row.existing).length;
  const canImport = rows.length > 0 && !fileError && invalidCount === 0 && !loading;

  const importUsers = async () => {
    if (!canImport) return;
    setLoading(true); setResult(null);
    const successes = []; const failures = [];
    for (const row of rows) {
      try {
        const payload = {
          employeeNo: row.employeeNo,
          displayName: row.displayName,
          role: row.role,
          enabled: row.enabled,
          productDomainIds: row.productDomainIds,
          mssDomainIds: row.mssDomainIds,
          organizationNodeIds: row.organizationNodeIds,
        };
        if (row.existing) {
          if (row.password) payload.password = row.password;
          await api.updateUser({ ...payload, id: row.existing.id });
          successes.push(row);
        } else {
          payload.password = row.password;
          await api.createUser(payload);
          successes.push(row);
        }
      } catch (error) {
        failures.push({ ...row, error: error.message || "导入失败" });
      }
    }
    setResult({ success: successes, failures });
    setLoading(false);
  };

  const allSuccess = result && result.failures.length === 0;
  return <div className="modal-backdrop" role="presentation" style={{ zIndex: 1200 }} onMouseDown={(event) => { if (event.target === event.currentTarget && !loading) onClose(); }}>
    <section className="operation-modal operation-modal-xwide" role="dialog" aria-modal="true" aria-label="Excel导入用户" style={{ maxWidth: 1080, width: "min(1080px, calc(100vw - 40px))" }}>
      <div className="modal-header"><div><h2>Excel批量导入用户</h2><p>支持批量创建Beta测试账号；工号已存在时按更新处理，已有用户留空初始密码则不修改密码。</p></div><button className="icon-button" type="button" disabled={loading} onClick={onClose} aria-label="关闭"><IconX size={22} /></button></div>
      {!result && <>
        <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 16 }}>
          <button className="button button-outline" type="button" onClick={downloadTemplate}><IconDownload size={18} />下载导入模板</button>
          <button className="button button-primary" type="button" onClick={() => inputRef.current?.click()} disabled={loading}><IconUpload size={18} />选择Excel</button>
          <input ref={inputRef} type="file" accept=".xlsx,.xls" hidden onChange={(event) => parseFile(event.target.files?.[0])} />
          {file && <span style={{ color: "#4b5563" }}>{file.name}</span>}
        </div>
        {fileError && <p className="config-error"><IconAlertTriangleFilled size={16} />{fileError}</p>}
        {rows.length > 0 && <>
          <div className="metric-strip" style={{ marginBottom: 16 }}>
            <div className="metric-item"><span className="metric-icon metric-blue"><IconFileSpreadsheet size={20} /></span><div><span className="metric-label">Excel行数</span><div className="metric-value">{rows.length}<small>人</small></div></div></div>
            <div className="metric-item"><span className="metric-icon metric-blue"><IconCheck size={20} /></span><div><span className="metric-label">校验通过</span><div className="metric-value">{validCount}<small>人</small></div></div></div>
            <div className="metric-item"><span className="metric-icon metric-amber"><IconRefresh size={20} /></span><div><span className="metric-label">新增 / 更新</span><div className="metric-value">{newCount}<small> / {updateCount}人</small></div></div></div>
            <div className="metric-item"><span className={`metric-icon metric-${invalidCount ? "amber" : "blue"}`}><IconAlertTriangleFilled size={20} /></span><div><span className="metric-label">校验失败</span><div className="metric-value">{invalidCount}<small>人</small></div></div></div>
          </div>
          <div className="plain-table-wrap" style={{ maxHeight: 410, overflow: "auto" }}><table className="plain-table config-table"><thead><tr><th>行</th><th>工号</th><th>姓名</th><th>角色</th><th>范围</th><th>密码</th><th>校验</th></tr></thead><tbody>{rows.map((row) => <tr key={`${row.rowNo}-${row.employeeNo}`}><td>{row.rowNo}</td><td><code>{row.employeeNo}</code>{row.existing && <small style={{ display: "block", color: "#2563eb" }}>已有用户</small>}</td><td><strong>{row.displayName}</strong></td><td>{row.roleLabel}</td><td><small>{[...row.productDomainNames, ...row.mssDomainNames, ...row.organizationNames].join("、") || "—"}</small></td><td>{row.password ? "已填写" : row.existing ? "不修改" : "—"}</td><td>{row.errors.length ? <span className="warning-text">{row.errors.join("；")}</span> : <span style={{ color: "#15803d" }}>通过</span>}</td></tr>)}</tbody></table></div>
        </>}
      </>}
      {result && <div>
        <div className="metric-strip" style={{ marginBottom: 16 }}><div className="metric-item"><span className="metric-icon metric-blue"><IconCheck size={20} /></span><div><span className="metric-label">成功</span><div className="metric-value">{result.success.length}<small>人</small></div></div></div><div className="metric-item"><span className={`metric-icon metric-${result.failures.length ? "amber" : "blue"}`}><IconAlertTriangleFilled size={20} /></span><div><span className="metric-label">失败</span><div className="metric-value">{result.failures.length}<small>人</small></div></div></div></div>
        {result.failures.length > 0 && <div className="plain-table-wrap"><table className="plain-table"><thead><tr><th>Excel行</th><th>工号</th><th>姓名</th><th>失败原因</th></tr></thead><tbody>{result.failures.map((row) => <tr key={`${row.rowNo}-${row.employeeNo}`}><td>{row.rowNo}</td><td>{row.employeeNo}</td><td>{row.displayName}</td><td className="warning-text">{row.error}</td></tr>)}</tbody></table></div>}
        <p className="config-hint" style={{ marginTop: 14 }}>{allSuccess ? "全部用户已成功写入系统。关闭窗口后刷新用户列表即可看到最新结果。" : "失败行未写入；成功行已完成创建或更新，可修正Excel后重新导入失败行。"}</p>
      </div>}
      <div className="modal-actions"><button className="button button-secondary compact-button" type="button" onClick={result ? onFinished : onClose} disabled={loading}>{result ? "完成" : "取消"}</button>{!result && <button className="button button-primary compact-button" type="button" disabled={!canImport} onClick={importUsers}>{loading ? "导入中…" : `确认导入${validCount}人`}</button>}</div>
    </section>
  </div>;
}

export default function UserExcelImportEnhancer() {
  const [portalTarget, setPortalTarget] = useState(null);
  const [open, setOpen] = useState(false);
  const currentUser = auth.getCurrentUser();
  const canManage = currentUser?.permissions?.includes("user:manage");

  useEffect(() => {
    if (!canManage) return undefined;
    const findToolbar = () => document.querySelector(".user-config-table")?.closest(".config-surface")?.querySelector(".ops-toolbar");
    let currentToolbar = null;
    let host = null;
    const sync = () => {
      const toolbar = findToolbar();
      if (toolbar === currentToolbar) return;
      currentToolbar = toolbar;
      if (host) host.remove();
      host = null;
      if (toolbar) {
        host = document.createElement("span");
        host.style.display = "inline-flex";
        host.style.marginLeft = "8px";
        toolbar.appendChild(host);
        setPortalTarget(host);
      } else {
        setPortalTarget(null);
        setOpen(false);
      }
    };
    sync();
    const observer = new MutationObserver(sync);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => { observer.disconnect(); if (host) host.remove(); setPortalTarget(null); };
  }, [canManage]);

  if (!canManage) return null;
  return <>
    {portalTarget && createPortal(<button className="button button-outline compact-button" type="button" onClick={() => setOpen(true)}><IconFileSpreadsheet size={17} />Excel导入</button>, portalTarget)}
    {open && <UserImportModal onClose={() => setOpen(false)} onFinished={() => { setOpen(false); window.location.reload(); }} />}
  </>;
}
