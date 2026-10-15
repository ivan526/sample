import * as XLSX from 'xlsx';
export function validateSkuRows(rows) {
  const errors = [];
  rows.forEach((row, index) => {
    if (!row.sku.trim() && !(row.bom || '').trim() && !(row.description || '').trim()) return;
    if (!row.sku.trim()) { errors.push(`第${index + 1}行缺少产品型号`); return; }
  });
  return errors;
}
export function parseProductSkuWorkbook(buffer) {
  const workbook = XLSX.read(buffer, { type: 'array' });
  const errors = [];
  const normalize = (value) => String(value || '').normalize('NFKC').replace(/\s/gu, '').toLowerCase();
  for (const sheetName of workbook.SheetNames) {
    const grid = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, defval: '', raw: false, blankrows: true });
    const headerIndex = grid.findIndex((row) => row.some((cell) => ['产品型号','型号','sku'].includes(normalize(cell))) && row.some((cell) => ['bom编码','bom'].includes(normalize(cell))));
    if (headerIndex < 0) continue;
    const header = grid[headerIndex].map(normalize);
    const modelIndex = header.findIndex((cell) => ['产品型号','型号','sku'].includes(cell));
    const bomIndex = header.findIndex((cell) => ['bom编码','bom'].includes(cell));
    const descriptionIndex = header.findIndex((cell) => ['型号描述','配置说明','描述','备注','description'].includes(cell));
    const rows = [];
    grid.slice(headerIndex + 1).forEach((cells, offset) => {
      const row = { sku: String(cells[modelIndex] || '').trim(), bom: String(cells[bomIndex] || '').trim(), description: descriptionIndex >= 0 ? String(cells[descriptionIndex] || '').trim() : '' };
      if (!row.sku && !row.bom && !row.description) return;
      if (!row.sku) errors.push(`${sheetName}第${headerIndex + offset + 2}行缺少产品型号`);
      rows.push(row);
    });
    if (rows.length > 2000) throw new Error('单次最多导入2000行型号，请拆分文件');
    if (!rows.length) throw new Error('未找到可导入的型号数据');
    errors.push(...validateSkuRows(rows));
    if (errors.length) throw new Error(errors.slice(0, 6).join('；'));
    return rows;
  }
  throw new Error('未找到“产品型号”和“BOM编码”表头，请先下载模板');
}
export function downloadProductSkuTemplate() {
  const sheet = XLSX.utils.aoa_to_sheet([['产品型号','BOM编码','型号描述'],['HUAWEI WATCH 5 46mm','55020HKC','曜石黑'],['HUAWEI WATCH 5 46mm','55020HKD','晨曦金']]);
  sheet['!cols'] = [{ wch: 35 }, { wch: 22 }, { wch: 42 }];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, '产品型号');
  XLSX.writeFile(workbook, '产品型号导入模板.xlsx');
}
