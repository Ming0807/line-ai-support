import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactNode } from 'react';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn(), push: vi.fn() }),
}));

import TicketActions from '@/app/(dashboard)/tickets/[id]/ticket-actions';

const html = (node: ReactNode) => renderToStaticMarkup(node);

describe('ticket detail actions panel owns lifecycle actions only', () => {
  it('renders no second reply composer once the shared chat workspace owns the conversation', () => {
    const markup = html(<TicketActions
      actorId="staff-a"
      id="ticket-1"
      ticketNo="T-2026-0102"
      reporter="A1B2C3"
      revision={7}
      permissions={{ accept: true, reply: true, resolve: true, close: true, reassign: true, reopen: false }}
      assignees={[{ id: 'staff-b', display_name: 'เจ้าหน้าที่บี' }]}
    />);
    expect(markup).toContain('รับเรื่องนี้');
    expect(markup).toContain('ทำเครื่องหมายว่าแก้ไขแล้ว');
    expect(markup).toContain('เปลี่ยนผู้รับผิดชอบ');
    expect(markup).toContain('T-2026-0102');
    expect(markup).toContain('ผู้แจ้ง A1B2C3');
    expect(markup).not.toContain('เปิดเรื่องอีกครั้ง');
    // The reply composer belongs to the shared chat workspace, not to the actions panel.
    expect(markup).not.toContain('id="staff-reply"');
  });
});
