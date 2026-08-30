import { fromZodError } from 'zod-validation-error';
import { ValidationError } from '../../shared/errors.js';
import { inventoryRepository } from './repository.js';
import { InventoryCheckSchema, InventoryQuerySchema } from './schemas.js';
import { ROLES } from '../../shared/types.js';

export const inventoryService = {
  async list(input: unknown, actor: { role: ROLES; userId: string }) {
    const parsed = InventoryQuerySchema.safeParse(input);
    if (!parsed.success) throw new ValidationError(fromZodError(parsed.error).message);
    return inventoryRepository.list({ ...parsed.data, onlyDiff: Boolean(parsed.data.onlyDiff) }, actor);
  },
  async check(id: string, input: unknown, actor: { role: ROLES; userId: string }) {
    const parsed = InventoryCheckSchema.safeParse(input);
    if (!parsed.success) throw new ValidationError(fromZodError(parsed.error).message);
    return inventoryRepository.check(id, parsed.data, actor);
  },
};
