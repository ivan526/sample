import { collectionRepository, CollectionPlan, DemandDraft } from './repository.js';
import { CreatePlanSchema, DraftSaveSchema, DomainFeedbackSchema } from './schemas.js';
import { ValidationError, ForbiddenError } from '../../shared/errors.js';
import { fromZodError } from 'zod-validation-error';
import { ROLES } from '../../shared/types.js';

export const collectionService = {
  async listPlans(role: string, userId: string, keyword?: string, status?: string, productId?: string, regionId?: string): Promise<CollectionPlan[]> {
    return collectionRepository.listPlans(role, userId, keyword, status, productId, regionId);
  },

  async getPlan(planId: string): Promise<CollectionPlan | null> {
    return collectionRepository.getPlan(planId);
  },

  async createPlan(input: unknown, userId: string): Promise<CollectionPlan> {
    const parsed = CreatePlanSchema.safeParse(input);
    if (!parsed.success) {
      throw new ValidationError(fromZodError(parsed.error).message);
    }
    return collectionRepository.createPlan(parsed.data, userId);
  },

  async releasePlan(planId: string, userId: string, version?: number): Promise<CollectionPlan> {
    return collectionRepository.releasePlan(planId, userId, version);
  },

  async saveDraft(planId: string, regionId: string, input: unknown, userId: string): Promise<DemandDraft> {
    const parsed = DraftSaveSchema.safeParse(input);
    if (!parsed.success) {
      throw new ValidationError(fromZodError(parsed.error).message);
    }
    return collectionRepository.saveDraft(planId, regionId, parsed.data, userId);
  },

  async submitRegion(planId: string, regionId: string, userId: string, version?: number): Promise<CollectionPlan> {
    return collectionRepository.submitRegion(planId, regionId, userId, version);
  },

  async submitDomainFeedback(planId: string, input: unknown, userId: string): Promise<CollectionPlan> {
    const parsed = DomainFeedbackSchema.safeParse(input);
    if (!parsed.success) {
      throw new ValidationError(fromZodError(parsed.error).message);
    }
    return collectionRepository.submitDomainFeedback(planId, parsed.data, userId);
  },

  async createExport(planId: string, userId: string) {
    return collectionRepository.createExport(planId, userId);
  },

  async getDraft(planId: string, regionId: string): Promise<DemandDraft | null> {
    return collectionRepository.getDraft(planId, regionId);
  }
};
