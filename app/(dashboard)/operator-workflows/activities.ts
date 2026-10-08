/** Browser-safe Activities query, transport, and response validation. */

import {
  activityLabels,
  operationsEnvelopeSchema,
  parseActivityQuery as parseRootActivityQuery,
  type ActivityFilters,
  type ActivityItem,
  type ReadEnvelope,
} from '@/lib/operations/contracts';
import { currentObservedAt, validOperatorPagination, type OperatorViewState } from './state';
import { OperatorLoadError } from './controller';
import { projectActivityFields } from './privacy';

export type { ActivityFilters as ActivityServiceFilters, ActivityItem };
export type ValidatedActivityQuery = ActivityFilters & { validationError?: string };
export const ACTIVITY_ACTIONS = activityLabels;
export type ActivityAction = keyof typeof ACTIVITY_ACTIONS;
export const ALLOWED_ACTIVITY_QUERY_KEYS = ['q', 'from', 'to', 'page', 'pageSize', 'action'] as const;

function toSearchParams(params: Record<string, string | string[] | undefined>): URLSearchParams {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue;
    for (const item of Array.isArray(value) ? value : [value]) search.append(key, item);
  }
  return search;
}

/** Uses the root parser, including its Bangkok seven-day default and bounds. */
export function parseActivityQuery(
  params: Record<string, string | string[] | undefined>,
  now = new Date(),
): ValidatedActivityQuery {
  try {
    return parseRootActivityQuery(toSearchParams(params), now);
  } catch {
    const pageSizeValue = params.pageSize;
    const pageSize = typeof pageSizeValue === 'string' && /^[1-9]\d*$/u.test(pageSizeValue)
      ? Math.min(100, Number(pageSizeValue))
      : 25;
    return {
      ...parseRootActivityQuery(new URLSearchParams(`page=1&pageSize=${pageSize}`), now),
      validationError: 'ตัวกรองไม่ถูกต้อง โปรดตรวจสอบคำค้นหา วันที่ และตัวเลือก',
    };
  }
}

export function buildActivityServiceFilters(query: ValidatedActivityQuery): ActivityFilters {
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
    if (skip.includes(key) || !(ALLOWED_ACTIVITY_QUERY_KEYS as readonly string[]).includes(key)) continue;
    if (value === undefined || Array.isArray(value)) continue;
    target.append(key, value);
  }
}

export function buildActivityPageUrl(
  searchParams: Record<string, string | string[] | undefined>,
  targetPage: number,
): string {
  const kept = new URLSearchParams();
  appendKeptParams(kept, searchParams, ['page']);
  if (targetPage > 1) kept.set('page', String(targetPage));
  const query = kept.toString();
  return query ? `/activities?${query}` : '/activities';
}

export function buildActivityFilterUrl(searchParams: Record<string, string | string[] | undefined>): string {
  const kept = new URLSearchParams();
  appendKeptParams(kept, searchParams, ['page']);
  const query = kept.toString();
  return query ? `/activities?${query}` : '/activities';
}

export function buildActivityClearUrl(params: Record<string, string | string[] | undefined>): string {
  const parsed = parseActivityQuery({ pageSize: params.pageSize });
  return `/activities?pageSize=${parsed.pageSize}&from=${parsed.from}&to=${parsed.to}`;
}

export type ActivityLoader = (
  filters: ActivityFilters,
  signal: AbortSignal,
) => Promise<ReadEnvelope<unknown>>;

function responseError(status: number): OperatorLoadError {
  if (status === 503) return new OperatorLoadError('ข้อมูลกิจกรรมยังไม่พร้อมใช้งาน', true);
  if (status === 401) return new OperatorLoadError('เซสชันหมดอายุ กรุณาเข้าสู่ระบบอีกครั้ง');
  if (status === 403 || status === 404) return new OperatorLoadError('ไม่มีสิทธิ์อ่านข้อมูลกิจกรรม');
  return new OperatorLoadError('โหลดข้อมูลกิจกรรมไม่สำเร็จ');
}

function activityUrl(filters: ActivityFilters): string {
  const query = new URLSearchParams();
  if (filters.q) query.set('q', filters.q);
  query.set('page', String(filters.page));
  query.set('pageSize', String(filters.pageSize));
  query.set('from', filters.from);
  query.set('to', filters.to);
  if (filters.action) query.set('action', filters.action);
  return `/api/activities?${query.toString()}`;
}

export function createActivityBrowserLoader(fetcher: typeof fetch = fetch): ActivityLoader {
  return async (filters, signal) => {
    const response = await fetcher(activityUrl(filters), {
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
      throw new OperatorLoadError('รูปแบบข้อมูลกิจกรรมไม่ถูกต้อง');
    }
    const parsed = operationsEnvelopeSchema('activities').safeParse(payload);
    if (!parsed.success || parsed.data.window.from !== filters.from || parsed.data.window.to !== filters.to ||
        !validOperatorPagination(parsed.data.pagination, parsed.data.items.length, filters)) {
      throw new OperatorLoadError('รูปแบบข้อมูลกิจกรรมไม่ถูกต้อง');
    }
    const items = parsed.data.items.map(projectActivityFields);
    if (items.some(item => !item.ok)) throw new OperatorLoadError('รูปแบบข้อมูลกิจกรรมไม่ถูกต้อง');
    return {
      items: items.map(item => item.ok ? item.item : null).filter((item): item is ActivityItem => item !== null),
      pagination: parsed.data.pagination,
      window: parsed.data.window,
    };
  };
}

export interface ActivitiesAdapter {
  load(filters: ActivityFilters, signal?: AbortSignal): Promise<OperatorViewState<ActivityItem>>;
}

export function createActivitiesAdapter(loader: ActivityLoader = createActivityBrowserLoader()): ActivitiesAdapter {
  return {
    load: async (filters, signal) => {
      const observedAt = currentObservedAt();
      try {
        const abort = signal ?? new AbortController().signal;
        const payload = await loader(filters, abort);
        const parsed = operationsEnvelopeSchema('activities').safeParse(payload);
        if (!parsed.success || parsed.data.window.from !== filters.from || parsed.data.window.to !== filters.to ||
            !validOperatorPagination(parsed.data.pagination, parsed.data.items.length, filters)) {
          return { status: 'error', observedAt, message: 'รูปแบบข้อมูลไม่ถูกต้อง', canRetry: true };
        }
        const projected = parsed.data.items.map(projectActivityFields);
        if (projected.some(item => !item.ok)) {
          return { status: 'error', observedAt, message: 'รูปแบบข้อมูลไม่ถูกต้อง', canRetry: true };
        }
        const items = projected.map(item => item.ok ? item.item : null).filter((item): item is ActivityItem => item !== null);
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
export async function loadActivityList(
  filters: ActivityFilters,
  loader: ActivityLoader = createActivityBrowserLoader(),
): Promise<OperatorViewState<ActivityItem>> {
  return createActivitiesAdapter(loader).load(filters);
}
