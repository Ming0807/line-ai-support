import {z} from 'zod';
export const modelAssistanceRequestSchema=z.strictObject({expectedJobRevision:z.number().int().positive(),expectedExtractionRevision:z.number().int().positive(),externalProcessingConfirmed:z.literal(true)});
export const modelSuggestionSchema=z.strictObject({field:z.enum(['title','familyCode','departmentCode','documentType','versionName','academicYear']),value:z.string().trim().min(1).max(500),segmentId:z.string().regex(/^p[1-9][0-9]{0,3}$/u),quote:z.string().trim().min(1).max(500)});
export const modelSuggestionsSchema=z.strictObject({suggestions:z.array(modelSuggestionSchema).max(6)});
export type ImportModelSuggestion=z.infer<typeof modelSuggestionSchema>;
export const modelAssistanceResultSchema=z.strictObject({jobId:z.uuid(),jobRevision:z.number().int().positive(),extractionRevision:z.number().int().positive(),suggestions:z.array(modelSuggestionSchema.extend({pageIndex:z.number().int().nonnegative()})).max(6),omittedPages:z.number().int().nonnegative()});
export type ImportModelResult=z.infer<typeof modelAssistanceResultSchema>;
