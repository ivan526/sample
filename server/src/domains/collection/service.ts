import { collectionRepository, CollectionPlan, DemandDraft, PlanListOptions } from './repository.js';
import { CreatePlanSchema, DraftSaveSchema, DomainDispatchSchema, DomainFeedbackSchema } from './schemas.js';
import { ValidationError, ForbiddenError } from '../../shared/errors.js';
import { fromZodError } from 'zod-validation-error';
import { ROLES } from '../../shared/types.js';

export const collectionService = {
  async listPlans(role: string, userId: string, keyword?: string, status?: string, productId?: string, regionId?: string, options?: PlanListOptions): Promise<CollectionPlan[] | { items: CollectionPlan[]; total: number }> {
    return collectionRepository.listPlans(role, userId, keyword, status, productId, regionId, options);
  },

  async getPlan(planId: string, role: string, userId: string, domainTaskId?: string): Promise<CollectionPlan | null> {
    return collectionRepository.getPlan(planId, role, userId, domainTaskId);
  },

  async createPlan(input: unknown, userId: string, role: string): Promise<CollectionPlan> {
    const parsed = CreatePlanSchema.safeParse(input);
    if (!parsed.success) {
      throw new ValidationError(fromZodError(parsed.error).message);
    }
    return collectionRepository.createPlan(parsed.data, userId, role);
  },

  async releasePlan(planId: string, userId: string, role: string, version?: number): Promise<CollectionPlan> {
    return collectionRepository.releasePlan(planId, userId, role, version);
  },

  async deletePlan(planId: string, userId: string, role: string): Promise<void> {
    return collectionRepository.deletePlan(planId, userId, role);
  },

  async cancelPlan(planId: string, userId: string, role: string): Promise<CollectionPlan> {
    return collectionRepository.cancelPlan(planId, userId, role);
  },

  async archivePlan(planId: string, userId: string, role: string) {
    return collectionRepository.archivePlan(planId, userId, role);
  },

  async dispatchDomainTask(taskId: string, input: unknown, userId: string, role: string): Promise<CollectionPlan> {
    const parsed = DomainDispatchSchema.safeParse(input);
    if (!parsed.success) throw new ValidationError(fromZodError(parsed.error).message);
    return collectionRepository.dispatchDomainTask(taskId, parsed.data, userId, role);
  },

  async saveDraft(planId: string, regionId: string, domainTaskId: string | undefined, input: unknown, userId: string, role: string): Promise<DemandDraft> {
    const parsed = DraftSaveSchema.safeParse(input);
    if (!parsed.success) {
      throw new ValidationError(fromZodError(parsed.error).message);
    }
    return collectionRepository.saveDraft(planId, regionId, domainTaskId, parsed.data, userId, role);
  },

  async submitRegion(planId: string, regionId: string, domainTaskId: string | undefined, userId: string, role: string, version?: number): Promise<CollectionPlan> {
    return collectionRepository.submitRegion(planId, regionId, domainTaskId, userId, role, version);
  },

  async returnRegion(planId: string, regionId: string, domainTaskId: string | undefined, input: any, userId: string, role: string): Promise<CollectionPlan> {
    if (!input?.reason?.trim()) throw new ValidationError('退回原因不能为空');
    return collectionRepository.returnRegion(planId, regionId, domainTaskId, input.reason.trim(), userId, role, input.version);
  },

  async submitDomainFeedback(taskId: string, input: unknown, userId: string, role: string): Promise<CollectionPlan> {
    const parsed = DomainFeedbackSchema.safeParse(input);
    if (!parsed.success) {
      throw new ValidationError(fromZodError(parsed.error).message);
    }
    return collectionRepository.submitDomainFeedback(taskId, parsed.data, userId, role);
  },

  async createExport(planId: string, userId: string, role: string) {
    return collectionRepository.createExport(planId, userId, role);
  },

  async getDraft(planId: string, regionId: string, userId: string, role: string, domainTaskId?: string): Promise<DemandDraft | null> {
    return collectionRepository.getDraft(planId, regionId, userId, role, domainTaskId);
  }
};
