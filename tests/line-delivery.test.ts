import { afterEach, describe, expect, expectTypeOf, it, vi } from 'vitest';
import { deliverLine, type DeliveryInput, type DeliveryResult, type LineMessage } from '../lib/line/delivery';

const accessToken = 'fake-channel-access-token';
const replyToken = 'fake-single-use-reply-token';
const retryKey = '6f7d3f8c-36e6-4cf5-a0a7-c3d92f53f4b1';
const recipientId = 'U1234567890abcdef';
const message: LineMessage = {
  type: 'text',
  text: 'Choose an action',
  quickReply: {
    items: [{ type: 'action', action: { type: 'postback', label: 'Open', data: 'choice:opaque' } }],
  },
};

function input(overrides: Partial<DeliveryInput> = {}): DeliveryInput {
  return {
    channel: 'STUDENT',
    mode: 'REPLY',
    recipientId,
    replyToken,
    messages: [message],
    retryKey,
    firstAttemptAt: null,
    replyDeadlineAt: new Date('2026-10-04T00:00:20.000Z'),
    attempts: 0,
    ...overrides,
  };
}

function options(fetchImpl: typeof fetch, now = new Date('2026-10-04T00:00:10.000Z')) {
  return { accessToken, fetchImpl, now: () => now, timeoutMs: 50 };
}

