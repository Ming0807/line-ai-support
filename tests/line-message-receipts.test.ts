import { describe, expect, it, vi } from 'vitest';
import { deliverLine, type DeliveryInput, type LineMessage } from '../lib/line/delivery';
import { userEventSchema } from '../lib/line/events';

const now = new Date('2026-10-29T00:00:10.000Z');
const retryKey = '6f7d3f8c-36e6-4cf5-a0a7-c3d92f53f4b1';
const firstAttemptAt = new Date(now.getTime() - 1000);
const messages: LineMessage[] = [
  { type: 'text', text: 'first outgoing part' },
  { type: 'text', text: 'second outgoing part' },
];

function input(overrides: Partial<DeliveryInput> = {}): DeliveryInput {
  return {
    channel: 'STUDENT',
    mode: 'REPLY',
    recipientId: 'U1234567890abcdef',
    replyToken: 'single-use-reply-token',
    messages,
    retryKey,
    firstAttemptAt: null,
    replyDeadlineAt: new Date(now.getTime() + 20_000),
    attempts: 0,
    ...overrides,
  };
}

function response(body: string | null, status = 200, headers: Record<string, string> = {}) {
  return new Response(body, { status, headers });
}

function fakeFetch(reply: Response) {
  return vi.fn<typeof fetch>().mockResolvedValue(reply);
}

