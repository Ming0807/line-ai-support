import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactNode } from 'react';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import IncidentBatchReply, {
  incidentBatchApiError,
  incidentBatchDeliveryLabel,
  incidentBatchFailureLabel,
  incidentBatchRecipientCanRetry,
  incidentBatchRetryOperation,
  incidentReplyDraftReducer,
  incidentReplyPreviewMatches,
  incidentReplySelectionIntervention,
  initialIncidentReplyDraft,
} from '@/app/(dashboard)/incidents/IncidentBatchReply';
import IncidentDetailView from '@/app/(dashboard)/incidents/IncidentDetailView';
import { incidentBatchDraftSchema } from '@/lib/incidents/batch-draft-contracts';
import { incidentReplyPreviewSchema } from '@/lib/incidents/batch-reply-contracts';
import type { IncidentReplyOption } from '@/lib/incidents/batch-reply-contracts';
import type { IncidentBatchStatusList } from '@/lib/incidents/batch-status-contracts';

const incidentId = 'f3cbab47-439d-46e3-9559-9238737bba29';
const ticketId = 'bf2ab5c1-9331-46ed-8cc7-39a0e6e4b8af';
const requestId = 'f22d37ad-658b-49f5-a189-f2f84e944e01';
const preparedText = 'อัปเดตเคส: T-2026-0102\n\nเจ้าหน้าที่กำลังตรวจสอบ';
const html = (node: ReactNode) => renderToStaticMarkup(node);

const preview = incidentReplyPreviewSchema.parse({
  status: 'REVIEW_ONLY', incidentId, requestId,
  cases: [{ ticketId, ticketCode: 'T-2026-0102', reporterLabel: 'ผู้รายงาน R1' }],
  caseCount: 1, recipientCount: 1, commonText: 'เจ้าหน้าที่กำลังตรวจสอบ',
  deliveries: [{ recipientCode: 'R1', cases: [{ ticketId, ticketCode: 'T-2026-0102', reporterLabel: 'ผู้รายงาน R1' }], messages: [{ type: 'text', text: preparedText }] }],
  intervention: false, expiresAt: '2026-10-10T12:00:00.000Z', previewReceipt: 'opaque-preview-receipt',
});

