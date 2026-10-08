import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

function renderView(props: Record<string, unknown>): string {
  return renderToStaticMarkup(createElement(ActivitiesView, props as never));
}

const staffMock = vi.hoisted(() => ({ staff: vi.fn() }));
const activityCalls = vi.hoisted(() => ({ calls: [] as unknown[][] }));
const readMock = vi.hoisted(() => ({ read: vi.fn() }));

vi.mock('@/lib/auth/staff', () => ({ requireStaff: staffMock.staff }));
vi.mock('@/lib/operations/reads', () => ({ readActivities: readMock.read }));
vi.mock('@/app/(dashboard)/operator-workflows/activities', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/app/(dashboard)/operator-workflows/activities')>();
  return {
    ...actual,
    loadActivityList: (...args: unknown[]) => {
      activityCalls.calls.push(args);
      return (actual.loadActivityList as (...a: unknown[]) => Promise<unknown>)(...args);
    },
  };
});

import ActivitiesPage from '@/app/(dashboard)/activities/page';
import {
  ACTIVITY_ACTIONS,
  buildActivityFilterUrl,
  buildActivityPageUrl,
  buildActivityServiceFilters,
  createActivitiesAdapter,
  loadActivityList,
  parseActivityQuery,
} from '@/app/(dashboard)/operator-workflows/activities';
import { createOperatorController, OperatorLoadError } from '@/app/(dashboard)/operator-workflows/controller';
import { projectActivityFields } from '@/app/(dashboard)/operator-workflows/privacy';
import ActivitiesView from '@/app/(dashboard)/operator-workflows/ActivitiesView';
import { handleDialogKeyDown, isEscapeKey } from '@/app/(dashboard)/operator-workflows/ActivityDetail';
import {
  SECRET_INJECTED_ACTIVITY,
  SYNTHETIC_ACTIVITIES,
} from './fixtures/opencode-operator-fixtures';

const params = (p: Record<string, string | string[] | undefined>) => Promise.resolve(p);
const filters = { page: 1, pageSize: 25, from: '2026-10-01', to: '2026-10-07' };

