import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

function renderView(props: Record<string, unknown>): string {
  return renderToStaticMarkup(createElement(LogsView, props as never));
}

const staffMock = vi.hoisted(() => ({ staff: vi.fn() }));
const logCalls = vi.hoisted(() => ({ calls: [] as unknown[][] }));
const readMock = vi.hoisted(() => ({ read: vi.fn() }));

vi.mock('@/lib/auth/staff', () => ({ requireStaff: staffMock.staff }));
vi.mock('@/lib/operations/reads', () => ({ readLogs: readMock.read }));
vi.mock('@/app/(dashboard)/operator-workflows/logs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/app/(dashboard)/operator-workflows/logs')>();
  return {
    ...actual,
    loadLogList: (...args: unknown[]) => {
      logCalls.calls.push(args);
      return (actual.loadLogList as (...a: unknown[]) => Promise<unknown>)(...args);
    },
  };
});

import LogsPage from '@/app/(dashboard)/logs/page';
import {
  buildLogFilterUrl,
  buildLogPageUrl,
  buildLogServiceFilters,
  createLogsAdapter,
  LOG_COMPONENTS,
  LOG_SEVERITIES,
  loadLogList,
  parseLogQuery,
} from '@/app/(dashboard)/operator-workflows/logs';
import { createOperatorController } from '@/app/(dashboard)/operator-workflows/controller';
import { projectLogFields } from '@/app/(dashboard)/operator-workflows/privacy';
import LogsView from '@/app/(dashboard)/operator-workflows/LogsView';
import { SECRET_INJECTED_LOG, SYNTHETIC_LOGS } from './fixtures/opencode-operator-fixtures';

const params = (p: Record<string, string | string[] | undefined>) => Promise.resolve(p);
const filters = { page: 1, pageSize: 50, from: '2026-10-01', to: '2026-10-07' };

