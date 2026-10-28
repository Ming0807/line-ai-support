'use client';

import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { z } from 'zod';
import {
  incidentReplyOptionsSchema,
  incidentReplyPreviewSchema,
  type IncidentReplyOption,
  type IncidentReplyOptions,
  type IncidentReplyPreview,
} from '@/lib/incidents/batch-reply-contracts';
import {
  incidentBatchDraftSchema,
  type IncidentBatchDraft,
} from '@/lib/incidents/batch-draft-contracts';
import { incidentBatchConfirmResultSchema } from '@/lib/incidents/batch-confirm-contracts';
import {
  incidentBatchRetryResultSchema,
  incidentBatchStatusListSchema,
  type IncidentBatchStatusList,
} from '@/lib/incidents/batch-status-contracts';

const recoveryUuidSchema = z.uuid().transform(value => value.toLowerCase());

const pendingConfirmationSchema = z.strictObject({
  previewReceipt: z.string().min(1).max(200000),
  requestId: recoveryUuidSchema,
  incidentId: recoveryUuidSchema,
  caseCount: z.number().int().min(1).max(100),
  recipientCount: z.number().int().min(1).max(100),
  expiresAt: z.iso.datetime(),
}).refine(value => value.recipientCount <= value.caseCount);

const pendingRetrySchema = z.strictObject({
  batchId: recoveryUuidSchema,
  recipientCode: z.string().regex(/^R(?:[1-9]|[1-9]\d|100)$/u),
  requestId: recoveryUuidSchema,
});

export const incidentBatchRecoverySchema = z.strictObject({
  version: z.literal(1),
  pendingConfirmation: pendingConfirmationSchema.nullable(),
  pendingRetries: z.array(pendingRetrySchema).max(2500),
}).superRefine((value, context) => {
  const retryKeys = value.pendingRetries.map(item => `${item.batchId}:${item.recipientCode}`);
  if (new Set(retryKeys).size !== retryKeys.length) {
    context.addIssue({ code: 'custom', message: 'INCIDENT_BATCH_RECOVERY_DUPLICATE_RETRY' });
  }
});

export type IncidentBatchRecovery = z.infer<typeof incidentBatchRecoverySchema>;
export type PendingIncidentBatchConfirmation = z.infer<typeof pendingConfirmationSchema>;
export type PendingIncidentBatchRetry = z.infer<typeof pendingRetrySchema>;

type IncidentReplyMode = 'single' | 'common';

const MAX_RECOVERY_LENGTH = 1_000_000;

export function incidentBatchRecoveryKey(actorId: string | undefined, incidentId: string): string | null {
  const actor = recoveryUuidSchema.safeParse(actorId);
  const incident = recoveryUuidSchema.safeParse(incidentId);
  if (!actor.success || !incident.success) return null;
  return `yru:incident-batch:${actor.data}:${incident.data}`;
}

export function readIncidentBatchRecovery(storage: Pick<Storage, 'getItem'>, key: string):
  { ok: true; value: IncidentBatchRecovery } | { ok: false } {
  try {
    const serialized = storage.getItem(key);
    if (serialized === null) return { ok: true, value: { version: 1, pendingConfirmation: null, pendingRetries: [] } };
    if (serialized.length > MAX_RECOVERY_LENGTH) return { ok: false };
    const parsed = incidentBatchRecoverySchema.safeParse(JSON.parse(serialized) as unknown);
    return parsed.success ? { ok: true, value: parsed.data } : { ok: false };
  } catch {
    return { ok: false };
  }
}

export function writeIncidentBatchRecovery(storage: Pick<Storage, 'setItem'>, key: string, value: unknown): boolean {
  const parsed = incidentBatchRecoverySchema.safeParse(value);
  if (!parsed.success) return false;
  try {
    const serialized = JSON.stringify(parsed.data);
    if (serialized.length > MAX_RECOVERY_LENGTH) return false;
    storage.setItem(key, serialized);
    return true;
  } catch {
    return false;
  }
}

type ReplyDraft = {
  ticketIds: string[];
  text: string;
  mode: IncidentReplyMode;
  intervention: boolean;
  preview: IncidentReplyPreview | null;
  previewEpoch: number;
  previewPending: boolean;
};

type ReplyDraftAction =
  | { type: 'TEXT_CHANGED'; text: string }
  | { type: 'MODE_CHANGED'; mode: IncidentReplyMode }
  | { type: 'CASE_TOGGLED'; ticketId: string }
  | { type: 'CASE_SELECTION_REPLACED'; ticketIds: string[] }
  | { type: 'INTERVENTION_CHANGED'; value: boolean }
  | { type: 'PREVIEW_STARTED'; epoch: number }
  | { type: 'PREVIEW_RECEIVED'; epoch: number; preview: IncidentReplyPreview }
  | { type: 'PREVIEW_FAILED'; epoch: number }
  | { type: 'PREVIEW_CLEARED' }
  | { type: 'RECIPIENTS_CHANGED' }
  | { type: 'BATCH_ACCEPTED' };

export const initialIncidentReplyDraft: ReplyDraft = {
  ticketIds: [], text: '', mode: 'common', intervention: false, preview: null, previewEpoch: 0, previewPending: false,
};

export function incidentReplyDraftReducer(state: ReplyDraft, action: ReplyDraftAction): ReplyDraft {
  switch (action.type) {
    case 'TEXT_CHANGED':
      return { ...state, text: action.text, preview: null, previewEpoch: state.previewEpoch + 1, previewPending: false };
    case 'MODE_CHANGED':
      return action.mode === state.mode ? state : {
        ...state, mode: action.mode, preview: null, previewEpoch: state.previewEpoch + 1, previewPending: false,
      };
    case 'CASE_TOGGLED': {
      const ticketIds = state.ticketIds.includes(action.ticketId)
        ? state.ticketIds.filter(ticketId => ticketId !== action.ticketId)
        : [...state.ticketIds, action.ticketId];
      return { ...state, ticketIds, preview: null, previewEpoch: state.previewEpoch + 1, previewPending: false };
    }
    case 'CASE_SELECTION_REPLACED':
      return {
        ...state, ticketIds: [...new Set(action.ticketIds)], preview: null,
        previewEpoch: state.previewEpoch + 1, previewPending: false,
      };
    case 'INTERVENTION_CHANGED':
      return action.value === state.intervention ? state : {
        ...state, intervention: action.value, preview: null, previewEpoch: state.previewEpoch + 1, previewPending: false,
      };
    case 'PREVIEW_STARTED':
      return action.epoch <= state.previewEpoch ? state : {
        ...state, preview: null, previewEpoch: action.epoch, previewPending: true,
      };
    case 'PREVIEW_RECEIVED':
      return state.previewPending && action.epoch === state.previewEpoch
        ? { ...state, preview: action.preview, previewPending: false }
        : state;
    case 'PREVIEW_FAILED':
      return state.previewPending && action.epoch === state.previewEpoch
        ? { ...state, previewPending: false }
        : state;
    case 'PREVIEW_CLEARED':
      return { ...state, preview: null, previewEpoch: state.previewEpoch + 1, previewPending: false };
    case 'RECIPIENTS_CHANGED':
      return {
        ...state, ticketIds: [], intervention: false, preview: null,
        previewEpoch: state.previewEpoch + 1, previewPending: false,
      };
    case 'BATCH_ACCEPTED':
      return {
        ...state, ticketIds: [], intervention: false, preview: null,
        previewEpoch: state.previewEpoch + 1, previewPending: false,
      };
  }
}

export function incidentReplyPreviewMatches(preview: IncidentReplyPreview, expected: {
  incidentId: string; requestId: string; ticketIds: string[]; text: string; intervention: boolean;
}): boolean {
  const previewIds = preview.cases.map(item => item.ticketId).sort();
  const selectedIds = [...expected.ticketIds].sort();
  return preview.incidentId === expected.incidentId
    && preview.requestId === expected.requestId
    && preview.commonText === expected.text.trim()
    && preview.intervention === expected.intervention
    && preview.caseCount === selectedIds.length
    && previewIds.length === selectedIds.length
    && previewIds.every((id, index) => id === selectedIds[index]);
}

