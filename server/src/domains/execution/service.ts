import { executionRepository, ImportJob, ExecutionView } from './repository.js';
import { ImportRequestSchema, ExecutionQuerySchema } from './schemas.js';
import { ValidationError } from '../../shared/errors.js';
import { fromZodError } from 'zod-validation-error';

export const executionService = {
  async importTsmpData(input: unknown, userId: string): Promise<ImportJob> {
    const parsed = ImportRequestSchema.safeParse(input);
    if (!parsed.success) {
      throw new ValidationError(fromZodError(parsed.error).message);
    }
    return executionRepository.importTsmpData(parsed.data, userId);
  },

  async getExecutionView(filters: unknown): Promise<ExecutionView> {
    const parsed = ExecutionQuerySchema.safeParse(filters);
    if (!parsed.success) {
      throw new ValidationError(fromZodError(parsed.error).message);
    }
    return executionRepository.getExecutionView(parsed.data);
  },

  async getLatestImportJobs(limit: number = 5): Promise<ImportJob[]> {
    return executionRepository.getLatestImportJobs(limit);
  }
};
