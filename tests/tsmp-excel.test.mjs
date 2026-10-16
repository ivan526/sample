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
    sourceRowNo: 4, externalKey: "", applicationNo: "", mssDomain: "MKT", bomCode: "111",
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

test("TSMP parser accepts an all-zero shipment file without importing rows", () => {
  const sheet = XLSX.utils.aoa_to_sheet([
    ["业务领域", "地区部", "代表处", "国家/地区", "BOM编码", "发货数量"],
    ["GTM样机", "中国终端业务部", "中国终端渠道部", "中国", "55020HKC", "0.00"],
  ]);

  assert.deepEqual(parseTsmpWorksheet(XLSX, sheet), []);
});


test("TSMP parser treats blank quantity as zero and keeps valid shipment rows", () => {
  const sheet = XLSX.utils.aoa_to_sheet([
    ["业务领域", "地区部", "代表处", "国家/地区", "BOM编码", "发货数量"],
    ["MKT样机", "拉美终端业务部", "拉美终端Marketing部", "哥伦比亚", "51098XYG", ""],
    ["MKT样机", "拉美终端业务部", "拉美终端Marketing部", "哥伦比亚", "51098XYH", 8],
  ]);
  const rows = parseTsmpWorksheet(XLSX, sheet);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].sourceRowNo, 3);
  assert.equal(rows[0].shippedQty, 8);
});

test("TSMP parser accepts a file with only blank shipment quantities", () => {
  const sheet = XLSX.utils.aoa_to_sheet([
    ["业务领域", "地区部", "代表处", "国家/地区", "BOM编码", "发货数量"],
    ["MKT样机", "拉美终端业务部", "拉美终端Marketing部", "哥伦比亚", "51098XYG", ""],
  ]);
  assert.deepEqual(parseTsmpWorksheet(XLSX, sheet), []);
});

test("TSMP parser still rejects malformed nonempty shipment quantities", () => {
  const sheet = XLSX.utils.aoa_to_sheet([
    ["业务领域", "地区部", "代表处", "国家/地区", "BOM编码", "发货数量"],
    ["MKT样机", "拉美终端业务部", "拉美终端Marketing部", "哥伦比亚", "51098XYG", "abc"],
  ]);
  assert.throws(() => parseTsmpWorksheet(XLSX, sheet), /发货数量/);
});


test('TSMP parser forwards optional product model to disambiguate a shared BOM', () => {
  const sheet = XLSX.utils.aoa_to_sheet([
    ['业务领域','地区部','代表处','国家/地区','BOM编码','发货数量','产品型号'],
    ['MKT领域','欧洲MKT','德国代表处','德国','SHARED-BOM',5,'型号乙'],
  ]);
  const rows = parseTsmpWorksheet(XLSX, sheet);
  assert.equal(rows[0].sku, '型号乙');
});


test("TSMP optional people and business times are preserved without account mapping", () => {
  const sheet = XLSX.utils.aoa_to_sheet([
    ["业务领域", "地区部", "代表处", "国家/地区", "BOM编码", "发货数量", "申请人", "申请人工号", "处理人", "处理人工号", "申请时间", "处理时间", "发货时间"],
    ["MKT", "欧洲", "德国代表处", "德国", "111", 2, "外部申请人", "APP-01", "外部处理人", "EXT-01", "2026-10-14T13:00:00Z", "2026-10-14T14:00:00Z", "2026-10-14T15:00:00Z"],
  ]);
  const row = parseTsmpWorksheet(XLSX, sheet)[0];
  assert.equal(row.applicantName, "外部申请人"); assert.equal(row.handlerName, "外部处理人"); assert.equal(row.handlerEmployeeNo, "EXT-01");
  assert.equal(row.appliedAt, "2026-10-14T13:00:00.000Z"); assert.equal(row.handledAt, "2026-10-14T14:00:00.000Z");
});


test("Excel serial and local display dates consistently represent Beijing time", () => {
  const serial=(Date.UTC(2026,9,15,15,42,10)-Date.UTC(1899,11,30))/86400000;
  const sheet=XLSX.utils.aoa_to_sheet([
    ["业务领域","地区部","代表处","国家/地区","BOM编码","发货数量","发货时间","申请时间","处理时间"],
    ["MKT","欧洲","德国代表处","德国","111",2,serial,"2026-10-15 10:00:00","2026/10/15 14:00:00"],
  ]);
  const row=parseTsmpWorksheet(XLSX,sheet)[0];
  assert.equal(row.shippedAt,"2026-10-15T07:42:10.000Z");assert.equal(row.appliedAt,"2026-10-15T02:00:00.000Z");assert.equal(row.handledAt,"2026-10-15T06:00:00.000Z");
});
test("Nonempty invalid business times report the physical row instead of disappearing", () => {
  const sheet=XLSX.utils.aoa_to_sheet([
    ["业务领域","地区部","代表处","国家/地区","BOM编码","发货数量","处理时间"],
    ["MKT","欧洲","德国代表处","德国","111",2,"2026-02-30 10:00:00"],
  ]);
  assert.throws(()=>parseTsmpWorksheet(XLSX,sheet),/第2行.*处理时间格式无效/);
});
