import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactNode } from 'react';

const mocks = vi.hoisted(() => ({
  role: 'SUPER_ADMIN' as 'SUPER_ADMIN' | 'STAFF',
  staff: vi.fn(),
  summary: vi.fn(),
  analytics: vi.fn(),
  usage: vi.fn(),
  departments: vi.fn(),
  settings: vi.fn(),
  tickets: vi.fn(),
  importJobs: vi.fn(),
  providers: vi.fn(),
  embedding: vi.fn(),
}));

vi.mock('next/link', () => ({ default: ({ href, children, ...props }: { href: string; children: ReactNode }) => <a href={href} {...props}>{children}</a> }));
vi.mock('next/navigation', () => ({ notFound: () => { throw new Error('NOT_FOUND'); } }));
vi.mock('@/lib/auth/staff', () => ({ requireStaff: mocks.staff }));
vi.mock('@/lib/operations/metrics', () => ({
  readOperationsSummary: mocks.summary,
  readOperationsAnalytics: mocks.analytics,
  readOperationsUsage: mocks.usage,
  readOperationsDepartments: mocks.departments,
  readOperationsSettings: mocks.settings,
}));
vi.mock('@/lib/tickets/reads', () => ({ listTickets: mocks.tickets }));
vi.mock('@/lib/imports/import-staging', () => ({ listImportJobs: mocks.importJobs }));
vi.mock('@/lib/ai/provider-admin', () => ({ listProviders: mocks.providers }));
vi.mock('@/lib/knowledge/embedding-status', () => ({ getEmbeddingStatus: mocks.embedding }));

import DashboardPage from '../app/(dashboard)/dashboard/page';
import AnalyticsPage from '../app/(dashboard)/analytics/page';
import UsagePage from '../app/(dashboard)/usage/page';
import DepartmentsPage from '../app/(dashboard)/departments/page';
import SettingsPage from '../app/(dashboard)/settings/page';
vi.mock('@/lib/staff/line-binding',()=>({getBindingStatus:vi.fn(async()=>({bound:false,pending:false,expiresAt:null}))}));

const staffId = '39f7e07f-7d76-433e-a83e-205297c60a83';
const departmentId = '4fe5dd1d-28d5-4a2e-bb4a-48f6e4559d28';
const window = { from: '2026-10-02', to: '2026-10-08', timeZone: 'Asia/Bangkok' as const };
const summary = {
  observedAt: '2026-10-08T05:00:00.000Z', window, departmentId: null,
  counts: { total: 138, open: 21, waitingStaff: 4, handling: 7, waitingUser: 3, resolved: 80, closed: 37, critical: 2, high: 5 },
  intake: [{ date: '2026-10-08', count: 8 }],
};
const analytics = {
  observedAt: summary.observedAt, window, departmentId: null,
  firstStaffResponse: { samples: 2, averageSeconds: 3600 }, resolution: { samples: 0, averageSeconds: null },
  aiResolutionRate: null, aiOutcomes:{confirmedSolved:0,confirmedEscalated:0,samples:0},distribution: [],
};
const usage = {
  observedAt: summary.observedAt, window,
  totals: { calls: 4, success: 3, errors: 1, fallback: 1, meanLatencyMs: 250,
    inputTokens: { knownTotal: 120, unknownCalls: 1 }, outputTokens: { knownTotal: 60, unknownCalls: 2 },
    cost: { knownTotal: '0.02', unknownCalls: 2 } },
  models: [{ providerName: 'Test Provider', modelName: 'Test Model', totals: { calls: 4, success: 3, errors: 1, fallback: 1, meanLatencyMs: 250,
    inputTokens: { knownTotal: 120, unknownCalls: 1 }, outputTokens: { knownTotal: 60, unknownCalls: 2 }, cost: { knownTotal: '0.02', unknownCalls: 2 } } }],
};
const settings = {
  observedAt: summary.observedAt, database: 'OBSERVED_OK' as const, pool: { total: 5, idle: 2, waiting: 1 },
  queues: { inbox: [{ status: 'PENDING' as const, channel: 'STUDENT' as const, count: 3 }], ai: [], outbox: [] },
  workerLiveness: 'UNKNOWN' as const, workerObservations:[{worker:'INBOX',lastObservedAt:'2026-10-08T04:55:00.000Z'},{worker:'OUTBOX',lastObservedAt:null},{worker:'AI',lastObservedAt:null},{worker:'INCIDENT',lastObservedAt:null}],line: { studentConfigured: true, staffConfigured: false },
};

