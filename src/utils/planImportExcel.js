import { parseShipmentDate } from './tsmpExcel.js';
const aliases={mssDomain:['MSS业务领域','MSS领域','业务领域'],productModel:['产品型号','型号','SKU'],bomCode:['BOM编码','BOM'],region:['区域','地区部'],office:['代表处'],country:['国家/地区','国家'],quantity:['需求数量','申请需求数量'],basis:['需求依据'],plannedUseDate:['计划使用时间','计划使用日期'],note:['备注'],productSkuId:['SKU ID','SKUID'],appliedQuantity:['累计申请数量','累计申请'],shippedQuantity:['累计发货数量','累计发货']};
const norm=v=>String(v??'').normalize('NFKC').replace(/\s/gu,'').toLowerCase();
export function parsePlanImportWorkbook(XLSX,buffer){
  const book=XLSX.read(buffer,{type:'array',cellDates:false});
  const sheet=book.Sheets['需求明细'];if(!sheet)throw new Error('未找到“需求明细”工作表，请使用下载的模板');
  const range=sheet['!ref']?XLSX.utils.decode_range(sheet['!ref']):null;
  if(!range)throw new Error('需求明细为空，请填写模板后上传');
  if(range.e.r>10020)throw new Error('单次最多导入10000条需求，请拆分文件');
  const grid=XLSX.utils.sheet_to_json(sheet,{header:1,defval:'',raw:true,blankrows:true});
  const header=grid.findIndex(row=>row.some(c=>aliases.quantity.map(norm).includes(norm(c)))&&row.some(c=>aliases.mssDomain.map(norm).includes(norm(c))));
  if(header<0)throw new Error('模板缺少“MSS业务领域”或“需求数量”表头');
  const columns=Object.fromEntries(Object.entries(aliases).map(([k,vs])=>[k,grid[header].findIndex(c=>vs.map(norm).includes(norm(c)))]));
  for(const key of ['mssDomain','region','office','quantity'])if(columns[key]<0)throw new Error(`模板缺少“${aliases[key][0]}”表头`);
  const errors=[],rows=[];
  const quantity=(value,key,no,optional)=>{
    if(value==null||String(value).trim()===''){if(optional)return undefined;errors.push(`第${no}行${aliases[key][0]}不能为空（0请明确填写）`);return 0;}
    const str=String(value).trim().replace(/[,，]/g,'');const n=Number(str);
    if(!/^\d+$/.test(str)||!Number.isInteger(n)||n>2147483647){errors.push(`第${no}行${aliases[key][0]}须为0至2147483647的整数`);return 0;}return n;
  };
  grid.slice(header+1).forEach((cells,index)=>{
    if(!cells.some(c=>String(c??'').trim()))return;
    const no=header+index+2,read=k=>columns[k]<0?'':cells[columns[k]];
    // Formatted model/BOM text preserves leading zeros from existing workbooks.
    const text=k=>{const cell=columns[k]<0?null:sheet[XLSX.utils.encode_cell({r:no-1,c:columns[k]})];return String((['bomCode','productSkuId'].includes(k)?cell?.w:null)??read(k)??'').trim();};
    const row={sourceRowNo:no,...Object.fromEntries(['productSkuId','productModel','bomCode','mssDomain','region','office','country','basis','note'].map(k=>[k,text(k)])),quantity:quantity(read('quantity'),'quantity',no,false)};
    for(const key of ['appliedQuantity','shippedQuantity']){const value=quantity(read(key),key,no,true);if(value!==undefined)row[key]=value;}
    const date=read('plannedUseDate');if(date!=null&&String(date).trim()){
      const parsed=parseShipmentDate(date,XLSX);
      if(!parsed)errors.push(`第${no}行计划使用时间无效，请填写YYYY-MM-DD`);
      else row.plannedUseDate=new Date(Date.parse(parsed)+8*3600000).toISOString().slice(0,10);
    }
    for(const k of ['mssDomain','region','office'])if(!row[k])errors.push(`第${no}行${aliases[k][0]}不能为空`);
    rows.push(row);
  });
  if(rows.length>10000)throw new Error('单次最多导入10000条需求，请拆分文件');
  if(!rows.length)throw new Error('需求明细中没有数据，参考页不会导入');
  if(errors.length)throw new Error(errors.slice(0,15).join('；')+(errors.length>15?`；另有${errors.length-15}项错误`:''));
  return rows;
}
