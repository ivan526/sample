const REQUIRED_FIELDS = ["业务领域", "地区部", "代表处", "国家/地区", "BOM编码", "发货数量"];

const FIELD_ALIASES = {
  mssDomain: ["业务领域"], region: ["地区部"], office: ["代表处"], country: ["国家/地区"],
  bomCode: ["BOM编码"], shippedQty: ["发货数量"],
  sku: ["产品型号", "SKU", "型号"],
  externalKey: ["外部流水号", "流水号", "externalKey", "external_key"],
  applicationNo: ["申请单号", "TSMP申请单号", "applicationNo", "application_no"],
  applicantName: ["申请人", "申请人姓名", "applicantName"],
  applicantEmployeeNo: ["申请人工号", "applicantEmployeeNo"],
  handlerName: ["处理人", "处理人姓名", "handlerName"],
  handlerEmployeeNo: ["处理人工号", "handlerEmployeeNo"],
  appliedAt: ["申请时间", "申请日期", "appliedAt"],
  handledAt: ["处理时间", "处理日期", "handledAt"],
  shippedAt: ["发货时间", "发货日期", "shippedAt", "shipped_at"],
};

export function normalizeTsmpHeader(value) {
  return String(value ?? "").replace(/[\s\u3000\uFEFF\u200B-\u200D]/g, "").toLowerCase();
}

function findHeaderIndex(headers, aliases) {
  const normalizedAliases = aliases.map(normalizeTsmpHeader);
  return headers.findIndex((header) => normalizedAliases.includes(normalizeTsmpHeader(header)));
}

function parsePositiveInteger(value) {
  if (typeof value === "number") return Number.isInteger(value) && value > 0 ? value : NaN;
  const normalized = String(value ?? "").trim().replace(/[,，\s\u3000]/g, "");
  if (!/^\d+$/.test(normalized)) return NaN;
  const parsed = Number(normalized);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : NaN;
}

function isZeroQuantity(value) {
  if (value == null || String(value).trim() === "") return true;
  if (typeof value === "number") return value === 0;
  const normalized = String(value ?? "").trim().replace(/[,，\s\u3000]/g, "");
  return /^0+(?:\.0+)?$/.test(normalized);
}

function parseShipmentDate(value, XLSX) {
  if (value == null || String(value).trim() === '') return undefined;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? undefined : value.toISOString();
  // Excel serials and unzoned display strings are Beijing business wall time.
  if (typeof value === 'number') {
    const parts = value >= 1 && value <= 2958465 ? (XLSX.SSF || XLSX.default?.SSF).parse_date_code(value) : null;
    if (!parts) return undefined;
    return new Date(Date.UTC(parts.y, parts.m-1, parts.d, parts.H-8, parts.M, parts.S, Math.round(parts.u*1000))).toISOString();
  }
  const raw = String(value).trim();
  const local = raw.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?)?$/);
  if (local) {
    const [,y,m,d,h='0',minute='0',second='0',fraction='0'] = local;
    const ms=Number(fraction.padEnd(3,'0'));
    const date = new Date(Date.UTC(Number(y),Number(m)-1,Number(d),Number(h)-8,Number(minute),Number(second),ms));
    const wall = new Date(date.getTime()+8*3600000);
    if (wall.getUTCFullYear()!==Number(y) || wall.getUTCMonth()+1!==Number(m) || wall.getUTCDate()!==Number(d) || wall.getUTCHours()!==Number(h) || wall.getUTCMinutes()!==Number(minute) || wall.getUTCSeconds()!==Number(second)) return undefined;
    return date.toISOString();
  }
  if (!/(?:Z|[+-]\d{2}:?\d{2})$/i.test(raw)) return undefined;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

