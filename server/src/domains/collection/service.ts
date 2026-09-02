import { collectionRepository, CollectionPlan, DemandDraft } from './repository.js';
import { CreatePlanSchema, DraftSaveSchema, DomainFeedbackSchema } from './schemas.js';
import { ValidationError, ForbiddenError } from '../../shared/errors.js';
import { fromZodError } from 'zod-validation-error';
import { ROLES } from '../../shared/types.js';

export const collectionService = {
  async listPlans(role: string, userId: string, keyword?: string, status?: string, productId?: string, regionId?: string): Promise<CollectionPlan[]> {
    return collectionRepository.listPlans(role, userId, keyword, status, productId, regionId);
  },

  async getPlan(planId: string, role: string, userId: string): Promise<CollectionPlan | null> {
    return collectionRepository.getPlan(planId, role, userId);
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

  async saveDraft(planId: string, regionId: string, input: unknown, userId: string, role: string): Promise<DemandDraft> {
    const parsed = DraftSaveSchema.safeParse(input);
    if (!parsed.success) {
      throw new ValidationError(fromZodError(parsed.error).message);
    }
    return collectionRepository.saveDraft(planId, regionId, parsed.data, userId, role);
  },

  async submitRegion(planId: string, regionId: string, userId: string, role: string, version?: number): Promise<CollectionPlan> {
    return collectionRepository.submitRegion(planId, regionId, userId, role, version);
  },

  async returnRegion(planId: string, regionId: string, input: any, userId: string, role: string): Promise<CollectionPlan> {
    if (!input?.reason?.trim()) throw new ValidationError('退回原因不能为空');
    return collectionRepository.returnRegion(planId, regionId, input.reason.trim(), userId, role, input.version);
  },

  async submitDomainFeedback(planId: string, input: unknown, userId: string, role: string): Promise<CollectionPlan> {
    const parsed = DomainFeedbackSchema.safeParse(input);
    if (!parsed.success) {
      throw new ValidationError(fromZodError(parsed.error).message);
    }
    return collectionRepository.submitDomainFeedback(planId, parsed.data, userId, role);
  },

  async createExport(planId: string, userId: string, role: string) {
    return collectionRepository.createExport(planId, userId, role);
  },

  async getDraft(planId: string, regionId: string, userId: string, role: string): Promise<DemandDraft | null> {
    return collectionRepository.getDraft(planId, regionId, userId, role);
  }
};
