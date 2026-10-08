import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ staff: vi.fn(), list: vi.fn() }));

vi.mock('@/lib/auth/staff', () => ({ requireStaff: mocks.staff }));
vi.mock('@/lib/tickets/reads', () => ({ listTickets: mocks.list }));

import TicketsPage from '@/app/(dashboard)/tickets/page';
import {
  buildPageUrl,
  buildTicketServiceFilters,
  parseCanonicalTicketQuery,
} from '@/app/(dashboard)/tickets/ticket-helpers';

const STAFF_ID = 'staff-pilot-id';
const DEPT_ID = '11111111-1111-4111-8111-111111111111';
const ASSIGNEE_ID = '22222222-2222-4222-8222-222222222222';

function ticketRow(index: number) {
  return {
    id: `ticket-${index}`,
    ticket_no: `TK-2026-${String(index).padStart(4, '0')}`,
    department_id: DEPT_ID,
    department_name: 'Test Department',
    category: 'ACADEMIC',
    problem_summary: `Pilot summary ${index} ปฏิทิน`,
    priority: 'MEDIUM',
    status: 'NEW',
    mode: 'AI',
    sensitive_level: 'GENERAL',
    assigned_staff_id: null,
    assignee_name: null,
    revision: 1,
    created_at: '2026-10-01T00:00:00.000Z',
    updated_at: '2026-10-02T00:00:00.000Z',
    anonymous_code: `ANON-${index}`,
  };
}

function listResultFixture(page: number, pageSize: number, total: number) {
  const rows = Array.from({ length: pageSize }, (_, i) => ticketRow((page - 1) * pageSize + i + 1));
  const totalPages = Math.ceil(total / pageSize);
  return {
    tickets: rows,
    departments: [{ id: DEPT_ID, code: 'IT', name_th: 'Test Department' }],
    assignees: [{ id: ASSIGNEE_ID, display_name: 'Pilot Staff' }],
    pagination: {
      page,
      pageSize,
      total,
      totalPages,
      hasNext: page * pageSize < total,
      hasPrevious: page > 1,
    },
  };
}

function paramsPromise(params: Record<string, string | string[] | undefined>) {
  return Promise.resolve(params);
}

function renderedText(element: unknown): string {
  const seen = new WeakSet<object>();
  const parts: string[] = [];
  function visit(node: unknown): void {
    if (node === null || node === undefined) return;
    if (typeof node === 'string' || typeof node === 'number') {
      parts.push(String(node));
      return;
    }
    if (Array.isArray(node)) {
      for (const child of node) visit(child);
      return;
    }
    if (typeof node === 'object') {
      if (seen.has(node as object)) return;
      seen.add(node as object);
      const record = node as Record<string, unknown>;
      if ('props' in record) visit(record.props);
      if ('children' in record) visit(record.children);
      else {
        for (const value of Object.values(record)) {
          if (typeof value === 'string') parts.push(value);
        }
      }
      return;
    }
  }
  visit(element);
  return parts.join(' ');
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.staff.mockResolvedValue({ id: STAFF_ID });
  mocks.list.mockResolvedValue(listResultFixture(1, 25, 250));
});