function html(node: ReactNode) { return renderToStaticMarkup(node); }
beforeEachReset();
function beforeEachReset() {
  mocks.staff.mockImplementation(async () => ({ id: staffId, role: mocks.role, display_name: 'Staff' }));
  mocks.summary.mockResolvedValue(summary);
  mocks.analytics.mockResolvedValue(analytics);
  mocks.usage.mockResolvedValue(usage);
  mocks.departments.mockResolvedValue({ observedAt: summary.observedAt, items: [{ id: departmentId, code: 'IT', name: 'งานไอที', totalTickets: 20, openTickets: 3, activeStaff: 2 }] });
  mocks.settings.mockResolvedValue(settings);
  mocks.tickets.mockResolvedValue({ tickets: [], departments: [], assignees: [], pagination: { page: 1, pageSize: 100, total: 138, totalPages: 2, hasNext: true, hasPrevious: false } });
  mocks.importJobs.mockResolvedValue([]);
  mocks.providers.mockResolvedValue([]);
  mocks.embedding.mockResolvedValue({ healthy: false, model: 'intfloat/multilingual-e5-small', dimension: 384, mode: 'CPU', observedAt: summary.observedAt, httpStatus: 503 });
}
afterEach(() => { vi.clearAllMocks(); mocks.role = 'SUPER_ADMIN'; beforeEachReset(); });

