import { fromZodError } from 'zod-validation-error';
import { ValidationError } from '../../shared/errors.js';
import { inventoryRepository } from './repository.js';
import { InventoryCheckSchema, InventoryQuerySchema } from './schemas.js';

export const inventoryService = {
  async list(input: unknown) {
    const parsed = InventoryQuerySchema.safeParse(input);
    if (!parsed.success) throw new ValidationError(fromZodError(parsed.error).message);
    return inventoryRepository.list({ ...parsed.data, onlyDiff: Boolean(parsed.data.onlyDiff) });
  },
  async check(id: string, input: unknown, userId: string) {
    const parsed = InventoryCheckSchema.safeParse(input);
    if (!parsed.success) throw new ValidationError(fromZodError(parsed.error).message);
    return inventoryRepository.check(id, parsed.data, userId);
  },
};
