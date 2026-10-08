'use client';

import { useSyncExternalStore } from 'react';
import type { OperatorController } from './controller';
import type { OperatorViewState } from './state';

/**
 * React binding for the production operator controller. The controller owns
 * all loading/race/cancellation logic; this hook only subscribes. Server
 * pages never import this file.
 */
export function useOperatorView<TFilters, TItem>(
  controller: OperatorController<TFilters, TItem>,
): { state: OperatorViewState<TItem>; pending: boolean } {
  const state = useSyncExternalStore(
    (notify) => controller.subscribe(notify),
    () => controller.getState(),
    () => controller.getState(),
  );
  return { state, pending: controller.isPending() };
}
