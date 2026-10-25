import { z } from 'zod';

const uuid = z.uuid().transform(value => value.toLowerCase());

export const incidentBatchConfirmInputSchema = z.strictObject({
  previewReceipt: z.string().min(1).max(200000),
});

export type IncidentBatchConfirmInput = z.infer<typeof incidentBatchConfirmInputSchema>;

/** ACCEPTED confirms atomic enqueue acceptance; it does not mean delivered or read. */
export const incidentBatchConfirmResultSchema = z.strictObject({
  status: z.literal('ACCEPTED'),
  batchId: uuid,
  incidentId: uuid,
  requestId: uuid,
  caseCount: z.number().int().min(1).max(100),
  recipientCount: z.number().int().min(1).max(100),
  createdAt: z.iso.datetime(),
  replayed: z.boolean(),
}).superRefine((result, context) => {
  if (result.recipientCount > result.caseCount) {
    context.addIssue({ code: 'custom', message: 'INCIDENT_BATCH_RECIPIENT_COUNT_INVALID' });
  }
});

export type IncidentBatchConfirmResult = z.infer<typeof incidentBatchConfirmResultSchema>;