function fixtureLoader(rows: unknown[] = SYNTHETIC_LOGS) {
  return (query: typeof filters) => Promise.resolve({
    items: rows,
    pagination: { page: query.page, pageSize: query.pageSize, total: rows.length, totalPages: Math.ceil(rows.length / query.pageSize), hasNext: false, hasPrevious: query.page > 1 },
    window: { from: query.from, to: query.to, timeZone: 'Asia/Bangkok' as const },
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  logCalls.calls.length = 0;
  staffMock.staff.mockResolvedValue({ id: 'staff-test-id', role: 'SUPER_ADMIN' });
  readMock.read.mockImplementation(async (_staffId: string, query: typeof filters) => fixtureLoader()(query));
});

describe('OC-UI-02.07 log query validation (production parser)', () => {
  it('uses the root Bangkok seven-civil-day default and derives a missing endpoint', () => {
    const now = new Date('2026-10-08T12:00:00.000Z');
    expect(parseLogQuery({}, now)).toMatchObject({ from: '2026-10-02', to: '2026-10-08' });
    expect(parseLogQuery({ to: '2026-10-07' }, now)).toMatchObject({ from: '2026-10-01', to: '2026-10-07' });
  });

  it('accepts only the root-owned log components and event codes', () => {
    expect(parseLogQuery({ component: 'line-delivery' }).validationError).toBeUndefined();
    expect(parseLogQuery({ component: 'ai-gateway', code: 'TIMEOUT' }).validationError).toBeUndefined();
    expect(parseLogQuery({ component: 'webhook-ingress' }).validationError).toBeTruthy();
    expect(parseLogQuery({ code: 'WEBHOOK_OK' }).validationError).toBeTruthy();
  });

  it('accepts valid severity/component/code/date/page selectors', () => {
    const parsed = parseLogQuery({
      q: 'gateway',
      severity: 'ERROR',
      component: 'ai-gateway',
      code: 'TIMEOUT',
      from: '2026-10-01',
      to: '2026-10-07',
      page: '1',
      pageSize: '50',
    });
    expect(parsed.validationError).toBeUndefined();
    expect(buildLogServiceFilters(parsed)).toEqual({
      q: 'gateway',
      severity: 'ERROR',
      component: 'ai-gateway',
      code: 'TIMEOUT',
      from: '2026-10-01',
      to: '2026-10-07',
      page: 1,
      pageSize: 50,
    });
  });

  it('rejects duplicate, unknown, invalid enum, and bad range selectors', () => {
    expect(parseLogQuery({ severity: ['ERROR', 'WARN'] }).validationError).toBeTruthy();
    expect(parseLogQuery({ nope: '1' }).validationError).toBeTruthy();
    expect(parseLogQuery({ severity: 'CRITICAL' }).validationError).toBeTruthy();
    expect(parseLogQuery({ component: 'billing' }).validationError).toBeTruthy();
    expect(parseLogQuery({ pageSize: '0' }).validationError).toBeTruthy();
    expect(parseLogQuery({ from: '2026-10-09', to: '2026-10-01' }).validationError).toBeTruthy();
  });

  it('keeps severity and component vocabularies fixed, never inferred', () => {
    expect(Object.keys(LOG_SEVERITIES)).toEqual(['ERROR', 'WARN', 'INFO']);
    expect(LOG_COMPONENTS).toEqual(['ai-gateway', 'line-delivery']);
  });
});

describe('OC-UI-02.07/08 logs adapter, list, detail, and recovery', () => {
  it('loads the accepted strict envelope from the same-origin API with the abort signal', async () => {
    const response = {
      items: [{
        id: 'ai:6f63c09c-377e-4f85-8a50-407d14b7ded4',
        loggedAt: '2026-10-06T02:15:00.000Z', code: 'TIMEOUT', label: 'AI ใช้เวลานานเกินกำหนด',
        component: 'ai-gateway', severity: 'ERROR', httpStatus: 504, correlationId: null,
      }],
      pagination: { page: 1, pageSize: 25, total: 1, totalPages: 1, hasNext: false, hasPrevious: false },
      window: { from: '2026-10-01', to: '2026-10-07', timeZone: 'Asia/Bangkok' },
    };
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(response), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    try {
      const controller = new AbortController();
      const state = await createLogsAdapter().load({
        page: 1, pageSize: 25, from: '2026-10-01', to: '2026-10-07', component: 'ai-gateway', severity: 'ERROR', code: 'TIMEOUT',
      }, controller.signal);
      expect(state.status).toBe('ready');
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('/api/logs?page=1&pageSize=25&from=2026-10-01&to=2026-10-07&severity=ERROR&component=ai-gateway&code=TIMEOUT');
      expect(init.signal).toBe(controller.signal);
      expect(init.credentials).toBe('same-origin');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('production adapter is unavailable by default', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 503 })));
    const state = await loadLogList(filters);
    expect(state.status).toBe('unavailable');
    vi.unstubAllGlobals();
  });

  it('renders fixture rows with code, component, time, and observed HTTP status', () => {
    const adapter = createLogsAdapter(fixtureLoader());
    return adapter.load(filters).then((state) => {
      expect(state.status).toBe('ready');
      const html = renderView({ state, baseParams: {} });
    expect(html).toContain('TIMEOUT');
      expect(html).toContain('ai-gateway');
      expect(html).toContain('500');
      expect(html).not.toContain('healthy');
      expect(html).not.toContain('โควตา');
    });
  });

  it('never renders tokens, bodies, LINE identities, or stacks', () => {
    const adapter = createLogsAdapter(fixtureLoader([SECRET_INJECTED_LOG]));
    return adapter.load(filters).then((state) => {
      expect(state.status).toBe('error');
      const html = renderView({ state, baseParams: {}, initialSelectedId: 'ai:0f5f8eae-56e5-4ce7-8b58-282781181103' });
      for (const secret of [
        'secret-access-token-must-not-render',
        'must-not-render',
        'U-deadbeef_should_never_render',
        'Bearer secret',
      ]) {
        expect(html).not.toContain(secret);
      }
      expect(html).not.toContain('ป้ายที่ดูปลอดภัย');
    });
  });

  it('fails closed on malformed rows and keeps empty distinct from unavailable', () => {
    const bad = createLogsAdapter(fixtureLoader([null]));
    const empty = createLogsAdapter(fixtureLoader([]));
    return Promise.all([bad.load(filters), empty.load(filters)]).then(
      ([badState, emptyState]) => {
        expect(badState.status).toBe('error');
        expect(emptyState.status).toBe('empty');
        const emptyHtml = renderView({ state: emptyState, baseParams: {} });
        expect(emptyHtml).toContain('ยังไม่มีบันทึก');
        expect(emptyHtml).not.toContain('อยู่ระหว่างเชื่อมต่อ');
      },
    );
  });

  it('retry preserves filters and reset restores defaults with size retained', async () => {
    const seen: unknown[] = [];
    const controller = createOperatorController(async (filters: unknown) => {
      seen.push(filters);
      return { items: [] };
    }, { page: 3, pageSize: 50, severity: 'ERROR' });
    await controller.load({ page: 3, pageSize: 50, severity: 'ERROR' });
    await controller.retry();
    expect(seen.length).toBe(2);
    expect(seen[1]).toEqual({ page: 3, pageSize: 50, severity: 'ERROR' });
    await controller.clear({ page: 1, pageSize: 50 });
    expect(controller.getPendingFilters()).toEqual({ page: 1, pageSize: 50 });
    controller.dispose();
  });

  it('does not dispatch on invalid log query and links honest recovery', async () => {
    const element = await LogsPage({ searchParams: params({ severity: ['ERROR', 'WARN'] }) });
    const html = renderToStaticMarkup(element);
    expect(logCalls.calls.length).toBe(0);
    expect(html).toContain('ตัวกรองไม่ถูกต้อง');
  });

  it('renders the authenticated root log read with accepted fields only', async () => {
    const element = await LogsPage({ searchParams: params({ severity: 'ERROR', pageSize: '50' }) });
    const html = renderToStaticMarkup(element);
    expect(logCalls.calls.length).toBe(1);
    expect(html).toContain('LINE_DELIVERY_FAILED');
    expect(html).toContain('Asia/Bangkok');
    expect(readMock.read).toHaveBeenCalledWith('staff-test-id', expect.objectContaining({ pageSize: 50 }));
    expect(html).not.toContain('ROOT_BACKEND_SYNC_REQUIRED');
  });

  it('projects only allowlisted diagnostic fields from raw rows', () => {
    const projected = projectLogFields(SYNTHETIC_LOGS[2]);
    expect(projected.ok).toBe(true);
    if (projected.ok) {
      expect(projected.item.code).toBe('LINE_DELIVERY_FAILED');
      expect(projected.item.httpStatus).toBe(500);
      expect('headers' in projected.item).toBe(false);
    }
  });

  it('builds encoded log page and filter links with the declared vocabulary', () => {
    const page = buildLogPageUrl({ severity: 'WARN', component: 'ai-gateway', pageSize: '50' }, 2);
    expect(page).toContain('severity=WARN');
    expect(page).toContain('component=ai-gateway');
    expect(page).toContain('page=2');
    const cleared = buildLogFilterUrl({ severity: 'WARN', page: '5', pageSize: '50' });
    expect(cleared).not.toContain('page=');
    expect(cleared).toContain('pageSize=50');
  });

  it('does not render logs or call the read when a non-super-admin opens the route directly', async () => {
    staffMock.staff.mockResolvedValue({ id: 'staff-test-id', role: 'ADMIN' });
    await expect(LogsPage({ searchParams: params({}) })).rejects.toThrow();
    expect(readMock.read).not.toHaveBeenCalled();
  });
});
