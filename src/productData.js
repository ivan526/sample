export const baseProducts = [
  {
    id: "chitu-b19",
    name: "Chitu B19系列",
    categoryId: "wearables",
    stage: "测试样机（VN2）",
    supply: "预计2026年1月初发货",
    deadline: "8月31日 18:00",
    scope: "6个MKT区域",
    enabled: true,
    skus: [
      { sku: "Chitu-B19F", bom: "111" },
      { sku: "Chitu-B19W", bom: "222" },
      { sku: "Chitu-B19FB", bom: "333" },
      { sku: "Chitu-B19D", bom: "444" },
    ],
  },
  {
    id: "chitu-b21",
    name: "Chitu B21系列",
    categoryId: "wearables",
    stage: "工程样机（EVT）",
    supply: "预计2026年2月中旬发货",
    deadline: "9月15日 18:00",
    scope: "5个MKT区域",
    enabled: true,
    skus: [
      { sku: "Chitu-B21F", bom: "521" },
      { sku: "Chitu-B21W", bom: "522" },
      { sku: "Chitu-B21D", bom: "523" },
    ],
  },
  {
    id: "chitu-pad-x",
    name: "Chitu Pad X系列",
    categoryId: "tablet",
    stage: "测试样机（DVT）",
    supply: "预计2026年3月初发货",
    deadline: "9月30日 18:00",
    scope: "4个MKT区域",
    enabled: true,
    skus: [
      { sku: "Chitu-PadX-Pro", bom: "PX01" },
      { sku: "Chitu-PadX-Air", bom: "PX02" },
    ],
  },
  {
    id: "chitu-b23",
    name: "Chitu B23新品项目",
    categoryId: "wearables",
    stage: "工程样机（EVT）",
    supply: "待产品线确认",
    deadline: "待计划下发",
    scope: "6个MKT区域",
    enabled: true,
    skus: [],
  },
];

export const baseDomains = [
  { id: "wearables", name: "穿戴", gtm: "王璐", stockingOwner: "赵敏", description: "手表、手环及穿戴配件", enabled: true },
  { id: "mobile", name: "手机", gtm: "李娜", stockingOwner: "陈涛", description: "手机及移动终端", enabled: true },
  { id: "tablet", name: "平板", gtm: "周航", stockingOwner: "孙悦", description: "平板及配套终端", enabled: true },
];

export const baseOrganizations = [
  { id: "europe", name: "欧洲MKT", owner: "AAA", enabled: true, offices: [
    { id: "de-office", name: "德国代表处", owner: "吴凯", countries: ["德国", "奥地利", "瑞士"] },
    { id: "fr-office", name: "法国代表处", owner: "何静", countries: ["法国", "比利时", "荷兰"] },
    { id: "es-office", name: "西班牙代表处", owner: "林浩", countries: ["西班牙", "葡萄牙"] },
  ] },
  { id: "eurasia", name: "欧亚MKT", owner: "BBB", enabled: true, offices: [
    { id: "kz-office", name: "哈萨克斯坦代表处", owner: "韩磊", countries: ["哈萨克斯坦", "乌兹别克斯坦"] },
    { id: "tr-office", name: "土耳其代表处", owner: "赵然", countries: ["土耳其", "格鲁吉亚"] },
  ] },
  { id: "sea", name: "东南亚MKT", owner: "CCC", enabled: true, offices: [
    { id: "sea-office", name: "东南亚代表处", owner: "陈曦", countries: ["新加坡", "泰国", "马来西亚", "菲律宾"] },
  ] },
  { id: "latam", name: "拉美MKT", owner: "DDD", enabled: true, offices: [
    { id: "br-office", name: "巴西代表处", owner: "宋扬", countries: ["巴西", "阿根廷", "智利"] },
    { id: "mx-office", name: "墨西哥代表处", owner: "蒋欣", countries: ["墨西哥", "哥伦比亚", "秘鲁"] },
  ] },
  { id: "mea", name: "中东非MKT", owner: "EEE", enabled: true, offices: [
    { id: "me-office", name: "中东代表处", owner: "高远", countries: ["阿联酋", "沙特阿拉伯"] },
    { id: "za-office", name: "南非代表处", owner: "潘悦", countries: ["南非", "肯尼亚"] },
  ] },
  { id: "china", name: "中国区MKT", owner: "FFF", enabled: true, offices: [
    { id: "cn-office", name: "中国区代表处", owner: "郭宁", countries: ["中国"] },
  ] },
];
