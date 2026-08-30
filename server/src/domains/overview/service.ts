import { executionRepository } from '../execution/repository.js';
import { query } from '../../config/db.js';

export interface OverviewData {
  productId: string;
  metrics: {
    confirmedDemand: number;
    productionScheduled: number;
    tsmpApplied: number;
    tsmpShipped: number;
    availableInventory: number;
  };
  process: Array<{
    code: string;
    label: string;
    value: number;
    unit: string;
    state: 'done' | 'current' | 'pending';
  }>;
  rows: Array<{
    type: 'product' | 'sku';
    name: string;
    meta: string;
    demand: number;
    stocked: number;
    applied: number;
    available: number;
    shipped: number;
    progress: number;
    status: '待推进' | '需关注' | '执行中';
  }>;
  attention: Array<{
    code: string;
    value: number;
    unit: string;
    target: string;
  }>;
}

export const overviewService = {
  async getOverview(productId: string = 'all', actor?: { role: string; userId: string }): Promise<OverviewData> {
    // 复用执行聚合服务
    const executionView = await executionRepository.getExecutionView({
      productId,
      regionId: '',
      officeId: '',
      country: '',
      keyword: '',
    }, actor);

    const productionScheduled = executionView.metrics.stocked;
    const availableInventory = executionView.products.reduce((sum, product) => sum + product.metrics.inventory, 0);

    const metrics = {
      confirmedDemand: executionView.metrics.demand,
      productionScheduled,
      tsmpApplied: executionView.metrics.applied,
      tsmpShipped: executionView.metrics.shipped,
      availableInventory,
    };

    // 流程节点
    const enabledProducts = executionView.products.length;
    const process = [
      { code: 'PRODUCT', label: '新品建档', value: enabledProducts, unit: '个项目', state: 'done' as const },
      { code: 'DEMAND', label: '需求收集', value: metrics.confirmedDemand, unit: 'Pcs', state: 'done' as const },
      { code: 'PRODUCTION', label: '产品线排产', value: metrics.productionScheduled, unit: 'Pcs', state: 'current' as const },
      { code: 'SHIPMENT', label: 'TSMP发货', value: metrics.tsmpShipped, unit: 'Pcs', state: 'current' as const },
      { code: 'MATCH', label: '执行匹配', value: metrics.tsmpShipped, unit: 'Pcs', state: 'pending' as const },
    ];

    // 产品/SKU行
    const rows: OverviewData['rows'] = [];
    for (const product of executionView.products) {
      if (productId !== 'all') {
        // 单产品看SKU
        for (const sku of product.skus) {
          const progress = sku.demand > 0 ? Math.round((sku.applied / sku.demand) * 100) : 0;
          const status: OverviewData['rows'][number]['status'] = progress < 45 ? '待推进' : progress < 60 ? '需关注' : '执行中';
          rows.push({
            type: 'sku' as const,
            name: sku.sku,
            meta: `BOM ${sku.bom}`,
            demand: sku.demand,
            stocked: sku.stocked,
            applied: sku.applied,
            available: sku.inventory,
            shipped: sku.shipped,
            progress,
            status,
          });
        }
        continue;
      }
      // 全产品看产品
      const progress = product.metrics.demand > 0 ? Math.round((product.metrics.applied / product.metrics.demand) * 100) : 0;
      const status: OverviewData['rows'][number]['status'] = progress < 45 ? '待推进' : progress < 60 ? '需关注' : '执行中';
      rows.push({
        type: 'product' as const,
        name: product.name,
        meta: `${product.domain} · ${product.stage} · ${product.skuCount}个SKU`,
        demand: product.metrics.demand,
        stocked: product.metrics.stocked,
        applied: product.metrics.applied,
        available: product.metrics.inventory,
        shipped: product.metrics.shipped,
        progress,
        status,
      });
    }

    // 需关注项
    const visibleProductIds = executionView.products.map((product) => product.id);
    const inventoryDiffRows = visibleProductIds.length
      ? (await query(`
          SELECT COALESCE(SUM(ABS(actual_quantity - system_quantity)), 0) AS difference
          FROM inventory_balance
          WHERE enabled = true AND product_id IN (${visibleProductIds.map((_, index) => `$${index + 1}`).join(',')})
        `, visibleProductIds)).rows
      : [{ difference: 0 }];
    const attention = [
      { code: 'DEMAND_NOT_APPLIED', value: executionView.metrics.remainingToApply, unit: 'Pcs', target: '执行情况' },
      { code: 'INVENTORY_DIFF', value: Number(inventoryDiffRows[0]?.difference) || 0, unit: 'Pcs', target: '库存核对' },
    ];

    return {
      productId,
      metrics,
      process,
      rows,
      attention,
    };
  }
};
