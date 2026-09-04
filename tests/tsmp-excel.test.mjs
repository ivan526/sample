import test from "node:test";
import assert from "node:assert/strict";
import * as XLSX from "xlsx";
import { parseTsmpWorksheet } from "../src/utils/tsmpExcel.js";

test("TSMP parser locates a non-first header row and normalizes exported headers", () => {
  const sheet = XLSX.utils.aoa_to_sheet([
    ["TSMP发货数据导出"],
    ["导出时间", "2026-09-04"],
    ["业务\n领域", "地区部　", "代表处", "国家/地区", "BOM 编码", "发货数量"],
    ["MKT", "欧洲", "德国代表处", "德国", "111", "1,200"],
  ]);
  assert.deepEqual(parseTsmpWorksheet(XLSX, sheet), [{
    externalKey: "", applicationNo: "", mssDomain: "MKT", bomCode: "111",
    region: "欧洲", office: "德国代表处", country: "德国", shippedQty: 1200,
  }]);
});

test("TSMP parser reports the physical Excel row after title rows", () => {
  const sheet = XLSX.utils.aoa_to_sheet([
    ["说明"],
    ["业务领域", "地区部", "代表处", "国家/地区", "BOM编码", "发货数量"],
    ["MKT", "欧洲", "", "德国", "111", 10],
  ]);
  assert.throws(() => parseTsmpWorksheet(XLSX, sheet), /第3行缺少/);
});
