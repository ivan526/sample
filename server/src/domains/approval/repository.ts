import { query } from '../../config/db.js';
import { ForbiddenError, ValidationError } from '../../shared/errors.js';
import { ROLES } from '../../shared/types.js';
import type { ShipmentApprovalCheckInput } from './schemas.js';

export const approvalRepository = {
  async check(input: ShipmentApprovalCheckInput, actor: { role: string; userId: string }) {
    const { rows: matches } = await query<any>(`
      SELECT ps.id as sku_id, ps.model, ps.bom_code, p.id as product_id, p.name as product_name,
        pd.stocking_owner_id, r.id as region_id, r.name as region_name, o.id as office_id, o.name as office_name
      FROM product_sku ps
      JOIN product p ON ps.product_id = p.id
      JOIN product_domain pd ON p.domain_id = pd.id
      JOIN org_node r ON (r.id = $2 OR r.name = $2) AND r.node_type = 'REGION'
      JOIN org_node o ON (o.id = $3 OR o.name = $3) AND o.node_type = 'OFFICE' AND o.parent_id = r.id
      WHERE ps.enabled = true AND p.enabled = true AND (ps.id = $1 OR ps.model = $1 OR ps.bom_code = $1)
      LIMIT 1
    `, [input.sku, input.region, input.office]);
    if (matches.length === 0) throw new ValidationError('未找到匹配的产品型号、区域或代表处，请检查主数据');
    const match = matches[0];
    if (actor.role !== ROLES.ADMIN && (actor.role !== ROLES.STOCKING_OWNER || match.stocking_owner_id !== actor.userId)) {
      throw new ForbiddenError('只能核对自己负责产品品类的发货申请');
    }

    const { rows: facts } = await query<any>(`
      SELECT
        COALESCE(SUM(CASE WHEN source_type = 'CONFIRMED_DEMAND' THEN quantity ELSE 0 END), 0) as confirmed_demand,
        COALESCE(SUM(CASE WHEN source_type = 'APPLICATION' THEN quantity ELSE 0 END), 0) as applied_quantity,
        COALESCE(SUM(CASE WHEN source_type = 'SHIPMENT' THEN quantity ELSE 0 END), 0) as shipped_quantity
      FROM execution_fact
      WHERE product_sku_id = $1 AND region_id = $2 AND office_id = $3
    `, [match.sku_id, match.region_id, match.office_id]);
    const { rows: inventoryRows } = await query<any>(`
      SELECT COALESCE(SUM(available_quantity), 0) as available_inventory
      FROM inventory_balance WHERE product_sku_id = $1
    `, [match.sku_id]);

    const confirmedDemand = Number(facts[0].confirmed_demand) || 0;
    const appliedQuantity = Number(facts[0].applied_quantity) || 0;
    const shippedQuantity = Number(facts[0].shipped_quantity) || 0;
    const availableInventory = Number(inventoryRows[0].available_inventory) || 0;
    const remainingDemand = Math.max(0, confirmedDemand - appliedQuantity);
    let verdict = 'PASS';
    let message = '需求额度与库存均满足，可在TSMP继续审批';
    if (confirmedDemand === 0) {
      verdict = 'NO_CONFIRMED_DEMAND';
      message = '未找到该SKU、区域和代表处的正式确认需求';
    } else if (input.requestedQuantity > remainingDemand) {
      verdict = 'EXCEEDS_DEMAND';
      message = '本次申请超过剩余确认需求额度';
    } else if (input.requestedQuantity > availableInventory) {
      verdict = 'INSUFFICIENT_INVENTORY';
      message = '需求额度满足，但当前可用库存不足';
    }

    return {
      applicationNo: input.applicationNo,
      applicant: input.applicant,
      product: { id: match.product_id, name: match.product_name },
      sku: { id: match.sku_id, model: match.model, bomCode: match.bom_code || '' },
      scope: { regionId: match.region_id, regionName: match.region_name, officeId: match.office_id, officeName: match.office_name },
      requestedQuantity: input.requestedQuantity,
      confirmedDemand,
      appliedQuantity,
      shippedQuantity,
      remainingDemand,
      availableInventory,
      verdict,
      message,
      checkedAt: new Date().toISOString(),
    };
  },
};