export function incidentReplySelectionIntervention(
  items: readonly IncidentReplyOption[],
  ticketIds: readonly string[],
  attested: boolean,
): boolean {
  return attested && ticketIds.some(ticketId => items.some(item => item.ticketId === ticketId && item.eligibility === 'INTERVENTION_REQUIRED'));
}

export function incidentBatchSelectAllEligible(
  selectedTicketIds: readonly string[],
  items: readonly IncidentReplyOption[],
  canIntervene: boolean,
  interventionAttested: boolean,
  limit = 100,
): string[] {
  const selected = [...new Set(selectedTicketIds)];
  const selectedSet = new Set(selected);
  const boundedLimit = Math.max(0, Math.min(100, Math.floor(limit)));
  for (const item of items) {
    const eligible = item.eligibility === 'OWN_CASE'
      || (item.eligibility === 'INTERVENTION_REQUIRED' && canIntervene && interventionAttested);
    if (!eligible || selectedSet.has(item.ticketId) || selected.length >= boundedLimit) continue;
    selected.push(item.ticketId);
    selectedSet.add(item.ticketId);
  }
  return selected;
}

export function incidentBatchClearSelection(): string[] {
  return [];
}

export function incidentBatchDeliveryLabel(status: IncidentBatchStatusList['batches'][number]['recipients'][number]['deliveryStatus']): string {
  switch (status) {
    case 'PENDING': return 'อยู่ในคิว';
    case 'PROCESSING': return 'กำลังส่ง';
    case 'SENT': return 'LINE รับข้อความแล้ว';
    case 'DEAD': return 'ส่งไม่สำเร็จ';
    case 'SUPPRESSED': return 'งดส่งตามสถานะหรือสิทธิ์ปัจจุบัน';
    case 'UNKNOWN': return 'ยังไม่ทราบผลการส่ง';
  }
}

export function incidentBatchFailureLabel(code: NonNullable<IncidentBatchStatusList['batches'][number]['recipients'][number]['safeFailureCode']>): string {
  switch (code) {
    case 'TEMPORARY_FAILURE': return 'ระบบปลายทางขัดข้องชั่วคราว';
    case 'ACCESS_CHANGED': return 'สิทธิ์หรือสถานะเคสเปลี่ยนก่อนส่ง';
    case 'DELIVERY_UNCERTAIN': return 'ยังยืนยันผลการส่งไม่ได้';
    case 'DELIVERY_FAILED': return 'ระบบปลายทางปฏิเสธข้อความ';
  }
}

export function incidentBatchRecipientCanRetry(recipient: IncidentBatchStatusList['batches'][number]['recipients'][number]): boolean {
  return recipient.deliveryStatus === 'DEAD' && recipient.retryable;
}

export function incidentBatchApiError(status: number): string {
  if (status === 400) return 'คำขอไม่ถูกต้อง ตรวจรายการที่เลือกและข้อความแล้วลองอีกครั้ง';
  if (status === 401) return 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบอีกครั้ง';
  if (status === 403) return 'บัญชีนี้ไม่มีสิทธิ์ดำเนินการกับรายการนี้';
  if (status === 404) return 'ไม่พบเหตุการณ์หรือรายการตอบกลับนี้';
  if (status === 409) return 'ข้อมูลเปลี่ยนแล้ว โหลดรายการล่าสุดและตรวจทานก่อนดำเนินการต่อ';
  if (status === 410) return 'ตัวอย่างหมดอายุแล้ว โหลดรายการล่าสุดและตรวจข้อความใหม่';
  if (status === 429) return 'มีคำขอมากเกินไป กรุณารอสักครู่แล้วลองอีกครั้ง';
  return 'ระบบยังยืนยันรายการนี้ไม่ได้ กรุณาตรวจผลล่าสุดก่อนดำเนินการต่อ';
}

type Feedback = { kind: 'info' | 'success' | 'error'; text: string } | null;
type RetryOperation = { requestId: string; recipientCodes: string[]; pending: boolean; uncertain: boolean };
type LatestDraftView =
  | { phase: 'idle' | 'loading' | 'empty' }
  | { phase: 'available'; value: Extract<IncidentBatchDraft, { status: 'AVAILABLE' }> }
  | { phase: 'error'; message: string };

export function incidentBatchRetryOperation(existing: RetryOperation | undefined, recipientCode: string, createRequestId: () => string): RetryOperation {
  return existing ?? { requestId: createRequestId(), recipientCodes: [recipientCode], pending: false, uncertain: false };
}

export function incidentBatchRetryOperationFromRecovery(retry: PendingIncidentBatchRetry): RetryOperation {
  return { requestId: retry.requestId, recipientCodes: [retry.recipientCode], pending: false, uncertain: true };
}

function incidentStatusLabel(status: IncidentReplyOptions['incidentStatus']): string {
  switch (status) {
    case 'DETECTED': return 'ตรวจพบ';
    case 'INVESTIGATING': return 'กำลังตรวจสอบ';
    case 'MONITORING': return 'กำลังติดตาม';
    case 'RESOLVED': return 'แก้ไขแล้ว';
    case 'CLOSED': return 'ปิดแล้ว';
  }
}

function ticketStatusLabel(status: string): string {
  switch (status) {
    case 'WAITING_STAFF': return 'รอเจ้าหน้าที่';
    case 'STAFF_HANDLING': return 'เจ้าหน้าที่กำลังดำเนินการ';
    case 'WAITING_USER': return 'รอผู้ใช้ตอบ';
    case 'RESOLVED': return 'แก้ไขแล้ว';
    case 'CLOSED': return 'ปิดแล้ว';
    default: return 'ไม่ทราบสถานะ';
  }
}

function eligibilityLabel(item: IncidentReplyOption): string {
  switch (item.eligibility) {
    case 'OWN_CASE': return 'มอบหมายให้คุณ';
    case 'INTERVENTION_REQUIRED': return 'ต้องยืนยันการเข้าแทรกแซง';
    case 'OTHER_ASSIGNEE': return 'มอบหมายให้เจ้าหน้าที่คนอื่น';
    case 'UNASSIGNED': return 'ยังไม่มีผู้รับผิดชอบ';
    case 'PRIVATE_CASE': return 'เคสจำกัดสิทธิ์';
    case 'INACTIVE_CASE': return 'เคสไม่อยู่ในสถานะทำงาน';
    case 'NOT_HUMAN': return 'ไม่ใช่เคสที่เจ้าหน้าที่ตอบ';
  }
}