function fixtureLoader(rows: unknown[] = SYNTHETIC_ACTIVITIES) {
  return (query: typeof filters) => Promise.resolve({
    items: rows,
    pagination: { page: query.page, pageSize: query.pageSize, total: rows.length, totalPages: Math.ceil(rows.length / query.pageSize), hasNext: false, hasPrevious: query.page > 1 },
    window: { from: query.from, to: query.to, timeZone: 'Asia/Bangkok' as const },
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  activityCalls.calls.length = 0;
  staffMock.staff.mockResolvedValue({ id: 'staff-test-id', role: 'STAFF' });
  readMock.read.mockImplementation(async (_staffId: string, query: typeof filters) => fixtureLoader()(query));
});

describe('OC-UI-02.05 activity query validation (production parser)', () => {
  it('uses the root Bangkok seven-civil-day default and derives a missing endpoint', () => {
    const now = new Date('2026-10-08T12:00:00.000Z');
    expect(parseActivityQuery({}, now)).toMatchObject({ from: '2026-10-02', to: '2026-10-08' });
    expect(parseActivityQuery({ from: '2026-10-01' }, now)).toMatchObject({ from: '2026-10-01', to: '2026-10-07' });
  });

  it('accepts the root-owned expanded activity groups', () => {
    for (const action of ['CREATE', 'REOPEN', 'IMPORT', 'PROVIDER', 'OTHER']) {
      expect(parseActivityQuery({ action }).validationError, action).toBeUndefined();
      expect(parseActivityQuery({ action }).action).toBe(action);
    }
  });

  it('accepts a valid Thai search with action/date/page selectors', () => {
    const parsed = parseActivityQuery({
      q: '  รับเรื่อง  ',
      action: 'TAKEOVER',
      from: '2026-10-01',
      to: '2026-10-07',
      page: '2',
      pageSize: '25',
    });
    expect(parsed.validationError).toBeUndefined();
    expect(buildActivityServiceFilters(parsed)).toEqual({
      q: 'รับเรื่อง',
      action: 'TAKEOVER',
      from: '2026-10-01',
      to: '2026-10-07',
      page: 2,
      pageSize: 25,
    });
  });

  it('rejects duplicate, unknown, malformed, and out-of-range selectors', () => {
    expect(parseActivityQuery({ q: ['a', 'b'] }).validationError).toBeTruthy();
    expect(parseActivityQuery({ page: ['1', '2'] }).validationError).toBeTruthy();
    expect(parseActivityQuery({ unknownThing: '1' }).validationError).toBeTruthy();
    expect(parseActivityQuery({ page: '01' }).validationError).toBeTruthy();
    expect(parseActivityQuery({ pageSize: '101' }).validationError).toBeTruthy();
    expect(parseActivityQuery({ action: 'HACK' }).validationError).toBeTruthy();
    expect(parseActivityQuery({ from: '2026-02-30' }).validationError).toBeTruthy();
    expect(parseActivityQuery({ from: '2026-10-08', to: '2026-10-07' }).validationError).toBeTruthy();
  });

  it('builds encoded page links that retain valid filters and omit page 1', () => {
    const url = buildActivityPageUrl({ q: 'รับเรื่อง', action: 'TAKEOVER', pageSize: '25' }, 2);
    expect(url).toContain('q=');
    expect(url).toContain('action=TAKEOVER');
    expect(url).toContain('pageSize=25');
    expect(url).toContain('page=2');
    expect(buildActivityPageUrl({ q: 'a', page: '3' }, 1)).not.toContain('page=');
  });

  it('builds filter-change links that reset page but retain size', () => {
    const url = buildActivityFilterUrl({ q: 'a', page: '4', pageSize: '25', action: 'REPLY' });
    expect(url).not.toContain('page=');
    expect(url).toContain('pageSize=25');
    expect(url).toContain('action=REPLY');
  });
});

describe('OC-UI-02.03/04 activities adapter, privacy, and list rendering', () => {
  it('projects the root DTO groups with server-owned labels only', () => {
    const projected = projectActivityFields({
      id: '6f63c09c-377e-4f85-8a50-407d14b7ded4', occurredAt: '2026-10-06T02:15:00.000Z',
      action: 'CREATE', actionLabel: 'สร้างงาน', actorDisplayName: null, ticketCode: 'TK-2026-0001',
      departmentLabel: 'ฝ่ายทดสอบ', summary: 'สร้างงาน',
    });
    expect(projected.ok).toBe(true);
    if (projected.ok) expect(projected.item.actionLabel).toBe('สร้างงาน');
  });

  it('loads the accepted strict envelope from the same-origin API with the abort signal', async () => {
    const response = {
      items: [{
        id: '6f63c09c-377e-4f85-8a50-407d14b7ded4',
        occurredAt: '2026-10-06T02:15:00.000Z',
        action: 'CREATE', actionLabel: 'สร้างงาน', actorDisplayName: 'เจ้าหน้าที่ทดสอบ',
        ticketCode: 'TK-2026-0001', departmentLabel: 'ฝ่ายทดสอบ', summary: 'สร้างงาน',
      }],
      pagination: { page: 1, pageSize: 25, total: 1, totalPages: 1, hasNext: false, hasPrevious: false },
      window: { from: '2026-10-01', to: '2026-10-07', timeZone: 'Asia/Bangkok' },
    };
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(response), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    try {
      const controller = new AbortController();
      const state = await createActivitiesAdapter().load({
        page: 1, pageSize: 25, from: '2026-10-01', to: '2026-10-07', action: 'CREATE',
      }, controller.signal);
      expect(state.status).toBe('ready');
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('/api/activities?page=1&pageSize=25&from=2026-10-01&to=2026-10-07&action=CREATE');
      expect(init.signal).toBe(controller.signal);
      expect(init.credentials).toBe('same-origin');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('production adapter is unavailable by default without guessing an endpoint', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 503 })));
    const state = await loadActivityList(filters);
    expect(state.status).toBe('unavailable');
    expect('items' in state).toBe(false);
    vi.unstubAllGlobals();
  });

  it('renders fixture rows through the production renderer with safe fields only', () => {
    const adapter = createActivitiesAdapter(fixtureLoader());
    return adapter.load(filters).then((state) => {
      expect(state.status).toBe('ready');
      const html = renderView({ state, baseParams: { pageSize: '25' } });
      expect(html).toContain('TEST-2026-0001');
      expect(html).toContain('สร้างงาน');
      expect(html).toContain('ฝ่ายทดสอบระบบ');
      expect(html).not.toContain('U-deadbeef');
      expect(html).not.toContain('TK-2026-');
    });
  });

  it('strips injected secrets and private extras before render', () => {
    const adapter = createActivitiesAdapter(fixtureLoader([SECRET_INJECTED_ACTIVITY]));
    return adapter.load(filters).then((state) => {
      expect(state.status).toBe('error');
      const html = renderView({ state, baseParams: {} });
      for (const secret of [
        'U-deadbeef_should_never_render',
        'secret-access-token-must-not-render',
        'secret-reply-token-must-not-render',
        'hunter2-must-not-render',
        'must-not-render',
        '10.9.9.9',
      ]) {
        expect(html).not.toContain(secret);
      }
      expect(html).not.toContain('สรุปที่ดูปลอดภัย');
    });
  });

  it('fails closed to a safe error on malformed rows', () => {
    const adapter = createActivitiesAdapter(fixtureLoader([null, { id: 'x' }]));
    return adapter.load(filters).then((state) => {
      expect(state.status).toBe('error');
      const html = renderView({ state, baseParams: {} });
      expect(html).toContain('ลองอีกครั้ง');
    });
  });

  it('renders known-empty distinctly from unavailable', () => {
    const adapter = createActivitiesAdapter(fixtureLoader([]));
    return adapter.load(filters).then((state) => {
      expect(state.status).toBe('empty');
      const html = renderView({ state, baseParams: {} });
      expect(html).toContain('ยังไม่มีกิจกรรม');
      expect(html).not.toContain('อยู่ระหว่างเชื่อมต่อ');
    });
  });

  it('renders loading with a status announcement, not rows', () => {
    const html = renderView({
      state: { status: 'loading', observedAt: '2026-10-07T00:00:00.000Z' },
      baseParams: {},
    });
    expect(html).toContain('กำลังโหลด');
    expect(html).not.toContain('TEST-2026-0001');
  });
});

