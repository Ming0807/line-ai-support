import { z } from 'zod';
import { incidentReplySelectionSchema } from './batch-reply-contracts';

const canonicalUuidSchema = z.uuid().refine(value => value === value.toLowerCase());

export const incidentBatchDraftSchema = z.discriminatedUnion('status', [
  z.strictObject({ status: z.literal('EMPTY') }),
  z.strictObject({
    status: z.literal('AVAILABLE'),
    batchId: canonicalUuidSchema,
    acceptedAt: z.iso.datetime(),
    text: incidentReplySelectionSchema.shape.text,
  }),
]);

export type IncidentBatchDraft = z.infer<typeof incidentBatchDraftSchema>;
