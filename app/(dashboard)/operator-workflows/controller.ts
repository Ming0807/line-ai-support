/**
 * Framework-free production controller for operator list workflows.
 * One code path serves the fixture harness, unit tests, and (once a backend
 * exists) real adapters: latest-request-wins epoch fencing plus AbortController
 * cancellation, so stale or aborted responses never overwrite newer state.
 */

import { currentObservedAt, validOperatorPagination, type OperatorPagination, type OperatorViewState } from './state';

export class OperatorLoadError extends Error {
  readonly unavailable: boolean;

  constructor(message: string, unavailable = false) {
    super(message);
    this.name = 'OperatorLoadError';
    this.unavailable = unavailable;
  }
}

export interface OperatorPage<T> {
  items: T[];
  pagination?: OperatorPagination;
}

export type OperatorLoader<TFilters, TItem> = (
  filters: TFilters,
  signal: AbortSignal,
) => Promise<OperatorPage<TItem>>;

export interface OperatorController<TFilters, TItem> {
  getState(): OperatorViewState<TItem>;
  getPendingFilters(): TFilters;
  isPending(): boolean;
  subscribe(listener: () => void): () => void;
  load(filters: TFilters): Promise<void>;
  retry(): Promise<void>;
  clear(defaultFilters: TFilters): Promise<void>;
  cancel(): void;
  dispose(): void;
}

export function createOperatorController<TFilters, TItem>(
  loader: OperatorLoader<TFilters, TItem>,
  initialFilters: TFilters,
  initialState?: OperatorViewState<TItem>,
): OperatorController<TFilters, TItem> {
  let state: OperatorViewState<TItem> = initialState ?? { status: 'loading', observedAt: currentObservedAt() };
  let pendingFilters: TFilters = initialFilters;
  let pending = false;
  let epoch = 0;
  let aborter: AbortController | null = null;
  let disposed = false;
  const listeners = new Set<() => void>();

  function emit(): void {
    if (disposed) return;
    for (const listener of listeners) listener();
  }

  function setState(next: OperatorViewState<TItem>): void {
    state = next;
    pending = false;
    emit();
  }

  async function run(filters: TFilters): Promise<void> {
    if (disposed) return;
    epoch += 1;
    const ticket = epoch;
    if (aborter) aborter.abort();
    aborter = new AbortController();
    const signal = aborter.signal;
    pendingFilters = filters;
    pending = true;
    emit();
    let page: OperatorPage<TItem>;
    try {
      page = await loader(filters, signal);
    } catch (error) {
      if (disposed || ticket !== epoch || signal.aborted) return;
      if (error instanceof OperatorLoadError && error.unavailable) {
        setState({ status: 'unavailable', observedAt: currentObservedAt() });
      } else {
        setState({
          status: 'error',
          observedAt: currentObservedAt(),
          message: 'โหลดข้อมูลไม่สำเร็จ กรุณาลองอีกครั้ง',
          canRetry: true,
        });
      }
      return;
    }
    if (disposed || ticket !== epoch || signal.aborted) return;
    if (!page || !Array.isArray(page.items) || !validOperatorPagination(page.pagination,page.items.length)) {
      setState({
        status: 'error',
        observedAt: currentObservedAt(),
        message: 'รูปแบบข้อมูลไม่ถูกต้อง',
        canRetry: true,
      });
      return;
    }
    if (page.items.length === 0) {
      setState({ status: 'empty', observedAt: currentObservedAt(), pagination: page.pagination });
    } else {
      setState({
        status: 'ready',
        observedAt: currentObservedAt(),
        items: page.items,
        pagination: page.pagination,
      });
    }
  }

  return {
    getState: () => state,
    getPendingFilters: () => pendingFilters,
    isPending: () => pending,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    load: (filters: TFilters) => run(filters),
    retry: () => run(pendingFilters),
    clear: (defaultFilters: TFilters) => run(defaultFilters),
    cancel: () => {
      epoch += 1;
      if (aborter) aborter.abort();
      pending = false;
      emit();
    },
    dispose: () => {
      disposed = true;
      if (aborter) aborter.abort();
      listeners.clear();
    },
  };
}
