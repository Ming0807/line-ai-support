/** Fixed, privacy-safe transport for LINE's one-to-one loading animation. */

export const LINE_LOADING_SECONDS = [5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60] as const;
export type LineLoadingSeconds = (typeof LINE_LOADING_SECONDS)[number];

export interface LineLoadingInput {
  recipientId: string;
  loadingSeconds: LineLoadingSeconds;
}

export interface LineLoadingOptions {
  /** Explicit Student channel token. This client does not read configuration itself. */
  accessToken?: string;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export type LineLoadingErrorCode =
  | 'CHANNEL_NOT_CONFIGURED'
  | 'INVALID_RECIPIENT'
  | 'INVALID_DURATION'
  | 'INVALID_TIMEOUT'
  | 'ABORTED'
  | 'TIMEOUT'
  | 'NETWORK_ERROR'
  | 'HTTP_REJECTED'
  | 'UNEXPECTED_HTTP_STATUS';

export type LineLoadingResult =
  | { status: 'ACCEPTED'; httpStatus: 202 }
  | { status: 'NOT_SENT'; errorCode: LineLoadingErrorCode; httpStatus?: number };

const LINE_LOADING_URL = 'https://api.line.me/v2/bot/chat/loading/start';
const DEFAULT_TIMEOUT_MS = 3_000;
const MAX_TIMEOUT_MS = 10_000;
const LINE_USER_ID_PATTERN = /^U[A-Za-z0-9]{1,127}$/u;
const ALLOWED_DURATIONS = new Set<number>(LINE_LOADING_SECONDS);

function notSent(errorCode: LineLoadingErrorCode, httpStatus?: number): LineLoadingResult {
  return { status: 'NOT_SENT', errorCode, ...(httpStatus === undefined ? {} : { httpStatus }) };
}

function configuredToken(value: unknown): value is string {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= 4_096
    && value.trim() === value
    && !/[\u0000-\u001f\u007f-\u009f]/u.test(value);
}

/**
 * Requests the official LINE loading animation. The caller controls when this
 * side effect is eligible; no recipient lookup, logging, retries, or fallback
 * message occurs here.
 */
export async function startLineLoading(
  input: LineLoadingInput,
  options: LineLoadingOptions,
): Promise<LineLoadingResult> {
  if (!options || !configuredToken(options.accessToken)) return notSent('CHANNEL_NOT_CONFIGURED');
  if (!input || typeof input.recipientId !== 'string' || !LINE_USER_ID_PATTERN.test(input.recipientId)) {
    return notSent('INVALID_RECIPIENT');
  }
  if (!ALLOWED_DURATIONS.has(input.loadingSeconds)) return notSent('INVALID_DURATION');
  if (options.signal?.aborted) return notSent('ABORTED');

  const timeoutMs = options.timeoutMs === undefined ? DEFAULT_TIMEOUT_MS : options.timeoutMs;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > MAX_TIMEOUT_MS) {
    return notSent('INVALID_TIMEOUT');
  }

  const controller = new AbortController();
  let timedOut = false;
  let callerAborted = false;
  const relayAbort = () => {
    callerAborted = true;
    controller.abort();
  };
  const callerSignal = options.signal;
  callerSignal?.addEventListener('abort', relayAbort, { once: true });
  if (callerSignal?.aborted) relayAbort();
  if (callerAborted) {
    callerSignal?.removeEventListener('abort', relayAbort);
    return notSent('ABORTED');
  }

  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  let rejectAbort!: (reason: Error) => void;
  const aborted = new Promise<never>((_resolve, reject) => {
    rejectAbort = reject;
  });
  const rejectOnAbort = () => rejectAbort(new Error('REQUEST_ABORTED'));
  controller.signal.addEventListener('abort', rejectOnAbort, { once: true });
  if (controller.signal.aborted) rejectOnAbort();

  try {
    const response = await Promise.race([(options.fetchImpl ?? fetch)(LINE_LOADING_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${options.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ chatId: input.recipientId, loadingSeconds: input.loadingSeconds }),
      signal: controller.signal,
      redirect: 'error',
    }), aborted]);

    if (timedOut) return notSent('TIMEOUT');
    if (callerAborted || callerSignal?.aborted) return notSent('ABORTED');
    if (response.status === 202) return { status: 'ACCEPTED', httpStatus: 202 };
    if (Number.isInteger(response.status) && response.status >= 400 && response.status <= 599) {
      return notSent('HTTP_REJECTED', response.status);
    }
    if (Number.isInteger(response.status) && response.status >= 300 && response.status <= 399) {
      return notSent('HTTP_REJECTED', response.status);
    }
    return notSent('UNEXPECTED_HTTP_STATUS', response.status);
  } catch {
    if (timedOut) return notSent('TIMEOUT');
    if (callerAborted || callerSignal?.aborted) return notSent('ABORTED');
    return notSent('NETWORK_ERROR');
  } finally {
    clearTimeout(timer);
    controller.signal.removeEventListener('abort', rejectOnAbort);
    callerSignal?.removeEventListener('abort', relayAbort);
  }
}
