import { z } from 'zod';

export type LineChannel = 'STUDENT' | 'STAFF';
export type DeliveryMode = 'REPLY' | 'PUSH';

const postbackActionSchema = z.strictObject({
  type: z.literal('postback'),
  label: z.string().min(1).max(20),
  data: z.string().min(1).max(300),
  displayText: z.string().max(300).optional(),
});

const quickReplySchema = z.strictObject({
  items: z.array(z.strictObject({
    type: z.literal('action'),
    action: postbackActionSchema,
  })).min(1).max(13),
});

const lineTextMessageSchema = z.strictObject({
  type: z.literal('text'),
  text: z.string().min(1).max(5000),
  quickReply: quickReplySchema.optional(),
});

const messagesSchema = z.array(lineTextMessageSchema).min(1).max(5);

export type LineMessage = z.infer<typeof lineTextMessageSchema>;

/** Prior network attempts only; the caller persists the upcoming attempt before fetch. */
export interface DeliveryInput {
  channel: LineChannel;
  mode: DeliveryMode;
  recipientId: string;
  replyToken?: string;
  messages: readonly LineMessage[];
  retryKey: string;
  firstAttemptAt: Date | null;
  replyDeadlineAt: Date | null;
  attempts: number;
}

export interface DeliveryOptions {
  accessToken: string;
  fetchImpl?: typeof fetch;
  now?: () => Date;
  timeoutMs?: number;
}

export type DeliveryErrorCode =
  | 'INVALID_MODE'
  | 'INVALID_ATTEMPT_STATE'
  | 'INVALID_CLOCK'
  | 'INVALID_CHANNEL'
  | 'CHANNEL_NOT_CONFIGURED'
  | 'INVALID_RECIPIENT'
  | 'INVALID_RETRY_KEY'
  | 'INVALID_REPLY_DEADLINE'
  | 'INVALID_MESSAGES'
  | 'PUSH_RETRY_WINDOW_UNKNOWN'
  | 'PUSH_RETRY_WINDOW_INVALID'
  | 'PUSH_RETRY_WINDOW_EXPIRED'
  | 'LINE_REJECTED'
  | 'REPLY_RATE_LIMITED'
  | 'UNEXPECTED_HTTP_STATUS';

export type DeliveryResult =
  | { status: 'SENT'; mode: DeliveryMode; httpStatus: number; requestId?: string }
  | { status: 'RETRY'; mode: 'PUSH'; httpStatus?: number; requestId?: string; errorCode: 'PUSH_RETRYABLE' | 'PUSH_NETWORK_ERROR' | 'PUSH_TIMEOUT' }
  | { status: 'DEAD'; mode: DeliveryMode; httpStatus?: number; requestId?: string; errorCode: DeliveryErrorCode }
  | { status: 'UNKNOWN'; mode: 'REPLY'; httpStatus?: number; requestId?: string; errorCode: 'REPLY_ALREADY_ATTEMPTED' | 'REPLY_OUTCOME_UNKNOWN' };

const API_BASE = 'https://api.line.me/v2/bot/message';
const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_TIMEOUT_MS = 30_000;
const PUSH_RETRY_WINDOW_MS = 24 * 60 * 60 * 1000;
const MAX_REPLY_WINDOW_MS = 60_000;
const REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LINE_USER_ID_PATTERN = /^U[A-Za-z0-9]{1,127}$/;

function requestId(headers: Headers, accepted = false): string | undefined {
  const acceptedId = accepted ? headers.get('x-line-accepted-request-id') : null;
  const currentId = headers.get('x-line-request-id');
  if (acceptedId && REQUEST_ID_PATTERN.test(acceptedId)) return acceptedId;
  return currentId && REQUEST_ID_PATTERN.test(currentId) ? currentId : undefined;
}

function isValidDate(value: Date | null): value is Date {
  return value instanceof Date && Number.isFinite(value.getTime());
}

function dead(mode: DeliveryMode, errorCode: DeliveryErrorCode): DeliveryResult {
  return { status: 'DEAD', mode, errorCode };
}

/**
 * Send one LINE reply or push request. `attempts` and `firstAttemptAt` describe
 * earlier requests; the caller persists the next attempt and effective mode
 * before invoking the network operation.
 */
