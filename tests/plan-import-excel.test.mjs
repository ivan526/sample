import assert from 'node:assert/strict';
import test from 'node:test';
import * as XLSX from 'xlsx';
import {parsePlanImportWorkbook} from '../src/utils/planImportExcel.js';
const header=['MSS业务领域','产品型号','BOM编码','区域','代表处','国家/地区','需求数量','需求依据','计划使用时间','备注','SKU ID','累计申请数量','累计发货数量'];
function workbook(rows){const book=XLSX.utils.book_new(),sheet=XLSX.utils.aoa_to_sheet(rows);XLSX.utils.book_append_sheet(book,sheet,'需求明细');return {book,sheet,read:()=>parsePlanImportWorkbook(XLSX,XLSX.write(book,{type:'array',bookType:'xlsx'}))};}
test('plan template parser preserves explicit zero countries, blank pools, SKU IDs, leading-zero BOMs and dates',()=>{
 const w=workbook([header,['MKT','WATCH','00001','欧洲','德国代表处','',100,'上市展示','2026-11-01','','sku-1',20,10],['MKT','WATCH',2,'欧洲','德国代表处','德国',0,'',46327,'','sku-2','','']]);w.sheet.C3.z='00000';
 const rows=w.read();assert.equal(rows[0].country,'');assert.equal(rows[0].quantity,100);assert.equal(rows[0].bomCode,'00001');assert.equal(rows[0].plannedUseDate,'2026-11-01');assert.equal(rows[1].quantity,0);assert.equal(rows[1].country,'德国');assert.equal(rows[1].bomCode,'00002');assert.equal(rows[1].appliedQuantity,undefined);assert.equal(rows[1].sourceRowNo,3);
});
test('blank demand is not zero and malformed nonempty numbers or dates show the physical row',()=>{
 for(const [idx,value,match] of [[6,'',/第2行需求数量不能为空/],[6,-1,/第2行需求数量须为/],[12,1.5,/第2行累计发货数量须为/],[8,'2026-02-30',/第2行计划使用时间无效/]]){
  const row=['MKT','WATCH','00001','欧洲','德国代表处','',10,'','','','sku'];row[idx]=value;assert.throws(()=>workbook([header,row]).read(),match);
 }
});
test('only the named demand sheet is imported and reference rows cannot become business data',()=>{
 const w=workbook([header]);XLSX.utils.book_append_sheet(w.book,XLSX.utils.aoa_to_sheet([header,['MKT','WATCH','A','欧洲','德国代表处','德国',10]]),'参考');assert.throws(w.read,/没有数据/);
 const b=XLSX.utils.book_new();XLSX.utils.book_append_sheet(b,XLSX.utils.aoa_to_sheet([header]),'其他');assert.throws(()=>parsePlanImportWorkbook(XLSX,XLSX.write(b,{type:'array',bookType:'xlsx'})),/未找到/);
});
