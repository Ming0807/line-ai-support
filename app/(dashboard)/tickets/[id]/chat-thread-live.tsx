'use client';

import { useState, type FormEvent, type RefObject } from 'react';
import type { InboxThreadResult } from '@/types/inbox';
import ChatThread from './chat-thread';
import TicketActions from './ticket-actions';
import {
  createThreadDraftStore,
  useChatThreadOps,
  useStaffInvalidateSupervisor,
  type ChatThreadAssist,
} from './chat-thread-ops';

type Props = { actorId: string; ticketId: string; initialThread: InboxThreadResult };

const ASSIST_STATUSES = ['WAITING_STAFF', 'STAFF_HANDLING', 'WAITING_USER'];

/**
 * Detail-route mount with ONE current authority (D4): the ops record (merged
 * by revision epoch from SSR thread + later RSC refreshes + refetches) feeds
 * the conversation, the assistant revision and the lifecycle panel. Ticket
 * actions live inside this bridge — SSR props can no longer shadow the live
 * permissions/revision after an authority change.
 */
export default function ChatThreadLive({ actorId, ticketId, initialThread }: Props) {
  const [draftsStore] = useState(createThreadDraftStore);
  const ops = useChatThreadOps({ actorId, ticketId, initialThread, draftsStore });
  const thread = ops.thread;

  // D8: the detail route carries the same lifetime wiring as the inbox — one
  // private-invalidate subscription, visible/online interval refresh, one cleanup.
  useStaffInvalidateSupervisor({ actorId, onInvalidate: ops.refresh });

  const assist: ChatThreadAssist = {
    available: thread !== null
      && thread.detail.ticket.mode === 'HUMAN'
      && ASSIST_STATUSES.includes(thread.detail.ticket.status),
    revision: thread?.detail.ticket.revision ?? initialThread.detail.ticket.revision,
    onDraft: (text: string) => {
      const live = ops.thread;
      if (!live) return;
      ops.applyAssistantDraft(actorId, ticketId, live.detail.ticket.revision, text);
    },
  };

  const draftChange = (kind: 'reply' | 'note', text: string) => ops.onDraftChange(kind, text);
  const noop = () => {};

  return (
    <>
      <section className="ticket-panel" aria-labelledby="conversation-heading">
        <div className="ticket-section-heading">
          <div><h2 id="conversation-heading">บทสนทนา</h2></div>
          <span className="ticket-message-count">
            {thread ? `${thread.messages.length}${thread.hasMore ? '+' : ''} ข้อความ` : 'กำลังโหลด…'}
          </span>
        </div>
        <ChatThread
          actorId={actorId}
          thread={ops.thread}
          loading={ops.loading}
          error={ops.error}
          hasStaleResponse={ops.hasStaleResponse}
          catchUpBefore={ops.catchUpBefore}
          historyLoading={ops.historyLoading}
          drafts={ops.drafts}
          attempts={ops.attempts}
          busy={ops.busy}
          notice={ops.notice}
          onDraftChange={draftChange}
          onLoadEarlier={() => void ops.loadEarlier()}
          onLoadCatchUp={() => void ops.loadCatchUp()}
          onAckRead={noop}
          onRefresh={ops.refresh}
          onSubmitReply={(event: FormEvent<HTMLFormElement>) => ops.onSubmitReply(event)}
          onSubmitNote={(event: FormEvent<HTMLFormElement>) => ops.onSubmitNote(event)}
          assist={assist}
          paneRef={ops.paneRef as RefObject<HTMLDivElement | null>}
          sentinelRef={ops.sentinelRef as RefObject<HTMLLIElement | null>}
        />
      </section>
      {thread && (
        <TicketActions
          key={`actions-${ticketId}`}
          actorId={actorId}
          id={ticketId}
          ticketNo={thread.detail.ticket.ticket_no}
          reporter={thread.detail.ticket.anonymous_code}
          revision={thread.detail.ticket.revision}
          permissions={thread.detail.permissions}
          assignees={thread.detail.assignees}
        />
      )}
    </>
  );
}
