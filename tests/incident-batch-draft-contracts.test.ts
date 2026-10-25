import { describe, expect, it } from 'vitest';
import { incidentBatchDraftSchema } from '@/lib/incidents/batch-draft-contracts';

const batchId = 'f3cbab47-439d-46e3-9559-9238737bba29';

describe('incident batch draft contract', () => {
  it('accepts exactly the empty state or a complete available proposal', () => {
    expect(incidentBatchDraftSchema.parse({ status: 'EMPTY' })).toEqual({ status: 'EMPTY' });
    expect(incidentBatchDraftSchema.parse({
      status: 'AVAILABLE',
      batchId,
      acceptedAt: '2026-10-10T12:30:00.000Z',
      text: 'เจ้าหน้าที่กำลังตรวจสอบเครือข่าย\nจะแจ้งความคืบหน้าอีกครั้ง',
    })).toEqual({
      status: 'AVAILABLE',
      batchId,
      acceptedAt: '2026-10-10T12:30:00.000Z',
      text: 'เจ้าหน้าที่กำลังตรวจสอบเครือข่าย\nจะแจ้งความคืบหน้าอีกครั้ง',
    });
  });

  it.each([
    { status: 'EMPTY', batchId },
    { status: 'AVAILABLE', batchId, acceptedAt: '2026-10-10T12:30:00.000Z' },
    { status: 'AVAILABLE', batchId: batchId.toUpperCase(), acceptedAt: '2026-10-10T12:30:00.000Z', text: 'อัปเดต' },
    { status: 'AVAILABLE', batchId, acceptedAt: 'not-a-date', text: 'อัปเดต' },
    { status: 'AVAILABLE', batchId, acceptedAt: '2026-10-10T12:30:00.000Z', text: ' ' },
    { status: 'AVAILABLE', batchId, acceptedAt: '2026-10-10T12:30:00.000Z', text: 'x'.repeat(4001) },
    { status: 'AVAILABLE', batchId, acceptedAt: '2026-10-10T12:30:00.000Z', text: 'ซ่อน\u202Eข้อความ' },
    { status: 'AVAILABLE', batchId, acceptedAt: '2026-10-10T12:30:00.000Z', text: 'อัปเดต', ticketIds: [] },
  ])('rejects malformed or non-exact proposal data %#', value => {
    expect(incidentBatchDraftSchema.safeParse(value).success).toBe(false);
  });

  it('accepts the full 4,000-character validated text limit', () => {
    const text = 'ก'.repeat(4000);
    const proposal = incidentBatchDraftSchema.parse({
      status: 'AVAILABLE', batchId, acceptedAt: '2026-10-10T12:30:00.000Z', text,
    });
    expect(proposal.status).toBe('AVAILABLE');
    if (proposal.status !== 'AVAILABLE') throw new Error('Expected an available proposal');
    expect(proposal.text).toBe(text);
  });
});