describe('incident batch reply UI', () => {
  it('starts with no selected cases and places the shared reply workflow after linked cases', () => {
    expect(initialIncidentReplyDraft.ticketIds).toEqual([]);
    const markup = html(<IncidentDetailView detail={{
      incident: {
        id: incidentId, revision: 4, title: 'ระบบลงทะเบียนตอบสนองช้า', category: 'REGISTRATION',
        departmentLabel: 'งานทะเบียน', status: 'INVESTIGATING', severity: 'HIGH', sensitivity: 'GENERAL',
        reportCount: 6, distinctSessionCount: 5, createdAt: '2026-10-08T01:00:00.000Z', updatedAt: '2026-10-08T02:00:00.000Z',
      },
      canManage: true,
      tickets: [{ id: ticketId, ticketCode: 'T-2026-0102', status: 'WAITING_STAFF', category: 'REGISTRATION' }],
    }} />);
    expect(markup.indexOf('คำร้องที่เชื่อมโยง')).toBeLessThan(markup.indexOf('ตอบกลับเคสที่เลือก'));
    expect(markup).toContain('กำลังโหลดเคสและสิทธิ์ปัจจุบัน');
    expect(markup).toContain('ช่องทางผู้รับนิรนาม');
    expect(markup).not.toContain('5 คน');
    expect(markup).not.toContain('lineUserId');
    expect(markup).not.toContain('sessionId');
  });

  it('keeps the exact selection and text after a failed preview, accepts only the current preview epoch, and clears its receipt on edits', () => {
    let state = { ...initialIncidentReplyDraft, ticketIds: [ticketId], text: 'เจ้าหน้าที่กำลังตรวจสอบ' };
    state = incidentReplyDraftReducer(state, { type: 'PREVIEW_STARTED', epoch: 1 });
    const stale = incidentReplyDraftReducer(state, { type: 'PREVIEW_RECEIVED', epoch: 0, preview });
    expect(stale.preview).toBeNull();

    const failed = incidentReplyDraftReducer(state, { type: 'PREVIEW_FAILED', epoch: 1 });
    expect(failed.ticketIds).toEqual([ticketId]);
    expect(failed.text).toBe('เจ้าหน้าที่กำลังตรวจสอบ');
    expect(failed.preview).toBeNull();

    state = incidentReplyDraftReducer(failed, { type: 'PREVIEW_STARTED', epoch: 2 });
    const reviewed = incidentReplyDraftReducer(state, { type: 'PREVIEW_RECEIVED', epoch: 2, preview });
    expect(reviewed.preview?.previewReceipt).toBe('opaque-preview-receipt');
    const edited = incidentReplyDraftReducer(reviewed, { type: 'TEXT_CHANGED', text: 'มีข้อมูลเพิ่มเติม' });
    expect(edited.preview).toBeNull();
    expect(edited.previewEpoch).toBe(reviewed.previewEpoch + 1);
    expect(edited.ticketIds).toEqual([ticketId]);
    expect(edited.text).toBe('มีข้อมูลเพิ่มเติม');

    const refreshed = incidentReplyDraftReducer(edited, { type: 'RECIPIENTS_CHANGED' });
    expect(refreshed.ticketIds).toEqual([]);
    expect(refreshed.text).toBe('มีข้อมูลเพิ่มเติม');
  });

  it('applies a retained proposal through the normal text edit, preserving selected cases and invalidating the old receipt', () => {
    const proposal = incidentBatchDraftSchema.parse({
      status: 'AVAILABLE', batchId: requestId, acceptedAt: '2026-10-10T12:30:00.000Z',
      text: 'เจ้าหน้าที่กำลังตรวจสอบเครือข่าย',
    });
    if (proposal.status !== 'AVAILABLE') throw new Error('AVAILABLE_PROPOSAL_REQUIRED');
    const reviewed = incidentReplyDraftReducer(
      { ...initialIncidentReplyDraft, ticketIds: [ticketId], text: 'ข้อความปัจจุบัน', preview },
      { type: 'TEXT_CHANGED', text: proposal.text },
    );

    expect(reviewed.ticketIds).toEqual([ticketId]);
    expect(reviewed.text).toBe(proposal.text);
    expect(reviewed.preview).toBeNull();
    expect(reviewed.previewEpoch).toBe(1);
  });

  it('rejects a preview unless incident, request, common text, intervention and selected case set all match', () => {
    const expected = { incidentId, requestId, ticketIds: [ticketId], text: 'เจ้าหน้าที่กำลังตรวจสอบ', intervention: false };
    expect(incidentReplyPreviewMatches(preview, expected)).toBe(true);
    expect(incidentReplyPreviewMatches(preview, { ...expected, incidentId: requestId })).toBe(false);
    expect(incidentReplyPreviewMatches(preview, { ...expected, requestId: incidentId })).toBe(false);
    expect(incidentReplyPreviewMatches(preview, { ...expected, ticketIds: [] })).toBe(false);
    expect(incidentReplyPreviewMatches(preview, { ...expected, intervention: true })).toBe(false);
    expect(incidentReplyPreviewMatches(preview, { ...expected, text: 'ข้อความที่แก้แล้ว' })).toBe(false);
  });

  it('sends intervention only when an explicitly attested selected case requires it', () => {
    const ownCase: IncidentReplyOption = {
      ticketId, ticketCode: 'T-2026-0102', reporterLabel: 'ผู้รายงาน R1', status: 'STAFF_HANDLING',
      eligibility: 'OWN_CASE', pendingUserMessages: 1,
    };
    const otherTicketId = '82b49569-4415-4c73-ae55-0bc6bf50466c';
    const interventionCase: IncidentReplyOption = {
      ...ownCase, ticketId: otherTicketId, ticketCode: 'T-2026-0103', eligibility: 'INTERVENTION_REQUIRED',
    };
    expect(incidentReplySelectionIntervention([ownCase, interventionCase], [ticketId], true)).toBe(false);
    expect(incidentReplySelectionIntervention([ownCase, interventionCase], [otherTicketId], false)).toBe(false);
    expect(incidentReplySelectionIntervention([ownCase, interventionCase], [ticketId, otherTicketId], true)).toBe(true);
  });

  it('reuses an uncertain retry request id and permits retries only for server-marked DEAD recipients', () => {
    const retryable: IncidentBatchStatusList['batches'][number]['recipients'][number] = {
      recipientCode: 'R1', ticketCodes: ['T-2026-0102'], deliveryStatus: 'DEAD', retryable: true,
      safeFailureCode: 'TEMPORARY_FAILURE',
    };
    const sent: IncidentBatchStatusList['batches'][number]['recipients'][number] = {
      recipientCode: 'R2', ticketCodes: ['T-2026-0103'], deliveryStatus: 'SENT', retryable: false,
    };
    const unknown: IncidentBatchStatusList['batches'][number]['recipients'][number] = {
      recipientCode: 'R3', ticketCodes: ['T-2026-0104'], deliveryStatus: 'UNKNOWN', retryable: false,
      safeFailureCode: 'DELIVERY_UNCERTAIN',
    };
    expect(incidentBatchRecipientCanRetry(retryable)).toBe(true);
    expect(incidentBatchRecipientCanRetry(sent)).toBe(false);
    expect(incidentBatchRecipientCanRetry(unknown)).toBe(false);
    expect(incidentBatchDeliveryLabel('SENT')).toBe('LINE รับข้อความแล้ว');
    expect(incidentBatchDeliveryLabel('UNKNOWN')).toBe('ยังไม่ทราบผลการส่ง');
    expect(incidentBatchFailureLabel('ACCESS_CHANGED')).toContain('สิทธิ์หรือสถานะ');

    const existing = { requestId, recipientCodes: ['R1'], pending: false, uncertain: true };
    const createNewId = vi.fn(() => 'new-request-id');
    expect(incidentBatchRetryOperation(existing, 'R1', createNewId)).toBe(existing);
    expect(createNewId).not.toHaveBeenCalled();
    expect(incidentBatchRetryOperation(undefined, 'R2', () => 'new-request-id')).toEqual({
      requestId: 'new-request-id', recipientCodes: ['R2'], pending: false, uncertain: false,
    });
  });

  it('uses fixed Thai errors rather than exposing API response details', () => {
    expect(incidentBatchApiError(409)).toContain('โหลดรายการล่าสุด');
    expect(incidentBatchApiError(503)).toContain('ตรวจผลล่าสุด');
    expect(incidentBatchApiError(503)).not.toContain('LINE');
  });

  it('renders a usable loading and result-refresh boundary without pretending that a preview is sent', () => {
    const markup = html(<IncidentBatchReply incidentId={incidentId} />);
    expect(markup).toContain('ตอบกลับเคสที่เลือก');
    expect(markup).toContain('กำลังโหลดเคสและสิทธิ์ปัจจุบัน');
    expect(markup).toContain('ผลการตอบกลับ');
    expect(markup).toContain('กำลังโหลดผลที่บันทึกไว้');
    expect(markup).toContain('ใช้ข้อความอัปเดตเดิม');
    expect(markup).not.toContain('ยืนยันและเข้าคิวส่งข้อความ');
  });

  it('provides actor-and-incident-scoped recovery storage before enabling confirmation retries', async () => {
    const api = await import('@/app/(dashboard)/incidents/IncidentBatchReply');
    const keyFor = Reflect.get(api, 'incidentBatchRecoveryKey');
    expect(typeof keyFor).toBe('function');
    if (typeof keyFor !== 'function') return;
    expect(Reflect.apply(keyFor, undefined, [requestId, incidentId])).toBe(`yru:incident-batch:${requestId}:${incidentId}`);
    expect(Reflect.apply(keyFor, undefined, [ticketId, incidentId])).not.toBe(`yru:incident-batch:${requestId}:${incidentId}`);
  });

  it('round-trips only opaque confirmation and retry metadata through strict recovery storage', async () => {
    const api = await import('@/app/(dashboard)/incidents/IncidentBatchReply');
    const keyFor = Reflect.get(api, 'incidentBatchRecoveryKey');
    const write = Reflect.get(api, 'writeIncidentBatchRecovery');
    const read = Reflect.get(api, 'readIncidentBatchRecovery');
    expect([keyFor, write, read].every(value => typeof value === 'function')).toBe(true);
    if ([keyFor, write, read].some(value => typeof value !== 'function')) return;

    const key = Reflect.apply(keyFor, undefined, [requestId, incidentId]);
    if (typeof key !== 'string') throw new Error('VALID_RECOVERY_KEY_REQUIRED');
    const values = new Map<string, string>();
    const storage = {
      getItem: (name: string) => values.get(name) ?? null,
      setItem: (name: string, value: string) => { values.set(name, value); },
    };
    const recovery = {
      version: 1,
      pendingConfirmation: {
        previewReceipt: 'encrypted-preview-receipt', requestId, incidentId,
        caseCount: 2, recipientCount: 1, expiresAt: '2026-10-10T12:00:00.000Z',
      },
      pendingRetries: [{ batchId: ticketId, recipientCode: 'R1', requestId: 'b64172e9-12a4-4151-bf4a-3c4a1e7f8c16' }],
    };

    expect(Reflect.apply(write, undefined, [storage, key, recovery])).toBe(true);
    const serialized = values.get(key) ?? '';
    expect(serialized).toContain('encrypted-preview-receipt');
    expect(serialized).not.toMatch(/commonText|reporterLabel|messages|lineUserId|sessionId/u);
    const restored = Reflect.apply(read, undefined, [storage, key]);
    expect(restored).toMatchObject({ ok: true, value: recovery });
    const restoreRetry = Reflect.get(api, 'incidentBatchRetryOperationFromRecovery');
    expect(typeof restoreRetry).toBe('function');
    if (typeof restoreRetry === 'function') {
      expect(Reflect.apply(restoreRetry, undefined, [recovery.pendingRetries[0]])).toEqual({
        requestId: recovery.pendingRetries[0].requestId, recipientCodes: ['R1'], pending: false, uncertain: true,
      });
    }
  });

  it('rejects plaintext or malformed recovery records and handles storage exceptions safely', async () => {
    const api = await import('@/app/(dashboard)/incidents/IncidentBatchReply');
    const write = Reflect.get(api, 'writeIncidentBatchRecovery');
    const read = Reflect.get(api, 'readIncidentBatchRecovery');
    expect([write, read].every(value => typeof value === 'function')).toBe(true);
    if ([write, read].some(value => typeof value !== 'function')) return;
    const key = `yru:incident-batch:${requestId}:${incidentId}`;
    const empty = { version: 1, pendingConfirmation: null, pendingRetries: [] };
    const storage = {
      getItem: () => '{"version":1,"pendingConfirmation":"invalid"}',
      setItem: () => { throw new Error('storage unavailable'); },
    };
    expect(Reflect.apply(read, undefined, [storage, key])).toEqual({ ok: false });
    expect(Reflect.apply(write, undefined, [storage, key, empty])).toBe(false);
    expect(Reflect.apply(write, undefined, [storage, key, {
      ...empty,
      pendingConfirmation: {
        previewReceipt: 'encrypted-preview-receipt', requestId, incidentId,
        caseCount: 2, recipientCount: 1, expiresAt: '2026-10-10T12:00:00.000Z', commonText: 'ห้ามเก็บข้อความนี้',
      },
    }])).toBe(false);
  });
});
