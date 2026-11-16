import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactNode } from 'react';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn(), push: vi.fn() }),
}));

import ChatThread from '@/app/(dashboard)/tickets/[id]/chat-thread';
import type { InboxThreadResult } from '@/types/inbox';

const html = (node: ReactNode) => renderToStaticMarkup(node);

const revisionThread = (): InboxThreadResult => ({
  detail: {
    ticket: {
      id: 'ticket-1', ticket_no: 'T-2026-0102', department_id: 'd-1', department_name: 'งานทะเบียน',
      category: 'REG_ALL', problem_summary: 'คำร้องเรื่องระบบ', priority: 'HIGH', status: 'STAFF_HANDLING',
      mode: 'HUMAN', sensitive_level: 'GENERAL', assigned_staff_id: 'staff-a', assignee_name: 'เจ้าหน้าที่เอ',
      revision: 7, created_at: '2026-10-28T01:00:00.000Z', updated_at: '2026-10-28T02:00:00.000Z', anonymous_code: 'A1B2C3',
    },
    messages: [],
    history: [],
    assignees: [],
    deliveries: [],
    permissions: {
      accept: false, reply: true, resolve: true, close: true, reassign: true, reopen: true,
    },
  },
  messages: [
    {
      id: 'm-1', sequence: 1, senderType: 'USER', staffName: null, content: 'ระบบขึ้นสถานะผิด',
      createdAt: '2026-10-28T01:00:00.000Z', deliveryStatus: null, attachments: [],
    },
    {
      id: 'm-2', sequence: 2, senderType: 'STAFF', staffName: 'เจ้าหน้าที่เอ', content: 'กำลังตรวจสอบ',
      createdAt: '2026-10-28T01:05:00.000Z', deliveryStatus: 'SENT', attachments: [
        { id: 'f-1', name: 'ใบเสร็จ-ชื่อยาวมาก-ยาวมาก-ซีเรียล-99112233445566778899001122334455667788990011223344.pdf', mimeType: 'application/pdf', size: 2048, status: 'READY', downloadUrl: '/api/attachments/f-1' },
        { id: 'f-2', name: 'แนบรอดำเนินการ.pdf', mimeType: 'application/pdf', size: 2048, status: 'PENDING', downloadUrl: null },
        { id: 'f-3', name: 'ล้มเหลว.png', mimeType: 'image/png', size: 512, status: 'FAILED', downloadUrl: null },
      ],
    },
    {
      id: 'm-3', sequence: 3, senderType: 'AI', staffName: null, content: 'ร่างอัตโนมัติ',
      createdAt: '2026-10-28T01:06:00.000Z', deliveryStatus: null, attachments: [],
    },
  ],
  notes: [
    { id: 'n-1', text: 'บันทึกส่วนตัวตรวจสอบ', staffName: 'เจ้าหน้าที่เอ', createdAt: '2026-10-28T01:10:00.000Z' },
  ],
  latestSequence: 3,
  readThroughSequence: 2,
  hasMore: false,
  nextBefore: null,
});