export async function deliverLine(input: DeliveryInput, options: DeliveryOptions): Promise<DeliveryResult> {
  const inputMode = input.mode;
  if (inputMode !== 'REPLY' && inputMode !== 'PUSH') return dead('PUSH', 'INVALID_MODE');
  let mode: DeliveryMode = inputMode;

  if (!Number.isSafeInteger(input.attempts) || input.attempts < 0) return dead(mode, 'INVALID_ATTEMPT_STATE');
  const now = options.now?.() ?? new Date();
  if (!isValidDate(now)) return dead(mode, 'INVALID_CLOCK');

  if (mode === 'REPLY' && (input.attempts > 0 || input.firstAttemptAt !== null)) {
    return { status: 'UNKNOWN', mode: 'REPLY', errorCode: 'REPLY_ALREADY_ATTEMPTED' };
  }

  if (input.channel !== 'STUDENT' && input.channel !== 'STAFF') return dead(mode, 'INVALID_CHANNEL');
  if (!options.accessToken || options.accessToken.trim() !== options.accessToken) return dead(mode, 'CHANNEL_NOT_CONFIGURED');
  if (!LINE_USER_ID_PATTERN.test(input.recipientId)) return dead(mode, 'INVALID_RECIPIENT');
  if (!UUID_PATTERN.test(input.retryKey)) return dead(mode, 'INVALID_RETRY_KEY');
  if (input.firstAttemptAt !== null && !isValidDate(input.firstAttemptAt)) return dead(mode, 'INVALID_ATTEMPT_STATE');
  if (input.replyDeadlineAt !== null && !isValidDate(input.replyDeadlineAt)) return dead(mode, 'INVALID_REPLY_DEADLINE');

  const validatedMessages = messagesSchema.safeParse(input.messages);
  if (!validatedMessages.success) return dead(mode, 'INVALID_MESSAGES');

  if (mode === 'REPLY') {
    const hasReplyToken = typeof input.replyToken === 'string'
      && input.replyToken.length > 0
      && input.replyToken.length <= 1024
      && input.replyToken.trim() === input.replyToken;
    const remainingReplyWindow = isValidDate(input.replyDeadlineAt)
      ? input.replyDeadlineAt.getTime() - now.getTime()
      : 0;
    const beforeDeadline = remainingReplyWindow > 0 && remainingReplyWindow <= MAX_REPLY_WINDOW_MS;
    if (!hasReplyToken || !beforeDeadline) mode = 'PUSH';
  }

  if (mode === 'PUSH' && input.attempts > 0) {
    if (!isValidDate(input.firstAttemptAt)) return dead(mode, 'PUSH_RETRY_WINDOW_UNKNOWN');
    const age = now.getTime() - input.firstAttemptAt.getTime();
    if (age < 0) return dead(mode, 'PUSH_RETRY_WINDOW_INVALID');
    if (age >= PUSH_RETRY_WINDOW_MS) return dead(mode, 'PUSH_RETRY_WINDOW_EXPIRED');
  }
  if (mode === 'PUSH' && input.attempts === 0 && input.firstAttemptAt !== null) {
    return dead(mode, 'INVALID_ATTEMPT_STATE');
  }

  const effectiveMode = mode;
  const url = `${API_BASE}/${effectiveMode === 'REPLY' ? 'reply' : 'push'}`;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${options.accessToken}`,
    'Content-Type': 'application/json',
  };
  const requestBody = effectiveMode === 'REPLY'
    ? JSON.stringify({ replyToken: input.replyToken, messages: input.messages })
    : JSON.stringify({ to: input.recipientId, messages: input.messages });

  if (effectiveMode === 'PUSH') headers['X-Line-Retry-Key'] = input.retryKey;

  const timeoutMs = Number.isFinite(options.timeoutMs)
    ? Math.min(MAX_TIMEOUT_MS, Math.max(1, Math.trunc(options.timeoutMs!)))
    : DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  let response: Response;
  try {
    response = await (options.fetchImpl ?? fetch)(url, {
      method: 'POST',
      headers,
      body: requestBody,
      signal: controller.signal,
      redirect: 'error',
    });
  } catch {
    if (effectiveMode === 'REPLY') {
      return { status: 'UNKNOWN', mode: 'REPLY', errorCode: 'REPLY_OUTCOME_UNKNOWN' };
    }
    return {
      status: 'RETRY',
      mode: 'PUSH',
      errorCode: timedOut ? 'PUSH_TIMEOUT' : 'PUSH_NETWORK_ERROR',
    };
  } finally {
    clearTimeout(timer);
  }

  const id = requestId(response.headers, response.status === 409);
  if (response.status >= 200 && response.status < 300) {
    return { status: 'SENT', mode: effectiveMode, httpStatus: response.status, ...(id ? { requestId: id } : {}) };
  }
  if (effectiveMode === 'PUSH' && response.status === 409) {
    return { status: 'SENT', mode: 'PUSH', httpStatus: response.status, ...(id ? { requestId: id } : {}) };
  }
  if (effectiveMode === 'PUSH' && (response.status === 408 || response.status === 429 || response.status >= 500)) {
    return {
      status: 'RETRY',
      mode: 'PUSH',
      httpStatus: response.status,
      ...(id ? { requestId: id } : {}),
      errorCode: 'PUSH_RETRYABLE',
    };
  }
  if (effectiveMode === 'REPLY' && (response.status === 408 || response.status >= 500)) {
    return {
      status: 'UNKNOWN',
      mode: 'REPLY',
      httpStatus: response.status,
      ...(id ? { requestId: id } : {}),
      errorCode: 'REPLY_OUTCOME_UNKNOWN',
    };
  }
  if (effectiveMode === 'REPLY' && response.status === 429) {
    return { status: 'DEAD', mode: 'REPLY', httpStatus: response.status, ...(id ? { requestId: id } : {}), errorCode: 'REPLY_RATE_LIMITED' };
  }
  if (response.status >= 400 && response.status < 500) {
    return { status: 'DEAD', mode: effectiveMode, httpStatus: response.status, ...(id ? { requestId: id } : {}), errorCode: 'LINE_REJECTED' };
  }
  return { status: 'DEAD', mode: effectiveMode, httpStatus: response.status, ...(id ? { requestId: id } : {}), errorCode: 'UNEXPECTED_HTTP_STATUS' };
}