function dateTimeLabel(value: string): string {
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat('th-TH', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Bangkok' }).format(date)
    : 'ไม่ทราบเวลา';
}

function errorState(text: string) {
  return <p className="incident-batch-message incident-batch-error" role="alert">{text}</p>;
}

function currentSessionStorage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

function emptyIncidentBatchRecovery(): IncidentBatchRecovery {
  return { version: 1, pendingConfirmation: null, pendingRetries: [] };
}

export default function IncidentBatchReply({ incidentId, actorId }: { incidentId: string; actorId?: string }) {
  const recoveryKey = incidentBatchRecoveryKey(actorId, incidentId);
  const [draft, dispatchDraft] = useReducer(incidentReplyDraftReducer, initialIncidentReplyDraft);
  const draftRef = useRef(draft);
  const latestDraftEpoch = useRef(0);
  const [latestDraftView, setLatestDraftView] = useState<LatestDraftView>({ phase: 'idle' });
  const transitionDraft = useCallback((action: ReplyDraftAction) => {
    if (action.type === 'TEXT_CHANGED' || action.type === 'MODE_CHANGED' || action.type === 'CASE_TOGGLED'
      || action.type === 'CASE_SELECTION_REPLACED' || action.type === 'INTERVENTION_CHANGED'
      || action.type === 'RECIPIENTS_CHANGED' || action.type === 'BATCH_ACCEPTED') {
      latestDraftEpoch.current += 1;
    }
    draftRef.current = incidentReplyDraftReducer(draftRef.current, action);
    dispatchDraft(action);
  }, []);

  const [options, setOptions] = useState<IncidentReplyOptions | null>(null);
  const [optionsPhase, setOptionsPhase] = useState<'loading' | 'ready' | 'error'>('loading');
  const [optionsError, setOptionsError] = useState('');
  const [statusList, setStatusList] = useState<IncidentBatchStatusList | null>(null);
  const [statusPhase, setStatusPhase] = useState<'loading' | 'ready' | 'error'>('loading');
  const [statusError, setStatusError] = useState('');
  const [confirmPhase, setConfirmPhase] = useState<'idle' | 'restoring' | 'sending' | 'uncertain'>(recoveryKey ? 'restoring' : 'idle');
  const confirmPendingRef = useRef(false);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [recovery, setRecovery] = useState<IncidentBatchRecovery>(emptyIncidentBatchRecovery);
  const recoveryRef = useRef(recovery);
  const [persistencePhase, setPersistencePhase] = useState<'checking' | 'ready' | 'unavailable' | 'error'>(recoveryKey ? 'checking' : 'unavailable');
  const [persistenceError, setPersistenceError] = useState('');
  const [retryOperations, setRetryOperations] = useState<Record<string, RetryOperation>>({});
  const retryOperationsRef = useRef(retryOperations);
  const [retryMessages, setRetryMessages] = useState<Record<string, string>>({});
  const optionsEpoch = useRef(0);
  const statusEpoch = useRef(0);

  useEffect(() => () => {
    latestDraftEpoch.current += 1;
  }, [incidentId]);

  function persistRecovery(next: IncidentBatchRecovery): boolean {
    const storage = currentSessionStorage();
    if (!recoveryKey || persistencePhase !== 'ready' || !storage
      || !writeIncidentBatchRecovery(storage, recoveryKey, next)) return false;
    recoveryRef.current = next;
    setRecovery(next);
    return true;
  }

  const loadOptions = useCallback(async (showLoading = true) => {
    const requestEpoch = ++optionsEpoch.current;
    if (showLoading) {
      setOptionsPhase('loading');
      setOptionsError('');
    }
    try {
      const response = await fetch(`/api/incidents/${encodeURIComponent(incidentId)}/reply-options`, {
        credentials: 'same-origin', cache: 'no-store',
      });
      if (requestEpoch !== optionsEpoch.current) return false;
      if (!response.ok) {
        setOptionsPhase('error');
        setOptionsError(incidentBatchApiError(response.status));
        return false;
      }
      const body: unknown = await response.json().catch(() => null);
      if (requestEpoch !== optionsEpoch.current) return false;
      const parsed = incidentReplyOptionsSchema.safeParse(body);
      if (!parsed.success || parsed.data.incidentId !== incidentId) {
        setOptionsPhase('error');
        setOptionsError('ระบบส่งรายการเคสที่ตรวจสอบไม่ได้ กรุณาโหลดใหม่');
        return false;
      }
      setOptions(parsed.data);
      setOptionsPhase('ready');
      if (!parsed.data.canIntervene || !parsed.data.items.some(item => item.eligibility === 'INTERVENTION_REQUIRED')) {
        transitionDraft({ type: 'INTERVENTION_CHANGED', value: false });
      }
      return true;
    } catch {
      if (requestEpoch === optionsEpoch.current) {
        setOptionsPhase('error');
        setOptionsError('เชื่อมต่อเพื่อโหลดเคสไม่ได้ กรุณาลองใหม่');
      }
      return false;
    }
  }, [incidentId, transitionDraft]);

  const loadStatuses = useCallback(async (showLoading = true) => {
    const requestEpoch = ++statusEpoch.current;
    if (showLoading) {
      setStatusPhase('loading');
      setStatusError('');
    }
    try {
      const response = await fetch(`/api/incidents/${encodeURIComponent(incidentId)}/replies`, {
        credentials: 'same-origin', cache: 'no-store',
      });
      if (requestEpoch !== statusEpoch.current) return false;
      if (!response.ok) {
        setStatusPhase('error');
        setStatusError(incidentBatchApiError(response.status));
        if (response.status === 409) {
          transitionDraft({ type: 'PREVIEW_CLEARED' });
          setFeedback({ kind: 'error', text: 'ข้อมูลเหตุการณ์เปลี่ยนแล้ว โหลดตัวเลือกใหม่และตรวจข้อความก่อนยืนยันอีกครั้ง' });
          void loadOptions();
        }
        return false;
      }
      const body: unknown = await response.json().catch(() => null);
      if (requestEpoch !== statusEpoch.current) return false;
      const parsed = incidentBatchStatusListSchema.safeParse(body);
      if (!parsed.success) {
        setStatusPhase('error');
        setStatusError('ระบบส่งผลตอบกลับที่ตรวจสอบไม่ได้ กรุณาโหลดอีกครั้ง');
        return false;
      }
      setStatusList(parsed.data);
      setStatusPhase('ready');
      return true;
    } catch {
      if (requestEpoch === statusEpoch.current) {
        setStatusPhase('error');
        setStatusError('เชื่อมต่อเพื่อโหลดผลตอบกลับไม่ได้ กรุณาลองใหม่');
      }
      return false;
    }
  }, [incidentId, loadOptions, transitionDraft]);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      if (!recoveryKey) {
        setPersistencePhase('unavailable');
        setPersistenceError('ไม่สามารถยืนยันรายการได้จนกว่าจะระบุขอบเขตผู้ใช้สำหรับกู้คืนคำขอเดิม');
      } else {
        const stored = currentSessionStorage();
        const loaded = stored ? readIncidentBatchRecovery(stored, recoveryKey) : { ok: false as const };
        const state = loaded.ok ? loaded.value : null;
        if (!state || (state.pendingConfirmation && state.pendingConfirmation.incidentId !== incidentId.toLowerCase())) {
          setPersistencePhase('error');
          setPersistenceError('ข้อมูลคำขอเดิมในเซสชันตรวจสอบไม่ได้ จึงปิดการแก้ไขและส่งรายการใหม่ไว้ก่อน');
          setConfirmPhase('uncertain');
        } else {
          recoveryRef.current = state;
          setRecovery(state);
          const restoredOperations: Record<string, RetryOperation> = {};
          for (const retry of state.pendingRetries) {
            restoredOperations[`${retry.batchId}:${retry.recipientCode}`] = incidentBatchRetryOperationFromRecovery(retry);
          }
          retryOperationsRef.current = restoredOperations;
          setRetryOperations(restoredOperations);
          setPersistencePhase('ready');
          setPersistenceError('');
          setConfirmPhase(state.pendingConfirmation ? 'uncertain' : 'idle');
        }
      }
      void loadOptions(false);
      void loadStatuses(false);
    });
    return () => {
      cancelled = true;
      optionsEpoch.current += 1;
      statusEpoch.current += 1;
    };
  }, [incidentId, loadOptions, loadStatuses, recoveryKey]);

  function updateDraft(action: ReplyDraftAction) {
    if (confirmPendingRef.current || recoveryRef.current.pendingConfirmation) return;
    const hadPreview = draftRef.current.preview !== null || draftRef.current.previewPending;
    transitionDraft(action);
    if (action.type === 'TEXT_CHANGED' || action.type === 'MODE_CHANGED' || action.type === 'CASE_TOGGLED'
      || action.type === 'CASE_SELECTION_REPLACED' || action.type === 'INTERVENTION_CHANGED') {
      setFeedback(hadPreview
        ? { kind: 'info', text: 'แก้ไขรายการแล้ว ตัวอย่างเดิมถูกยกเลิก กรุณาตรวจข้อความและผู้รับใหม่' }
        : null);
    }
  }

  function refreshOptions() {
    if (confirmLocked) return;
    transitionDraft({ type: 'PREVIEW_CLEARED' });
    setFeedback({ kind: 'info', text: 'กำลังโหลดตัวเลือกเคสล่าสุด ตัวอย่างเดิมถูกยกเลิก' });
    void loadOptions();
  }

  async function loadLatestDraft() {
    if (confirmLocked || confirmPendingRef.current || recoveryRef.current.pendingConfirmation) return;
    const requestEpoch = ++latestDraftEpoch.current;
    const requestIncidentId = incidentId;
    const draftEpoch = draftRef.current.previewEpoch;
    setLatestDraftView({ phase: 'loading' });
    try {
      const response = await fetch(`/api/incidents/${encodeURIComponent(requestIncidentId)}/replies/latest-draft`, {
        credentials: 'same-origin', cache: 'no-store',
      });
      if (requestEpoch !== latestDraftEpoch.current
        || draftEpoch !== draftRef.current.previewEpoch) return;
      if (response.status === 404 || response.status === 403) {
        setLatestDraftView({ phase: 'error', message: 'ไม่พบข้อความอัปเดตที่เปิดดูได้สำหรับเหตุการณ์นี้' });
        return;
      }
      if (!response.ok) {
        setLatestDraftView({ phase: 'error', message: response.status === 401
          ? 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบอีกครั้ง แล้วลองโหลดข้อความใหม่'
          : 'โหลดข้อความอัปเดตเดิมไม่ได้ ข้อความในช่องปัจจุบันยังอยู่ ลองอีกครั้งได้' });
        return;
      }
      const body: unknown = await response.json().catch(() => null);
      if (requestEpoch !== latestDraftEpoch.current
        || draftEpoch !== draftRef.current.previewEpoch) return;
      const parsed = incidentBatchDraftSchema.safeParse(body);
      if (!parsed.success) {
        setLatestDraftView({ phase: 'error', message: 'ระบบส่งข้อความอัปเดตที่ตรวจสอบไม่ได้ ข้อความในช่องปัจจุบันยังอยู่' });
        return;
      }
      setLatestDraftView(parsed.data.status === 'EMPTY'
        ? { phase: 'empty' }
        : { phase: 'available', value: parsed.data });
    } catch {
      if (requestEpoch === latestDraftEpoch.current
        && draftEpoch === draftRef.current.previewEpoch) {
        setLatestDraftView({ phase: 'error', message: 'เชื่อมต่อเพื่อโหลดข้อความอัปเดตเดิมไม่ได้ ข้อความในช่องปัจจุบันยังอยู่ ลองอีกครั้งได้' });
      }
    }
  }

  function cancelLatestDraft() {
    latestDraftEpoch.current += 1;
    setLatestDraftView({ phase: 'idle' });
  }

  const interventionRequired = options?.items.filter(item => item.eligibility === 'INTERVENTION_REQUIRED') ?? [];
  const visibleOptionIds = new Set(options?.items.map(item => item.ticketId) ?? []);
  const missingSelectedCount = draft.ticketIds.filter(ticketId => !visibleOptionIds.has(ticketId)).length;
  const optionsById = new Map((options?.items ?? []).map(item => [item.ticketId, item]));
  const selectableCurrentCaseIds = (options?.items ?? [])
    .filter(item => item.eligibility === 'OWN_CASE'
      || (item.eligibility === 'INTERVENTION_REQUIRED' && options?.canIntervene && draft.intervention))
    .map(item => item.ticketId);
  const canAddEligibleCases = draft.ticketIds.length < (draft.mode === 'single' ? 1 : 100)
    && selectableCurrentCaseIds.some(ticketId => !draft.ticketIds.includes(ticketId));
  const selectedCasesAreEligible = draft.ticketIds.length > 0 && draft.ticketIds.every(ticketId => {
    const item = optionsById.get(ticketId);
    return Boolean(item && (item.eligibility === 'OWN_CASE' || (item.eligibility === 'INTERVENTION_REQUIRED' && options?.canIntervene && draft.intervention)));
  });
  const modeLimit = draft.mode === 'single' ? 1 : 100;
  const selectedCasesFitMode = draft.ticketIds.length <= modeLimit;
  const selectedInterventionNeedsAttestation = !draft.intervention && draft.ticketIds.some(ticketId => optionsById.get(ticketId)?.eligibility === 'INTERVENTION_REQUIRED');
  const confirmLocked = confirmPhase !== 'idle' || persistencePhase === 'checking' || persistencePhase === 'error'
    || recovery.pendingConfirmation !== null;

  async function createPreview() {
    const current = draftRef.current;
    if (current.previewPending || confirmPendingRef.current || recoveryRef.current.pendingConfirmation || confirmLocked
      || optionsPhase !== 'ready' || !options || !selectedCasesAreEligible
      || current.ticketIds.length > 100 || (current.mode === 'single' && current.ticketIds.length !== 1)
      || current.text.trim() === '') return;
    const requestId = crypto.randomUUID();
    const epoch = current.previewEpoch + 1;
    const ticketIds = [...current.ticketIds];
    const text = current.text.trim();
    const intervention = incidentReplySelectionIntervention(options.items, ticketIds, current.intervention);
    transitionDraft({ type: 'PREVIEW_STARTED', epoch });
    setFeedback(null);
    try {
      const response = await fetch(`/api/incidents/${encodeURIComponent(incidentId)}/replies/preview`, {
        method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ requestId, ticketIds, text, intervention }),
      });
      if (draftRef.current.previewEpoch !== epoch) return;
      if (response.status === 409) {
        transitionDraft({ type: 'RECIPIENTS_CHANGED' });
        setFeedback({ kind: 'error', text: 'รายการเคสหรือสิทธิ์เปลี่ยนแล้ว รายการเดิมถูกล้างเพื่อทบทวนข้อมูลล่าสุด เลือกเคสใหม่ก่อนสร้างตัวอย่าง' });
        void loadOptions();
        return;
      }
      if (!response.ok) {
        transitionDraft({ type: 'PREVIEW_FAILED', epoch });
        setFeedback({ kind: 'error', text: incidentBatchApiError(response.status) });
        return;
      }
      const body: unknown = await response.json().catch(() => null);
      if (draftRef.current.previewEpoch !== epoch) return;
      const parsed = incidentReplyPreviewSchema.safeParse(body);
      if (!parsed.success || !incidentReplyPreviewMatches(parsed.data, { incidentId, requestId, ticketIds, text, intervention })) {
        transitionDraft({ type: 'PREVIEW_FAILED', epoch });
        setFeedback({ kind: 'error', text: 'ระบบส่งตัวอย่างที่ไม่ตรงกับรายการที่เลือก ตัวอย่างถูกยกเลิก กรุณาลองใหม่' });
        return;
      }
      transitionDraft({ type: 'PREVIEW_RECEIVED', epoch, preview: parsed.data });
    } catch {
      if (draftRef.current.previewEpoch === epoch) {
        transitionDraft({ type: 'PREVIEW_FAILED', epoch });
        setFeedback({ kind: 'error', text: 'เชื่อมต่อเพื่อเตรียมตัวอย่างไม่ได้ ข้อความและเคสที่เลือกยังอยู่ ลองอีกครั้งได้' });
      }
    }
  }

  async function confirmPreview() {
    const preview = draftRef.current.preview;
    const confirmation = recoveryRef.current.pendingConfirmation ?? (preview ? {
      previewReceipt: preview.previewReceipt,
      requestId: preview.requestId,
      incidentId: preview.incidentId,
      caseCount: preview.caseCount,
      recipientCount: preview.recipientCount,
      expiresAt: preview.expiresAt,
    } : null);
    if (!confirmation || confirmation.incidentId !== incidentId.toLowerCase() || confirmPendingRef.current) return;
    if (!recoveryKey || persistencePhase !== 'ready' || !currentSessionStorage()) {
      setFeedback({ kind: 'error', text: 'บันทึกคำยืนยันเดิมในเซสชันไม่ได้ จึงยังไม่ส่งคำขอ กรุณาลองอีกครั้งเมื่อเซสชันพร้อม' });
      return;
    }
    if (!persistRecovery({ ...recoveryRef.current, pendingConfirmation: confirmation })) {
      setFeedback({ kind: 'error', text: 'บันทึกคำยืนยันเดิมในเซสชันไม่ได้ จึงยังไม่ส่งคำขอ กรุณาลองอีกครั้งเมื่อเซสชันพร้อม' });
      return;
    }
    latestDraftEpoch.current += 1;
    setLatestDraftView({ phase: 'idle' });
    confirmPendingRef.current = true;
    setConfirmPhase('sending');
    setFeedback(null);
    try {
      const response = await fetch(`/api/incidents/${encodeURIComponent(incidentId)}/replies/confirm`, {
        method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ previewReceipt: confirmation.previewReceipt }),
      });
      if (response.status === 409) {
        confirmPendingRef.current = false;
        const cleared = persistRecovery({ ...recoveryRef.current, pendingConfirmation: null });
        if (cleared) {
          setConfirmPhase('idle');
          transitionDraft({ type: 'RECIPIENTS_CHANGED' });
          setFeedback({ kind: 'error', text: 'ข้อมูลหรือสิทธิ์เปลี่ยนก่อนเข้าคิว ตัวอย่างเดิมถูกยกเลิก โหลดรายการล่าสุดและเลือกเคสเพื่อทบทวนใหม่' });
        } else {
          setConfirmPhase('uncertain');
          setFeedback({ kind: 'error', text: 'คำขอเดิมถูกปฏิเสธเพราะข้อมูลเปลี่ยน แต่ยังล้างข้อมูลกู้คืนในเซสชันไม่ได้ จึงคงรายการเดิมไว้ก่อน' });
        }
        void loadOptions();
        void loadStatuses();
        return;
      }
      if (!response.ok) {
        confirmPendingRef.current = false;
        setConfirmPhase('uncertain');
        setFeedback({ kind: 'error', text: `${incidentBatchApiError(response.status)} ใบยืนยันเดิมยังถูกเก็บไว้ ให้ลองคำขอเดิมอีกครั้งเพื่อป้องกันการส่งซ้ำ` });
        return;
      }
      const body: unknown = await response.json().catch(() => null);
      const parsed = incidentBatchConfirmResultSchema.safeParse(body);
      const result = parsed.success ? parsed.data : null;
      if (!result || result.incidentId !== incidentId || result.requestId !== confirmation.requestId
        || result.caseCount !== confirmation.caseCount || result.recipientCount !== confirmation.recipientCount) {
        confirmPendingRef.current = false;
        setConfirmPhase('uncertain');
        setFeedback({ kind: 'error', text: 'ระบบยังยืนยันผลเข้าคิวไม่ได้ ใบยืนยันเดิมยังถูกเก็บไว้ ให้ลองคำขอเดิมอีกครั้งเพื่อป้องกันการส่งซ้ำ' });
        return;
      }
      confirmPendingRef.current = false;
      if (!persistRecovery({ ...recoveryRef.current, pendingConfirmation: null })) {
        setConfirmPhase('uncertain');
        setFeedback({ kind: 'error', text: 'รับเข้าคิวแล้ว แต่ยังล้างข้อมูลกู้คืนในเซสชันไม่ได้ ให้ตรวจคำขอเดิมอีกครั้งโดยไม่สร้างรายการใหม่' });
        void loadStatuses();
        return;
      }
      setConfirmPhase('idle');
      transitionDraft({ type: 'BATCH_ACCEPTED' });
      setFeedback({
        kind: 'success',
        text: `รับเข้าคิวแล้ว · ${result.caseCount} เคส · ${result.recipientCount} ช่องทางผู้รับนิรนามที่ไม่ซ้ำ · ยังไม่ยืนยันผลการส่งหรือการอ่าน`,
      });
      void loadStatuses();
    } catch {
      confirmPendingRef.current = false;
      setConfirmPhase('uncertain');
      setFeedback({ kind: 'error', text: 'ยังยืนยันผลเข้าคิวไม่ได้ ใบยืนยันเดิมยังถูกเก็บไว้ ให้ลองคำขอเดิมอีกครั้งเพื่อป้องกันการส่งซ้ำ' });
    }
  }

  function setRetryOperation(key: string, operation: RetryOperation | null) {
    const next = { ...retryOperationsRef.current };
    if (operation) next[key] = operation;
    else delete next[key];
    retryOperationsRef.current = next;
    setRetryOperations(next);
  }

  async function retryRecipient(batchId: string, recipientCode: string) {
    const operationKey = `${batchId}:${recipientCode}`;
    const persistedRetry = recoveryRef.current.pendingRetries.find(item => item.batchId === batchId && item.recipientCode === recipientCode);
    const alreadyPersisted = Boolean(persistedRetry);
    if ((!alreadyPersisted && statusPhase !== 'ready') || persistencePhase !== 'ready' || !recoveryKey) return;
    const operation = retryOperationsRef.current[operationKey]
      ?? (persistedRetry
        ? incidentBatchRetryOperationFromRecovery(persistedRetry)
        : incidentBatchRetryOperation(undefined, recipientCode, () => crypto.randomUUID()));
    if (operation.pending) return;
    const retry = { batchId, recipientCode, requestId: operation.requestId };
    const pendingRetries = alreadyPersisted
      ? recoveryRef.current.pendingRetries
      : [...recoveryRef.current.pendingRetries, retry];
    if (!persistRecovery({ ...recoveryRef.current, pendingRetries })) {
      setRetryMessages(current => ({ ...current, [operationKey]: 'บันทึกคำขอกู้คืนในเซสชันไม่ได้ จึงยังไม่ส่งคำขอลองอีกครั้ง' }));
      return;
    }
    setRetryOperation(operationKey, { ...operation, pending: true });
    setRetryMessages(current => ({ ...current, [operationKey]: '' }));
    try {
      const response = await fetch(`/api/incidents/${encodeURIComponent(incidentId)}/replies/${encodeURIComponent(batchId)}/retry`, {
        method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ requestId: operation.requestId, recipientCodes: operation.recipientCodes }),
      });
      if (response.status === 409) {
        const cleared = persistRecovery({
          ...recoveryRef.current,
          pendingRetries: recoveryRef.current.pendingRetries.filter(item => item.batchId !== batchId || item.recipientCode !== recipientCode),
        });
        if (cleared) {
          setRetryOperation(operationKey, null);
          setRetryMessages(current => ({ ...current, [operationKey]: 'สถานะเปลี่ยนแล้ว โหลดผลล่าสุดและตรวจสิทธิ์ก่อนลองอีกครั้ง' }));
        } else {
          setRetryOperation(operationKey, { ...operation, pending: false, uncertain: true });
          setRetryMessages(current => ({ ...current, [operationKey]: 'ระบบปฏิเสธคำขอเดิมแล้ว แต่ยังล้างข้อมูลกู้คืนไม่ได้ ให้ตรวจคำขอเดิมอีกครั้งภายหลัง' }));
        }
        void loadStatuses();
        void loadOptions();
        return;
      }
      if (!response.ok) {
        setRetryOperation(operationKey, { ...operation, pending: false, uncertain: true });
        setRetryMessages(current => ({ ...current, [operationKey]: `${incidentBatchApiError(response.status)} คำขอเดิมยังถูกเก็บไว้และจะใช้รหัสเดิมเมื่อลองอีกครั้ง` }));
        return;
      }
      const body: unknown = await response.json().catch(() => null);
      const parsed = incidentBatchRetryResultSchema.safeParse(body);
      const result = parsed.success ? parsed.data : null;
      if (!result || result.batchId !== batchId || result.requestId !== operation.requestId
        || result.recipientCodes.length !== operation.recipientCodes.length
        || !result.recipientCodes.every((code, index) => code === operation?.recipientCodes[index])) {
        setRetryOperation(operationKey, { ...operation, pending: false, uncertain: true });
        setRetryMessages(current => ({ ...current, [operationKey]: 'ระบบยังยืนยันผลคำขอลองส่งไม่ได้ คำขอเดิมยังถูกเก็บไว้และจะใช้รหัสเดิมเมื่อลองอีกครั้ง' }));
        return;
      }
      const cleared = persistRecovery({
        ...recoveryRef.current,
        pendingRetries: recoveryRef.current.pendingRetries.filter(item => item.batchId !== batchId || item.recipientCode !== recipientCode),
      });
      if (!cleared) {
        setRetryOperation(operationKey, { ...operation, pending: false, uncertain: true });
        setRetryMessages(current => ({ ...current, [operationKey]: 'รับคำขอลองส่งเข้าคิวแล้ว แต่ยังล้างข้อมูลกู้คืนไม่ได้ ให้ตรวจคำขอเดิมอีกครั้งเพื่อไม่สร้างคำขอใหม่' }));
        void loadStatuses();
        return;
      }
      setRetryOperation(operationKey, null);
      setRetryMessages(current => ({ ...current, [operationKey]: 'รับคำขอลองส่งเข้าคิวแล้ว · ยังไม่ยืนยันผลการส่ง' }));
      void loadStatuses();
    } catch {
      setRetryOperation(operationKey, { ...operation, pending: false, uncertain: true });
      setRetryMessages(current => ({ ...current, [operationKey]: 'เชื่อมต่อไม่ได้ คำขอเดิมยังถูกเก็บไว้และจะใช้รหัสเดิมเมื่อลองอีกครั้ง' }));
    }
  }

  const readyOptions = optionsPhase === 'ready' ? options : null;
  const canPersistRecovery = Boolean(recoveryKey && persistencePhase === 'ready');
  const showComposition = Boolean(readyOptions && !recovery.pendingConfirmation
    && persistencePhase !== 'checking' && persistencePhase !== 'error');
  const canReview = Boolean(readyOptions && selectedCasesAreEligible && selectedCasesFitMode && missingSelectedCount === 0
    && draft.text.trim().length > 0 && draft.text.length <= 4000 && !confirmLocked);

  return <section className="incident-panel incident-batch-panel" aria-labelledby="incident-batch-title">
    <div className="incident-section-heading incident-batch-heading">
      <div>
        <h2 id="incident-batch-title">ตอบกลับเคสที่เลือก</h2>
        <p>เลือกตอบเคสเดียว หรือส่งข้อความร่วมให้หลายเคสที่เลือกและตรวจทานแล้ว</p>
      </div>
      <button type="button" className="incident-secondary-link incident-batch-refresh" onClick={refreshOptions} disabled={confirmLocked || optionsPhase === 'loading'}>
        {optionsPhase === 'loading' ? 'กำลังโหลดเคส…' : 'โหลดเคสล่าสุด'}
      </button>
    </div>

    <p className="incident-batch-privacy-note">จำนวนช่องทางผู้รับนับแยกตามข้อมูลนิรนาม ไม่ได้ยืนยันว่าเป็นบุคคลคนละคน · เคสที่เข้ามาภายหลังจะไม่ถูกรวมในตัวอย่างที่ตรวจแล้ว</p>

    {persistencePhase === 'checking' && <p className="incident-batch-message" role="status">กำลังตรวจสอบคำขอเดิมในเซสชันก่อนเปิดฟอร์ม…</p>}
    {persistencePhase === 'error' && errorState(persistenceError || 'ตรวจสอบคำขอเดิมไม่ได้ จึงปิดการส่งรายการใหม่ไว้ก่อน')}
    {persistencePhase === 'unavailable' && readyOptions && errorState(persistenceError || 'เซสชันนี้ยังไม่พร้อมเก็บคำขอเดิม จึงยืนยันส่งไม่ได้')}
    {feedback && <p className={`incident-batch-message incident-batch-${feedback.kind}`} role={feedback.kind === 'error' ? 'alert' : 'status'} aria-live="polite">{feedback.text}</p>}

    {optionsPhase === 'loading' && <p className="incident-batch-message" role="status">กำลังโหลดเคสและสิทธิ์ปัจจุบัน…</p>}
    {optionsPhase === 'error' && <div>{errorState(optionsError || 'โหลดเคสไม่ได้')}<button type="button" className="incident-secondary-link" onClick={() => void loadOptions()} disabled={confirmLocked}>ลองโหลดเคสอีกครั้ง</button></div>}
    <div className="incident-batch-draft-source">
      <button type="button" className="incident-secondary-link" onClick={() => void loadLatestDraft()}
        disabled={confirmLocked || latestDraftView.phase === 'loading'}>
        {latestDraftView.phase === 'loading' ? 'กำลังโหลดข้อความ…' : 'ใช้ข้อความอัปเดตเดิม'}
      </button>
      <span>โหลดเมื่อกดเท่านั้น · ข้อความเดิมเป็นเพียงข้อเสนอสำหรับร่างใหม่</span>
    </div>
    {latestDraftView.phase === 'empty' && <p className="incident-batch-message" role="status">ไม่มีข้อความอัปเดตเดิมที่เปิดดูได้ในขณะนี้</p>}
    {latestDraftView.phase === 'error' && <p className="incident-batch-message incident-batch-error" role="alert">{latestDraftView.message}</p>}
    {latestDraftView.phase === 'available' && <section className="incident-batch-previous-draft" aria-labelledby={`incident-batch-previous-draft-${incidentId}`}>
      <div>
        <h3 id={`incident-batch-previous-draft-${incidentId}`}>ข้อความอัปเดตที่เคยรับเข้าคิว</h3>
        <p>รับเข้าคิวเมื่อ {dateTimeLabel(latestDraftView.value.acceptedAt)} · เวลานี้ไม่ยืนยันว่าข้อความส่งถึง LINE หรือมีผู้เปิดอ่าน</p>
      </div>
      <pre>{latestDraftView.value.text}</pre>
      <div className="incident-batch-previous-draft-actions">
        <button type="button" className="incident-primary-button" onClick={() => {
          if (confirmLocked || confirmPendingRef.current || recoveryRef.current.pendingConfirmation) return;
          updateDraft({ type: 'TEXT_CHANGED', text: latestDraftView.value.text });
          cancelLatestDraft();
        }} disabled={confirmLocked || optionsPhase !== 'ready'}>แทนที่ข้อความร่างปัจจุบัน</button>
        <button type="button" className="incident-secondary-link" onClick={cancelLatestDraft} disabled={confirmLocked}>ยกเลิก</button>
      </div>
    </section>}
    {recovery.pendingConfirmation && <section className="incident-batch-recovery" aria-labelledby={`incident-batch-recovery-${incidentId}`}>
      <h3 id={`incident-batch-recovery-${incidentId}`}>ตรวจผลคำยืนยันเดิม</h3>
      <p>เก็บใบยืนยันเดิมไว้สำหรับ {recovery.pendingConfirmation.caseCount} เคส · {recovery.pendingConfirmation.recipientCount} ช่องทางผู้รับนิรนามที่ไม่ซ้ำ ใช้ปุ่มด้านล่างเพื่อเรียกผลเดิมด้วยใบเดิม ระบบจะไม่สร้างคำขอใหม่</p>
      <p className="incident-batch-help">ใบยืนยันมีอายุถึง {dateTimeLabel(recovery.pendingConfirmation.expiresAt)} · เบราว์เซอร์เก็บเฉพาะใบยืนยันแบบเข้ารหัสและจำนวน ไม่มีข้อความหรือข้อมูลผู้รายงาน</p>
      {confirmPhase === 'sending' && <p className="incident-batch-message" role="status">กำลังตรวจผลคำยืนยันเดิม…</p>}
      <button type="button" className="incident-primary-button" onClick={() => void confirmPreview()} disabled={confirmPhase === 'sending' || !canPersistRecovery}>
        {confirmPhase === 'sending' ? 'กำลังตรวจคำขอเดิม…' : 'ตรวจคำยืนยันเดิมอีกครั้ง'}
      </button>
    </section>}

    {showComposition && readyOptions && <>
      <p className="incident-batch-incident-state">สถานะเหตุการณ์: <strong>{incidentStatusLabel(readyOptions.incidentStatus)}</strong></p>
      <dl className="incident-batch-counts" aria-label="จำนวนตามข้อมูลล่าสุดที่คุณมีสิทธิ์ดู">
        <div><dt>เคสที่เชื่อมโยง</dt><dd>{readyOptions.workload.memberCases}</dd></div>
        <div><dt>เคสที่ยังทำงาน</dt><dd>{readyOptions.workload.activeCases}</dd></div>
        <div><dt>ช่องทางนิรนามที่เชื่อมโยง (ไม่ซ้ำ)</dt><dd>{readyOptions.workload.anonymousSessions}</dd></div>
        <div><dt>ช่องทางนิรนามในเคสที่ยังทำงาน (ไม่ซ้ำ)</dt><dd>{readyOptions.workload.activeAnonymousSessions}</dd></div>
        <div><dt>เคสที่ยังไม่มอบหมาย</dt><dd>{readyOptions.workload.unassignedCases}</dd></div>
        <div><dt>เจ้าหน้าที่ที่รับผิดชอบ</dt><dd>{readyOptions.workload.assignedStaff}</dd></div>
        <div><dt>ข้อความจากผู้ใช้ที่รอตอบ</dt><dd>{readyOptions.workload.pendingUserMessages}</dd></div>
      </dl>

      {missingSelectedCount > 0 && <div className="incident-batch-warning" role="alert">
        <p>มี {missingSelectedCount} เคสจากรายการเดิมที่ไม่อยู่ในข้อมูลล่าสุด ตัวอย่างถูกปิดไว้จนกว่าจะล้างรายการเดิมและเลือกใหม่</p>
        <button type="button" className="incident-secondary-link" onClick={() => updateDraft({ type: 'RECIPIENTS_CHANGED' })} disabled={confirmLocked}>ล้างเคสเดิมและเริ่มเลือกใหม่</button>
      </div>}

      <fieldset className="incident-batch-mode-fieldset" disabled={confirmLocked}>
        <legend>รูปแบบการตอบ</legend>
        <label><input type="radio" name={`incident-batch-mode-${incidentId}`} checked={draft.mode === 'single'} onChange={() => updateDraft({ type: 'MODE_CHANGED', mode: 'single' })} /> ตอบเคสเดียว</label>
        <label><input type="radio" name={`incident-batch-mode-${incidentId}`} checked={draft.mode === 'common'} onChange={() => updateDraft({ type: 'MODE_CHANGED', mode: 'common' })} /> ส่งข้อความร่วมให้หลายเคส</label>
        <p>{draft.mode === 'single' ? 'เลือกได้หนึ่งเคสต่อรายการ' : 'ส่งข้อความเดียวให้เคสที่เลือก โดยแต่ละช่องทางผู้รับจะได้รับข้อความของตนเอง'}</p>
      </fieldset>

      <fieldset className="incident-batch-case-fieldset" disabled={confirmLocked}>
        <legend>เลือกเคสที่จะตอบกลับ</legend>
        <p className="incident-batch-selection-guidance">หมวดเดียวกันไม่ได้แปลว่าเป็นเหตุการณ์เดียวกัน ตรวจเคสและผู้รายงานแต่ละรายการก่อนเลือก</p>
        <div className="incident-batch-selection-controls">
          <button type="button" className="incident-secondary-link" onClick={() => updateDraft({
            type: 'CASE_SELECTION_REPLACED',
            ticketIds: incidentBatchSelectAllEligible(draft.ticketIds, readyOptions.items, readyOptions.canIntervene, draft.intervention, modeLimit),
          })} disabled={confirmLocked || !canAddEligibleCases}>
            {draft.mode === 'single' ? 'เลือกเคสที่เข้าเกณฑ์หนึ่งรายการ' : 'เลือกเคสที่เข้าเกณฑ์ทั้งหมดจากรายการปัจจุบัน (สูงสุด 100)'}
          </button>
          <button type="button" className="incident-secondary-link" onClick={() => updateDraft({ type: 'CASE_SELECTION_REPLACED', ticketIds: incidentBatchClearSelection() })} disabled={confirmLocked || draft.ticketIds.length === 0}>
            ล้างรายการที่เลือก
          </button>
        </div>
        {readyOptions.items.length === 0
          ? <p className="incident-batch-message">ยังไม่มีเคสที่แสดงได้จากข้อมูลล่าสุด</p>
          : <ul className="incident-batch-case-list">{readyOptions.items.map(item => {
            const checked = draft.ticketIds.includes(item.ticketId);
            const selectable = item.eligibility === 'OWN_CASE'
              || (item.eligibility === 'INTERVENTION_REQUIRED' && readyOptions.canIntervene && draft.intervention);
            const disabled = confirmLocked || (!checked && (!selectable || draft.ticketIds.length >= modeLimit));
            return <li key={item.ticketId}>
              <label className={`incident-batch-case${selectable || checked ? '' : ' incident-batch-case-disabled'}`}>
                <input type="checkbox" checked={checked} disabled={disabled} onChange={() => updateDraft({ type: 'CASE_TOGGLED', ticketId: item.ticketId })} />
                <span className="incident-batch-case-copy">
                  <strong>{item.ticketCode}</strong>
                  <span>{item.reporterLabel} · {ticketStatusLabel(item.status)}</span>
                  <span className="incident-batch-eligibility">{eligibilityLabel(item)}</span>
                </span>
              </label>
            </li>;
          })}</ul>}
      </fieldset>
      {!selectedCasesFitMode && draft.mode === 'single' && <p className="incident-batch-warning" role="alert">มี {draft.ticketIds.length} เคสที่เลือกอยู่ โหมดตอบเคสเดียวรับได้หนึ่งเคส · ยกเลิกการเลือกส่วนเกินหรือเปลี่ยนเป็นส่งข้อความร่วม โดยรายการที่เลือกยังคงอยู่</p>}
      {draft.mode === 'common' && draft.ticketIds.length >= 100 && <p className="incident-batch-help" role="status">เลือกได้สูงสุด 100 เคสต่อรายการ · เคสที่เข้ามาภายหลังต้องเลือกและตรวจใหม่เอง</p>}

      {readyOptions.canIntervene && interventionRequired.length > 0 && <label className="incident-batch-intervention">
        <input type="checkbox" checked={draft.intervention} disabled={confirmLocked} onChange={event => updateDraft({ type: 'INTERVENTION_CHANGED', value: event.target.checked })} />
        <span>ฉันยืนยันการเข้าแทรกแซงเคสที่มอบหมายให้เจ้าหน้าที่คนอื่นภายในขอบเขตที่ดูแล</span>
      </label>}
      {selectedInterventionNeedsAttestation && <p className="incident-batch-warning" role="alert">เคสที่เลือกบางรายการต้องยืนยันการเข้าแทรกแซง หรือเอาเครื่องหมายเลือกออกก่อนสร้างตัวอย่าง</p>}

      <label className="incident-batch-text-label" htmlFor={`incident-batch-text-${incidentId}`}>
        {draft.mode === 'single' ? 'ข้อความสำหรับเคสที่เลือก' : 'ข้อความร่วมสำหรับเคสที่เลือก'}
        <textarea
          id={`incident-batch-text-${incidentId}`} value={draft.text} maxLength={4000} rows={5} disabled={confirmLocked}
          aria-describedby={`incident-batch-text-help-${incidentId}`}
          onChange={event => updateDraft({ type: 'TEXT_CHANGED', text: event.target.value })}
        />
      </label>
      <div id={`incident-batch-text-help-${incidentId}`} className="incident-batch-help">
        <span>{draft.text.length} / 4,000 ตัวอักษร</span>
        <span>{draft.mode === 'single' ? 'ตัวอย่างจะแสดงข้อความสำหรับเคสนี้' : 'ตัวอย่างจะแสดงเคสและข้อความแยกตามช่องทางผู้รับ'}</span>
      </div>

      <div className="incident-batch-actions">
        <span>{draft.ticketIds.length} เคสที่เลือก</span>
        <button type="button" className="incident-primary-button" onClick={() => void createPreview()} disabled={!canReview || draft.previewPending}>
          {draft.previewPending ? 'กำลังเตรียมตัวอย่าง…' : 'ตรวจข้อความและผู้รับ'}
        </button>
      </div>

      {draft.preview && <section className="incident-batch-review" aria-labelledby={`incident-batch-review-${incidentId}`}>
        <div className="incident-batch-review-heading">
          <h3 id={`incident-batch-review-${incidentId}`}>ตรวจรายการก่อนเข้าคิว</h3>
          <strong>{draft.preview.caseCount} เคส · {draft.preview.recipientCount} ช่องทางผู้รับนิรนามที่ไม่ซ้ำ</strong>
        </div>
        <p className="incident-batch-review-expiry">ตัวอย่างนี้ใช้ได้ถึง {dateTimeLabel(draft.preview.expiresAt)} · การยืนยันรับเข้าคิว ไม่ได้ยืนยันการส่งหรือการอ่าน</p>
        <div className="incident-batch-common-text"><h4>{draft.mode === 'single' ? 'ข้อความสำหรับเคสที่เลือก' : 'ข้อความร่วม'}</h4><p>{draft.preview.commonText}</p></div>
        <ol className="incident-batch-packets">{draft.preview.deliveries.map(packet => <li key={packet.recipientCode}>
          <div className="incident-batch-packet-heading"><strong>{packet.recipientCode}</strong><span>{packet.cases.length} เคส</span></div>
          <ul className="incident-batch-packet-cases">{packet.cases.map(item => <li key={item.ticketId}><strong>{item.ticketCode}</strong><span>{item.reporterLabel}</span></li>)}</ul>
          <div className="incident-batch-messages"><h4>ข้อความที่เตรียมส่ง</h4>{packet.messages.map((message, index) => <pre key={`${packet.recipientCode}-${index}`}>{message.text}</pre>)}</div>
        </li>)}</ol>
        <button type="button" className="incident-primary-button" onClick={() => void confirmPreview()} disabled={confirmPhase === 'sending' || !canPersistRecovery}>
          {confirmPhase === 'sending' ? 'กำลังยืนยันรายการ…' : confirmPhase === 'uncertain' ? 'ลองยืนยันรายการเดิมอีกครั้ง' : 'ยืนยันและเข้าคิวส่งข้อความ'}
        </button>
        {!canPersistRecovery && <p className="incident-batch-message incident-batch-error" role="alert">ยังบันทึกใบยืนยันเดิมในเซสชันไม่ได้ จึงไม่ส่งคำขอ</p>}
      </section>}
    </>}

    {recovery.pendingRetries.length > 0 && <section className="incident-batch-recovery" aria-labelledby={`incident-batch-retries-${incidentId}`}>
      <h3 id={`incident-batch-retries-${incidentId}`}>ตรวจคำขอลองส่งเดิม</h3>
      <p>เรียกคำขอเดิมด้วยรหัสเดิมเพื่อดูว่ารับเข้าคิวแล้วหรือไม่ แม้สถานะปัจจุบันเป็นส่งแล้วหรือยังไม่ทราบผล จะไม่สร้างคำขอใหม่</p>
      <ul className="incident-batch-recovery-list">{recovery.pendingRetries.map(retry => {
        const operationKey = `${retry.batchId}:${retry.recipientCode}`;
        const operation = retryOperations[operationKey];
        return <li key={operationKey}>
          <div><strong>ช่องทางผู้รับนิรนาม {retry.recipientCode}</strong><span>คำขอลองส่งเดิม</span></div>
          {retryMessages[operationKey] && <p className="incident-batch-message" role="status">{retryMessages[operationKey]}</p>}
          <button type="button" className="incident-secondary-link" onClick={() => void retryRecipient(retry.batchId, retry.recipientCode)} disabled={!canPersistRecovery || Boolean(operation?.pending)}>
            {operation?.pending ? 'กำลังตรวจคำขอเดิม…' : 'ตรวจคำขอเดิมอีกครั้ง'}
          </button>
        </li>;
      })}</ul>
    </section>}

    <section className="incident-batch-results" aria-labelledby={`incident-batch-results-${incidentId}`}>
      <div className="incident-batch-results-heading">
        <div><h3 id={`incident-batch-results-${incidentId}`}>ผลการตอบกลับ</h3><p>รับเข้าคิวและผลส่งของแต่ละผู้รับแสดงแยกกัน</p></div>
        <button type="button" className="incident-secondary-link" onClick={() => void loadStatuses()} disabled={statusPhase === 'loading'}>
          {statusPhase === 'loading' ? 'กำลังโหลดผล…' : 'รีเฟรชผล'}
        </button>
      </div>
      {statusPhase === 'loading' && <p className="incident-batch-message" role="status">กำลังโหลดผลที่บันทึกไว้…</p>}
      {statusPhase === 'error' && errorState(statusError || 'โหลดผลตอบกลับไม่ได้')}
      {statusPhase === 'ready' && statusList && statusList.batches.length === 0 && <p className="incident-batch-message">ยังไม่มีข้อความที่รับเข้าคิว</p>}
      {statusPhase === 'ready' && statusList && statusList.batches.length > 0 && <ol className="incident-batch-list">{statusList.batches.map(batch => <li key={batch.batchId}>
        <div className="incident-batch-list-heading">
          <strong>รับเข้าคิวแล้ว</strong>
          <span>{batch.caseCount} เคส · {batch.recipientCount} ช่องทางผู้รับนิรนามที่ไม่ซ้ำ · {dateTimeLabel(batch.acceptedAt)}</span>
        </div>
        <ul className="incident-batch-recipient-list">{batch.recipients.map(recipient => {
          const operationKey = `${batch.batchId}:${recipient.recipientCode}`;
          const operation = retryOperations[operationKey];
          const retryIsPending = recovery.pendingRetries.some(item => item.batchId === batch.batchId && item.recipientCode === recipient.recipientCode);
          const canRetry = incidentBatchRecipientCanRetry(recipient) && statusPhase === 'ready' && canPersistRecovery && !retryIsPending;
          return <li key={recipient.recipientCode}>
            <div className="incident-batch-recipient-heading">
              <strong>{recipient.recipientCode}</strong>
              <span className={`incident-batch-delivery incident-batch-delivery-${recipient.deliveryStatus.toLowerCase()}`}>{incidentBatchDeliveryLabel(recipient.deliveryStatus)}</span>
            </div>
            <p>เคส: {recipient.ticketCodes.join(', ')}</p>
            {recipient.safeFailureCode && <p className="incident-batch-failure">{incidentBatchFailureLabel(recipient.safeFailureCode)}</p>}
            {recipient.deliveryStatus === 'SENT' && <p className="incident-batch-help">LINE รับข้อความแล้ว · ไม่ใช่หลักฐานว่าเปิดอ่านแล้ว</p>}
            {operation?.uncertain && <p className="incident-batch-message incident-batch-error" role="alert">ผลคำขอลองส่งยังไม่ชัดเจน ระบบจะใช้รหัสคำขอเดิมเมื่อลองซ้ำ</p>}
            {retryMessages[operationKey] && <p className="incident-batch-message" role="status">{retryMessages[operationKey]}</p>}
            {canRetry && <button type="button" className="incident-secondary-link" disabled={Boolean(operation?.pending)} onClick={() => void retryRecipient(batch.batchId, recipient.recipientCode)}>
              {operation?.pending ? 'กำลังขอลองส่ง…' : operation?.uncertain ? 'ลองคำขอเดิมอีกครั้ง' : 'ลองส่งผู้รับนี้อีกครั้ง'}
            </button>}
          </li>;
        })}</ul>
      </li>)}</ol>}
    </section>
  </section>;
}
