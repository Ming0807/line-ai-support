'use client';

import type { StaffTicketAction, TicketActionResult } from '@/types/tickets';
import { parseReplyResult } from './chat-thread-state';

/**
 * Cross-case lifecycle attempt workspace (D1). One store instance lives for the
 * mounted operator; an attempt is write-once and identified by
 * (actorId, ticketId, action). Returning to a ticket keeps its stored attempt,
 * so a retry always re-posts the ORIGINAL endpoint with the ORIGINAL body —
 * form edits, polling, or room switches never rewrite a stored attempt and a
 * retry never mints a new requestId.
 */
export type ActionAttemptBody = Record<string, string | number>;
export type ActionAttempt = {
  actorId: string;
  ticketId: string;
  action: StaffTicketAction;
  endpoint: string;
  revision: number;
  requestId: string;
  body: ActionAttemptBody;
  startedAt: number;
};

export type ActionAttemptInput = {actorId: string; ticketId: string; action: StaffTicketAction; endpoint: string; revision: number; body: ActionAttemptBody};

const workspaces = new Map<string, Map<string, ActionAttempt>>();
const listeners = new Set<() => void>();

function workspaceFor(actorId: string): Map<string, ActionAttempt> {
  const existing = workspaces.get(actorId);
  if (existing) return existing;
  const created = new Map<string, ActionAttempt>();
  workspaces.set(actorId, created);
  return created;
}

function broadcast(): void {
  for (const listener of [...listeners]) listener();
}

export function subscribeActionAttempts(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

function newRequestId(): string {
  const api = globalThis.crypto;
  if (typeof api?.randomUUID === 'function') return api.randomUUID();
  throw new Error('REQUEST_ID_UNAVAILABLE');
}

/** Attempt key space is per (actor, ticket, action); the workspace map is per actor. */
function attemptKey(ticketId: string, action: StaffTicketAction): string {
  return `${ticketId}:${action}`;
}

export function findActionAttempt(actorId: string, ticketId: string, action: StaffTicketAction): ActionAttempt | undefined {
  return workspaces.get(actorId)?.get(attemptKey(ticketId, action));
}

/**
 * Write-once registration: when an attempt already exists for the key, the
 * stored attempt (with its original body / requestId / revision) is returned
 * unchanged and the proposed body is discarded.
 */
export function registerActionAttempt(next: ActionAttemptInput): ActionAttempt {
  const workspace = workspaceFor(next.actorId);
  const key = attemptKey(next.ticketId, next.action);
  const existing = workspace.get(key);
  if (existing) return existing;
  const supplied = typeof next.body.requestId === 'string' && next.body.requestId ? next.body.requestId : null;
  const requestId = supplied ?? newRequestId();
  const attempt: ActionAttempt = { ...next, requestId, body: { ...next.body, requestId }, startedAt: Date.now() };
  workspace.set(key, attempt);
  broadcast();
  return attempt;
}

/**
 * Definitive outcomes (valid commit, definitive 4xx) release the stored attempt.
 * OP06-02 RX2: a completion may clear ONLY the attempt whose requestId it
 * carries — a late OLD response never releases a NEWER attempt re-registered
 * under the same (actor, ticket, action) key while the newer request flies.
 */
export function clearActionAttempt(actorId: string, ticketId: string, action: StaffTicketAction, guard?: { requestId: string }): void {
  const workspace = workspaces.get(actorId);
  if (!workspace) return;
  const key = attemptKey(ticketId, action);
  const stored = workspace.get(key);
  if (!stored) return;
  if (guard && stored.requestId !== guard.requestId) return;
  workspace.delete(key);
  broadcast();
}

/** Ticket-wide erasure used by access-loss paths (must clear every action of the ticket). */
export function clearTicketActionAttempts(actorId: string, ticketId: string): void {
  const workspace = workspaces.get(actorId);
  if (!workspace) return;
  const prefix = `${ticketId}:`;
  const doomed = [...workspace.keys()].filter(key => key.startsWith(prefix));
  if (doomed.length === 0) return;
  for (const key of doomed) workspace.delete(key);
  broadcast();
}

/** Full actor erasure (login switch / mount teardown / logout) — used by the cleanup task. */
export function clearActorActionAttempts(actorId: string): void {
  if (!workspaces.delete(actorId)) return;
  broadcast();
}

/**
 * D3: a lifecycle 200 commits ONLY on the exact success DTO
 * `TicketActionResult {id,ticketStatus enum,revision int}` with `id === ticketId`.
 * Anything else (empty {}, malformed, wrong ticket) stays unknown.
 * The strict validator is shared: composer replies use parseReplyResult too.
 */
export function parseActionResult(payload: unknown, ticketId: string): TicketActionResult | null {
  return parseReplyResult(payload, ticketId);
}