describe('unified conversation workspace', () => {
  it('keeps exactly one reply composer and one note composer in the shared chat component', () => {
    const markup = html(<ChatThread
      actorId="staff-a"
      thread={revisionThread()}
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
      assist={{ available: true, revision: 7, onDraft: () => {} }}
    />);
    expect(markup).toContain('data-testid="chat-reply-composer"');
    expect(markup).toContain('data-testid="chat-note-composer"');
    // Note contract is 4000 characters, with its own visible counter (not 3,000).
    // (amendment fixed: this React SSR string serializes the attribute as `MaxLength`-style camelCase
    // i.e. `maxLength`; the HTML attribute itself is case-insensitive, so match case-insensitively.)
    expect(markup).toMatch(/maxlength="4000"/i);
    expect(markup).toContain('4,000 ตัวอักษร');
    expect(markup).not.toMatch(/maxlength="3000"/i);
    expect(markup).toMatch(/maxlength="5000"/i);
    assertOnce(markup, 'data-testid="chat-reply-composer"');
    assertOnce(markup, 'data-testid="chat-note-composer"');
  });

  it('hides the reply composer when the server denies the reply permission instead of faking it', () => {
    const thread = revisionThread();
    thread.detail.permissions.reply = false;
    const markup = html(<ChatThread
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
    />);
    expect(markup).not.toContain('data-testid="chat-reply-composer"');
    expect(markup).toContain('คุณไม่มีสิทธิ์ตอบกลับ');
  });

  it('renders delivery evidence honestly and never derives it from the sender type', () => {
    const markup = html(<ChatThread
      actorId="staff-a"
      thread={revisionThread()}
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
    />);
    expect(markup).toContain('ยังไม่มีหลักฐานการส่ง'); // STAFF + null status
    expect(markup).toContain('ส่งแล้ว');          // SENT evidence (delivery, not a read receipt)
    // SENT is never presented as a read receipt: the qualifier avoids the "อ่านแล้ว" claim entirely
    // (amendment: honest qualifier wording keeps the strict no-read-receipt assertion testable).
    expect(markup).toContain('ไม่ได้ยืนยันว่าผู้ใช้เปิดอ่าน');
    expect(markup).not.toContain('อ่านแล้ว');      // never fabricates read receipts
  });

  it('shows attachments only from the server DTO and links only READY files', () => {
    const markup = html(<ChatThread
      actorId="staff-a"
      thread={revisionThread()}
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
    />);
    expect(markup).toContain('กำลังเตรียมไฟล์');
    expect(markup).toContain('ไฟล์ยังเปิดไม่ได้');
    expect(markup).toContain('/api/attachments/f-1');
    // Only one anchor for the READY file: PENDING/FAILED rows never expose a link.
    expect(markup.match(/\/api\/attachments\/f-1/g)?.length).toBe(1);
    expect(markup).toMatch(/\.pdf['`"]|\.pdf\u0022/);
  });

  it('renders every delivery status label distinctly and never derives a read receipt from statuses or senders', () => {
    const matrix = [
      ['PENDING', 'สถานะข้อความ: รอส่ง'],
      ['PROCESSING', 'สถานะข้อความ: กำลังส่ง'],
      ['RETRY', 'สถานะข้อความ: รอลองส่งอีกครั้ง'],
      ['UNKNOWN', 'สถานะข้อความ: กำลังตรวจสอบผล'],
      ['DEAD', 'สถานะข้อความ: ส่งไม่สำเร็จ'],
      ['SUPPRESSED', 'สถานะข้อความ: ระงับการส่ง'],
    ] as const;
    for (const [status, line] of matrix) {
      const thread = revisionThread();
      thread.messages = [{
        id: 'm-2', sequence: 2, senderType: 'STAFF', staffName: 'เจ้าหน้าที่เอ', content: 'กำลังตรวจสอบ',
        createdAt: '2026-10-28T01:05:00.000Z', deliveryStatus: status, attachments: [],
      }];
      const markup = html(<ChatThread
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
        onRefresh={() => {}}
        onSubmitReply={() => {}}
        onSubmitNote={() => {}}
        assist={{ available: false, revision: 7, onDraft: () => {} }}
      />);
      expect(markup).toContain(line);
      expect(markup).not.toContain('อ่านแล้ว');
    }
  });

  it('exposes the history loader and the mid-gap catch-up control for bursts beyond the window', () => {
    const thread = revisionThread();
    thread.hasMore = true;
    thread.nextBefore = 1;
    const markup = html(<ChatThread
      actorId="staff-a"
      thread={thread}
      loading={false}
      error=""
      drafts={{ reply: '', note: '' }}
      attempts={{ reply: null, note: null }}
      busy={null}
      notice={null}
      hasStaleResponse={false}
      catchUpBefore={151}
      historyLoading={false}
      onDraftChange={() => {}}
      onLoadEarlier={() => {}}
      onLoadCatchUp={() => {}}
      onAckRead={() => {}}
      onRefresh={() => {}}
      onSubmitReply={() => {}}
      onSubmitNote={() => {}}
      assist={{ available: false, revision: 7, onDraft: () => {} }}
    />);
    expect(markup).toContain('โหลดข้อความก่อนหน้า');
    expect(markup).toContain('โหลดช่วงที่ขาด');
    expect(markup).toContain('ยังไม่โหลดครบ');
  });
});

function assertOnce(markup: string, marker: string) {
  expect(markup.split(marker).length).toBe(2);
}
