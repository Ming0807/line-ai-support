import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactNode } from 'react';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn(), push: vi.fn() }),
}));

import ChatThread from '@/app/(dashboard)/tickets/[id]/chat-thread';
import type { InboxThreadWithOutbound, StudentAttachmentAccess } from '@/app/(dashboard)/tickets/[id]/chat-outbound-state';
import type { ChatThreadOutboundOps } from '@/app/(dashboard)/tickets/[id]/chat-thread-ops';

const html = (node: ReactNode) => renderToStaticMarkup(node);

function makeThread(overrides: Partial<InboxThreadWithOutbound> = {}): InboxThreadWithOutbound {
  return {
    detail: {
      ticket: {
        id: '11111111-1111-4111-8111-111111111111',
        ticket_no: 'YRU-20260001',
        department_id: '22222222-2222-4222-8222-222222222222',
        department_name: 'งานทะเบียน',
        category: 'REG_ALL',
        problem_summary: 'ขอเอกสารรับรอง',
        priority: 'HIGH',
        status: 'STAFF_HANDLING',
        mode: 'HUMAN',
        sensitive_level: 'GENERAL',
        assigned_staff_id: 'staff-a',
        assignee_name: 'เจ้าหน้าที่เอ',
        revision: 7,
        created_at: '2026-10-28T01:00:00.000Z',
        updated_at: '2026-10-28T02:00:00.000Z',
        anonymous_code: 'A1B2C3',
      },
      messages: [],
      history: [],
      assignees: [],
      deliveries: [],
      permissions: { accept: false, reply: true, resolve: true, close: true, reassign: true, reopen: false },
    },
    messages: [
      {
        id: 'm-1',
        sequence: 1,
        senderType: 'USER',
        staffName: null,
        content: 'ขอแบบฟอร์มคำร้องครับ',
        createdAt: '2026-10-28T01:00:00.000Z',
        deliveryStatus: null,
        attachments: [],
      },
    ],
    notes: [],
    latestSequence: 1,
    readThroughSequence: 1,
    hasMore: false,
    nextBefore: null,
    outboundFiles: { enabled: true },
    ...overrides,
  };
}

function renderThread(thread: InboxThreadWithOutbound, outbound?: ChatThreadOutboundOps) {
  return html(
    <ChatThread
      actorId="staff-a"
      thread={thread}
      loading={false}
      error=""
      drafts={{ reply: '', note: '' }}
      attempts={{ reply: null, note: null }}
      busy={null}
      notice={null}
      hasStaleResponse={false}
      catchUpBefore={null}
      historyLoading={false}
      onDraftChange={() => {}}
      onLoadEarlier={() => {}}
      onLoadCatchUp={() => {}}
      onAckRead={() => {}}
      onRefresh={() => {}}
      onSubmitReply={() => {}}
      onSubmitNote={() => {}}
      assist={{ available: false, revision: 7, onDraft: () => {} }}
      outbound={outbound}
    />,
  );
}

