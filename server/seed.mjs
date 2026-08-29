import { PLAN_STATUS } from "../shared/domain.mjs";

export const seed = {
  domains: [
    { id: "wearables", name: "穿戴", gtm: "王璐", stockingOwner: "赵敏", description: "手表、手环及穿戴配件", enabled: true, version: 1 },
    { id: "mobile", name: "手机", gtm: "李娜", stockingOwner: "陈涛", description: "手机及移动终端", enabled: true, version: 1 },
    { id: "tablet", name: "平板", gtm: "周航", stockingOwner: "孙悦", description: "平板及配套终端", enabled: true, version: 1 },
  ],
  products: [
    { id: "chitu-b19", name: "Chitu B19系列", domainId: "wearables", stage: "测试样机（VN2）", supplyTimeText: "预计2026年1月初发货", defaultDeadline: "2026-08-31T18:00:00+08:00", enabled: true, version: 1, skus: [{ id: "b19f", model: "Chitu-B19F", bomCode: "111" }, { id: "b19w", model: "Chitu-B19W", bomCode: "222" }, { id: "b19fb", model: "Chitu-B19FB", bomCode: "333" }, { id: "b19d", model: "Chitu-B19D", bomCode: "444" }] },
    { id: "chitu-b21", name: "Chitu B21系列", domainId: "wearables", stage: "工程样机（EVT）", supplyTimeText: "预计2026年2月中旬发货", defaultDeadline: "2026-09-15T18:00:00+08:00", enabled: true, version: 1, skus: [{ id: "b21f", model: "Chitu-B21F", bomCode: "521" }, { id: "b21w", model: "Chitu-B21W", bomCode: "522" }, { id: "b21d", model: "Chitu-B21D", bomCode: "523" }] },
    { id: "chitu-pad-x", name: "Chitu Pad X系列", domainId: "tablet", stage: "测试样机（DVT）", supplyTimeText: "预计2026年3月初发货", defaultDeadline: "2026-09-30T18:00:00+08:00", enabled: true, version: 1, skus: [{ id: "padx-pro", model: "Chitu-PadX-Pro", bomCode: "PX01" }, { id: "padx-air", model: "Chitu-PadX-Air", bomCode: "PX02" }] },
    { id: "chitu-b23", name: "Chitu B23新品项目", domainId: "wearables", stage: "工程样机（EVT）", supplyTimeText: "待产品线确认", defaultDeadline: null, enabled: true, version: 1, skus: [] },
  ],
  organizations: [
    { id: "europe", name: "欧洲MKT", owner: "AAA", enabled: true, version: 1, offices: [{ id: "de-office", name: "德国代表处", owner: "吴凯", enabled: true, countries: ["德国", "奥地利", "瑞士"] }, { id: "fr-office", name: "法国代表处", owner: "何静", enabled: true, countries: ["法国", "比利时", "荷兰"] }, { id: "es-office", name: "西班牙代表处", owner: "林浩", enabled: true, countries: ["西班牙", "葡萄牙"] }] },
    { id: "eurasia", name: "欧亚MKT", owner: "BBB", enabled: true, version: 1, offices: [{ id: "kz-office", name: "哈萨克斯坦代表处", owner: "韩磊", enabled: true, countries: ["哈萨克斯坦", "乌兹别克斯坦"] }, { id: "tr-office", name: "土耳其代表处", owner: "赵然", enabled: true, countries: ["土耳其", "格鲁吉亚"] }] },
    { id: "sea", name: "东南亚MKT", owner: "CCC", enabled: true, version: 1, offices: [{ id: "sea-office", name: "东南亚代表处", owner: "陈曦", enabled: true, countries: ["新加坡", "泰国", "马来西亚", "菲律宾"] }] },
    { id: "latam", name: "拉美MKT", owner: "DDD", enabled: true, version: 1, offices: [{ id: "br-office", name: "巴西代表处", owner: "宋扬", enabled: true, countries: ["巴西", "阿根廷", "智利"] }, { id: "mx-office", name: "墨西哥代表处", owner: "蒋欣", enabled: true, countries: ["墨西哥", "哥伦比亚", "秘鲁"] }] },
    { id: "mea", name: "中东非MKT", owner: "EEE", enabled: true, version: 1, offices: [{ id: "me-office", name: "中东代表处", owner: "高远", enabled: true, countries: ["阿联酋", "沙特阿拉伯"] }, { id: "za-office", name: "南非代表处", owner: "潘悦", enabled: true, countries: ["南非", "肯尼亚"] }] },
    { id: "china", name: "中国区MKT", owner: "FFF", enabled: true, version: 1, offices: [{ id: "cn-office", name: "中国区代表处", owner: "郭宁", enabled: true, countries: ["中国"] }] },
  ],
  plans: [
    { id: "PLAN-2608-01", productId: "chitu-b19", regionIds: ["europe", "eurasia", "sea", "latam", "mea", "china"], submittedRegionIds: ["europe", "eurasia", "sea", "latam", "mea", "china"], status: PLAN_STATUS.DOMAIN_REVIEW, deadline: "2026-08-31T18:00:00+08:00", demandTotal: 2482, note: "穿戴领域新品收集", version: 1 },
    { id: "PLAN-2608-02", productId: "chitu-b21", regionIds: ["europe", "eurasia", "sea", "latam", "mea"], submittedRegionIds: ["eurasia", "sea", "latam"], status: PLAN_STATUS.COLLECTING, deadline: "2026-09-15T18:00:00+08:00", demandTotal: 1180, note: "B21新品收集", version: 1 },
    { id: "PLAN-2608-03", productId: "chitu-pad-x", regionIds: ["europe", "sea", "latam", "mea"], submittedRegionIds: [], status: PLAN_STATUS.READY_TO_RELEASE, deadline: "2026-09-30T18:00:00+08:00", demandTotal: 0, note: "平板领域新品收集", version: 1 },
    { id: "PLAN-2608-04", productId: "chitu-b23", regionIds: ["europe", "eurasia", "sea", "latam", "mea", "china"], submittedRegionIds: [], status: PLAN_STATUS.PRODUCT_DRAFT, deadline: null, demandTotal: 0, note: "型号与BOM待补充", version: 1 },
  ],
  drafts: {},
  feedbacks: {},
  imports: [{ id: "IMPORT-001", fileName: "TSMP_发货明细_20260828.xlsx", status: "COMPLETED", totalRows: 428, matchedRows: 412, mappingRequiredRows: 12, unmatchedRows: 4, duplicateRows: 0, createdAt: "2026-08-28T15:30:00+08:00" }],
};

