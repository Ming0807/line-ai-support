/**
 * Shared browser-safe view-state contract for operator workflows
 * (Activities + Logs). No backend, auth, or Node imports.
 */

export type OperatorStatus = 'unavailable' | 'loading' | 'ready' | 'empty' | 'error';

export interface OperatorPagination {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  hasNext: boolean;
  hasPrevious: boolean;
}

export type OperatorViewState<T> =
  | { status: 'unavailable'; observedAt: string; detail?: string }
  | { status: 'loading'; observedAt: string }
  | { status: 'ready'; observedAt: string; items: T[]; pagination?: OperatorPagination }
  | { status: 'empty'; observedAt: string; pagination?: OperatorPagination }
  | { status: 'error'; observedAt: string; message: string; canRetry: boolean };

export function currentObservedAt(): string {
  return new Date().toISOString();
}

export function isValidTimestamp(value: unknown): boolean {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,6})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/u.test(value)) return false;
  const civil = new Date(value.slice(0,10)+'T00:00:00.000Z');
  return Number.isFinite(civil.getTime()) && civil.toISOString().slice(0,10)===value.slice(0,10) && Number.isFinite(Date.parse(value));
}

/** Unknown totals stay absent; present observations must agree with their rows/request. */
export function validOperatorPagination(value: unknown, rowCount: number, request?: {page:number;pageSize:number}): boolean {
  if(value===undefined)return true;
  if(value===null||typeof value!=='object'||Array.isArray(value))return false;
  const p=value as Record<string,unknown>;
  const keys=['page','pageSize','total','totalPages','hasNext','hasPrevious'];
  if(Object.keys(p).length!==keys.length||!keys.every(key=>Object.hasOwn(p,key)))return false;
  if(!['page','pageSize','total','totalPages'].every(key=>typeof p[key]==='number'&&Number.isSafeInteger(p[key])))return false;
  const page=p.page as number,size=p.pageSize as number,total=p.total as number,pages=p.totalPages as number;
  if(page<1||page>1_000_000||size<1||size>100||total<0||pages!==Math.ceil(total/size))return false;
  if(p.hasNext!==(page<pages)||p.hasPrevious!==(page>1))return false;
  if(request&&(request.page!==page||request.pageSize!==size))return false;
  return rowCount===Math.max(0,Math.min(size,total-(page-1)*size));
}

/** Shared by actual dialog keyboard handlers; container/outside focus stays inside. */
export function dialogTabTarget(shift:boolean,atFirst:boolean,atLast:boolean,atContainerOrOutside:boolean):'FIRST'|'LAST'|null {
  if(atContainerOrOutside)return shift?'LAST':'FIRST';
  if(shift&&atFirst)return 'LAST';
  if(!shift&&atLast)return 'FIRST';
  return null;
}

const UNKNOWN_TIME_LABEL = 'ไม่ทราบ';

/**
 * Formats an ISO timestamp for Asia/Bangkok display. Invalid input renders a
 * safe unknown label instead of throwing, so one bad row can never break the
 * whole page.
 */
export function formatBangkokDateTime(value: unknown): string {
  if (!isValidTimestamp(value)) return UNKNOWN_TIME_LABEL;
  try {
    return new Intl.DateTimeFormat('th-TH', {
      timeZone: 'Asia/Bangkok',
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(value as string));
  } catch {
    return UNKNOWN_TIME_LABEL;
  }
}

export function formatBangkokDate(value: unknown): string {
  if (!isValidTimestamp(value)) return UNKNOWN_TIME_LABEL;
  try {
    return new Intl.DateTimeFormat('th-TH', {
      timeZone: 'Asia/Bangkok',
      dateStyle: 'medium',
    }).format(new Date(value as string));
  } catch {
    return UNKNOWN_TIME_LABEL;
  }
}
