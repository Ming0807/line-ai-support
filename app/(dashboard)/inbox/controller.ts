export type DraftKind = 'reply' | 'note';
export type Drafts = Record<string, string>;
export type DeliveryStatus = 'PENDING' | 'PROCESSING' | 'SENT' | 'RETRY' | 'UNKNOWN' | 'DEAD' | 'SUPPRESSED';
export type DeliveryEvidence = { kind: DeliveryStatus | 'unproven'; text: string };

export function deliveryEvidence(senderType: 'USER' | 'AI' | 'STAFF' | 'SYSTEM', status: DeliveryStatus | null): DeliveryEvidence | null {
  if (status === null) return senderType === 'AI' || senderType === 'STAFF' ? { kind: 'unproven', text: 'ยังไม่มีหลักฐานการส่ง' } : null;
  const labels: Record<DeliveryStatus, string> = {
    PENDING: 'รอส่ง', PROCESSING: 'กำลังส่ง', SENT: 'ส่งแล้ว', RETRY: 'รอลองส่งอีกครั้ง',
    UNKNOWN: 'กำลังตรวจสอบผล', DEAD: 'ส่งไม่สำเร็จ', SUPPRESSED: 'ระงับการส่ง',
  };
  return { kind: status, text: labels[status] };
}

export type RetryRequest = { body: Record<string, string | number>; text: string };

export function draftKey(actorId: string, ticketId: string, kind: DraftKind) {
  return `${actorId}:${ticketId}:${kind}`;
}

export function readDraft(drafts: Drafts, actorId: string, ticketId: string, kind: DraftKind) {
  return drafts[draftKey(actorId, ticketId, kind)] ?? '';
}

export function writeDraft(drafts: Drafts, actorId: string, ticketId: string, kind: DraftKind, text: string): Drafts {
  return { ...drafts, [draftKey(actorId, ticketId, kind)]: text };
}

export function actorMountKey(actorId: string) { return `staff:${actorId}`; }

export function requestForText(
  previous: RetryRequest | undefined,
  text: string,
  fields: Record<string, string | number>,
  createRequestId: () => string,
): RetryRequest {
  if (previous?.text === text) return previous;
  return { text, body: { ...fields, requestId: createRequestId() } };
}

/** A 4xx is a definitive reject. Keep request IDs after network or server uncertainty. */
export function retryAfterStatus(status: number | 'network'): 'keep' | 'clear' {
  return status === 'network' || status >= 500 ? 'keep' : 'clear';
}

export function shouldClearSelectedThread(input: { status: number; requestIsCurrent: boolean; requestTicketId: string; selectedTicketId: string | null }) {
  return input.requestIsCurrent && input.requestTicketId === input.selectedTicketId &&
    (input.status === 401 || input.status === 403 || input.status === 404);
}

export function assistantDraftDisposition(input: {
  currentActorId: string;
  sourceActorId: string;
  currentTicketId: string;
  sourceTicketId: string;
  currentRevision: number;
  sourceRevision: number;
  canReply: boolean;
  busy: boolean;
  draftText: string;
  currentReply: string;
}): 'apply' | 'confirm' | 'reject' {
  if (input.currentActorId !== input.sourceActorId || input.currentTicketId !== input.sourceTicketId ||
      input.currentRevision !== input.sourceRevision || !input.canReply || input.busy ||
      !input.draftText.trim() || input.draftText.length > 5_000) return 'reject';
  return input.currentReply.trim() ? 'confirm' : 'apply';
}

export type ThreadRequestToken = { actorId: string; ticketId: string; sequence: number };

/** Prevent late requests from a previous selection/session replacing the visible thread. */
export class ThreadRequestFence {
  private actorId: string;
  private ticketId: string | null;
  private sequence = 0;
  private latest = 0;

  constructor(actorId: string, ticketId: string | null) {
    this.actorId = actorId;
    this.ticketId = ticketId;
  }

  select(actorId: string, ticketId: string | null) {
    this.actorId = actorId;
    this.ticketId = ticketId;
    this.latest = ++this.sequence;
  }

  begin(actorId: string, ticketId: string): ThreadRequestToken {
    const sequence = ++this.sequence;
    this.latest = sequence;
    return { actorId, ticketId, sequence };
  }

  accepts(token: ThreadRequestToken) {
    return token.actorId === this.actorId && token.ticketId === this.ticketId && token.sequence === this.latest;
  }
}

export function shouldAcknowledgeRead(input: {
  documentVisible: boolean;
  rendered: boolean;
  sentinelVisible: boolean;
  latestSequence: number;
  readThroughSequence: number;
}) {
  return input.documentVisible && input.rendered && input.sentinelVisible && input.latestSequence > input.readThroughSequence;
}

export type ScrollAnchor = { scrollTop: number; scrollHeight: number; stickToBottom: boolean };

export function restoredScrollTop(anchor: ScrollAnchor, currentScrollHeight: number) {
  return anchor.stickToBottom ? currentScrollHeight : anchor.scrollTop + (currentScrollHeight - anchor.scrollHeight);
}

export interface VisibilityDocument {
  visibilityState: DocumentVisibilityState;
  addEventListener(type: 'visibilitychange', listener: () => void): void;
  removeEventListener(type: 'visibilitychange', listener: () => void): void;
}

export interface IntervalHost {
  setInterval(callback: () => void, milliseconds: number): number;
  clearInterval(handle: number): void;
}

export function installVisibleRefresh(
  documentLike: VisibilityDocument,
  timers: IntervalHost,
  refresh: () => void,
  intervalMs = 5000,
) {
  const refreshIfVisible = () => {
    if (documentLike.visibilityState === 'visible') refresh();
  };
  const onVisibilityChange = () => refreshIfVisible();
  const interval = timers.setInterval(refreshIfVisible, intervalMs);
  documentLike.addEventListener('visibilitychange', onVisibilityChange);
  return () => {
    timers.clearInterval(interval);
    documentLike.removeEventListener('visibilitychange', onVisibilityChange);
  };
}
