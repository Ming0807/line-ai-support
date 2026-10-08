import {z} from 'zod';
import {ticketFiltersSchema, type TicketFilters} from '@/types/tickets';

export interface TicketPaginationState {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  hasNext: boolean;
  hasPrevious: boolean;
}

export interface ValidatedTicketQuery {
  q?: string;
  page: number;
  pageSize: number;
  department?: string;
  status?: TicketFilters['status'];
  priority?: TicketFilters['priority'];
  assignee?: string;
  sensitivity?: TicketFilters['sensitivity'];
  from?: string;
  to?: string;
  validationError?: string;
}

/**
 * Validates page number strictly according to Root contract:
 * Rejects leading zeros ('01'), non-digits ('1bad'), zero, and negative values.
 */
export function parsePageNumber(value: unknown, maximum: number): number | null {
  if (typeof value === 'number') {
    return Number.isInteger(value) && value >= 1 && value <= maximum ? value : null;
  }
  if (typeof value === 'string') {
    if (!/^[1-9][0-9]*$/u.test(value)) return null;
    const num = Number(value);
    return Number.isSafeInteger(num) && num >= 1 && num <= maximum ? num : null;
  }
  return null;
}

/**
 * Validates search text 'q' strictly according to Root contract:
 * Max 200 characters, no Unicode control characters (\p{Cc}), trimmed.
 */
export function validateSearchQuery(rawQuery?: string): { valid: boolean; value?: string; error?: string } {
  if (rawQuery === undefined || rawQuery === null) return { valid: true };
  if (typeof rawQuery !== 'string') return { valid: false, error: 'รูปแบบคำค้นหาไม่ถูกต้อง' };
  if (rawQuery.length > 200) return { valid: false, error: 'คำค้นหายาวเกิน 200 ตัวอักษร' };
  if (/\p{Cc}/u.test(rawQuery)) return { valid: false, error: 'คำค้นหามีอักขระควบคุมที่ไม่อนุญาต' };
  const trimmed = rawQuery.trim();
  return { valid: true, value: trimmed || undefined };
}

export const ALLOWED_TICKET_QUERY_KEYS = [
  'q',
  'page',
  'pageSize',
  'department',
  'status',
  'priority',
  'assignee',
  'from',
  'to',
  'sensitivity',
] as const;

const TICKET_STATUSES: readonly NonNullable<TicketFilters['status']>[] = [
  'NEW',
  'AI_HANDLING',
  'WAITING_STAFF',
  'STAFF_HANDLING',
  'WAITING_USER',
  'RESOLVED',
  'CLOSED',
  'CANCELLED',
] as const;

const TICKET_PRIORITIES: readonly NonNullable<TicketFilters['priority']>[] = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];

const TICKET_SENSITIVITIES: readonly NonNullable<TicketFilters['sensitivity']>[] = ['GENERAL', 'SENSITIVE', 'RESTRICTED'];

function isTicketStatus(value: string): value is NonNullable<TicketFilters['status']> {
  return TICKET_STATUSES.some(candidate => candidate === value);
}

function isTicketPriority(value: string): value is NonNullable<TicketFilters['priority']> {
  return TICKET_PRIORITIES.some(candidate => candidate === value);
}

function isTicketSensitivity(value: string): value is NonNullable<TicketFilters['sensitivity']> {
  return TICKET_SENSITIVITIES.some(candidate => candidate === value);
}

const CIVIL_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/u;

function isValidUuid(value: string): boolean {
  return z.uuid().safeParse(value).success;
}

function isValidCivilDate(value: string): boolean {
  const match = CIVIL_DATE_PATTERN.exec(value);
  if (!match) return false;
  const normalized = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(normalized.getTime())) return false;
  return normalized.toISOString().slice(0, 10) === value;
}

export type TicketServiceFilters = TicketFilters;

/**
 * Parses and validates raw searchParams from URL matching Root TicketFilters contract.
 * Unknown or duplicate keys are invalid. Invalid enum/UUID/date selectors are
 * reported as validationError and must prevent service calls with unfiltered data.
 */
