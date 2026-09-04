const REQUIRED_FIELDS = ["业务领域", "地区部", "代表处", "国家/地区", "BOM编码", "发货数量"];

const FIELD_ALIASES = {
  mssDomain: ["业务领域"], region: ["地区部"], office: ["代表处"], country: ["国家/地区"],
  bomCode: ["BOM编码"], shippedQty: ["发货数量"],
  externalKey: ["外部流水号", "流水号", "externalKey", "external_key"],
  applicationNo: ["申请单号", "TSMP申请单号", "applicationNo", "application_no"],
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

function parseShipmentDate(value) {
  if (!value) return undefined;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}

export function parseTsmpWorksheet(XLSX, worksheet) {
  const matrix = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: "", raw: true });
  if (!matrix.length) throw new Error("Excel中没有可导入的数据");

  const requiredHeaders = REQUIRED_FIELDS.map(normalizeTsmpHeader);
  const headerRowIndex = matrix.findIndex((row) => {
    const normalized = row.map(normalizeTsmpHeader);
    return requiredHeaders.every((header) => normalized.includes(header));
  });
  if (headerRowIndex < 0) throw new Error(`未找到完整表头，请确认包含：${REQUIRED_FIELDS.join("、")}`);

  const headers = matrix[headerRowIndex];
  const columns = Object.fromEntries(Object.entries(FIELD_ALIASES).map(([field, aliases]) => [field, findHeaderIndex(headers, aliases)]));
  const dataRows = matrix.slice(headerRowIndex + 1).filter((row) => row.some((cell) => String(cell ?? "").trim()));
  if (!dataRows.length) throw new Error("Excel中没有可导入的数据");
  if (dataRows.length > 10000) throw new Error("单次导入不能超过10,000条");

  return dataRows.map((row, index) => {
    const read = (field) => columns[field] >= 0 ? row[columns[field]] : "";
    const mapped = {
      externalKey: String(read("externalKey") ?? "").trim(), applicationNo: String(read("applicationNo") ?? "").trim(),
      mssDomain: String(read("mssDomain") ?? "").trim(), bomCode: String(read("bomCode") ?? "").trim(),
      region: String(read("region") ?? "").trim(), office: String(read("office") ?? "").trim(),
      country: String(read("country") ?? "").trim(), shippedQty: parsePositiveInteger(read("shippedQty")),
    };
    const shippedAt = parseShipmentDate(read("shippedAt"));
    if (shippedAt) mapped.shippedAt = shippedAt;
    if (!mapped.mssDomain || !mapped.bomCode || !mapped.region || !mapped.office || !mapped.country || !Number.isInteger(mapped.shippedQty)) {
      throw new Error(`第${headerRowIndex + index + 2}行缺少业务领域、地区部、代表处、国家/地区、BOM编码或有效发货数量`);
    }
    return mapped;
  });
}
