import { z } from 'zod';
import { modelTypeSchema } from './model';

export const globalPreferencesSchema = z.object({
  PK: z.literal('global-config'),
  SK: z.literal('general'),
  modelOverride: modelTypeSchema.default('opus4.5'),
  enableLinkInPr: z.boolean().default(false),
  updatedAt: z.number().default(0),
});

export const updateGlobalPreferenceSchema = z.object({
  modelOverride: modelTypeSchema.optional(),
  enableLinkInPr: z.boolean().optional(),
});

export type GlobalPreferences = z.infer<typeof globalPreferencesSchema>;
