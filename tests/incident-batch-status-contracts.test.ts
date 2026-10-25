import { describe, expect, it } from 'vitest';
import {
  incidentBatchRetryInputSchema,
  incidentBatchRetryResultSchema,
  incidentBatchStatusListSchema,
} from '../lib/incidents/batch-status-contracts';

const id = (tail: string) => `123e4567-e89b-42d3-a456-${tail.padStart(12, '0')}`;

const batch = {
  status: 'ACCEPTED',
  batchId: id('1'),
  acceptedAt: '2026-10-10T12:34:56.000Z',
  caseCount: 3,
  recipientCount: 2,
  recipients: [
    { recipientCode: 'R1', ticketCodes: ['CASE-001', 'CASE-002'], deliveryStatus: 'SENT', retryable: false },
    { recipientCode: 'R2', ticketCodes: ['CASE-003'], deliveryStatus: 'DEAD', retryable: true, safeFailureCode: 'TEMPORARY_FAILURE' },
  ],
};

describe('incident batch status and retry DTOs', () => {
  it('accepts distinct recipient delivery states with a complete selected-case partition', () => {
    expect(incidentBatchStatusListSchema.parse({ batches: [batch] })).toEqual({ batches: [batch] });
  });

  it('keeps statuses private and rejects transport, identity, and raw-error fields', () => {
    for (const extra of [
      { sessionId: id('2') },
      { lineSessionId: id('2') },
      { lineUserId: 'U1234567890' },
      { outboxId: id('3') },
      { lineRetryKey: id('4') },
      { rawError: 'LINE request body' },
    ]) {
      const invalid = { batches: [{ ...batch, recipients: [{ ...batch.recipients[0], ...extra }, batch.recipients[1]] }] };
      expect(incidentBatchStatusListSchema.safeParse(invalid).success).toBe(false);
    }
  });

  it.each([
    { status: 'SENT' },
    { batchId: 'not-a-uuid' },
    { acceptedAt: 'not-a-datetime' },
    { caseCount: 0 },
    { caseCount: 101 },
    { recipientCount: 0 },
    { recipientCount: 101 },
    { caseCount: 1, recipientCount: 2 },
    { recipientCount: 1 },
    { caseCount: 2 },
    { batchId: batch.batchId, recipients: batch.recipients.slice(0, 1) },
  ])('rejects invalid batch shape, status, or counts %#', override => {
    expect(incidentBatchStatusListSchema.safeParse({ batches: [{ ...batch, ...override }] }).success).toBe(false);
  });

  it('rejects duplicate batch IDs, duplicate recipient codes, and duplicate or incomplete ticket partitions', () => {
    expect(incidentBatchStatusListSchema.safeParse({ batches: [batch, batch] }).success).toBe(false);
    const duplicateRecipient = { ...batch, recipients: [batch.recipients[0], { ...batch.recipients[1], recipientCode: 'R1' }] };
    expect(incidentBatchStatusListSchema.safeParse({ batches: [duplicateRecipient] }).success).toBe(false);
    const duplicateCase = { ...batch, recipients: [batch.recipients[0], { ...batch.recipients[1], ticketCodes: ['CASE-002'] }] };
    expect(incidentBatchStatusListSchema.safeParse({ batches: [duplicateCase] }).success).toBe(false);
    const invalidRecipientCount = { ...batch, recipientCount: 1 };
    expect(incidentBatchStatusListSchema.safeParse({ batches: [invalidRecipientCount] }).success).toBe(false);
  });

  it('allows retryable only for definite failed delivery and validates safe failure codes', () => {
    for (const deliveryStatus of ['PENDING', 'PROCESSING', 'SENT', 'SUPPRESSED', 'UNKNOWN']) {
      const invalid = { ...batch, recipients: [{ ...batch.recipients[0], deliveryStatus, retryable: true }] };
      expect(incidentBatchStatusListSchema.safeParse({ batches: [invalid] }).success).toBe(false);
    }
    const invalidErrorCode = { ...batch, recipients: [{ ...batch.recipients[1], safeFailureCode: 'RAW_PROVIDER_ERROR' }] };
    expect(incidentBatchStatusListSchema.safeParse({ batches: [invalidErrorCode] }).success).toBe(false);
  });

  it('caps the status response to 25 batches and enforces bounded ticket codes and recipients', () => {
    const manyBatches = Array.from({ length: 26 }, (_, index) => ({ ...batch, batchId: id(String(index + 1)) }));
    expect(incidentBatchStatusListSchema.safeParse({ batches: manyBatches }).success).toBe(false);
    const longCode = { ...batch, recipients: [{ ...batch.recipients[0], ticketCodes: ['C'.repeat(101)] }] };
    expect(incidentBatchStatusListSchema.safeParse({ batches: [longCode] }).success).toBe(false);
    const tooManyRecipients = {
      ...batch,
      caseCount: 100,
      recipientCount: 1,
      recipients: [{ recipientCode: 'R1', ticketCodes: Array.from({ length: 100 }, (_, index) => `CASE-${index}`), deliveryStatus: 'PENDING', retryable: false }],
    };
    expect(incidentBatchStatusListSchema.safeParse({ batches: [tooManyRecipients] }).success).toBe(true);
  });

  it('accepts an explicit unique retry selection and an enqueue-acceptance result', () => {
    const input = { requestId: id('5'), recipientCodes: ['R2'] };
    expect(incidentBatchRetryInputSchema.parse(input)).toEqual(input);
    const result = { status: 'RETRY_ACCEPTED', batchId: id('1'), requestId: id('5'), recipientCodes: ['R2'], replayed: false };
    expect(incidentBatchRetryResultSchema.parse(result)).toEqual(result);
  });

  it('normalizes public UUIDs to lowercase and rejects invalid retry DTO fields', () => {
    const statusList = incidentBatchStatusListSchema.parse({ batches: [{ ...batch, batchId: batch.batchId.toUpperCase() }] });
    expect(statusList.batches[0].batchId).toBe(batch.batchId);
    expect(incidentBatchRetryInputSchema.parse({ requestId: id('5').toUpperCase(), recipientCodes: ['R2'] }).requestId).toBe(id('5'));
    const parsed = incidentBatchRetryResultSchema.parse({
      status: 'RETRY_ACCEPTED', batchId: id('1').toUpperCase(), requestId: id('5').toUpperCase(), recipientCodes: ['R2'], replayed: true,
    });
    expect(parsed.batchId).toBe(id('1'));
    expect(parsed.requestId).toBe(id('5'));

    for (const invalid of [
      {},
      { requestId: id('5'), recipientCodes: [] },
      { requestId: id('5'), recipientCodes: ['R1', 'R1'] },
      { requestId: id('5'), recipientCodes: Array.from({ length: 101 }, (_, index) => `R${index + 1}`) },
      { requestId: id('5'), recipientCodes: ['R101'] },
      { requestId: 'bad', recipientCodes: ['R1'] },
      { requestId: id('5'), recipientCodes: ['R1'], sessionId: id('6') },
    ]) expect(incidentBatchRetryInputSchema.safeParse(invalid).success).toBe(false);

    for (const invalid of [
      { ...parsed, status: 'SENT' },
      { ...parsed, recipientCodes: ['R1', 'R1'] },
      { ...parsed, outboxId: id('7') },
    ]) expect(incidentBatchRetryResultSchema.safeParse(invalid).success).toBe(false);
  });
});
