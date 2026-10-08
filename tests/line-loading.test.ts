import { afterEach, describe, expect, it, vi } from 'vitest';
import { startLineLoading, type LineLoadingInput } from '../lib/line/loading';

const accessToken = 'test-channel-access-token-must-not-escape';
const recipientId = 'U1234567890abcdef';
const input = (overrides: Partial<LineLoadingInput> = {}): LineLoadingInput => ({
  recipientId,
  loadingSeconds: 15,
  ...overrides,
});

function fakeFetch(response: Response = new Response(null, { status: 202 })) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return response;
  }) as typeof fetch;
  return { calls, fetchImpl };
}

function bodyOf(call: { init: RequestInit }): unknown {
  return JSON.parse(String(call.init.body));
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('startLineLoading', () => {
  it('uses the fixed LINE endpoint and sends only chatId and the explicit official duration', async () => {
    const { calls, fetchImpl } = fakeFetch();

    const result = await startLineLoading(input(), { accessToken, fetchImpl });

    expect(result).toEqual({ status: 'ACCEPTED', httpStatus: 202 });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://api.line.me/v2/bot/chat/loading/start');
    expect(calls[0].init.method).toBe('POST');
    expect(calls[0].init.redirect).toBe('error');
    const headers = new Headers(calls[0].init.headers);
    expect(headers.get('authorization')).toBe(`Bearer ${accessToken}`);
    expect(headers.get('content-type')).toBe('application/json');
    expect(bodyOf(calls[0])).toEqual({ chatId: recipientId, loadingSeconds: 15 });
    expect(Object.keys(bodyOf(calls[0]) as object).sort()).toEqual(['chatId', 'loadingSeconds']);
    expect(calls[0].init.signal).toBeInstanceOf(AbortSignal);
  });

  it('does not call LINE when channel configuration or recipient is invalid', async () => {
    const { calls, fetchImpl } = fakeFetch();

    await expect(startLineLoading(input(), { fetchImpl })).resolves.toEqual({
      status: 'NOT_SENT', errorCode: 'CHANNEL_NOT_CONFIGURED',
    });
    await expect(startLineLoading(input(), { accessToken: '  ', fetchImpl })).resolves.toMatchObject({
      status: 'NOT_SENT', errorCode: 'CHANNEL_NOT_CONFIGURED',
    });
    await expect(startLineLoading(input({ recipientId: 'not-a-line-user' }), { accessToken, fetchImpl })).resolves.toEqual({
      status: 'NOT_SENT', errorCode: 'INVALID_RECIPIENT',
    });
    expect(calls).toHaveLength(0);
  });

  it.each([0, 1, 4, 6, 12, 20.5, 61, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects a duration outside the official enum: %s',
    async loadingSeconds => {
      const { calls, fetchImpl } = fakeFetch();
      await expect(startLineLoading(input({ loadingSeconds: loadingSeconds as LineLoadingInput['loadingSeconds'] }), {
        accessToken,
        fetchImpl,
      })).resolves.toEqual({ status: 'NOT_SENT', errorCode: 'INVALID_DURATION' });
      expect(calls).toHaveLength(0);
    },
  );

  it('rejects unbounded timeout configuration before fetch', async () => {
    const { calls, fetchImpl } = fakeFetch();
    for (const timeoutMs of [0, -1, 10_001, Number.NaN, Number.POSITIVE_INFINITY, 1.5]) {
      await expect(startLineLoading(input(), { accessToken, fetchImpl, timeoutMs })).resolves.toEqual({
        status: 'NOT_SENT', errorCode: 'INVALID_TIMEOUT',
      });
    }
    expect(calls).toHaveLength(0);
  });

  it('returns only the HTTP status and leaves an error response body unread', async () => {
    const secretResponse = 'provider-body-secret-must-not-escape';
    const response = new Response(secretResponse, { status: 503 });
    const { calls, fetchImpl } = fakeFetch(response);
    const log = vi.spyOn(console, 'error');
    const warn = vi.spyOn(console, 'warn');
    const info = vi.spyOn(console, 'info');

    const result = await startLineLoading(input(), { accessToken, fetchImpl });

    expect(result).toEqual({ status: 'NOT_SENT', errorCode: 'HTTP_REJECTED', httpStatus: 503 });
    expect(response.bodyUsed).toBe(false);
    expect(JSON.stringify(result)).not.toContain(accessToken);
    expect(JSON.stringify(result)).not.toContain(recipientId);
    expect(JSON.stringify(result)).not.toContain(secretResponse);
    expect([log, warn, info].every(spy => spy.mock.calls.length === 0)).toBe(true);
    expect(calls).toHaveLength(1);
  });

  it('accepts only LINE 202 and treats other 2xx results as unexpected', async () => {
    const { fetchImpl } = fakeFetch(new Response(null, { status: 200 }));
    await expect(startLineLoading(input(), { accessToken, fetchImpl })).resolves.toEqual({
      status: 'NOT_SENT', errorCode: 'UNEXPECTED_HTTP_STATUS', httpStatus: 200,
    });
  });

  it('converts fetch rejection to a fixed network result without echoing provider error text', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error(`network ${accessToken} ${recipientId} provider-body-secret`);
    }) as typeof fetch;

    const result = await startLineLoading(input(), { accessToken, fetchImpl });

    expect(result).toEqual({ status: 'NOT_SENT', errorCode: 'NETWORK_ERROR' });
    expect(JSON.stringify(result)).not.toContain(accessToken);
    expect(JSON.stringify(result)).not.toContain(recipientId);
    expect(JSON.stringify(result)).not.toContain('provider-body-secret');
  });

  it('settles at the bounded timeout even if the injected fetch ignores abort', async () => {
    let requestSignal: AbortSignal | undefined;
    const fetchImpl = ((_url: string | URL | Request, init?: RequestInit) => {
      requestSignal = init?.signal as AbortSignal;
      return new Promise<Response>(() => undefined);
    }) as typeof fetch;

    const result = await Promise.race([
      startLineLoading(input(), { accessToken, fetchImpl, timeoutMs: 5 }),
      new Promise<'STILL_PENDING'>(resolve => setTimeout(() => resolve('STILL_PENDING'), 50)),
    ]);

    expect(result).toEqual({ status: 'NOT_SENT', errorCode: 'TIMEOUT' });
    expect(requestSignal?.aborted).toBe(true);
  });

  it('propagates caller cancellation without converting it into a timeout', async () => {
    const caller = new AbortController();
    let requestSignal: AbortSignal | undefined;
    const fetchImpl = ((_url: string | URL | Request, init?: RequestInit) => {
      requestSignal = init?.signal as AbortSignal;
      return new Promise<Response>(() => undefined);
    }) as typeof fetch;
    const pending = startLineLoading(input(), { accessToken, fetchImpl, signal: caller.signal, timeoutMs: 1_000 });
    caller.abort();

    const result = await Promise.race([
      pending,
      new Promise<'STILL_PENDING'>(resolve => setTimeout(() => resolve('STILL_PENDING'), 50)),
    ]);
    expect(result).toEqual({ status: 'NOT_SENT', errorCode: 'ABORTED' });
    expect(requestSignal?.aborted).toBe(true);
  });

  it('does not call fetch when the caller signal is already aborted', async () => {
    const caller = new AbortController();
    caller.abort();
    const { calls, fetchImpl } = fakeFetch();

    await expect(startLineLoading(input(), { accessToken, fetchImpl, signal: caller.signal })).resolves.toEqual({
      status: 'NOT_SENT', errorCode: 'ABORTED',
    });
    expect(calls).toHaveLength(0);
  });

  it('clears its timeout and removes the caller abort listener after a response', async () => {
    vi.useFakeTimers();
    const caller = new AbortController();
    const addListener = vi.spyOn(caller.signal, 'addEventListener');
    const removeListener = vi.spyOn(caller.signal, 'removeEventListener');
    const { fetchImpl } = fakeFetch();

    await expect(startLineLoading(input(), { accessToken, fetchImpl, signal: caller.signal })).resolves.toEqual({
      status: 'ACCEPTED', httpStatus: 202,
    });

    const registeredAbort = addListener.mock.calls.find(([type]) => type === 'abort');
    expect(registeredAbort).toBeDefined();
    expect(removeListener).toHaveBeenCalledWith('abort', registeredAbort?.[1]);
    expect(vi.getTimerCount()).toBe(0);
  });
});
