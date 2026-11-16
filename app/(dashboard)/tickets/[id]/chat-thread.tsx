'use client';

import { useEffect, useRef, type FormEvent, type RefObject } from 'react';
import { deliveryEvidence, type DraftKind } from '../../inbox/controller';
import type { PendingWrite } from './chat-thread-state';
import {
  canShowOutboundAttachControl,
  formatOutboundFileSize,
  outboundMimeLabel,
  readOutboundAttachment,
  readOutboundFilesEnabled,
  studentAccessLabel,
  type InboxThreadWithOutbound,
} from './chat-outbound-state';
import type {
  ChatThreadAssist,
  ChatThreadNotice,
  ChatThreadOutboundOps,
  OutboundReadyDraft,
  OutboundRevokeState,
} from './chat-thread-ops';
import StaffAiPanel from './staff-ai-panel';
import StaffKnowledgePanel from './staff-knowledge-panel';
import StaffCopilotPanel from './staff-copilot-panel';

const senderLabels: Record<InboxThreadWithOutbound['messages'][number]['senderType'], string> = {
  USER: 'ผู้แจ้ง', AI: 'YRU AI', STAFF: 'เจ้าหน้าที่', SYSTEM: 'ระบบ',
};

const dateTimeFormatter = new Intl.DateTimeFormat('th-TH', { dateStyle: 'medium', timeStyle: 'short' });

function dateTime(value: string) {
  return dateTimeFormatter.format(new Date(value));
}

const DEFAULT_OUTBOUND_OPS: ChatThreadOutboundOps = {
  busy: null,
  upload: null,
  readyDraft: null,
  confirmDialogOpen: false,
  confirmAttempt: null,
  revokeState: null,
  onSelectFile: () => {},
  onRetryUpload: () => {},
  onDismissUploadError: () => {},
  onRemoveDraft: () => {},
  onOpenConfirmDialog: () => {},
  onCloseConfirmDialog: () => {},
  onConfirmSend: () => {},
  onOpenRevokeDialog: () => {},
  onCloseRevokeDialog: () => {},
  onConfirmRevoke: () => {},
};

type Props = {
  actorId: string;
  thread: InboxThreadWithOutbound | null;
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
  outbound?: ChatThreadOutboundOps;
  paneRef?: RefObject<HTMLDivElement | null>;
  sentinelRef?: RefObject<HTMLLIElement | null>;
};

const ASSIST_STATUSES = ['WAITING_STAFF', 'STAFF_HANDLING', 'WAITING_USER'];

function OutboundConfirmDialog({
  ticketNo,
  anonymousCode,
  revision,
  draft,
  submitting,
  uncertainError,
  onClose,
  onConfirm,
}: {
  ticketNo: string;
  anonymousCode: string;
  revision: number;
  draft: OutboundReadyDraft;
  submitting: boolean;
  uncertainError: string | null;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const cancelRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    const element = dialogRef.current;
    if (!element) return;
    const returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (typeof element.showModal === 'function' && !element.open) {
      element.showModal();
    }
    cancelRef.current?.focus();
    return () => {
      if (element.open && typeof element.close === 'function') element.close();
      if (returnFocus?.isConnected) returnFocus.focus();
    };
  }, []);

  const mimeInfo = outboundMimeLabel(draft.mimeType);

  return (
    <dialog
      ref={dialogRef}
      className="inbox-outbound-dialog"
      data-testid="outbound-confirm-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="outbound-confirm-title"
      onCancel={event => {
        event.preventDefault();
        if (!submitting) onClose();
      }}
    >
      <div className="inbox-outbound-dialog-head">
        <h3 id="outbound-confirm-title">ยืนยันผู้รับก่อนส่งไฟล์ให้นักศึกษา</h3>
        <button
          ref={cancelRef}
          type="button"
          className="inbox-outbound-dialog-close"
          aria-label="ปิดหน้าต่างยืนยัน"
          disabled={submitting}
          onClick={onClose}
        >
          ×
        </button>
      </div>
      <dl className="inbox-outbound-dialog-meta">
        <div><dt>เลขที่เคส</dt><dd>{ticketNo}</dd></div>
        <div><dt>ผู้แจ้ง</dt><dd>{anonymousCode}</dd></div>
        <div><dt>ชื่อไฟล์</dt><dd>{draft.name}</dd></div>
        <div><dt>ชนิดและขนาด</dt><dd>{mimeInfo.label} · {formatOutboundFileSize(draft.size)}</dd></div>
        <div><dt>เวอร์ชันเคส</dt><dd>revision {revision}</dd></div>
      </dl>
      <p className="inbox-outbound-dialog-note">
        ระบบจะส่งข้อความพร้อมลิงก์เปิดไฟล์ผ่าน LIFF ให้ผู้รับของเคสนี้เท่านั้น โดยไม่แสดงชื่อไฟล์ในข้อความ LINE
      </p>
      {uncertainError && (
        <p className="inbox-notice inbox-notice-error" role="alert">{uncertainError}</p>
      )}
      <div className="inbox-outbound-dialog-actions">
        <button
          type="button"
          className="inbox-button inbox-button-secondary"
          data-testid="outbound-confirm-cancel"
          disabled={submitting}
          onClick={onClose}
        >
          ยกเลิก
        </button>
        <button
          type="button"
          className="inbox-button inbox-button-primary"
          data-testid="outbound-confirm-submit"
          disabled={submitting}
          onClick={onConfirm}
        >
          {submitting
            ? 'กำลังยืนยันส่ง…'
            : uncertainError
              ? 'ลองยืนยันซ้ำด้วยคำขอเดิม'
              : 'ยืนยันส่งให้นักศึกษา'}
        </button>
      </div>
    </dialog>
  );
}