describe('operations metrics server surfaces', () => {
  it('uses scoped aggregate counts and intake instead of treating the current ticket page as totals', async () => {
    const markup = html(await DashboardPage({ searchParams: Promise.resolve({ from: '2026-10-03', to: '2026-10-08' }) }));
    expect(mocks.summary).toHaveBeenCalledWith(staffId, expect.objectContaining({ from: '2026-10-03', to: '2026-10-08' }));
    expect(markup).toContain('138');
    expect(markup).toContain('รายการในหน้าปัจจุบัน');
    expect(markup).not.toContain('จากรายการล่าสุดที่ API ส่งให้ตามสิทธิ์');
  });

  it('renders sample counts and preserves unknown analytics outcomes', async () => {
    const markup = html(await AnalyticsPage({ searchParams: Promise.resolve({ from: '2026-10-03', to: '2026-10-08', department: departmentId }) }));
    expect(mocks.analytics).toHaveBeenCalledWith(staffId, { from: '2026-10-03', to: '2026-10-08', department: departmentId });
    expect(markup).toContain('2 ตัวอย่าง');
    expect(markup).toContain('ยังไม่มีตัวอย่าง');
    expect(markup).toContain('ยังไม่มีการยืนยันผล');
  });

  it('renders only observed confirmation outcomes with an explicit success denominator',async()=>{
    mocks.analytics.mockResolvedValue({...analytics,aiResolutionRate:75,aiOutcomes:{confirmedSolved:3,confirmedEscalated:1,samples:4}});
    const markup=html(await AnalyticsPage({searchParams:Promise.resolve({from:'2026-10-03',to:'2026-10-08'})}));
    expect(markup).toContain('75%');expect(markup).toContain('ยืนยันแก้ได้ 3');expect(markup).toContain('ยืนยันส่งต่อ 1');
    expect(markup).toContain('4 เรื่อง');expect(markup).not.toContain('ยังไม่มีนิยามผลการตอบ');
  });

  it('shows token and cost uncertainty without turning either into a quota estimate', async () => {
    const markup = html(await UsagePage({ searchParams: Promise.resolve({ from: '2026-10-03', to: '2026-10-08' }) }));
    expect(mocks.usage).toHaveBeenCalledWith(staffId, { from: '2026-10-03', to: '2026-10-08' });
    expect(markup).toContain('ไม่ทราบโทเค็น 2 ครั้ง');
    expect(markup).toContain('ไม่ทราบค่าใช้จ่าย 2 ครั้ง');
    expect(markup).toContain('Test Provider');
    expect(markup).not.toContain('โควต้าเหลือ');
  });

  it('rejects non-super-admin Usage and permits self Settings without protected administrative reads', async () => {
    mocks.role = 'STAFF';
    await expect(UsagePage({ searchParams: Promise.resolve({}) })).rejects.toThrow('NOT_FOUND');
    const markup = html(await SettingsPage());
    expect(markup).toContain('เชื่อมต่อ LINE เจ้าหน้าที่');
    expect(markup).not.toContain('Worker liveness');
    expect(mocks.usage).not.toHaveBeenCalled();
    expect(mocks.settings).not.toHaveBeenCalled();
    expect(mocks.embedding).not.toHaveBeenCalled();
  });

  it('renders only returned active scoped departments and an honest empty state', async () => {
    const markup = html(await DepartmentsPage());
    expect(mocks.departments).toHaveBeenCalledWith(staffId);
    expect(markup).toContain('งานไอที');
    expect(markup).toContain('20');
    mocks.departments.mockResolvedValueOnce({ observedAt: summary.observedAt, items: [] });
    expect(html(await DepartmentsPage())).toContain('ยังไม่มีหน่วยงานที่แสดงได้');
  });

  it('keeps worker liveness unknown and shows E5 as a separate observed HTTP status', async () => {
    const markup = html(await SettingsPage());
    expect(mocks.settings).toHaveBeenCalledWith(staffId);
    expect(markup).toContain('ยังไม่ทราบสถานะการทำงานของ worker');
    expect(markup).toContain('HTTP 503');
    expect(markup).toContain('กำหนดค่าแล้ว');
    expect(markup).toContain('ยังไม่ได้กำหนดค่า');
    expect(markup).not.toContain('LINE_STUDENT_CHANNEL_SECRET');
  });

  it('shows only observed worker times, and missing observations remain unknown',async()=>{
    const markup=html(await SettingsPage());
    expect(markup).toContain('การทำงานล่าสุดของ worker');
    expect(markup).toContain('dateTime="2026-10-08T04:55:00.000Z"');
    expect(markup).toContain('พบการทำงานล่าสุด');expect(markup).toContain('ยังไม่มีข้อมูลการทำงาน');
    expect(markup).not.toContain('worker ทำงานปกติ');expect(markup).not.toContain('worker หยุดทำงาน');
  });

  it('renders backend read failures as unavailable rather than successful empty data', async () => {
    mocks.analytics.mockRejectedValueOnce(new Error('db private text'));
    const markup = html(await AnalyticsPage({ searchParams: Promise.resolve({}) }));
    expect(markup).toContain('ไม่สามารถอ่านข้อมูลสถิติได้');
    expect(markup).not.toContain('db private text');
  });

  it('rejects repeated and unknown metric parameters instead of silently narrowing or dropping them', async () => {
    const markup = html(await AnalyticsPage({ searchParams: Promise.resolve({ from: ['2026-10-02', '2026-10-03'], to: '2026-10-08', token: 'private' }) }));
    expect(markup).toContain('ตัวกรองไม่ถูกต้อง');
    expect(mocks.analytics).not.toHaveBeenCalled();
  });

  it('does not call a worker healthy when the settings snapshot is unavailable', async () => {
    mocks.settings.mockRejectedValueOnce(new Error('private connection detail'));
    const markup = html(await SettingsPage());
    expect(markup).toContain('ไม่สามารถอ่านข้อมูลได้');
    expect(markup).not.toContain('private connection detail');
    expect(markup).toContain('ปลายทางรายงานไม่พร้อม');
    expect(markup).not.toContain('worker ทำงานอยู่');
  });
});