describe('LINE message receipt contract', () => {
  it('retains the quoted message ID on a parsed text webhook event', () => {
    const quotedMessageId = '468789532432007169';
    const event = userEventSchema.parse({
      type: 'message',
      source: { type: 'user', userId: 'U1234567890abcdef' },
      message: {
        type: 'text',
        id: '468789577898262530',
        text: 'I have another question about this.',
        quotedMessageId,
      },
    });

    expect(event).toHaveProperty('message.quotedMessageId', quotedMessageId);
  });

  it('returns exact sent IDs in request order and omits quote tokens', async () => {
    // LINE documents sentMessages.id as a number; preserve its original digits
    // rather than round-tripping through an unsafe JavaScript number.
    const ids = ['9007199254740993123', '9007199254740993124'];
    const body = `{"sentMessages":[{"id":${ids[0]},"quoteToken":"private-quote-token-1"},{"id":"${ids[1]}","quoteToken":"private-quote-token-2"}]}`;
    const result = await deliverLine(input(), {
      accessToken: 'fixture-only-access-token',
      fetchImpl: fakeFetch(response(body)),
      now: () => now,
      timeoutMs: 50,
    });

    expect(result).toMatchObject({
      status: 'SENT',
      mode: 'REPLY',
      httpStatus: 200,
      sentMessageIds: ids,
    });
    expect(JSON.stringify(result)).not.toContain('quoteToken');
    expect(JSON.stringify(result)).not.toContain('private-quote-token');
  });

  it('recovers accepted push IDs from a retry-key 409 response', async () => {
    const ids = ['461230966842064897', '461230966842064898'];
    const body = JSON.stringify({ message: 'The retry key is already accepted', sentMessages: ids.map(id => ({ id })) });
    const result = await deliverLine(input({
      mode: 'PUSH',
      replyToken: undefined,
      replyDeadlineAt: null,
      attempts: 1,
      firstAttemptAt,
    }), {
      accessToken: 'fixture-only-access-token',
      fetchImpl: fakeFetch(response(body, 409, {
        'x-line-request-id': 'retry-request',
        'x-line-accepted-request-id': 'accepted-request',
      })),
      now: () => now,
      timeoutMs: 50,
    });

    expect(result).toMatchObject({
      status: 'SENT',
      mode: 'PUSH',
      httpStatus: 409,
      requestId: 'accepted-request',
      sentMessageIds: ids,
    });
  });

  it.each([
    ['missing body', null],
    ['malformed body', '{not-json'],
    ['missing sentMessages', '{}'],
    ['wrong sentMessages count', '{"sentMessages":[{"id":"461230966842064897"}]}'],
    ['duplicate IDs', '{"sentMessages":[{"id":"461230966842064897"},{"id":"461230966842064897"}]}'],
    ['fractional ID', '{"sentMessages":[{"id":461230966842064897.5},{"id":"461230966842064898"}]}'],
    ['exponent ID', '{"sentMessages":[{"id":4.61230966842064897e17},{"id":"461230966842064898"}]}'],
  ])('keeps accepted delivery SENT but provides no receipt for %s', async (_label, body) => {
    const result = await deliverLine(input(), {
      accessToken: 'fixture-only-access-token',
      fetchImpl: fakeFetch(response(body)),
      now: () => now,
      timeoutMs: 50,
    });

    expect(result).toMatchObject({ status: 'SENT', mode: 'REPLY', httpStatus: 200 });
    expect(result).not.toHaveProperty('sentMessageIds');
  });

  it('stops reading an oversized accepted response body and keeps SENT without receipts', async () => {
    let chunksPulled = 0;
    let bodyCancelled = false;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        chunksPulled += 1;
        controller.enqueue(new Uint8Array(16_384));
      },
      cancel() {
        bodyCancelled = true;
      },
    });
    const result = await deliverLine(input(), {
      accessToken: 'fixture-only-access-token',
      fetchImpl: fakeFetch(new Response(body, { status: 200 })),
      now: () => now,
      timeoutMs: 50,
    });

    expect(result).toMatchObject({ status: 'SENT', mode: 'REPLY', httpStatus: 200 });
    expect(result).not.toHaveProperty('sentMessageIds');
    expect(bodyCancelled).toBe(true);
    expect(chunksPulled).toBeLessThan(10);
  });

  it('keeps an accepted delivery SENT without receipts for invalid UTF-8', async () => {
    const prefix = new TextEncoder().encode('{"sentMessages":[{"id":"');
    const suffix = new TextEncoder().encode('61230966842064897"},{"id":"461230966842064898"}]}');
    const bytes = new Uint8Array(prefix.length + 1 + suffix.length);
    bytes.set(prefix);
    bytes[prefix.length] = 0xff;
    bytes.set(suffix, prefix.length + 1);
    const result = await deliverLine(input(), {
      accessToken: 'fixture-only-access-token',
      fetchImpl: fakeFetch(new Response(bytes, { status: 200 })),
      now: () => now,
      timeoutMs: 50,
    });

    expect(result).toMatchObject({ status: 'SENT', mode: 'REPLY', httpStatus: 200 });
    expect(result).not.toHaveProperty('sentMessageIds');
  });

  it('keeps an accepted reply SENT without receipts when the response body stalls', async () => {
    let requestSignal: AbortSignal | undefined;
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async (_input, init) => {
      requestSignal = init?.signal ?? undefined;
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          requestSignal?.addEventListener('abort', () => controller.error(new Error('body timeout')), { once: true });
        },
      });
      return new Response(body, { status: 200 });
    });

    const result = await deliverLine(input(), {
      accessToken: 'fixture-only-access-token',
      fetchImpl,
      now: () => now,
      timeoutMs: 10,
    });

    expect(result).toMatchObject({ status: 'SENT', mode: 'REPLY', httpStatus: 200 });
    expect(result).not.toHaveProperty('sentMessageIds');
    expect(requestSignal?.aborted).toBe(true);
  });

  it('keeps an accepted reply SENT without receipts when the response body is already locked', async () => {
    const accepted = response('{"sentMessages":[{"id":"461230966842064897"},{"id":"461230966842064898"}]}');
    const bodyLock = accepted.body!.getReader();

    try {
      const result = await deliverLine(input(), {
        accessToken: 'fixture-only-access-token',
        fetchImpl: fakeFetch(accepted),
        now: () => now,
        timeoutMs: 50,
      });

      expect(result).toMatchObject({ status: 'SENT', mode: 'REPLY', httpStatus: 200 });
      expect(result).not.toHaveProperty('sentMessageIds');
    } finally {
      bodyLock.releaseLock();
    }
  });

  it('does not attach receipts to an unknown reply outcome', async () => {
    const result = await deliverLine(input(), {
      accessToken: 'fixture-only-access-token',
      fetchImpl: fakeFetch(response(null, 503)),
      now: () => now,
      timeoutMs: 50,
    });

    expect(result).toMatchObject({ status: 'UNKNOWN', mode: 'REPLY', errorCode: 'REPLY_OUTCOME_UNKNOWN' });
    expect(result).not.toHaveProperty('sentMessageIds');
  });
});
