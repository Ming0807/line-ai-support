import { describe, expect, it } from 'vitest';
import {
  formatBangkokDateTime,
  isValidTimestamp,
  type OperatorPagination,
  type OperatorViewState,
} from '@/app/(dashboard)/operator-workflows/state';

const PAGINATION: OperatorPagination = {
  page: 2,
  pageSize: 25,
  total: 250,
  totalPages: 10,
  hasNext: true,
  hasPrevious: true,
};

describe('OC-UI-02.02 shared operator view-state contract', () => {
  it('holds five distinct states with observedAt on every state', () => {
    const states: OperatorViewState<unknown>[] = [
      { status: 'unavailable', observedAt: '2026-10-07T00:00:00.000Z' },
      { status: 'loading', observedAt: '2026-10-07T00:00:00.000Z' },
      { status: 'ready', observedAt: '2026-10-07T00:00:00.000Z', items: [{ id: 1 }], pagination: PAGINATION },
      { status: 'empty', observedAt: '2026-10-07T00:00:00.000Z' },
      { status: 'error', observedAt: '2026-10-07T00:00:00.000Z', message: 'ล้มเหลว', canRetry: true },
    ];
    const kinds = new Set(states.map((state) => state.status));
    expect(kinds.size).toBe(5);
    for (const state of states) {
      expect(typeof state.observedAt).toBe('string');
      expect(Number.isNaN(Date.parse(state.observedAt))).toBe(false);
    }
  });

  it('keeps pagination only where evidence exists, never on unavailable', () => {
    const unavailable: OperatorViewState<unknown> = {
      status: 'unavailable',
      observedAt: '2026-10-07T00:00:00.000Z',
    };
    expect('pagination' in unavailable).toBe(false);
    expect('items' in unavailable).toBe(false);
    const ready: OperatorViewState<unknown> = {
      status: 'ready',
      observedAt: '2026-10-07T00:00:00.000Z',
      items: [],
      pagination: PAGINATION,
    };
    expect(ready.pagination?.total).toBe(250);
  });

  it('formats valid timestamps in Asia/Bangkok Thai locale', () => {
    const text = formatBangkokDateTime('2026-10-06T09:15:00.000+07:00');
    expect(text).toContain('2569');
    expect(text).not.toBe('ไม่ทราบ');
  });

  it('renders unknown for invalid timestamps without throwing', () => {
    for (const bad of [undefined, null, '', 'เมื่อวาน', '2026-13-99', 42, {}]) {
      expect(() => formatBangkokDateTime(bad)).not.toThrow();
      expect(formatBangkokDateTime(bad)).toBe('ไม่ทราบ');
      expect(isValidTimestamp(bad)).toBe(false);
    }
    expect(isValidTimestamp('2026-10-06T09:15:00.000+07:00')).toBe(true);
  });

  it('distinguishes empty from error and unavailable', () => {
    const empty: OperatorViewState<unknown> = { status: 'empty', observedAt: '2026-10-07T00:00:00.000Z' };
    const error: OperatorViewState<unknown> = {
      status: 'error',
      observedAt: '2026-10-07T00:00:00.000Z',
      message: 'ล้มเหลว',
      canRetry: true,
    };
    expect(empty.status).not.toBe(error.status);
    expect(error.canRetry).toBe(true);
  });
});