function OutboundRevokeDialog({
  ticketNo,
  revokeState,
  submitting,
  onClose,
  onConfirm,
}: {
  ticketNo: string;
  revokeState: OutboundRevokeState;
  submitting: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const cancelRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    const element = dialogRef.current;
    if (!element) return;
    const returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (typeof element.showModal === 'function' && !element.open) {
      element.showModal();
    }
    cancelRef.current?.focus();
    return () => {
      if (element.open && typeof element.close === 'function') element.close();
      if (returnFocus?.isConnected) returnFocus.focus();
    };
  }, []);

  return (
    <dialog
      ref={dialogRef}
      className="inbox-outbound-dialog"
      data-testid="outbound-revoke-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="outbound-revoke-title"
      onCancel={event => {
        event.preventDefault();
        if (!submitting) onClose();
      }}
    >
      <div className="inbox-outbound-dialog-head">
        <h3 id="outbound-revoke-title">ยืนยันการถอนสิทธิ์เปิดไฟล์</h3>
        <button
          ref={cancelRef}
          type="button"
          className="inbox-outbound-dialog-close"
          aria-label="ปิดหน้าต่างถอนสิทธิ์"
          disabled={submitting}
          onClick={onClose}
        >
          ×
        </button>
      </div>
      <dl className="inbox-outbound-dialog-meta">
        <div><dt>เลขที่เคส</dt><dd>{ticketNo}</dd></div>
        <div><dt>ชื่อไฟล์</dt><dd>{revokeState.attachmentName}</dd></div>
      </dl>
      <p className="inbox-outbound-dialog-note">
        ข้อความที่ส่งไปแล้วใน LINE จะยังคงอยู่ แต่ลิงก์เปิดไฟล์จะไม่สามารถเปิดดูได้อีกต่อไป
      </p>
      {revokeState.phase === 'error' && revokeState.errorText && (
        <p className="inbox-notice inbox-notice-error" role="alert">{revokeState.errorText}</p>
      )}
      <div className="inbox-outbound-dialog-actions">
        <button
          type="button"
          className="inbox-button inbox-button-secondary"
          data-testid="outbound-revoke-cancel"
          disabled={submitting}
          onClick={onClose}
        >
          ยกเลิก
        </button>
        <button
          type="button"
          className="inbox-button inbox-button-primary"
          data-testid="outbound-revoke-submit"
          disabled={submitting}
          onClick={onConfirm}
        >
          {submitting ? 'กำลังถอนสิทธิ์…' : 'ยืนยันถอนสิทธิ์'}
        </button>
      </div>
    </dialog>
  );
}