describe('OC-UI-02.05/06 activity page wiring and detail', () => {
  it('does not dispatch the adapter on invalid query and shows recovery', async () => {
    const element = await ActivitiesPage({ searchParams: params({ q: ['a', 'b'] }) });
    const html = renderToStaticMarkup(element);
    expect(activityCalls.calls.length).toBe(0);
    expect(html).toContain('ตัวกรองไม่ถูกต้อง');
    expect(html).toContain('ล้างตัวกรองทั้งหมด');
  });

  it('renders the authenticated root read for a valid query', async () => {
    const element = await ActivitiesPage({ searchParams: params({ page: '1', pageSize: '25' }) });
    const html = renderToStaticMarkup(element);
    expect(activityCalls.calls.length).toBe(1);
    expect(html).toContain('TEST-2026-0001');
    expect(html).toContain('Asia/Bangkok');
    expect(readMock.read).toHaveBeenCalledWith('staff-test-id', expect.objectContaining({ page: 1, pageSize: 25 }));
    expect(html).not.toContain('ROOT_BACKEND_SYNC_REQUIRED');
    expect(html).not.toContain('0 รายการ');
  });

  it('opens detail with a labelled dialog and closes back to the list', () => {
    const adapter = createActivitiesAdapter(fixtureLoader());
    return adapter.load(filters).then((state) => {
      const closed = renderView({ state, baseParams: {} });
      expect(closed).not.toContain('role="dialog"');
      const open = renderView({ state, baseParams: {}, initialSelectedId: '6f63c09c-377e-4f85-8a50-407d14b7ded4' });
      expect(open).toContain('role="dialog"');
      expect(open).toContain('TEST-2026-0001');
      expect(open).toContain('สมมติ เจ้าหน้าที่หนึ่ง');
    });
  });

  it('handles dialog keys with Escape only and exposes the shared handler', () => {
    expect(isEscapeKey({ key: 'Escape' })).toBe(true);
    expect(isEscapeKey({ key: 'Enter' })).toBe(false);
    const onEscape = vi.fn();
    handleDialogKeyDown({ key: 'Escape' }, onEscape);
    expect(onEscape).toHaveBeenCalledTimes(1);
    handleDialogKeyDown({ key: 'Tab' }, onEscape);
    expect(onEscape).toHaveBeenCalledTimes(1);
  });

  it('keeps action labels from the fixed allowlist, never raw input', () => {
    expect(ACTIVITY_ACTIONS.TAKEOVER).toContain('รับงาน');
    const projected = projectActivityFields(SYNTHETIC_ACTIVITIES[0]);
    expect(projected.ok).toBe(true);
    if (projected.ok) expect(projected.item.actionLabel).toBe(ACTIVITY_ACTIONS.CREATE);
  });

  it('captures filter and pager arguments through the production controller', async () => {
    const seen: unknown[][] = [];
    const controller = createOperatorController(async (filters: unknown) => {
      seen.push([filters]);
      throw new OperatorLoadError('fail', false);
    }, { page: 1, pageSize: 25 });
    await controller.load({ page: 2, pageSize: '25' } as never);
    expect(seen[0]?.[0]).toEqual({ page: 2, pageSize: '25' });
    expect(controller.getPendingFilters()).toEqual({ page: 2, pageSize: '25' });
    controller.dispose();
  });
});