export function parseCanonicalTicketQuery(
  params: Record<string, string | string[] | undefined>,
): ValidatedTicketQuery {
  for (const key of Object.keys(params)) {
    if (!(ALLOWED_TICKET_QUERY_KEYS as readonly string[]).includes(key)) {
      return {
        q: undefined,
        page: 1,
        pageSize: 100,
        department: undefined,
        status: undefined,
        priority: undefined,
        assignee: undefined,
        sensitivity: undefined,
        from: undefined,
        to: undefined,
        validationError: `พารามิเตอร์ไม่ถูกต้อง: ${key}`,
      };
    }
  }

  for (const key of ALLOWED_TICKET_QUERY_KEYS) {
    if (Array.isArray(params[key])) {
      return {
        q: undefined,
        page: 1,
        pageSize: 100,
        department: undefined,
        status: undefined,
        priority: undefined,
        assignee: undefined,
        sensitivity: undefined,
        from: undefined,
        to: undefined,
        validationError: `พารามิเตอร์ซ้ำไม่ถูกต้อง: ${key}`,
      };
    }
  }

  const getSingle = (key: string): string | undefined => {
    const v = params[key];
    if (typeof v !== 'string') return undefined;
    if (v === '') return undefined;
    return v;
  };

  const rawQ = getSingle('q');
  const qValidation = validateSearchQuery(rawQ);

  const rawPage = typeof params.page === 'string' ? params.page : undefined;
  const parsedPage = rawPage !== undefined ? parsePageNumber(rawPage, 10000) : 1;
  const page = parsedPage ?? 1;

  const rawPageSize = typeof params.pageSize === 'string' ? params.pageSize : undefined;
  const parsedPageSize = rawPageSize !== undefined ? parsePageNumber(rawPageSize, 100) : 100;
  const pageSize = parsedPageSize ?? 100;

  let validationError: string | undefined;
  if (!qValidation.valid) {
    validationError = qValidation.error;
  } else if (rawPage !== undefined && parsedPage === null) {
    validationError = 'หมายเลขหน้าไม่ถูกต้อง (ต้องเป็นจำนวนเต็มบวก 1–10,000 โดยไม่มีเลขศูนย์นำหน้า)';
  } else if (rawPageSize !== undefined && parsedPageSize === null) {
    validationError = 'ขนาดหน้าไม่ถูกต้อง (ต้องเป็นจำนวนเต็มบวก 1–100 โดยไม่มีเลขศูนย์นำหน้า)';
  }

  const department = getSingle('department');
  const status = getSingle('status');
  const priority = getSingle('priority');
  const assignee = getSingle('assignee');
  const sensitivity = getSingle('sensitivity');
  const from = getSingle('from');
  const to = getSingle('to');

  if (!validationError && department && !isValidUuid(department)) {
    validationError = 'หน่วยงานไม่ถูกต้อง (ต้องเป็นรหัส UUID)';
  } else if (!validationError && assignee && !isValidUuid(assignee)) {
    validationError = 'ผู้รับผิดชอบไม่ถูกต้อง (ต้องเป็นรหัส UUID)';
  } else if (
    !validationError &&
    status &&
    !isTicketStatus(status)
  ) {
    validationError = 'สถานะไม่ถูกต้อง';
  } else if (
    !validationError &&
    priority &&
    !isTicketPriority(priority)
  ) {
    validationError = 'ความสำคัญไม่ถูกต้อง';
  } else if (
    !validationError &&
    sensitivity &&
    !isTicketSensitivity(sensitivity)
  ) {
    validationError = 'ระดับข้อมูลไม่ถูกต้อง';
  } else if (!validationError && from && !isValidCivilDate(from)) {
    validationError = 'วันที่เริ่มต้นไม่ถูกต้อง (ต้องเป็น YYYY-MM-DD)';
  } else if (!validationError && to && !isValidCivilDate(to)) {
    validationError = 'วันที่สิ้นสุดไม่ถูกต้อง (ต้องเป็น YYYY-MM-DD)';
  } else if (!validationError && from && to && from > to) {
    validationError = 'ช่วงวันที่ไม่ถูกต้อง (วันที่เริ่มต้นต้องไม่มากกว่าวันที่สิ้นสุด)';
  }

  return {
    q: qValidation.value,
    page,
    pageSize,
    department,
    status: status && isTicketStatus(status) ? status : undefined,
    priority: priority && isTicketPriority(priority) ? priority : undefined,
    assignee,
    sensitivity: sensitivity && isTicketSensitivity(sensitivity) ? sensitivity : undefined,
    from,
    to,
    validationError,
  };
}