export function parseTsmpWorksheet(XLSX, worksheet) {
  const matrix = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: "", raw: true });
  if (!matrix.length) throw new Error("Excel中没有可导入的数据");

  // Excel合并单元格只有左上角真正存值。将其展开，避免界面上看起来有值、读取却为空。
  for (const merge of worksheet["!merges"] || []) {
    const mergedValue = matrix[merge.s.r]?.[merge.s.c] ?? "";
    for (let row = merge.s.r; row <= merge.e.r; row += 1) {
      if (!matrix[row]) matrix[row] = [];
      for (let column = merge.s.c; column <= merge.e.c; column += 1) {
        if (matrix[row][column] === undefined || matrix[row][column] === "") matrix[row][column] = mergedValue;
      }
    }
  }

  const requiredHeaders = REQUIRED_FIELDS.map(normalizeTsmpHeader);
  const headerRowIndex = matrix.findIndex((row) => {
    const normalized = row.map(normalizeTsmpHeader);
    return requiredHeaders.every((header) => normalized.includes(header));
  });
  if (headerRowIndex < 0) {
    const candidates = matrix.slice(0, 30).map((row, index) => {
      const cells = row.map((value) => String(value ?? "").trim()).filter(Boolean);
      const normalized = cells.map(normalizeTsmpHeader);
      const matched = REQUIRED_FIELDS.filter((field) => normalized.includes(normalizeTsmpHeader(field)));
      return { index, cells, matched };
    }).sort((a, b) => b.matched.length - a.matched.length);
    const closest = candidates[0];
    const missing = REQUIRED_FIELDS.filter((field) => !closest?.matched.includes(field));
    const detected = closest?.cells.length ? closest.cells.join("｜") : "未读取到内容";
    throw new Error(`未找到完整表头。最接近的是第${(closest?.index ?? 0) + 1}行；缺少：${missing.join("、")}；该行实际读取为：${detected}`);
  }

  const headers = matrix[headerRowIndex];
  const columns = Object.fromEntries(Object.entries(FIELD_ALIASES).map(([field, aliases]) => [field, findHeaderIndex(headers, aliases)]));
  const dataRows = matrix.slice(headerRowIndex + 1).filter((row) => row.some((cell) => String(cell ?? "").trim()));
  if (!dataRows.length) throw new Error("Excel中没有可导入的数据");
  if (dataRows.length > 10000) throw new Error("单次导入不能超过10,000条");

  const parsedRows = dataRows.map((row, index) => {
    const read = (field) => columns[field] >= 0 ? row[columns[field]] : "";
    if (isZeroQuantity(read("shippedQty"))) return null;
    const mapped = {
      sourceRowNo: headerRowIndex + index + 2,
      ...(String(read("sku") ?? "").trim() ? { sku: String(read("sku")).trim() } : {}),
      externalKey: String(read("externalKey") ?? "").trim(), applicationNo: String(read("applicationNo") ?? "").trim(),
      mssDomain: String(read("mssDomain") ?? "").trim(), bomCode: String(read("bomCode") ?? "").trim(),
      region: String(read("region") ?? "").trim(), office: String(read("office") ?? "").trim(),
      country: String(read("country") ?? "").trim(), shippedQty: parsePositiveInteger(read("shippedQty")),
    };
    for (const key of ["applicantName","applicantEmployeeNo","handlerName","handlerEmployeeNo"]) {
      const value=String(read(key) ?? "").trim(); if(value) mapped[key]=value;
    }
    for (const key of ["shippedAt","appliedAt","handledAt"]) {
      const raw=read(key), value=parseShipmentDate(raw, XLSX);
      if(value) mapped[key]=value;
      else if (raw != null && String(raw).trim()) throw new Error(`第${mapped.sourceRowNo}行：${{shippedAt:"发货时间",appliedAt:"申请时间",handledAt:"处理时间"}[key]}格式无效，请提供完整日期时间`);
    }
    const missing = [];
    if (!mapped.mssDomain) missing.push("业务领域");
    if (!mapped.region) missing.push("地区部");
    if (!mapped.office) missing.push("代表处");
    if (!mapped.country) missing.push("国家/地区");
    if (!mapped.bomCode) missing.push("BOM编码");
    if (!Number.isInteger(mapped.shippedQty)) missing.push(`发货数量（读取值：${String(read("shippedQty") ?? "空")}）`);
    if (missing.length) {
      const recognized = [
        `业务领域=${mapped.mssDomain || "空"}`, `地区部=${mapped.region || "空"}`,
        `代表处=${mapped.office || "空"}`, `国家/地区=${mapped.country || "空"}`,
        `BOM编码=${mapped.bomCode || "空"}`, `发货数量=${String(read("shippedQty") ?? "空") || "空"}`,
      ].join("；");
      throw new Error(`第${headerRowIndex + index + 2}行校验失败：${missing.join("、")}。系统读取结果：${recognized}`);
    }
    return mapped;
  });
  const importableRows = parsedRows.filter(Boolean);
  // 空白发货数量与明确填写0等价：无需进入后端匹配，也不计入实际发货。
  return importableRows;
}
