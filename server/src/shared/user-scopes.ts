import type { DbClient } from '../config/db.js';

export type ScopeType = 'PRODUCT_DOMAIN' | 'MSS_DOMAIN';
type Reader = Pick<DbClient, 'query'>;

// Expressions are supplied by repository code; all user values remain SQL parameters.
export function scopeExistsSql(type: ScopeType, scopeId: string, userId: string) {
  return `EXISTS (SELECT 1 FROM user_scope_assignment scope_access WHERE scope_access.scope_type = '${type}' AND scope_access.scope_id = ${scopeId} AND scope_access.user_id = ${userId})`;
}

export async function hasUserScope(db: Reader, userId: string, type: ScopeType, scopeId: string) {
  const { rows } = await db.query('SELECT scope_id FROM user_scope_assignment WHERE user_id=$1 AND scope_type=$2 AND scope_id=$3', [userId, type, scopeId]);
  return rows.length > 0;
}

export async function grantUserScope(db: Reader, userId: string | null, type: ScopeType, scopeId: string) {
  if (!userId) return;
  await db.query(`INSERT INTO user_scope_assignment(user_id,scope_type,scope_id) VALUES($1,$2,$3) ON CONFLICT(user_id,scope_type,scope_id) DO NOTHING`, [userId, type, scopeId]);
}
