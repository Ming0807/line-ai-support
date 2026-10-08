import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactNode } from 'react';

const router = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => router }));
import { isRulesActionResponse, isStatusActionResponse, parseIncidentSearchParams, nextIncidentStatuses } from '@/app/(dashboard)/incidents/presentation';
import IncidentListView from '@/app/(dashboard)/incidents/IncidentListView';
import IncidentDetailView from '@/app/(dashboard)/incidents/IncidentDetailView';
import { IncidentRulesEditor } from '@/app/(dashboard)/incidents/IncidentActions';

const query = { page: 1, pageSize: 25 };
const incident = {
  id: 'f3cbab47-439d-46e3-9559-9238737bba29', revision: 4,
  title: 'ระบบลงทะเบียนตอบสนองช้า', category: 'REGISTRATION', departmentLabel: 'งานทะเบียน',
  status: 'INVESTIGATING' as const, severity: 'HIGH' as const, sensitivity: 'SENSITIVE' as const,
  reportCount: 6, distinctSessionCount: 5,
  createdAt: '2026-10-08T01:00:00.000Z', updatedAt: '2026-10-08T02:00:00.000Z',
};
const page = { items: [incident], pagination: { page: 1, pageSize: 25, total: 1, totalPages: 1 } };
const detail = { incident, canManage: true, tickets: [{ id: 'bf2ab5c1-9331-46ed-8cc7-39a0e6e4b8af', ticketCode: 'T-2026-0102', status: 'WAITING_STAFF', category: 'REGISTRATION' }] };
const html = (node: ReactNode) => renderToStaticMarkup(node);

describe('ADV-02 incident query parsing', () => {
  it('accepts only the frozen selectors and preserves canonical paging defaults', () => {
    expect(parseIncidentSearchParams({ status: 'DETECTED', severity: 'HIGH', department: 'd3734112-62e8-4f82-8734-0f0b4f0a7c52', page: '2', pageSize: '10' }))
      .toEqual({ status: 'DETECTED', severity: 'HIGH', department: 'd3734112-62e8-4f82-8734-0f0b4f0a7c52', page: 2, pageSize: 10 });
    expect(parseIncidentSearchParams({})).toEqual(query);
  });

  it('rejects unknown, duplicate, malformed and out-of-range selectors instead of dropping them', () => {
    for (const input of [
      { q: 'registration' }, { status: ['DETECTED', 'CLOSED'] }, { severity: 'URGENT' },
      { department: 'not-a-uuid' }, { page: '10001' }, { pageSize: '0' },
    ]) expect(() => parseIncidentSearchParams(input)).toThrow();
  });

  it('uses only the backend-approved state transitions', () => {
    expect(nextIncidentStatuses('DETECTED')).toEqual(['INVESTIGATING']);
    expect(nextIncidentStatuses('INVESTIGATING')).toEqual(['MONITORING', 'RESOLVED']);
    expect(nextIncidentStatuses('MONITORING')).toEqual(['INVESTIGATING', 'RESOLVED']);
    expect(nextIncidentStatuses('RESOLVED')).toEqual(['INVESTIGATING', 'CLOSED']);
    expect(nextIncidentStatuses('CLOSED')).toEqual([]);
  });

  it('accepts only the exact success shapes returned by the status and rules APIs', () => {
    expect(isStatusActionResponse({ revision: 5, replayed: false })).toBe(true);
    expect(isStatusActionResponse({ revision: '5', replayed: false })).toBe(false);
    expect(isStatusActionResponse({ revision: 5, replayed: false, accessToken: 'secret' })).toBe(false);
    expect(isRulesActionResponse({ revision: 5 })).toBe(true);
    expect(isRulesActionResponse({ revision: -1 })).toBe(false);
    expect(isRulesActionResponse({ revision: 5, error: 'NOT_FOUND' })).toBe(false);
  });
});

describe('ADV-02 incident operational views', () => {
  it('renders scoped incident rows, supported filters, privacy-safe counts and current pagination', () => {
    const markup = html(<IncidentListView query={query} result={page} departments={[{id:'d3734112-62e8-4f82-8734-0f0b4f0a7c52',name:'งานทะเบียน'}]} />);
    expect(markup).toContain('ระบบลงทะเบียนตอบสนองช้า');
    expect(markup).toContain('6');
    expect(markup).toContain('5');
    expect(markup).toContain('name="status"');
    expect(markup).toContain('name="severity"');
    expect(markup).toContain('name="department"');
    expect(markup).toContain('งานทะเบียน');expect(markup).not.toContain('UUID');
    expect(markup).toContain('href="/incidents/f3cbab47-439d-46e3-9559-9238737bba29"');
    expect(markup).not.toContain('anonymousSessionKey');
    expect(markup).not.toContain('similarity');
  });

  it('shows a true empty state only for a successful zero-result response', () => {
    const markup = html(<IncidentListView query={query} result={{ ...page, items: [], pagination: { ...page.pagination, total: 0, totalPages: 0 } }} />);
    expect(markup).toContain('ยังไม่มีเหตุการณ์ในตัวกรองนี้');
    expect(markup).not.toContain('ยังอ่านข้อมูลไม่ได้');
  });

  it('shows read errors as errors, with retry, rather than presenting an empty result', () => {
    const markup = html(<IncidentListView query={query} error />);
    expect(markup).toContain('ยังอ่านข้อมูลเหตุการณ์ไม่ได้');
    expect(markup).toContain('ลองอีกครั้ง');
  });

  it('shows safe ticket links and management actions from the accepted DTO flags only', () => {
    const markup = html(<IncidentDetailView detail={detail} />);
    expect(markup).toContain('T-2026-0102');
    expect(markup).toContain('href="/tickets/bf2ab5c1-9331-46ed-8cc7-39a0e6e4b8af"');
    expect(markup).toContain('6 รายงาน');
    expect(markup).toContain('บันทึกสถานะ');
    expect(markup).not.toContain('session');
    expect(markup).not.toContain('vector');
    expect(markup).not.toContain('similarity');
  });

  it('does not render status actions for a read-only actor', () => {
    const markup = html(<IncidentDetailView detail={{ ...detail, canManage: false }} />);
    expect(markup).not.toContain('บันทึกสถานะ');
  });

  it('renders persisted rule values without implying defaults when the read is unavailable', () => {
    const markup = html(<IncidentRulesEditor initial={{ revision: 2, rules: { minReports: 7, minDistinctSessions: 4, windowMinutes: 30, minSimilarity: 0.91 } }} canManage />);
    expect(markup).toContain('value="7"');
    expect(markup).toContain('value="4"');
    expect(markup).toContain('value="30"');
    expect(markup).toContain('value="0.91"');
    const unavailable = html(<IncidentRulesEditor initial={null} canManage />);
    expect(unavailable).toContain('ยังอ่านกติกาการตรวจจับไม่ได้');
    expect(unavailable).not.toContain('value="5"');
  });
});
