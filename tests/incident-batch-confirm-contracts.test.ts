import { describe, expect, it } from 'vitest';
import {
  incidentBatchConfirmInputSchema,
  incidentBatchConfirmResultSchema,
} from '../lib/incidents/batch-confirm-contracts';

const id = (tail: string) => `123e4567-e89b-42d3-a456-${tail.padStart(12, '0')}`;

const acceptedResult = {
  status: 'ACCEPTED',
  batchId: id('1'),
  incidentId: id('2'),
  requestId: id('3'),
  caseCount: 3,
  recipientCount: 2,
  createdAt: '2026-10-10T12:34:56.000Z',
  replayed: false,
};

describe('incident batch confirmation DTOs', () => {
  it('accepts only the opaque preview receipt and preserves its complete value', () => {
    const previewReceipt = 'receipt:opaque:signed-value';

    expect(incidentBatchConfirmInputSchema.parse({ previewReceipt })).toEqual({ previewReceipt });
    expect(incidentBatchConfirmInputSchema.parse({ previewReceipt: 'R'.repeat(200000) }).previewReceipt)
      .toHaveLength(200000);
  });

  it.each([
    {},
    { previewReceipt: '' },
    { previewReceipt: 'R'.repeat(200001) },
    { previewReceipt: 'receipt', text: 'substituted message' },
    { previewReceipt: 'receipt', recipientIds: [id('4')] },
    { previewReceipt: 'receipt', requestId: id('5') },
  ])('rejects missing, invalid, oversized, or substituted confirmation input %#', input => {
    expect(incidentBatchConfirmInputSchema.safeParse(input).success).toBe(false);
  });

  it('accepts atomic enqueue acceptance with bounded counts and no delivery claim', () => {
    expect(incidentBatchConfirmResultSchema.parse(acceptedResult)).toEqual(acceptedResult);
    expect(incidentBatchConfirmResultSchema.parse({
      ...acceptedResult,
      caseCount: 100,
      recipientCount: 100,
      replayed: true,
    }).replayed).toBe(true);
  });

  it('normalizes accepted UUIDs to canonical lowercase form', () => {
    const parsed = incidentBatchConfirmResultSchema.parse({
      ...acceptedResult,
      batchId: acceptedResult.batchId.toUpperCase(),
      incidentId: acceptedResult.incidentId.toUpperCase(),
      requestId: acceptedResult.requestId.toUpperCase(),
    });

    expect(parsed.batchId).toBe(acceptedResult.batchId);
    expect(parsed.incidentId).toBe(acceptedResult.incidentId);
    expect(parsed.requestId).toBe(acceptedResult.requestId);
  });

  it.each([
    { status: 'QUEUED' },
    { batchId: 'not-a-uuid' },
    { incidentId: 'not-a-uuid' },
    { requestId: 'not-a-uuid' },
    { caseCount: 0 },
    { caseCount: 101 },
    { caseCount: 1.5 },
    { recipientCount: 0 },
    { recipientCount: 101 },
    { recipientCount: 2.5 },
    { caseCount: 1, recipientCount: 2 },
    { createdAt: 'not-a-datetime' },
    { replayed: 'false' },
    { sessionId: id('6') },
    { lineUserId: 'U1234567890' },
  ])('rejects invalid result fields and private identity extras %#', override => {
    expect(incidentBatchConfirmResultSchema.safeParse({ ...acceptedResult, ...override }).success).toBe(false);
  });
});