function fakeFetch(response: Response) {
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

afterEach(() => vi.restoreAllMocks());

describe('deliverLine', () => {
  it('sends an in-window unused reply once without a push retry key', async () => {
    const { calls, fetchImpl } = fakeFetch(new Response(null, {
      status: 200,
      headers: { 'x-line-request-id': 'line-request-123' },
    }));

    const result = await deliverLine(input(), options(fetchImpl));

    expect(result).toEqual({ status: 'SENT', mode: 'REPLY', httpStatus: 200, requestId: 'line-request-123' });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://api.line.me/v2/bot/message/reply');
    expect(new Headers(calls[0].init.headers).get('authorization')).toBe(`Bearer ${accessToken}`);
    expect(new Headers(calls[0].init.headers).get('x-line-retry-key')).toBeNull();
    expect(bodyOf(calls[0])).toEqual({ replyToken, messages: [message] });
    expect(calls[0].init.redirect).toBe('error');
  });

  it('switches an unused expired reply to a push before sending', async () => {
    const { calls, fetchImpl } = fakeFetch(new Response(null, { status: 200 }));
    const now = new Date('2026-10-04T00:00:21.000Z');

    const result = await deliverLine(input(), options(fetchImpl, now));

    expect(result).toMatchObject({ status: 'SENT', mode: 'PUSH', httpStatus: 200 });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://api.line.me/v2/bot/message/push');
    expect(new Headers(calls[0].init.headers).get('x-line-retry-key')).toBe(retryKey);
    expect(bodyOf(calls[0])).toEqual({ to: recipientId, messages: [message] });
  });

  it('uses push when a reply token is missing or its deadline exceeds the 60-second ceiling', async () => {
    const responses = [new Response(null, { status: 200 }), new Response(null, { status: 200 })];
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return responses.shift()!;
    }) as typeof fetch;
    const now = new Date('2026-10-04T00:00:10.000Z');

    const missingToken = await deliverLine(input({ replyToken: undefined }), options(fetchImpl, now));
    const excessiveDeadline = await deliverLine(input({ replyDeadlineAt: new Date(now.getTime() + 60_001) }), options(fetchImpl, now));

    expect(missingToken).toMatchObject({ status: 'SENT', mode: 'PUSH' });
    expect(excessiveDeadline).toMatchObject({ status: 'SENT', mode: 'PUSH' });
    expect(calls).toHaveLength(2);
    expect(calls.every((call) => call.url.endsWith('/push'))).toBe(true);
  });

  it('marks a previously attempted reply unknown without another request or push fallback', async () => {
    const { calls, fetchImpl } = fakeFetch(new Response(null, { status: 200 }));

    const result = await deliverLine(input({ attempts: 1, firstAttemptAt: new Date('2026-10-04T00:00:05.000Z') }), options(fetchImpl));

    expect(result).toEqual({ status: 'UNKNOWN', mode: 'REPLY', errorCode: 'REPLY_ALREADY_ATTEMPTED' });
    expect(calls).toHaveLength(0);
  });

  it.each([
    ['timeout', async () => { throw new Error(`timeout ${accessToken} ${replyToken}`); }],
    ['HTTP timeout', async () => new Response(null, { status: 408, headers: { 'x-line-request-id': 'line-408' } })],
    ['server error', async () => new Response(null, { status: 503, headers: { 'x-line-request-id': 'line-5xx' } })],
  ])('does not retry or push after an ambiguous reply %s', async (_name, respond) => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return respond();
    }) as typeof fetch;

    const result = await deliverLine(input(), options(fetchImpl));

    expect(result.status).toBe('UNKNOWN');
    expect(result.mode).toBe('REPLY');
    if (result.status !== 'UNKNOWN') throw new Error('expected ambiguous reply outcome');
    expect(result.errorCode).toBe('REPLY_OUTCOME_UNKNOWN');
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://api.line.me/v2/bot/message/reply');
    expect(JSON.stringify(result)).not.toContain(accessToken);
    expect(JSON.stringify(result)).not.toContain(replyToken);
  });

  it('aborts a timed-out reply into UNKNOWN and never switches to push', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error(`timeout ${replyToken}`)), { once: true });
      });
    }) as typeof fetch;

    const result = await deliverLine(input(), { ...options(fetchImpl), timeoutMs: 5 });

    expect(result).toEqual({ status: 'UNKNOWN', mode: 'REPLY', errorCode: 'REPLY_OUTCOME_UNKNOWN' });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://api.line.me/v2/bot/message/reply');
    expect(calls[0].init.signal?.aborted).toBe(true);
  });

  it('does not retry or push after a known reply rate-limit response', async () => {
    const { calls, fetchImpl } = fakeFetch(new Response(null, { status: 429 }));

    const result = await deliverLine(input(), options(fetchImpl));

    expect(result).toEqual({ status: 'DEAD', mode: 'REPLY', httpStatus: 429, errorCode: 'REPLY_RATE_LIMITED' });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://api.line.me/v2/bot/message/reply');
  });

  it('sends the stable retry key on the first push and treats 409 as already sent', async () => {
    const { calls, fetchImpl } = fakeFetch(new Response(null, {
      status: 409,
      headers: {
        'x-line-request-id': 'line-retry-409',
        'x-line-accepted-request-id': 'line-accepted-200',
      },
    }));

    const result = await deliverLine(input({ mode: 'PUSH', replyDeadlineAt: null, replyToken: undefined }), options(fetchImpl));

    expect(result).toEqual({ status: 'SENT', mode: 'PUSH', httpStatus: 409, requestId: 'line-accepted-200' });
    expect(calls).toHaveLength(1);
    expect(new Headers(calls[0].init.headers).get('x-line-retry-key')).toBe(retryKey);
    expect(bodyOf(calls[0])).toEqual({ to: recipientId, messages: [message] });
  });

  it.each([
    ['rate limited', 429],
    ['HTTP timeout', 408],
    ['server error', 503],
  ])('retries a push after a %s response while inside the 24-hour window', async (_name, status) => {
    const { calls, fetchImpl } = fakeFetch(new Response('private response body', {
      status,
      headers: { 'x-line-request-id': 'line-retryable' },
    }));
    const firstAttemptAt = new Date('2026-10-03T23:59:59.000Z');
    const now = new Date('2026-10-04T00:00:10.000Z');

    const result = await deliverLine(input({ mode: 'PUSH', replyDeadlineAt: null, replyToken: undefined, attempts: 1, firstAttemptAt }), options(fetchImpl, now));

    expect(result).toEqual({ status: 'RETRY', mode: 'PUSH', httpStatus: status, requestId: 'line-retryable', errorCode: 'PUSH_RETRYABLE' });
    expect(calls).toHaveLength(1);
    expect(new Headers(calls[0].init.headers).get('x-line-retry-key')).toBe(retryKey);
    expect(bodyOf(calls[0])).toEqual({ to: recipientId, messages: [message] });
    expect(JSON.stringify(result)).not.toContain('private response body');
  });

  it('retries a push timeout with the unchanged destination, body, and retry key', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      throw new Error(`socket timeout ${accessToken}`);
    }) as typeof fetch;

    const result = await deliverLine(input({ mode: 'PUSH', replyDeadlineAt: null, replyToken: undefined }), options(fetchImpl));

    expect(result).toEqual({ status: 'RETRY', mode: 'PUSH', errorCode: 'PUSH_NETWORK_ERROR' });
    expect(calls).toHaveLength(1);
    expect(new Headers(calls[0].init.headers).get('x-line-retry-key')).toBe(retryKey);
    expect(bodyOf(calls[0])).toEqual({ to: recipientId, messages: [message] });
    expect(JSON.stringify(result)).not.toContain(accessToken);
  });

  it('aborts a timed-out push request and returns a retryable result', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      });
    }) as typeof fetch;

    const result = await deliverLine(input({ mode: 'PUSH', replyDeadlineAt: null, replyToken: undefined }), {
      ...options(fetchImpl),
      timeoutMs: 5,
    });

    expect(result).toEqual({ status: 'RETRY', mode: 'PUSH', errorCode: 'PUSH_TIMEOUT' });
    expect(calls).toHaveLength(1);
    expect(calls[0].init.signal?.aborted).toBe(true);
  });

  it('reuses the exact recipient, serialized body, and retry key across a push retry', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const responses = [new Response(null, { status: 503 }), new Response(null, { status: 200 })];
    const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return responses.shift()!;
    }) as typeof fetch;
    const firstNow = new Date('2026-10-04T00:00:10.000Z');

    const first = await deliverLine(input({ mode: 'PUSH', replyDeadlineAt: null, replyToken: undefined }), options(fetchImpl, firstNow));
    const second = await deliverLine(input({
      mode: 'PUSH',
      replyDeadlineAt: null,
      replyToken: undefined,
      attempts: 1,
      firstAttemptAt: firstNow,
    }), options(fetchImpl, new Date(firstNow.getTime() + 1000)));

    expect(first.status).toBe('RETRY');
    expect(second).toMatchObject({ status: 'SENT', mode: 'PUSH', httpStatus: 200 });
    expect(calls).toHaveLength(2);
    expect(calls[0].url).toBe(calls[1].url);
    expect(calls[0].init.body).toBe(calls[1].init.body);
    expect(new Headers(calls[0].init.headers).get('x-line-retry-key')).toBe(retryKey);
    expect(new Headers(calls[1].init.headers).get('x-line-retry-key')).toBe(retryKey);
  });

  it('marks a permanent push 4xx dead without exposing the response body', async () => {
    const { calls, fetchImpl } = fakeFetch(new Response('private error body', { status: 400 }));

    const result = await deliverLine(input({ mode: 'PUSH', replyDeadlineAt: null, replyToken: undefined }), options(fetchImpl));

    expect(result).toEqual({ status: 'DEAD', mode: 'PUSH', httpStatus: 400, errorCode: 'LINE_REJECTED' });
    expect(calls).toHaveLength(1);
    expect(JSON.stringify(result)).not.toContain('private error body');
  });

  it('refuses a push retry at the 24-hour boundary without making a request', async () => {
    const { calls, fetchImpl } = fakeFetch(new Response(null, { status: 200 }));
    const firstAttemptAt = new Date('2026-10-03T00:00:00.000Z');
    const now = new Date('2026-10-04T00:00:00.000Z');

    const result = await deliverLine(input({ mode: 'PUSH', replyDeadlineAt: null, replyToken: undefined, attempts: 1, firstAttemptAt }), options(fetchImpl, now));

    expect(result).toEqual({ status: 'DEAD', mode: 'PUSH', errorCode: 'PUSH_RETRY_WINDOW_EXPIRED' });
    expect(calls).toHaveLength(0);
  });

  it('validates text and postback quick replies before sending, without mutating messages', async () => {
    const original = structuredClone([message]);
    const { calls, fetchImpl } = fakeFetch(new Response(null, { status: 200 }));

    const sent = await deliverLine(input({ messages: original }), options(fetchImpl));

    expect(sent.status).toBe('SENT');
    expect(original).toEqual([message]);
    expect(calls).toHaveLength(1);

    const invalid = await deliverLine(input({ messages: [{ type: 'text', text: 'x', quickReply: { items: [{ type: 'action', action: { type: 'message', label: 'Not supported', text: 'free-form' } }] } }] as unknown as LineMessage[] }), options(fetchImpl));
    expect(invalid).toMatchObject({ status: 'DEAD', errorCode: 'INVALID_MESSAGES' });
    expect(calls).toHaveLength(1);
  });

  it('bounds malformed LINE request IDs and does not log transport errors', async () => {
    const { calls, fetchImpl } = fakeFetch(new Response(null, {
      status: 200,
      headers: { 'x-line-request-id': `line-${'x'.repeat(300)}` },
    }));
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);

    const result = await deliverLine(input({ mode: 'PUSH', replyDeadlineAt: null, replyToken: undefined }), options(fetchImpl));

    expect(result).toEqual({ status: 'SENT', mode: 'PUSH', httpStatus: 200 });
    expect(calls).toHaveLength(1);
    expect(log).not.toHaveBeenCalled();
    expect(info).not.toHaveBeenCalled();
  });

  it('keeps status-specific result types narrow', async () => {
    const { fetchImpl } = fakeFetch(new Response(null, { status: 200 }));
    const result: DeliveryResult = await deliverLine(input({ mode: 'PUSH', replyDeadlineAt: null, replyToken: undefined }), options(fetchImpl));

    if (result.status === 'RETRY') expectTypeOf(result.mode).toEqualTypeOf<'PUSH'>();
    if (result.status === 'UNKNOWN') expectTypeOf(result.mode).toEqualTypeOf<'REPLY'>();
    if (result.status === 'SENT') expectTypeOf(result.httpStatus).toEqualTypeOf<number>();
  });
});
