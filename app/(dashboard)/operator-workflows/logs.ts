/** Browser-safe Logs query, transport, and response validation. */

import {
  logCodes,
  operationsEnvelopeSchema,
  parseLogQuery as parseRootLogQuery,
  type LogFilters,
  type LogItem,
  type ReadEnvelope,
} from '@/lib/operations/contracts';
import { currentObservedAt, validOperatorPagination, type OperatorViewState } from './state';
import { OperatorLoadError } from './controller';
import { LOG_SEVERITY_LABELS, projectLogFields } from './privacy';

export type { LogFilters as LogServiceFilters, LogItem };
export type ValidatedLogQuery = LogFilters & { validationError?: string };
export const LOG_SEVERITIES = LOG_SEVERITY_LABELS;
export const LOG_COMPONENTS = ['ai-gateway', 'line-delivery'] as const;
export const LOG_CODES = logCodes;
export const ALLOWED_LOG_QUERY_KEYS = ['q', 'severity', 'component', 'code', 'from', 'to', 'page', 'pageSize'] as const;

function toSearchParams(params: Record<string, string | string[] | undefined>): URLSearchParams {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue;
    for (const item of Array.isArray(value) ? value : [value]) search.append(key, item);
  }
  return search;
}

/** Uses the root parser, including its Bangkok seven-day default and bounds. */
export function parseLogQuery(
  params: Record<string, string | string[] | undefined>,
  now = new Date(),
): ValidatedLogQuery {
  try {
    return parseRootLogQuery(toSearchParams(params), now);
  } catch {
    const pageSizeValue = params.pageSize;
    const pageSize = typeof pageSizeValue === 'string' && /^[1-9]\d*$/u.test(pageSizeValue)
      ? Math.min(100, Number(pageSizeValue))
      : 25;
    return {
      ...parseRootLogQuery(new URLSearchParams(`page=1&pageSize=${pageSize}`), now),
      validationError: 'ตัวกรองไม่ถูกต้อง โปรดตรวจสอบคำค้นหา วันที่ และตัวเลือก',
    };
  }
}

export function buildLogServiceFilters(query: ValidatedLogQuery): LogFilters {
  const { validationError, ...filters } = query;
  void validationError;
  return filters;
}

function appendKeptParams(
  target: URLSearchParams,
  searchParams: Record<string, string | string[] | undefined>,
  skip: readonly string[],
): void {
  for (const [key, value] of Object.entries(searchParams)) {
    if (skip.includes(key) || !(ALLOWED_LOG_QUERY_KEYS as readonly string[]).includes(key)) continue;
    if (value === undefined || Array.isArray(value)) continue;
    target.append(key, value);
  }
}

export function buildLogPageUrl(
  searchParams: Record<string, string | string[] | undefined>,
  targetPage: number,
): string {
  const kept = new URLSearchParams();
  appendKeptParams(kept, searchParams, ['page']);
  if (targetPage > 1) kept.set('page', String(targetPage));
  const query = kept.toString();
  return query ? `/logs?${query}` : '/logs';
}

export function buildLogFilterUrl(searchParams: Record<string, string | string[] | undefined>): string {
  const kept = new URLSearchParams();
  appendKeptParams(kept, searchParams, ['page']);
  const query = kept.toString();
  return query ? `/logs?${query}` : '/logs';
}

export function buildLogClearUrl(params: Record<string, string | string[] | undefined>): string {
  const parsed = parseLogQuery({ pageSize: params.pageSize });
  return `/logs?pageSize=${parsed.pageSize}&from=${parsed.from}&to=${parsed.to}`;
}

export type LogLoader = (filters: LogFilters, signal: AbortSignal) => Promise<ReadEnvelope<unknown>>;

