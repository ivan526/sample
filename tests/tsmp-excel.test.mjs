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
  assert.throws(() => parseTsmpWorksheet(XLSX, sheet), /第3行校验失败：代表处。系统读取结果：.*代表处=空/);
});

test("TSMP parser expands visually populated merged cells", () => {
  const sheet = XLSX.utils.aoa_to_sheet([
    ["业务领域", "地区部", "代表处", "国家/地区", "BOM编码", "发货数量"],
    ["MKT", "欧洲", "德国代表处", "德国", "111", 10],
    ["", "", "", "奥地利", "222", 20],
  ]);
  sheet["!merges"] = [
    { s: { r: 1, c: 0 }, e: { r: 2, c: 0 } },
    { s: { r: 1, c: 1 }, e: { r: 2, c: 1 } },
    { s: { r: 1, c: 2 }, e: { r: 2, c: 2 } },
  ];

  const rows = parseTsmpWorksheet(XLSX, sheet);
  assert.equal(rows[1].mssDomain, "MKT");
  assert.equal(rows[1].region, "欧洲");
  assert.equal(rows[1].office, "德国代表处");
  assert.equal(rows[1].country, "奥地利");
});

test("TSMP parser skips zero-quantity rows without blocking valid shipments", () => {
  const sheet = XLSX.utils.aoa_to_sheet([
    ["业务领域", "地区部", "代表处", "国家/地区", "BOM编码", "发货数量"],
    ["GTM样机", "中国终端业务部", "中国终端渠道部", "中国", "55020HKC", 0],
    ["GTM样机", "中国终端业务部", "中国终端渠道部", "中国", "55020HKD", 12],
  ]);

  const rows = parseTsmpWorksheet(XLSX, sheet);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].bomCode, "55020HKD");
  assert.equal(rows[0].shippedQty, 12);
});

test("TSMP parser explains when every shipment quantity is zero", () => {
  const sheet = XLSX.utils.aoa_to_sheet([
    ["业务领域", "地区部", "代表处", "国家/地区", "BOM编码", "发货数量"],
    ["GTM样机", "中国终端业务部", "中国终端渠道部", "中国", "55020HKC", "0.00"],
  ]);

  assert.throws(() => parseTsmpWorksheet(XLSX, sheet), /发货数量全部为0/);
});
