import {z} from 'zod';
import {serviceTranscriptionSchema} from './public-service-transcription-contract';

/** Browser-safe explicit review choices. Source/revision binding is the encrypted review receipt. */
const reason=z.string().min(1).max(500).refine(v=>v.trim()===v&&!/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/u.test(v)).nullable();
export const publicSourceReviewSchema=z.object({
 transcription:serviceTranscriptionSchema.optional(),
 temporalBasis:z.enum(['DATED','CURRENT_REVIEWED']),temporalReason:reason,
 sensitivityAdjudications:z.array(z.object({
  category:z.enum(['GRADES','STUDENT_RECORDS','PHONE']),
  basis:z.enum(['GENERAL_POLICY_WORDING','PUBLIC_BLANK_TEMPLATE','INSTITUTIONAL_CONTACT']),reason,
 }).strict()).max(3).refine(rows=>new Set(rows.map(r=>r.category)).size===rows.length),
 extractionAdjudications:z.array(z.object({warningKey:z.string().regex(/^[a-f0-9]{64}$/u),basis:z.literal('REVIEWED_NON_TABULAR_DIAGRAM'),reason}).strict()).max(1000)
  .refine(rows=>new Set(rows.map(r=>r.warningKey)).size===rows.length).optional(),
}).strict();
export type PublicSourceReview=z.infer<typeof publicSourceReviewSchema>;