function responseError(status: number): OperatorLoadError {
  if (status === 503) return new OperatorLoadError('บันทึกระบบยังไม่พร้อมใช้งาน', true);
  if (status === 401) return new OperatorLoadError('เซสชันหมดอายุ กรุณาเข้าสู่ระบบอีกครั้ง');
  if (status === 403 || status === 404) return new OperatorLoadError('ไม่มีสิทธิ์อ่านบันทึกระบบ');
  return new OperatorLoadError('โหลดบันทึกระบบไม่สำเร็จ');
}

function logUrl(filters: LogFilters): string {
  const query = new URLSearchParams();
  if (filters.q) query.set('q', filters.q);
  query.set('page', String(filters.page));
  query.set('pageSize', String(filters.pageSize));
  query.set('from', filters.from);
  query.set('to', filters.to);
  if (filters.severity) query.set('severity', filters.severity);
  if (filters.component) query.set('component', filters.component);
  if (filters.code) query.set('code', filters.code);
  return `/api/logs?${query.toString()}`;
}

export function createLogBrowserLoader(fetcher: typeof fetch = fetch): LogLoader {
  return async (filters, signal) => {
    const response = await fetcher(logUrl(filters), {
      method: 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { accept: 'application/json' },
      signal,
    });
    if (!response.ok) throw responseError(response.status);
    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new OperatorLoadError('รูปแบบบันทึกระบบไม่ถูกต้อง');
    }
    const parsed = operationsEnvelopeSchema('logs').safeParse(payload);
    if (!parsed.success || parsed.data.window.from !== filters.from || parsed.data.window.to !== filters.to ||
        !validOperatorPagination(parsed.data.pagination, parsed.data.items.length, filters)) {
      throw new OperatorLoadError('รูปแบบบันทึกระบบไม่ถูกต้อง');
    }
    const items = parsed.data.items.map(projectLogFields);
    if (items.some(item => !item.ok)) throw new OperatorLoadError('รูปแบบบันทึกระบบไม่ถูกต้อง');
    return {
      items: items.map(item => item.ok ? item.item : null).filter((item): item is LogItem => item !== null),
      pagination: parsed.data.pagination,
      window: parsed.data.window,
    };
  };
}

export interface LogsAdapter {
  load(filters: LogFilters, signal?: AbortSignal): Promise<OperatorViewState<LogItem>>;
}

export function createLogsAdapter(loader: LogLoader = createLogBrowserLoader()): LogsAdapter {
  return {
    load: async (filters, signal) => {
      const observedAt = currentObservedAt();
      try {
        const abort = signal ?? new AbortController().signal;
        const payload = await loader(filters, abort);
        const parsed = operationsEnvelopeSchema('logs').safeParse(payload);
        if (!parsed.success || parsed.data.window.from !== filters.from || parsed.data.window.to !== filters.to ||
            !validOperatorPagination(parsed.data.pagination, parsed.data.items.length, filters)) {
          return { status: 'error', observedAt, message: 'รูปแบบข้อมูลไม่ถูกต้อง', canRetry: true };
        }
        const projected = parsed.data.items.map(projectLogFields);
        if (projected.some(item => !item.ok)) {
          return { status: 'error', observedAt, message: 'รูปแบบข้อมูลไม่ถูกต้อง', canRetry: true };
        }
        const items = projected.map(item => item.ok ? item.item : null).filter((item): item is LogItem => item !== null);
        if (items.length === 0) return { status: 'empty', observedAt, pagination: parsed.data.pagination };
        return { status: 'ready', observedAt, items, pagination: parsed.data.pagination };
      } catch (error) {
        if (error instanceof OperatorLoadError && error.unavailable) return { status: 'unavailable', observedAt };
        return { status: 'error', observedAt, message: 'โหลดข้อมูลไม่สำเร็จ กรุณาลองอีกครั้ง', canRetry: true };
      }
    },
  };
}

/** SSR callers inject the authenticated root read; browser callers use same-origin fetch. */
export async function loadLogList(
  filters: LogFilters,
  loader: LogLoader = createLogBrowserLoader(),
): Promise<OperatorViewState<LogItem>> {
  return createLogsAdapter(loader).load(filters);
}