export default function ChatThread({
  thread, loading, error, drafts, attempts, busy, notice, hasStaleResponse, catchUpBefore, historyLoading,
  onDraftChange, onLoadEarlier, onLoadCatchUp, onRefresh, onSubmitReply, onSubmitNote, assist,
  outbound: externalOutbound,
  paneRef: externalPaneRef, sentinelRef: externalSentinelRef,
}: Props) {
  const internalPaneRef = useRef<HTMLDivElement | null>(null);
  const internalSentinelRef = useRef<HTMLLIElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const paneRef = externalPaneRef ?? internalPaneRef;
  const sentinelRef = externalSentinelRef ?? internalSentinelRef;
  const outbound = externalOutbound ?? DEFAULT_OUTBOUND_OPS;
  const ticket = thread?.detail.ticket ?? null;
  const anyBusy = busy !== null || outbound.busy !== null;
  const assistVisible = assist.available
    && ticket !== null
    && ticket.mode === 'HUMAN'
    && ASSIST_STATUSES.includes(ticket.status);
  const showOutboundAttach = thread !== null && canShowOutboundAttachControl({
    outboundFiles: { enabled: readOutboundFilesEnabled(thread) },
    canReply: thread.detail.permissions.reply,
    ticketMode: thread.detail.ticket.mode,
    composerKind: 'reply',
  });

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
              {thread.messages.map(message => {
                const outboundAttachment = readOutboundAttachment(message);
                const accessInfo = outboundAttachment ? studentAccessLabel(outboundAttachment.studentAccess) : null;
                const outboundMime = outboundAttachment ? outboundMimeLabel(outboundAttachment.mimeType) : null;
                return (
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
                      {outboundAttachment && accessInfo && outboundMime && (
                        <div className="inbox-outbound-attachment" data-testid="outbound-message-attachment">
                          <span className="inbox-outbound-badge" aria-hidden="true">{outboundMime.badge}</span>
                          <div className="inbox-outbound-attachment-info">
                            <span className="inbox-attachment-name" title={outboundAttachment.name}>{outboundAttachment.name}</span>
                            <small>{outboundMime.label} · {formatOutboundFileSize(outboundAttachment.size)}</small>
                            <span className={`inbox-outbound-access inbox-outbound-access-${accessInfo.tone}`} data-testid="outbound-student-access">
                              {accessInfo.text}
                            </span>
                          </div>
                          {outboundAttachment.canRevoke && (
                            <button
                              type="button"
                              className="inbox-button inbox-button-secondary inbox-outbound-revoke-btn"
                              data-testid="outbound-revoke-open"
                              disabled={anyBusy}
                              onClick={() => outbound.onOpenRevokeDialog(outboundAttachment)}
                            >
                              ถอนสิทธิ์เปิดไฟล์
                            </button>
                          )}
                        </div>
                      )}
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
                );
              })}
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
                {showOutboundAttach && (
                  <div className="inbox-attach-row" data-testid="outbound-attach-control">
                    <label htmlFor="chat-outbound-file" className="inbox-attach-label">
                      แนบไฟล์ให้ผู้แจ้ง (PDF, JPEG, PNG ไม่เกิน 10 MiB)
                    </label>
                    <input
                      ref={fileInputRef}
                      id="chat-outbound-file"
                      data-testid="outbound-file-input"
                      type="file"
                      accept="application/pdf,image/jpeg,image/png"
                      className="inbox-attach-input"
                      disabled={anyBusy}
                      onChange={event => {
                        const picked = event.currentTarget.files?.[0] ?? null;
                        event.currentTarget.value = '';
                        if (picked) outbound.onSelectFile(picked);
                      }}
                    />
                  </div>
                )}
                <div className="inbox-compose-footer">
                  <span>{drafts.reply.length}/5,000 · ร่างอยู่ในหน่วยความจำของแท็บนี้</span>
                  <button type="submit" className="inbox-button inbox-button-primary" disabled={anyBusy || !drafts.reply.trim()}>
                    {busy === 'reply' ? 'กำลังบันทึก…' : attempts.reply ? 'ส่งซ้ำด้วยคำขอเดิม' : 'ส่งข้อความ'}
                  </button>
                </div>
              </form>
            ) : (
              <p className="inbox-readonly-note">คุณไม่มีสิทธิ์ตอบกลับ หรือเคสนี้ยังไม่อยู่ในสถานะที่ตอบได้</p>
            )}
            {outbound.upload && (
              <div className="inbox-outbound-upload-status" data-testid="outbound-upload-status" role="status">
                <span>
                  {(outbound.upload.phase === 'hashing' || outbound.upload.phase === 'uploading')
                    ? `กำลังอัปโหลดร่างไฟล์: ${outbound.upload.fileName} (${formatOutboundFileSize(outbound.upload.size)})…`
                    : (outbound.upload.errorText ?? 'อัปโหลดร่างไฟล์ไม่สำเร็จ')}
                </span>
                <div className="inbox-outbound-upload-actions">
                  {outbound.upload.phase === 'retryable-error' && (
                    <button
                      type="button"
                      className="inbox-button inbox-button-secondary"
                      data-testid="outbound-upload-retry"
                      disabled={anyBusy}
                      onClick={outbound.onRetryUpload}
                    >
                      ลองอัปโหลดอีกครั้ง
                    </button>
                  )}
                  {(outbound.upload.phase === 'retryable-error' || outbound.upload.phase === 'needs-reselect-error') && (
                    <button
                      type="button"
                      className="inbox-button inbox-button-secondary"
                      onClick={outbound.onDismissUploadError}
                    >
                      ยกเลิก
                    </button>
                  )}
                </div>
              </div>
            )}
                {outbound.readyDraft && (
                  <div className="inbox-draft-card" data-testid="outbound-draft-card">
                    <div className="inbox-draft-card-main">
                      <span className="inbox-outbound-badge" aria-hidden="true">
                        {outboundMimeLabel(outbound.readyDraft.mimeType).badge}
                      </span>
                      <div className="inbox-draft-card-meta">
                        <strong className="inbox-attachment-name">{outbound.readyDraft.name}</strong>
                        <span>
                          {outboundMimeLabel(outbound.readyDraft.mimeType).label} · {formatOutboundFileSize(outbound.readyDraft.size)}
                        </span>
                        <span className="inbox-draft-badge">ยังไม่ได้ส่งถึงนักศึกษา</span>
                        {outbound.confirmAttempt?.attachmentId === outbound.readyDraft.attachmentId && outbound.confirmAttempt.phase === 'submitting' && (
                          <p className="inbox-draft-warning" role="status">กำลังยืนยันส่งไฟล์ให้นักศึกษา…</p>
                        )}
                        {outbound.confirmAttempt?.attachmentId === outbound.readyDraft.attachmentId && outbound.confirmAttempt.phase === 'uncertain' && (
                          <p className="inbox-notice inbox-notice-error" role="alert">
                            {outbound.confirmAttempt.errorText}
                          </p>
                        )}
                        <p className="inbox-draft-warning">
                          ร่างนี้แสดงเฉพาะในแท็บนี้ หากโหลดหน้าใหม่ร่างที่ยังไม่ยืนยันจะหายไปจากหน้าจอ (ไฟล์ร่างยังเก็บแบบส่วนตัวในระบบ)
                        </p>
                      </div>
                    </div>
                    <div className="inbox-draft-card-actions">
                      {outbound.confirmAttempt?.attachmentId === outbound.readyDraft.attachmentId && outbound.confirmAttempt.phase === 'uncertain' ? (
                        <button
                          type="button"
                          className="inbox-button inbox-button-primary"
                          data-testid="outbound-confirm-retry"
                          disabled={anyBusy || !showOutboundAttach}
                          onClick={outbound.onConfirmSend}
                        >
                          ลองยืนยันซ้ำด้วยคำขอเดิม
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="inbox-button inbox-button-primary"
                          data-testid="outbound-draft-confirm-open"
                          disabled={anyBusy || !showOutboundAttach}
                          onClick={outbound.onOpenConfirmDialog}
                        >
                          ส่งให้นักศึกษา
                        </button>
                      )}
                      <button
                        type="button"
                        className="inbox-button inbox-button-secondary"
                        data-testid="outbound-draft-remove"
                        disabled={anyBusy}
                        onClick={outbound.onRemoveDraft}
                      >
                        นำออก
                      </button>
                    </div>
                  </div>
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
                  <button className="inbox-button inbox-button-secondary" type="submit" disabled={anyBusy || !drafts.note.trim()}>
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
                <StaffAiPanel key={`summary:${thread.detail.ticket.id}:${assist.revision}`} id={thread.detail.ticket.id} revision={assist.revision} canReply={thread.detail.permissions.reply && !anyBusy} onDraft={assist.onDraft} />
                <StaffKnowledgePanel key={`knowledge:${thread.detail.ticket.id}:${assist.revision}`} id={thread.detail.ticket.id} revision={assist.revision} canReply={thread.detail.permissions.reply && !anyBusy} onDraft={assist.onDraft} />
                <StaffCopilotPanel key={`copilot:${thread.detail.ticket.id}:${assist.revision}`} id={thread.detail.ticket.id} revision={assist.revision} canReply={thread.detail.permissions.reply && !anyBusy} onDraft={assist.onDraft} />
              </section>
            )}
          </div>
          {outbound.confirmDialogOpen && outbound.readyDraft && (
            <OutboundConfirmDialog
              ticketNo={thread.detail.ticket.ticket_no}
              anonymousCode={thread.detail.ticket.anonymous_code}
              revision={outbound.confirmAttempt?.revision ?? thread.detail.ticket.revision}
              draft={outbound.readyDraft}
              submitting={outbound.busy === 'confirm'}
              uncertainError={outbound.confirmAttempt?.phase === 'uncertain' ? outbound.confirmAttempt.errorText : null}
              onClose={outbound.onCloseConfirmDialog}
              onConfirm={outbound.onConfirmSend}
            />
          )}
          {outbound.revokeState && (
            <OutboundRevokeDialog
              ticketNo={thread.detail.ticket.ticket_no}
              revokeState={outbound.revokeState}
              submitting={outbound.busy === 'revoke'}
              onClose={outbound.onCloseRevokeDialog}
              onConfirm={outbound.onConfirmRevoke}
            />
          )}
        </>
      )}
    </div>
  );
}
