import crypto from 'node:crypto';
import { getClient, query } from '../../config/db.js';
import { ForbiddenError, NotFoundError, ValidationError } from '../../shared/errors.js';
import { ROLES } from '../../shared/types.js';

function mapRow(row: any) {
  const system = Number(row.system_quantity) || 0;
  const actual = Number(row.actual_quantity) || 0;
  return {
    id: row.id,
    productId: row.product_id,
    productName: row.product_name,
    domain: row.domain_name,
    skuId: row.product_sku_id,
    sku: row.sku_model,
    bom: row.bom_code || '待补充',
    warehouse: row.warehouse,
    system,
    actual,
    locked: Number(row.locked_quantity) || 0,
    available: Number(row.available_quantity) || 0,
    difference: actual - system,
    reason: row.reason || '',
    checkedBy: row.checked_by_name || '',
    updated: row.checked_at || row.updated_at,
    status: actual === system ? '已核对' : row.reason ? '已说明' : '有差异',
    version: Number(row.version),
  };
}

const selectSql = `
  SELECT ib.*, p.name AS product_name, ps.model AS sku_model, ps.bom_code,
         pd.name AS domain_name, au.display_name AS checked_by_name
  FROM inventory_balance ib
  JOIN product p ON p.id = ib.product_id
  JOIN product_sku ps ON ps.id = ib.product_sku_id
  JOIN product_domain pd ON pd.id = p.domain_id
  LEFT JOIN app_user au ON au.id = ib.checked_by
`;

export const inventoryRepository = {
  async list(filters: { productId: string; keyword: string; onlyDiff: boolean }, actor: { role: ROLES; userId: string }) {
    const conditions = ['ib.enabled = true'];
    const params: any[] = [];
    // 备货负责人仅能看到自己负责领域的库存
    if (actor.role === ROLES.STOCKING_OWNER) {
      params.push(actor.userId);
      conditions.push(`pd.stocking_owner_id = $${params.length}`);
    }
    if (filters.productId !== 'all') { params.push(filters.productId); conditions.push(`ib.product_id = $${params.length}`); }
    if (filters.onlyDiff) conditions.push('ib.system_quantity <> ib.actual_quantity');
    if (filters.keyword) {
      params.push(`%${filters.keyword}%`);
      conditions.push(`(p.name ILIKE $${params.length} OR pd.name ILIKE $${params.length} OR ps.model ILIKE $${params.length} OR ps.bom_code ILIKE $${params.length} OR ib.warehouse ILIKE $${params.length})`);
    }
    const { rows } = await query(`${selectSql} WHERE ${conditions.join(' AND ')} ORDER BY p.name, ps.model, ib.warehouse`, params);
    const items = rows.map(mapRow);
    return {
      items,
      metrics: items.reduce((sum, item) => ({
        system: sum.system + item.system,
        actual: sum.actual + item.actual,
        locked: sum.locked + item.locked,
        available: sum.available + item.available,
        difference: sum.difference + Math.abs(item.difference),
        differenceRows: sum.differenceRows + (item.difference ? 1 : 0),
      }), { system: 0, actual: 0, locked: 0, available: 0, difference: 0, differenceRows: 0 }),
    };
  },

  async check(id: string, input: { actualQuantity: number; reason: string; version: number }, actor: { role: ROLES; userId: string }) {
    const client = await getClient();
    try {
      await client.query('BEGIN');
      const { rows: beforeRows } = await client.query(`
        ${selectSql}, pd.stocking_owner_id
        WHERE ib.id = $1
      `, [id]);
      if (!beforeRows.length) throw new NotFoundError('库存记录不存在');
      const before = mapRow(beforeRows[0]);
      // 非管理员只能核对自己负责领域的库存
      if (actor.role !== ROLES.ADMIN && beforeRows[0].stocking_owner_id !== actor.userId) {
        throw new ForbiddenError('无权核对其他领域的库存');
      }
      const available = Math.max(0, input.actualQuantity - before.locked);
      const result = await client.query(`
        UPDATE inventory_balance SET actual_quantity = $1, available_quantity = $2, reason = $3,
          checked_by = $4, checked_at = NOW(), updated_at = NOW(), version = version + 1
        WHERE id = $5 AND version = $6
      `, [input.actualQuantity, available, input.reason, actor.userId, id, input.version]);
      if (!result.rowCount) throw new ValidationError('库存记录已被他人更新，请刷新后重试');

      await client.query("DELETE FROM execution_fact WHERE source_type = 'INVENTORY' AND product_sku_id = $1", [before.skuId]);
      const { rows: balances } = await client.query('SELECT id, product_id, product_sku_id, warehouse, available_quantity FROM inventory_balance WHERE product_sku_id = $1 AND enabled = true', [before.skuId]);
      for (const balance of balances) {
        await client.query(`INSERT INTO execution_fact (id, source_type, source_id, product_id, product_sku_id, quantity, occurred_at, dimension_snapshot)
          VALUES ($1, 'INVENTORY', $2, $3, $4, $5, NOW(), $6)`, [crypto.randomUUID(), balance.id, balance.product_id, balance.product_sku_id, balance.available_quantity, JSON.stringify({ warehouse: balance.warehouse })]);
      }
      await client.query(`INSERT INTO audit_log (id, actor_id, action, entity_type, entity_id, before_data, after_data)
        VALUES ($1, $2, 'CHECK_INVENTORY', 'INVENTORY_BALANCE', $3, $4, $5)`, [crypto.randomUUID(), actor.userId, id, JSON.stringify(before), JSON.stringify({ actualQuantity: input.actualQuantity, availableQuantity: available, reason: input.reason })]);
      const { rows: afterRows } = await client.query(`${selectSql} WHERE ib.id = $1`, [id]);
      await client.query('COMMIT');
      return mapRow(afterRows[0]);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  },
};