const operations = {
  "chitu-b19": [
    { sku: "Chitu-B19F", bom: "111", demand: 727, stocked: 620, applied: 512, shipped: 348, inventory: 176, shipmentCount: 3 },
    { sku: "Chitu-B19W", bom: "222", demand: 915, stocked: 680, applied: 486, shipped: 392, inventory: 228, shipmentCount: 3 },
    { sku: "Chitu-B19FB", bom: "333", demand: 480, stocked: 360, applied: 270, shipped: 210, inventory: 126, shipmentCount: 3 },
    { sku: "Chitu-B19D", bom: "444", demand: 360, stocked: 200, applied: 130, shipped: 90, inventory: 90, shipmentCount: 2 },
  ],
  "chitu-b21": [
    { sku: "Chitu-B21F", bom: "521", demand: 430, stocked: 300, applied: 210, shipped: 150, inventory: 120, shipmentCount: 2 },
    { sku: "Chitu-B21W", bom: "522", demand: 480, stocked: 300, applied: 230, shipped: 160, inventory: 110, shipmentCount: 2 },
    { sku: "Chitu-B21D", bom: "523", demand: 270, stocked: 160, applied: 100, shipped: 70, inventory: 80, shipmentCount: 1 },
  ],
  "chitu-pad-x": [
    { sku: "Chitu-PadX-Pro", bom: "PX01", demand: 380, stocked: 250, applied: 140, shipped: 90, inventory: 95, shipmentCount: 2 },
    { sku: "Chitu-PadX-Air", bom: "PX02", demand: 270, stocked: 170, applied: 90, shipped: 60, inventory: 75, shipmentCount: 1 },
  ],
};

function splitInteger(total, weights) {
  let remaining = total;
  return weights.map((weight, index) => {
    if (index === weights.length - 1) return remaining;
    const value = Math.round(total * weight);
    remaining -= value;
    return value;
  });
}

const regionWeights = [0.36, 0.18, 0.14, 0.12, 0.10, 0.10];
seed.executionRows = Object.entries(operations).flatMap(([productId, skuRows]) => {
  const product = seed.products.find((item) => item.id === productId);
  return skuRows.flatMap((row) => {
    const splitByField = Object.fromEntries(["demand", "stocked", "applied", "shipped", "inventory", "shipmentCount"].map((field) => [field, splitInteger(row[field], regionWeights)]));
    return seed.organizations.map((region, index) => ({
      productId,
      productName: product.name,
      sku: row.sku,
      bom: row.bom,
      regionId: region.id,
      officeId: region.offices[0].id,
      country: region.offices[0].countries[0],
      demand: splitByField.demand[index],
      stocked: splitByField.stocked[index],
      applied: splitByField.applied[index],
      shipped: splitByField.shipped[index],
      inventory: splitByField.inventory[index],
      shipmentCount: splitByField.shipmentCount[index],
    }));
  });
});

const b19Quantities = {
  europe: [307, 405, 170, 109], eurasia: [50, 50, 50, 20], sea: [120, 150, 80, 60],
  latam: [90, 120, 60, 40], mea: [100, 125, 70, 45], china: [80, 90, 50, 41],
};
const b21Quantities = {
  europe: [180, 210, 96], eurasia: [60, 70, 35], sea: [90, 110, 48], latam: [55, 65, 30], mea: [45, 56, 30],
};
for (const [regionId, quantities] of Object.entries(b19Quantities)) {
  seed.drafts[`PLAN-2608-01:${regionId}`] = {
    status: "SUBMITTED", version: 1, submittedAt: "2026-08-28T15:30:00+08:00",
    items: seed.products[0].skus.map((sku, index) => ({ productItemKey: sku.id, quantity: quantities[index], basis: "新品上市体验", plannedUseDate: null, note: "" })),
  };
}
for (const [regionId, quantities] of Object.entries(b21Quantities)) {
  seed.drafts[`PLAN-2608-02:${regionId}`] = {
    status: seed.plans[1].submittedRegionIds.includes(regionId) ? "SUBMITTED" : "DRAFT", version: 1, submittedAt: seed.plans[1].submittedRegionIds.includes(regionId) ? "2026-08-28T15:30:00+08:00" : null,
    items: seed.products[1].skus.map((sku, index) => ({ productItemKey: sku.id, quantity: quantities[index], basis: "新品上市体验", plannedUseDate: null, note: "" })),
  };
}
