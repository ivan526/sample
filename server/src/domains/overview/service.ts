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
  async getOverview(productId: string = 'all'): Promise<OverviewData> {
    // 复用执行聚合服务
    const executionView = await executionRepository.getExecutionView({
      productId,
      regionId: '',
      officeId: '',
      country: '',
      keyword: '',
    });

    // 获取排产数据（模拟，后续对接产品线接口）
    const productionScheduled = Math.round(executionView.metrics.demand * 0.85);
    // 获取库存数据（模拟，后续对接库存接口）
    const availableInventory = Math.round(executionView.metrics.shipped * 0.3);

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
    const rows = executionView.products.flatMap(product => {
      if (productId !== 'all') {
        // 单产品看SKU
        return product.skus.map(sku => {
          const progress = sku.demand > 0 ? Math.round((sku.applied / sku.demand) * 100) : 0;
          const status = progress < 45 ? '待推进' : progress < 60 ? '需关注' : '执行中';
          return {
            type: 'sku' as const,
            name: sku.sku,
            meta: `BOM ${sku.bom}`,
            demand: sku.demand,
            stocked: Math.round(sku.demand * 0.85),
            applied: sku.applied,
            available: sku.inventory,
            progress,
            status,
          };
        });
      }
      // 全产品看产品
      const progress = product.metrics.demand > 0 ? Math.round((product.metrics.applied / product.metrics.demand) * 100) : 0;
      const status = progress < 45 ? '待推进' : progress < 60 ? '需关注' : '执行中';
      return [{
        type: 'product' as const,
        name: product.name,
        meta: `${product.domain} · ${product.stage} · ${product.skuCount}个SKU`,
        demand: product.metrics.demand,
        stocked: Math.round(product.metrics.demand * 0.85),
        applied: product.metrics.applied,
        available: product.metrics.inventory,
        progress,
        status,
      }];
    });

    // 需关注项
    const attention = [
      { code: 'DEMAND_NOT_APPLIED', value: executionView.metrics.remainingToApply, unit: 'Pcs', target: '执行情况' },
      { code: 'INVENTORY_DIFF', value: Math.round(availableInventory * 0.08), unit: 'Pcs', target: '库存核对' },
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
