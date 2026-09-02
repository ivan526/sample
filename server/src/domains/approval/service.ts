import { fromZodError } from 'zod-validation-error';
import { ValidationError } from '../../shared/errors.js';
import { ShipmentApprovalCheckSchema } from './schemas.js';
import { approvalRepository } from './repository.js';

export const approvalService = {
  async check(input: unknown, actor: { role: string; userId: string }) {
    const parsed = ShipmentApprovalCheckSchema.safeParse(input);
    if (!parsed.success) throw new ValidationError(fromZodError(parsed.error).message);
    return approvalRepository.check(parsed.data, actor);
  },
};
