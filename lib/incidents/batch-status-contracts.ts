import { z } from 'zod';

const uuid = z.uuid().transform(value => value.toLowerCase());
const recipientCode = z.string().regex(/^R(?:[1-9]|[1-9]\d|100)$/u);
const deliveryStatus = z.enum(['PENDING', 'PROCESSING', 'SENT', 'DEAD', 'SUPPRESSED', 'UNKNOWN']);
const safeFailureCode = z.enum(['TEMPORARY_FAILURE', 'ACCESS_CHANGED', 'DELIVERY_UNCERTAIN', 'DELIVERY_FAILED']);

const incidentBatchStatusRecipientSchema = z.strictObject({
  recipientCode,
  ticketCodes: z.array(z.string().min(1).max(100)).min(1).max(100),
  deliveryStatus,
  retryable: z.boolean(),
  safeFailureCode: safeFailureCode.optional(),
}).superRefine((recipient, context) => {
  if (recipient.retryable && recipient.deliveryStatus !== 'DEAD') {
    context.addIssue({ code: 'custom', message: 'INCIDENT_BATCH_RETRY_STATE_INVALID' });
  }
});

const incidentBatchStatusSchema = z.strictObject({
  status: z.literal('ACCEPTED'),
  batchId: uuid,
  acceptedAt: z.iso.datetime(),
  caseCount: z.number().int().min(1).max(100),
  recipientCount: z.number().int().min(1).max(100),
  recipients: z.array(incidentBatchStatusRecipientSchema).min(1).max(100),
}).superRefine((batch, context) => {
  const recipientCodes = batch.recipients.map(recipient => recipient.recipientCode);
  const ticketCodes = batch.recipients.flatMap(recipient => recipient.ticketCodes);
  if (batch.recipientCount !== batch.recipients.length
    || batch.recipientCount > batch.caseCount
    || new Set(recipientCodes).size !== recipientCodes.length
    || ticketCodes.length !== batch.caseCount
    || new Set(ticketCodes).size !== ticketCodes.length) {
    context.addIssue({ code: 'custom', message: 'INCIDENT_BATCH_STATUS_PARTITION_INVALID' });
  }
});

export const incidentBatchStatusListSchema = z.strictObject({
  batches: z.array(incidentBatchStatusSchema).max(25),
}).superRefine((list, context) => {
  const ids = list.batches.map(batch => batch.batchId);
  if (new Set(ids).size !== ids.length) {
    context.addIssue({ code: 'custom', message: 'INCIDENT_BATCH_STATUS_DUPLICATE_BATCH' });
  }
});

export type IncidentBatchStatusList = z.infer<typeof incidentBatchStatusListSchema>;

export const incidentBatchRetryInputSchema = z.strictObject({
  requestId: uuid,
  recipientCodes: z.array(recipientCode).min(1).max(100).refine(codes => new Set(codes).size === codes.length),
});

export type IncidentBatchRetryInput = z.infer<typeof incidentBatchRetryInputSchema>;

export const incidentBatchRetryResultSchema = z.strictObject({
  status: z.literal('RETRY_ACCEPTED'),
  batchId: uuid,
  requestId: uuid,
  recipientCodes: z.array(recipientCode).min(1).max(100).refine(codes => new Set(codes).size === codes.length),
  replayed: z.boolean(),
});

export type IncidentBatchRetryResult = z.infer<typeof incidentBatchRetryResultSchema>;
