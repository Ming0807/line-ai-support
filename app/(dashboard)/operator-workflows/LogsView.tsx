'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import type { LogFilters } from '@/lib/operations/contracts';
import type { LogItem } from './privacy';
import { LOG_SEVERITY_LABELS } from './privacy';
import type { OperatorViewState } from './state';
import { formatBangkokDateTime } from './state';
import { buildLogPageUrl, buildLogClearUrl, buildLogServiceFilters, createLogsAdapter, parseLogQuery } from './logs';
import { createOperatorController, OperatorLoadError } from './controller';
import LogDetail from './LogDetail';
import OperatorPager from './pagination';

type SearchParams = Record<string, string | string[] | undefined>;

interface LogsViewProps {
  state: OperatorViewState<LogItem>;
  filters?: LogFilters;
  baseParams: SearchParams;
  retryHref?: string;
  initialSelectedId?: string;
}

/**
 * Production logs renderer: one component for every view state. Observed HTTP
 * statuses render as observed values only — the view never infers healthy,
 * failed, or quota state from a status code. Retry preserves the current
 * filters through the retry link.
 */
export default function LogsView({ state: initialState, filters, baseParams, retryHref, initialSelectedId }: LogsViewProps) {
  const activeFilters = filters ?? buildLogServiceFilters(parseLogQuery(baseParams));
  const [controller] = useState(() =>
    createOperatorController(
      (query, signal) => createLogsAdapter().load(query, signal).then(state => {
        if (state.status === 'error') throw new OperatorLoadError(state.message);
        if (state.status === 'unavailable') throw new OperatorLoadError('unavailable', true);
        if (state.status === 'loading') throw new OperatorLoadError('loading');
        return { items: state.status === 'ready' ? state.items : [], pagination: state.pagination };
      }),
      activeFilters,
      initialState,
    ),
  );
  const [state, setState] = useState(initialState);
  useEffect(() => controller.subscribe(() => setState(controller.getState())), [controller]);
  useEffect(() => () => controller.dispose(), [controller]);
  const retry = useCallback(() => void controller.retry(), [controller]);
  const [selectedId, setSelectedId] = useState<string | undefined>(initialSelectedId);
  const lastTriggerRef = useRef<HTMLElement | null>(null);

  const openDetail = useCallback((id: string, trigger: HTMLElement | null) => {
    lastTriggerRef.current = trigger;
    setSelectedId(id);
  }, []);

  const closeDetail = useCallback(() => {
    setSelectedId(undefined);
  }, []);

  const returnFocus = useCallback(() => {
    lastTriggerRef.current?.focus();
  }, []);

  const fallbackRetry =
    retryHref ??
    buildLogPageUrl(baseParams, state.status === 'ready' || state.status === 'empty' ? (state.pagination?.page ?? 1) : 1);

  if (state.status === 'loading') {
    return (
      <div className="opw-state" role="status" aria-live="polite">
        <p>กำลังโหลดบันทึก…</p>
      </div>
    );
  }

  if (state.status === 'unavailable') {
    return (
      <div className="opw-state" role="status">
        <p className="opw-state-title">อยู่ระหว่างเชื่อมต่อข้อมูลบันทึก</p>
        <p>ขณะนี้ยังอ่านบันทึกที่อยู่ในขอบเขตไม่ได้ โปรดลองอีกครั้งภายหลัง หรือกลับไปยังงานรับเรื่อง</p>
        <div className="opw-actions">
          <Link className="opw-btn opw-btn-primary" href="/tickets">
            ไปหน้างานรับเรื่อง
          </Link>
          <button className="opw-btn opw-btn-secondary" type="button" onClick={retry}>
            ลองโหลดอีกครั้ง
          </button>
          <Link className="opw-btn opw-btn-secondary" href={fallbackRetry}>โหลดหน้าใหม่</Link>
        </div>
      </div>
    );
  }

  if (state.status === 'error') {
    return (
      <div className="opw-state" role="alert">
        <p className="opw-state-title">โหลดบันทึกไม่สำเร็จ</p>
        <p>{state.message}</p>
        <div className="opw-actions">
          <button className="opw-btn opw-btn-primary" type="button" onClick={retry}>
            ลองอีกครั้ง
          </button>
          <Link className="opw-btn opw-btn-secondary" href="/tickets">
            ไปหน้างานรับเรื่อง
          </Link>
        </div>
      </div>
    );
  }

  if (state.status === 'empty') {
    return (
      <div className="opw-state" role="status">
        <p className="opw-state-title">ยังไม่มีบันทึกตรงกับเงื่อนไข</p>
        <p>ลองเปลี่ยนคำค้น ระดับ หรือช่วงเวลา หรือล้างตัวกรองเพื่อดูทั้งหมด</p>
        <div className="opw-actions">
          <Link className="opw-btn opw-btn-secondary" href={buildLogClearUrl(baseParams)}>
            ล้างตัวกรอง
          </Link>
        </div>
      </div>
    );
  }

  const selected = selectedId ? state.items.find((row) => row.id === selectedId) : undefined;

  return (
    <div>
      <p className="opw-count" role="status">
        ทั้งหมด {state.pagination ? state.pagination.total : state.items.length} รายการ
        {state.pagination ? ` · หน้า ${state.pagination.page} จาก ${state.pagination.totalPages}` : ''}
      </p>
      <ul className="opw-list">
        {state.items.map((item) => (
          <li key={item.id} className="opw-row">
            <button
              type="button"
              className="opw-row-btn"
              onClick={(event) => openDetail(item.id, event.currentTarget)}
              aria-haspopup="dialog"
            >
              <span className="opw-row-main">
                <strong>
                  {item.code} · {LOG_SEVERITY_LABELS[item.severity] ?? item.severity}
                </strong>
                <span className="opw-row-summary">{item.label}</span>
                <span className="opw-row-meta">
                  {item.component} · {formatBangkokDateTime(item.loggedAt)}
                  {item.httpStatus !== null ? ` · HTTP ${item.httpStatus}` : ''}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
      {state.pagination && state.pagination.totalPages > 0 && (
        <OperatorPager pagination={state.pagination} buildUrl={(target) => buildLogPageUrl(baseParams, target)} label="การแบ่งหน้าบันทึก" />
      )}
      {selected && (
        <LogDetail
          item={selected}
          titleId={`log-detail-${selected.id}`}
          onClose={closeDetail}
          onReturnFocus={returnFocus}
        />
      )}
    </div>
  );
}
