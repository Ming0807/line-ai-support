'use client';

import { useRef, type FormEvent, type RefObject } from 'react';
import type { InboxThreadResult } from '@/types/inbox';
import { deliveryEvidence, type DraftKind } from '../../inbox/controller';
import type { PendingWrite } from './chat-thread-state';
import type { ChatThreadAssist, ChatThreadNotice } from './chat-thread-ops';
import StaffAiPanel from './staff-ai-panel';
import StaffKnowledgePanel from './staff-knowledge-panel';
import StaffCopilotPanel from './staff-copilot-panel';

const senderLabels: Record<InboxThreadResult['messages'][number]['senderType'], string> = {
  USER: 'ผู้แจ้ง', AI: 'YRU AI', STAFF: 'เจ้าหน้าที่', SYSTEM: 'ระบบ',
};

const dateTimeFormatter = new Intl.DateTimeFormat('th-TH', { dateStyle: 'medium', timeStyle: 'short' });

function dateTime(value: string) {
  return dateTimeFormatter.format(new Date(value));
}

type Props = {
  actorId: string;
  thread: InboxThreadResult | null;
  loading: boolean;
  error: string;
  drafts: { reply: string; note: string };
  attempts: { reply: PendingWrite | null; note: PendingWrite | null };
  busy: DraftKind | null;
  notice: ChatThreadNotice | null;
  hasStaleResponse: boolean;
  catchUpBefore: number | null;
  historyLoading: boolean;
  onDraftChange: (kind: DraftKind, text: string) => void;
  onLoadEarlier: () => void;
  onLoadCatchUp: () => void;
  onAckRead?: () => void;
  onRefresh: () => void;
  onSubmitReply: (event: FormEvent<HTMLFormElement>) => void;
  onSubmitNote: (event: FormEvent<HTMLFormElement>) => void;
  assist: ChatThreadAssist;
  paneRef?: RefObject<HTMLDivElement | null>;
  sentinelRef?: RefObject<HTMLLIElement | null>;
};

const ASSIST_STATUSES = ['WAITING_STAFF', 'STAFF_HANDLING', 'WAITING_USER'];

