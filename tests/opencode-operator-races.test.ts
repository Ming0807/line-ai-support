import { describe, expect, it } from 'vitest';
import { createOperatorController, OperatorLoadError } from '@/app/(dashboard)/operator-workflows/controller';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('OC-UI-02.09 request races and cancellation (production controller)', () => {
  it('starts from the server-rendered state without a duplicate client read', () => {
    const initial = { status: 'empty' as const, observedAt: '2026-10-08T00:00:00.000Z', pagination: {
      page: 1, pageSize: 25, total: 0, totalPages: 0, hasNext: false, hasPrevious: false,
    } };
    const controller = createOperatorController(async () => ({ items: [] }), { page: 1, pageSize: 25 }, initial);
    expect(controller.getState()).toEqual(initial);
    expect(controller.isPending()).toBe(false);
    controller.dispose();
  });

  it('latest request wins when an older load settles last', async () => {
    const first = deferred<{ items: string[] }>();
    const controller = createOperatorController(async (filters: { tag: string }, signal: AbortSignal) => {
      if ((filters as { tag: string }).tag === 'A') return first.promise;
      void signal;
      return { items: ['B'] };
    }, { tag: 'A' });
    const runA = controller.load({ tag: 'A' });
    await controller.load({ tag: 'B' });
    first.resolve({ items: ['A-STALE'] });
    await runA;
    const state = controller.getState();
    expect(state.status).toBe('ready');
    if (state.status === 'ready') expect(state.items).toEqual(['B']);
    controller.dispose();
  });

  it('late errors from superseded requests never overwrite the winner', async () => {
    const first = deferred<{ items: string[] }>();
    const controller = createOperatorController(async (filters: { tag: string }) => {
      if ((filters as { tag: string }).tag === 'A') return first.promise;
      return { items: ['B'] };
    }, { tag: 'A' });
    const runA = controller.load({ tag: 'A' });
    await controller.load({ tag: 'B' });
    first.reject(new OperatorLoadError('stale failure', false));
    await runA;
    expect(controller.getState().status).toBe('ready');
    controller.dispose();
  });

  it('aborts the previous request when replaced', async () => {
    const signals: AbortSignal[] = [];
    const controller = createOperatorController(async (_filters: unknown, signal: AbortSignal) => {
      signals.push(signal);
      return { items: [] };
    }, { page: 1 });
    await controller.load({ page: 1 });
    const running = controller.load({ page: 2 });
    expect(signals[0]?.aborted).toBe(true);
    await running;
    controller.dispose();
  });

  it('ignores late settlements after unmount disposal', async () => {
    const gate = deferred<{ items: string[] }>();
    let notifications = 0;
    const controller = createOperatorController(async () => gate.promise, { page: 1 });
    controller.subscribe(() => {
      notifications += 1;
    });
    const running = controller.load({ page: 2 });
    const settledAtDispose = notifications;
    expect(settledAtDispose).toBeGreaterThan(0);
    controller.dispose();
    gate.resolve({ items: ['too-late'] });
    await running;
    expect(controller.getState().status).toBe('loading');
    expect(notifications).toBe(settledAtDispose);
  });

  it('never mixes an old detail selection with new rows', async () => {
    const controller = createOperatorController(async (filters: { page: number }) => {
      if ((filters as { page: number }).page === 1) return { items: [{ id: 'row-1' }] };
      return { items: [{ id: 'row-2' }] };
    }, { page: 1 });
    await controller.load({ page: 1 });
    const before = controller.getState();
    await controller.load({ page: 2 });
    const after = controller.getState();
    if (before.status === 'ready' && after.status === 'ready') {
      expect(before.items).not.toEqual(after.items);
    } else {
      expect.unreachable('both loads should be ready');
    }
    controller.dispose();
  });
});
