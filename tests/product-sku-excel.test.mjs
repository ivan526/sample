import assert from 'node:assert/strict';
import test from 'node:test';
import * as XLSX from 'xlsx';
import { parseProductSkuWorkbook, validateSkuRows } from '../src/utils/productSkuExcel.js';
function file(rows) { const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(rows),'型号');return XLSX.write(wb,{type:'buffer',bookType:'xlsx'}); }
test('Excel allows repeated models with separate BOMs and keeps text BOM leading zeros',()=>{
 const rows=parseProductSkuWorkbook(file([['产品型号维护'],['产品型号','BOM编码','型号描述'],['WATCH','001234','黑'],['WATCH','001235','白'],[],['PAD','','BOM待补']]));
 assert.equal(rows.length,3);assert.equal(rows[0].bom,'001234');assert.deepEqual(validateSkuRows(rows),[]);
});
test('Excel rejects duplicate pairs, missing models and malformed headers atomically',()=>{
 assert.throws(()=>parseProductSkuWorkbook(file([['产品型号','BOM编码'],['WATCH','A'],['watch','A']])),/重复/);
 assert.throws(()=>parseProductSkuWorkbook(file([['产品型号','BOM编码'],['','A']])),/第2行缺少/);
 assert.throws(()=>parseProductSkuWorkbook(file([['错误列'],['WATCH']])),/表头/);
 assert.equal(validateSkuRows([{sku:'X',bom:''},{sku:'X',bom:''}]).length,1);
 assert.equal(validateSkuRows([{sku:'X',bom:'A'},{sku:'X',bom:'B'}]).length,0);
});