describe('OC-UI-01 controlled ticket search/pagination pilot', () => {
  it('sends q/page/pageSize plus valid filters to the service', async () => {
    await TicketsPage({
      searchParams: paramsPromise({
        q: 'ปฏิทิน',
        page: '2',
        pageSize: '25',
        department: DEPT_ID,
        status: 'NEW',
        priority: 'HIGH',
        assignee: ASSIGNEE_ID,
        from: '2026-01-01',
        to: '2026-06-30',
        sensitivity: 'GENERAL',
      }),
    });

    expect(mocks.list).toHaveBeenCalledTimes(1);
    expect(mocks.list).toHaveBeenCalledWith(
      STAFF_ID,
      expect.objectContaining({
        q: 'ปฏิทิน',
        page: 2,
        pageSize: 25,
        department: DEPT_ID,
        status: 'NEW',
        priority: 'HIGH',
        assignee: ASSIGNEE_ID,
        from: '2026-01-01',
        to: '2026-06-30',
        sensitivity: 'GENERAL',
      }),
    );
  });

  it('builds service filters with canonical q/page/pageSize defaults', () => {
    const canonical = parseCanonicalTicketQuery({ q: '  หอพัก  ', page: '2', pageSize: '25' });
    expect(canonical.validationError).toBeUndefined();
    expect(buildTicketServiceFilters(canonical)).toEqual({
      q: 'หอพัก',
      page: 2,
      pageSize: 25,
    });
  });

  it('rejects duplicate and unknown query keys instead of using the first value', () => {
    expect(parseCanonicalTicketQuery({ q: ['a', 'b'] }).validationError).toBeTruthy();
    expect(parseCanonicalTicketQuery({ page: ['1', '2'] }).validationError).toBeTruthy();
    expect(parseCanonicalTicketQuery({ unknown: '1' }).validationError).toBeTruthy();
    expect(parseCanonicalTicketQuery({ q: 'a', sql: 'select' }).validationError).toBeTruthy();
  });

  it('rejects malformed pages without silent fallback', () => {
    for (const page of ['01', '1bad', '+1', '2.5', '0', '-1', '10001']) {
      expect(parseCanonicalTicketQuery({ page }).validationError).toBeTruthy();
    }
    for (const pageSize of ['01', '1bad', '+1', '2.5', '0', '101']) {
      expect(parseCanonicalTicketQuery({ pageSize }).validationError).toBeTruthy();
    }
  });

  it('rejects invalid enum/UUID/date selectors', () => {
    expect(parseCanonicalTicketQuery({ status: 'BAD' }).validationError).toBeTruthy();
    expect(parseCanonicalTicketQuery({ priority: 'URGENT' }).validationError).toBeTruthy();
    expect(parseCanonicalTicketQuery({ sensitivity: 'TOP' }).validationError).toBeTruthy();
    expect(parseCanonicalTicketQuery({ department: 'not-a-uuid' }).validationError).toBeTruthy();
    expect(parseCanonicalTicketQuery({ assignee: 'dept-123' }).validationError).toBeTruthy();
    expect(parseCanonicalTicketQuery({ from: '2026-02-30' }).validationError).toBeTruthy();
    expect(
      parseCanonicalTicketQuery({ from: '2026-12-31', to: '2026-01-01' }).validationError,
    ).toBeTruthy();
  });

  it('does not call the service with an unfiltered replacement on invalid query', async () => {
    await TicketsPage({ searchParams: paramsPromise({ page: '01' }) });
    expect(mocks.list).not.toHaveBeenCalled();

    await TicketsPage({ searchParams: paramsPromise({ q: ['a', 'b'] }) });
    expect(mocks.list).not.toHaveBeenCalled();

    await TicketsPage({ searchParams: paramsPromise({ unknown: '1' }) });
    expect(mocks.list).not.toHaveBeenCalled();

    await TicketsPage({ searchParams: paramsPromise({ status: 'BAD' }) });
    expect(mocks.list).not.toHaveBeenCalled();
  });

  it('renders the returned server page with 25 rows for total 250 page 2', async () => {
    mocks.list.mockResolvedValueOnce(listResultFixture(2, 25, 250));
    const element = await TicketsPage({ searchParams: paramsPromise({ page: '2', pageSize: '25' }) });
    const text = renderedText(element);

    expect(mocks.list).toHaveBeenCalledWith(STAFF_ID, expect.objectContaining({ page: 2, pageSize: 25 }));
    expect(text).toContain('250');
    expect(text).toContain('TK-2026-0026');
    expect(text).toContain('TK-2026-0050');
    expect(text).not.toContain('TK-2026-0051');
  });

  it('distinguishes missing pagination as unknown instead of a fabricated total', async () => {
    mocks.list.mockResolvedValueOnce({
      tickets: [ticketRow(1)],
      departments: [],
      assignees: [],
    });
    const element = await TicketsPage({ searchParams: paramsPromise({}) });
    const text = renderedText(element);

    expect(text).toContain('ไม่ระบุจำนวนรวม');
    expect(text).not.toContain('"total"');
  });

  it('preserves valid filters in page links with correct encoding', () => {
    const url = buildPageUrl({ q: 'ลงทะเบียน', status: 'NEW', pageSize: '25', page: '1' }, 2);
    expect(url).toContain('q=%E0%B8%A5%E0%B8%87%E0%B8%97%E0%B8%B0%E0%B9%80%E0%B8%9A%E0%B8%B5%E0%B8%A2%E0%B8%99');
    expect(url).toContain('status=NEW');
    expect(url).toContain('pageSize=25');
    expect(url).toContain('page=2');
    expect(buildPageUrl({ q: 'a', page: '2' }, 1)).not.toContain('page=');
  });
});
