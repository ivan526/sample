// A country row (including explicit zero) replaces the office pool for the same
// SKU and domain. Keep raw submissions intact; apply this only to effective totals.
export function effectiveDemandItems<T extends Record<string, any>>(items: T[]): T[] {
  const key = (item: T) => JSON.stringify([item.collection_plan_id, item.mss_domain_id, item.region_id, item.office_id,
    item.product_sku_id || item.sku_id || item.provisional_item_key]);
  const detailed = new Set(items.filter((item) => item.country_id).map(key));
  return items.filter((item) => item.country_id || !detailed.has(key(item)));
}