describe('ChatThread outbound attachment visibility and 02H rendering', () => {
  it('shows file attach input inside reply composer ONLY when outboundFiles.enabled, permissions.reply, and HUMAN mode', () => {
    const enabledHtml = renderThread(makeThread());
    expect(enabledHtml).toContain('type="file"');
    expect(enabledHtml).toContain('accept="application/pdf,image/jpeg,image/png"');
    expect(enabledHtml).toContain('แนบไฟล์');

    // Never renders inside note composer.
    const noteSection = enabledHtml.split('data-testid="chat-note-composer"')[1] ?? '';
    expect(noteSection).not.toContain('type="file"');

    // Hidden when outboundFiles missing or false.
    const absentHtml = renderThread(makeThread({ outboundFiles: undefined }));
    expect(absentHtml).not.toContain('type="file"');
    const disabledHtml = renderThread(makeThread({ outboundFiles: { enabled: false } }));
    expect(disabledHtml).not.toContain('type="file"');

    // Hidden when permissions.reply is false.
    const noReply = makeThread();
    noReply.detail.permissions.reply = false;
    expect(renderThread(noReply)).not.toContain('type="file"');

    // Hidden when ticket mode is AI.
    const aiMode = makeThread();
    aiMode.detail.ticket.mode = 'AI';
    expect(renderThread(aiMode)).not.toContain('type="file"');
  });

  it('renders outboundAttachment metadata, all 5 studentAccess Thai labels, and canRevoke button strictly from DTO', () => {
    const states: Array<{ status: StudentAttachmentAccess; expectedText: string; canRevoke: boolean }> = [
      { status: 'WAITING_DELIVERY', expectedText: 'รอส่งถึง LINE', canRevoke: true },
      { status: 'AVAILABLE', expectedText: 'นักศึกษาเปิดได้', canRevoke: true },
      { status: 'EXPIRED', expectedText: 'หมดเวลาเปิด (30 วัน)', canRevoke: false },
      { status: 'REVOKED', expectedText: 'ถอนสิทธิ์แล้ว', canRevoke: false },
      { status: 'NOT_DELIVERED', expectedText: 'ส่งไม่สำเร็จ', canRevoke: false },
    ];

    for (const item of states) {
      const thread = makeThread({
        messages: [
          {
            id: 'm-staff-file',
            sequence: 2,
            senderType: 'STAFF',
            staffName: 'เจ้าหน้าที่เอ',
            content: 'ส่งไฟล์คำร้อง https://liff.line.me/1234567890-abc?attachment=att-1',
            createdAt: '2026-10-28T01:05:00.000Z',
            deliveryStatus: 'SENT',
            attachments: [],
            outboundAttachment: {
              id: '55555555-5555-4555-8555-555555555555',
              name: 'คู่มือลงทะเบียน.pdf',
              mimeType: 'application/pdf',
              size: 4096,
              studentAccess: item.status,
              canRevoke: item.canRevoke,
            },
          },
        ],
      });
      const markup = renderThread(thread);
      expect(markup).toContain('คู่มือลงทะเบียน.pdf');
      expect(markup).toContain(item.expectedText);
      if (item.canRevoke) {
        expect(markup).toContain('ถอนสิทธิ์เปิดไฟล์');
      } else {
        expect(markup).not.toContain('ถอนสิทธิ์เปิดไฟล์');
      }
    }
  });

  it('renders READY draft card, retryable upload state, confirm dialog, and revoke dialog accurately', () => {
    const baseOps: ChatThreadOutboundOps = {
      busy: null,
      upload: null,
      readyDraft: {
        attachmentId: '55555555-5555-4555-8555-555555555555',
        name: 'ไฟล์ร่างยาวมาก-ชื่อไทย.pdf',
        mimeType: 'application/pdf',
        size: 1536,
        uploadedRevision: 7,
      },
      confirmDialogOpen: true,
      confirmAttempt: null,
      revokeState: {
        attachmentId: '66666666-6666-4666-8666-666666666666',
        attachmentName: 'ภาพหลักฐาน.png',
        phase: 'confirming',
        errorText: null,
      },
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
    const markup = renderThread(makeThread(), baseOps);
    expect(markup).toContain('for="chat-outbound-file"');
    expect(markup).toContain('id="chat-outbound-file"');
    expect(markup).toContain('ยังไม่ได้ส่งถึงนักศึกษา');
    expect(markup).toContain('หากโหลดหน้าใหม่');
    expect(markup).toContain('ส่งให้นักศึกษา');
    expect(markup).toContain('นำออก');
    expect(markup).toContain('data-testid="outbound-confirm-dialog"');
    expect(markup).toContain('YRU-20260001');
    expect(markup).toContain('ไฟล์ร่างยาวมาก-ชื่อไทย.pdf');
    expect(markup).toContain('data-testid="outbound-revoke-dialog"');
    expect(markup).toContain('ข้อความที่ส่งไปแล้วใน LINE จะยังคงอยู่');

    const retryMarkup = renderThread(makeThread(), {
      ...baseOps,
      readyDraft: null,
      confirmDialogOpen: false,
      revokeState: null,
      upload: {
        requestId: '33333333-3333-4333-8333-333333333333',
        fileName: 'retry.png',
        mimeType: 'image/png',
        size: 512,
        sha256: 'a'.repeat(64),
        revision: 7,
        phase: 'retryable-error',
        errorText: 'การเชื่อมต่อขาดหายระหว่างอัปโหลด · กดลองอัปโหลดอีกครั้งเพื่อใช้คำขอเดิม',
      },
    });
    expect(retryMarkup).toContain('ลองอัปโหลดอีกครั้ง');
  });
});