/**
 * Builds the exact service selector object sent to listTickets per Root contract.
 * Includes only valid selectors: q/page/pageSize plus department/status/priority/
 * assignee/from/to/sensitivity. Callers must skip the service call when
 * canonical.validationError is present.
 */
export function buildTicketServiceFilters(canonical: ValidatedTicketQuery): TicketServiceFilters {
  const filters: TicketServiceFilters = {
    page: canonical.page,
    pageSize: canonical.pageSize,
  };
  if (canonical.q) filters.q = canonical.q;
  if (canonical.department) filters.department = canonical.department;
  if (canonical.status) filters.status = canonical.status;
  if (canonical.priority) filters.priority = canonical.priority;
  if (canonical.assignee) filters.assignee = canonical.assignee;
  if (canonical.sensitivity) filters.sensitivity = canonical.sensitivity;
  if (canonical.from) filters.from = canonical.from;
  if (canonical.to) filters.to = canonical.to;
  return ticketFiltersSchema.parse(filters);
}

const paginationSchema=z.object({page:z.number().int().min(1).max(10000),pageSize:z.number().int().min(1).max(100),
 total:z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),totalPages:z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
 hasNext:z.boolean(),hasPrevious:z.boolean()}).strict();

/** Missing or inconsistent service metadata remains unknown. It never authorizes a scope. */
export function readTicketPagination(input:unknown,query:ValidatedTicketQuery,rowCount:number):TicketPaginationState|null{
 const checked=paginationSchema.safeParse(input);
 if(!checked.success)return null;
 const value=checked.data;
 if(value.page!==query.page||value.pageSize!==query.pageSize||value.totalPages!==Math.ceil(value.total/value.pageSize)
  ||value.hasNext!==(value.page<value.totalPages)||value.hasPrevious!==(value.page>1)
  ||rowCount!==Math.max(0,Math.min(value.pageSize,value.total-(value.page-1)*value.pageSize)))return null;
 return value;
}

/**
 * Builds ticket search URL preserving all valid query parameters while updating page.
 * Changing page retains every valid filter (including pageSize); page=1 is omitted
 * for canonical URLs. Unknown keys and duplicate array values are never preserved
 * because they are invalid selectors.
 */
export function buildPageUrl(
  searchParams: Record<string, string | string[] | undefined>,
  targetPage: number,
): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams)) {
    if (key === 'page') continue;
    if (!(ALLOWED_TICKET_QUERY_KEYS as readonly string[]).includes(key)) continue;
    if (value === undefined || value === null || value === '') continue;
    if (Array.isArray(value)) continue;
    params.append(key, value);
  }
  if (targetPage > 1) {
    params.set('page', String(targetPage));
  }
  const str = params.toString();
  return str ? `/tickets?${str}` : '/tickets';
}

/**
 * Builds a filter-change URL that resets page but retains pageSize and all other
 * valid filters. Used when changing search/filters so the pager restarts at page 1
 * without losing the selected page size.
 */
export function buildFilterUrl(
  searchParams: Record<string, string | string[] | undefined>,
): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams)) {
    if (key === 'page') continue;
    if (!(ALLOWED_TICKET_QUERY_KEYS as readonly string[]).includes(key)) continue;
    if (value === undefined || value === null || value === '') continue;
    if (Array.isArray(value)) continue;
    params.append(key, value);
  }
  const str = params.toString();
  return str ? `/tickets?${str}` : '/tickets';
}