export default function ChatThread({
  thread, loading, error, drafts, attempts, busy, notice, hasStaleResponse, catchUpBefore, historyLoading,
  onDraftChange, onLoadEarlier, onLoadCatchUp, onRefresh, onSubmitReply, onSubmitNote, assist,
  paneRef: externalPaneRef, sentinelRef: externalSentinelRef,
}: Props) {
  const internalPaneRef = useRef<HTMLDivElement | null>(null);
  const internalSentinelRef = useRef<HTMLLIElement | null>(null);
  const paneRef = externalPaneRef ?? internalPaneRef;
  const sentinelRef = externalSentinelRef ?? internalSentinelRef;
  const ticket = thread?.detail.ticket ?? null;
  const assistVisible = assist.available
    && ticket !== null
    && ticket.mode === 'HUMAN'
    && ASSIST_STATUSES.includes(ticket.status);

  return (
    <div className="inbox-thread">
      {!thread ? (
        loading ? <p className="inbox-empty-state">กำลังโหลดบทสนทนา…</p>
          : error ? (
            <div className="inbox-welcome" role="alert">
              <h2>เปิดบทสนทนาไม่ได้</h2>
              <p>{error}</p>
              <button type="button" className="inbox-button inbox-button-secondary" onClick={onRefresh}>ลองโหลดใหม่</button>
            </div>
          ) : null
      ) : (
        <>
          <header className="inbox-conversation-header">
            <div className="inbox-conversation-title">
              <h2>{thread.detail.ticket.problem_summary}</h2>
              <p>{thread.detail.ticket.ticket_no} · ผู้แจ้ง {thread.detail.ticket.anonymous_code} · {thread.detail.ticket.category}</p>
            </div>
          </header>
          <div className="inbox-message-scroll" ref={paneRef}>
            {error && <p className="inbox-inline-error" role="alert">{error}<button type="button" className="inbox-notice-refresh" onClick={onRefresh}>โหลดข้อมูลล่าสุด</button></p>}
            {hasStaleResponse && <p className="inbox-inline-notice" role="status">ข้อมูลมีการเปลี่ยนแปลง · ตรวจข้อมูลล่าสุดก่อนดำเนินการ<button type="button" className="inbox-notice-refresh" onClick={onRefresh}>โหลดใหม่</button></p>}
            {thread.hasMore && (
              <div className="inbox-history-control">
                <button type="button" onClick={onLoadEarlier} disabled={historyLoading}>{historyLoading ? 'กำลังโหลด…' : 'โหลดข้อความก่อนหน้า'}</button>
              </div>
            )}
            {catchUpBefore !== null && (
              <div className="inbox-gap-control">
                <span className="inbox-gap-note">ยังไม่โหลดครบ</span>
                <button type="button" onClick={onLoadCatchUp} disabled={historyLoading}>{historyLoading ? 'กำลังโหลด…' : 'โหลดช่วงที่ขาด'}</button>
              </div>
            )}
            <ol className="inbox-messages" aria-label="ประวัติบทสนทนา">
              {thread.messages.map(message => (
                <li key={message.id} className={`inbox-message inbox-message-${message.senderType.toLowerCase()}`}>
                  <div className="inbox-message-meta">
                    <span>{senderLabels[message.senderType]}{message.senderType === 'STAFF' && message.staffName ? ` · ${message.staffName}` : ''}</span>
                    <time dateTime={message.createdAt}>{dateTime(message.createdAt)}</time>
                  </div>
                  <div className="inbox-message-bubble">
                    <p>{message.content}</p>
                    {message.attachments.map(file => (
                      <div className="inbox-attachment inbox-attachment-long" key={file.id}>
                        <span aria-hidden="true">{file.mimeType === 'application/pdf' ? 'PDF' : 'IMG'}</span>
                        <span className="inbox-attachment-name" title={file.name}>
                          {file.name}
                          <small>{file.status === 'PENDING' ? 'กำลังเตรียมไฟล์' : file.status === 'FAILED' ? 'ไฟล์ยังเปิดไม่ได้' : `${Math.max(1, Math.round(file.size / 1024))} KB`}</small>
                        </span>
                        {file.status === 'READY' && file.downloadUrl ? <a href={file.downloadUrl} target="_blank" rel="noreferrer">เปิด</a> : null}
                      </div>
                    ))}
                  </div>
                  {(() => {
                    const evidence = deliveryEvidence(message.senderType, message.deliveryStatus);
                    if (!evidence) return null;
                    return (
                      <span className={`inbox-delivery inbox-delivery-${evidence.kind.toLowerCase()}`}>
                        {evidence.kind === 'unproven' ? evidence.text : `สถานะข้อความ: ${evidence.text}`}
                        {evidence.kind === 'SENT' && <small> ไม่ได้ยืนยันว่าผู้ใช้เปิดอ่าน</small>}
                      </span>
                    );
                  })()}
                </li>
              ))}
              <li ref={sentinelRef} className="inbox-bottom-sentinel" aria-hidden="true" />
            </ol>
            {thread.messages.length === 0 && <p className="inbox-empty-state">ยังไม่มีข้อความในบทสนทนานี้</p>}
          </div>
          <div className="inbox-composer-wrap">
            {notice && (
              <p className={`inbox-notice inbox-notice-${notice.kind}`} role={notice.kind === 'error' ? 'alert' : 'status'}>
                {notice.text}
                {notice.kind === 'error' && notice.text.includes('เคสมีการเปลี่ยนแปลง') && (
                  <button type="button" className="inbox-notice-refresh" onClick={onRefresh}>โหลดข้อมูลล่าสุด</button>
                )}
              </p>
            )}
            {thread.detail.permissions.reply ? (
              <form className="inbox-reply-form" data-testid="chat-reply-composer" onSubmit={onSubmitReply}>
                <label htmlFor="chat-reply">
                  ตอบกลับผู้แจ้ง
                  <span>ข้อความจะส่งถึง {thread.detail.ticket.ticket_no} · ผู้แจ้ง {thread.detail.ticket.anonymous_code} เท่านั้น</span>
                </label>
                <textarea
                  id="chat-reply"
                  value={drafts.reply}
                  maxLength={5000}
                  onChange={event => onDraftChange('reply', event.target.value)}
                  placeholder="เขียนข้อความตอบกลับ…"
                  rows={3}
                />
                <div className="inbox-compose-footer">
                  <span>{drafts.reply.length}/5,000 · ร่างอยู่ในหน่วยความจำของแท็บนี้</span>
                  <button type="submit" className="inbox-button inbox-button-primary" disabled={busy !== null || !drafts.reply.trim()}>
                    {busy === 'reply' ? 'กำลังบันทึก…' : attempts.reply ? 'ส่งซ้ำด้วยคำขอเดิม' : 'ส่งข้อความ'}
                  </button>
                </div>
              </form>
            ) : (
              <p className="inbox-readonly-note">คุณไม่มีสิทธิ์ตอบกลับ หรือเคสนี้ยังไม่อยู่ในสถานะที่ตอบได้</p>
            )}
            <details className="inbox-note-disclosure" data-testid="chat-note-composer">
              <summary>บันทึกส่วนตัวสำหรับเจ้าหน้าที่</summary>
              <form onSubmit={onSubmitNote}>
                <label htmlFor="chat-note" className="sr-only">บันทึกส่วนตัว</label>
                <textarea
                  id="chat-note"
                  value={drafts.note}
                  maxLength={4000}
                  onChange={event => onDraftChange('note', event.target.value)}
                  placeholder="บันทึกนี้ผู้แจ้งจะไม่เห็น"
                  rows={2}
                />
                <div className="inbox-compose-footer">
                  <span>{drafts.note.length} / 4,000 ตัวอักษร</span>
                  <button className="inbox-button inbox-button-secondary" type="submit" disabled={busy !== null || !drafts.note.trim()}>
                    {busy === 'note' ? 'กำลังบันทึก…' : attempts.note ? 'บันทึกซ้ำด้วยคำขอเดิม' : 'เพิ่มบันทึก'}
                  </button>
                </div>
              </form>
              {thread.notes.length > 0 && (
                <ul className="inbox-notes">
                  {thread.notes.map(item => (
                    <li key={item.id}><p>{item.text}</p><span>{item.staffName} · {dateTime(item.createdAt)}</span></li>
                  ))}
                </ul>
              )}
            </details>
            {assistVisible && (
              <section className="inbox-assist-tools inbox-thread-assist" aria-label="เครื่องมือช่วยร่าง">
                <h3>เครื่องมือช่วยร่าง</h3>
                <StaffAiPanel key={`summary:${thread.detail.ticket.id}:${assist.revision}`} id={thread.detail.ticket.id} revision={assist.revision} canReply={thread.detail.permissions.reply && busy === null} onDraft={assist.onDraft} />
                <StaffKnowledgePanel key={`knowledge:${thread.detail.ticket.id}:${assist.revision}`} id={thread.detail.ticket.id} revision={assist.revision} canReply={thread.detail.permissions.reply && busy === null} onDraft={assist.onDraft} />
                <StaffCopilotPanel key={`copilot:${thread.detail.ticket.id}:${assist.revision}`} id={thread.detail.ticket.id} revision={assist.revision} canReply={thread.detail.permissions.reply && busy === null} onDraft={assist.onDraft} />
              </section>
            )}
          </div>
        </>
      )}
    </div>
  );
}
