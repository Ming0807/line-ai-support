'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import type { ActivityFilters } from '@/lib/operations/contracts';
import type { ActivityItem } from './privacy';
import type { OperatorViewState } from './state';
import { formatBangkokDateTime } from './state';
import { buildActivityPageUrl, buildActivityClearUrl, buildActivityServiceFilters, createActivitiesAdapter, parseActivityQuery } from './activities';
import { createOperatorController, OperatorLoadError } from './controller';
import ActivityDetail from './ActivityDetail';
import OperatorPager from './pagination';

type SearchParams = Record<string, string | string[] | undefined>;

interface ActivitiesViewProps {
  state: OperatorViewState<ActivityItem>;
  filters?: ActivityFilters;
  baseParams: SearchParams;
  retryHref?: string;
  initialSelectedId?: string;
}

/**
 * Production activities renderer: one component for every view state.
 * Ready rows are safe projected fields only; stale rows during reload are
 * marked busy and never presented as the current response.
 */
export default function ActivitiesView({ state: initialState, filters, baseParams, retryHref, initialSelectedId }: ActivitiesViewProps) {
  const activeFilters = filters ?? buildActivityServiceFilters(parseActivityQuery(baseParams));
  const [controller] = useState(() =>
    createOperatorController(
      (query, signal) => createActivitiesAdapter().load(query, signal).then(state => {
        if (state.status === 'error') throw new OperatorLoadError(state.message);
        if (state.status === 'unavailable') throw new OperatorLoadError('unavailable', true);
        if (state.status === 'loading') throw new Error('loading');
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
  const fallbackRetry =
    retryHref ?? buildActivityPageUrl(baseParams, state.status === 'ready' || state.status === 'empty' ? (state.pagination?.page ?? 1) : 1);
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

  if (state.status === 'loading') {
    return (
      <div className="opw-state" role="status" aria-live="polite">
        <p>กำลังโหลดกิจกรรม…</p>
      </div>
    );
  }

  if (state.status === 'unavailable') {
    return (
      <div className="opw-state" role="status">
        <p className="opw-state-title">อยู่ระหว่างเชื่อมต่อข้อมูลกิจกรรม</p>
        <p>ขณะนี้ยังอ่านข้อมูลกิจกรรมไม่ได้ โปรดลองอีกครั้งภายหลัง หรือกลับไปยังงานรับเรื่อง</p>
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
        <p className="opw-state-title">โหลดกิจกรรมไม่สำเร็จ</p>
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
        <p className="opw-state-title">ยังไม่มีกิจกรรมตรงกับเงื่อนไข</p>
        <p>ลองเปลี่ยนคำค้นหรือช่วงเวลา หรือล้างตัวกรองเพื่อดูทั้งหมด</p>
        <div className="opw-actions">
          <Link className="opw-btn opw-btn-secondary" href={buildActivityClearUrl(baseParams)}>
            ล้างตัวกรอง
          </Link>
        </div>
        {state.pagination && (
          <p className="opw-count">
            ทั้งหมด {state.pagination.total} รายการ · หน้า {state.pagination.page} จาก{' '}
            {state.pagination.totalPages}
          </p>
        )}
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
                <strong>{item.actionLabel}</strong>
                <span className="opw-row-summary">{item.summary}</span>
                <span className="opw-row-meta">
                  {formatBangkokDateTime(item.occurredAt)} · {item.actorDisplayName ?? 'ไม่ระบุผู้ดำเนินการ'} ·{' '}
                  {item.ticketCode ?? 'ไม่ระบุรหัส'} · {item.departmentLabel ?? 'ไม่ระบุหน่วยงาน'}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
      {state.pagination && state.pagination.totalPages > 0 && (
        <OperatorPager
          pagination={state.pagination}
          buildUrl={(target) => buildActivityPageUrl(baseParams, target)}
          label="การแบ่งหน้ากิจกรรม"
        />
      )}
      {selected && (
        <ActivityDetail
          item={selected}
          titleId={`activity-detail-${selected.id}`}
          onClose={closeDetail}
          onReturnFocus={returnFocus}
        />
      )}
    </div>
  );
}
