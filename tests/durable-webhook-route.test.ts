import { createHmac } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST as studentPost } from '../app/api/line/student/webhook/route';
import { POST as staffPost } from '../app/api/line/staff/webhook/route';
import { persistWebhookEvents } from '../lib/queue/inbox';
import type { IngressEvent } from '../lib/line/receive-webhook';
import { decryptValue } from '../lib/security/identity';

vi.mock('../lib/queue/inbox', () => ({
  persistWebhookEvents: vi.fn(),
}));

const studentSecret = 'student-test-channel-secret';
const staffSecret = 'staff-test-channel-secret';
const studentAccessToken = 'student-test-access-token';
const staffAccessToken = 'staff-test-access-token';
const encryptionKey = Buffer.alloc(32, 19).toString('base64');
const privateUserId = 'UprivateStudent123456';
const privateReplyToken = 'privateReplyToken123456';
const privateText = 'ข้อความส่วนตัวทดสอบ';

const routes = [
  {
    channel: 'STUDENT' as const,
    post: studentPost,
    secret: studentSecret,
    wrongSecret: staffSecret,
  },
  {
    channel: 'STAFF' as const,
    post: staffPost,
    secret: staffSecret,
    wrongSecret: studentSecret,
  },
];

function textEvent(eventId = 'webhook-event-1') {
  return {
    type: 'message',
    webhookEventId: eventId,
    replyToken: privateReplyToken,
    timestamp: 1_791_050_000_000,
    source: { type: 'user', userId: privateUserId },
    message: { type: 'text', id: 'line-message-1', text: privateText },
  };
}

function bodyFor(event: unknown = textEvent()) {
  return JSON.stringify({ channel: 'SPOOFED', events: [event] });
}

function signedRequest(route: (typeof routes)[number], body: string, key = route.secret) {
  const signature = createHmac('sha256', key).update(body).digest('base64');
  return new Request('https://helpdesk.invalid/api/line/webhook', {
    method: 'POST',
    headers: { 'x-line-signature': signature },
    body,
  });
}

function logOutput() {
  return JSON.stringify([
    ...vi.mocked(console.info).mock.calls,
    ...vi.mocked(console.warn).mock.calls,
    ...vi.mocked(console.error).mock.calls,
    ...vi.mocked(console.log).mock.calls,
  ]);
}

describe.each(routes)('$channel durable webhook route', (route) => {
  beforeEach(() => {
    vi.stubEnv('LINE_WEBHOOK_MODE', 'durable');
    vi.stubEnv('LINE_STUDENT_CHANNEL_SECRET', studentSecret);
    vi.stubEnv('LINE_STAFF_CHANNEL_SECRET', staffSecret);
    vi.stubEnv('LINE_STUDENT_CHANNEL_ACCESS_TOKEN', studentAccessToken);
    vi.stubEnv('LINE_STAFF_CHANNEL_ACCESS_TOKEN', staffAccessToken);
    vi.stubEnv('ENCRYPTION_KEY', encryptionKey);
    vi.stubEnv('DATABASE_URL', '');
    vi.stubEnv('DIRECT_URL', '');

    vi.mocked(persistWebhookEvents).mockReset();
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      throw new Error('Network calls are forbidden in this unit test');
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it('accepts an empty signed verification envelope without persisting or sending', async () => {
    const response = await route.post(signedRequest(route, '{"events":[]}'));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(persistWebhookEvents).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('fails closed on an unsupported mode without consuming the request body', async () => {
    vi.stubEnv('LINE_WEBHOOK_MODE', 'unknown');
    const request = signedRequest(route, '{"events":[]}');
    const arrayBuffer = vi.spyOn(request, 'arrayBuffer');
    const json = vi.spyOn(request, 'json');

    const response = await route.post(request);

    expect(response.status).toBe(503);
    expect(request.bodyUsed).toBe(false);
    expect(arrayBuffer).not.toHaveBeenCalled();
    expect(json).not.toHaveBeenCalled();
    expect(persistWebhookEvents).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('waits for the durable commit before acknowledging a valid event', async () => {
    let releaseCommit!: () => void;
    let markPersistenceEntered!: () => void;
    const commitGate = new Promise<void>((resolve) => {
      releaseCommit = resolve;
    });
    const persistenceEntered = new Promise<void>((resolve) => {
      markPersistenceEntered = resolve;
    });
    vi.mocked(persistWebhookEvents).mockImplementation(async () => {
      markPersistenceEntered();
      await commitGate;
    });

    const eventId = route.channel + '-event-commit';
    const body = bodyFor(textEvent(eventId));
    let settled = false;
    const responsePromise = route.post(signedRequest(route, body)).then((response) => {
      settled = true;
      return response;
    });

    const didEnterPersistence = await Promise.race([
      persistenceEntered.then(() => true),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 100)),
    ]);
    if (!didEnterPersistence) {
      releaseCommit();
      await responsePromise;
    }
    expect(didEnterPersistence).toBe(true);
    expect(settled).toBe(false);

    releaseCommit();
    const response = await responsePromise;
    expect(response.status).toBe(200);
    expect(persistWebhookEvents).toHaveBeenCalledTimes(1);

    const persisted = vi.mocked(persistWebhookEvents).mock.calls[0][0] as IngressEvent[];
    expect(persisted).toHaveLength(1);
    expect(persisted[0]).toMatchObject({
      channel: route.channel,
      eventId,
      eventKind: 'MESSAGE',
    });
    expect(persisted[0].payloadEncrypted).not.toContain(privateUserId);
    expect(persisted[0].payloadEncrypted).not.toContain(privateReplyToken);
    expect(persisted[0].payloadEncrypted).not.toContain(privateText);
    expect(JSON.parse(decryptValue(persisted[0].payloadEncrypted, encryptionKey))).toEqual(
      textEvent(eventId),
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it('returns a bounded 503 when durable persistence fails', async () => {
    vi.mocked(persistWebhookEvents).mockRejectedValueOnce(
      new Error('private database detail ' + studentSecret + ' ' + staffSecret + ' ' + privateUserId + ' ' + privateReplyToken),
    );

    const response = await route.post(signedRequest(route, bodyFor()));
    const responseText = await response.text();

    expect(response.status).toBe(503);
    expect(responseText.length).toBeLessThan(256);
    expect(responseText).not.toContain('private database detail');
    expect(logOutput()).not.toContain('private database detail');
    expect(persistWebhookEvents).toHaveBeenCalledTimes(1);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('accepts only the route channel secret, regardless of a spoofed body channel', async () => {
    const body = bodyFor(textEvent(route.channel + '-channel-bound'));
    const response = await route.post(signedRequest(route, body, route.wrongSecret));

    expect(response.status).toBe(401);
    expect(persistWebhookEvents).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    expect(logOutput()).not.toContain(privateUserId);
  });

  it('rejects an invalid raw signature before parsing, persistence, or logging', async () => {
    const request = new Request('https://helpdesk.invalid/api/line/webhook', {
      method: 'POST',
      headers: { 'x-line-signature': 'invalid-signature' },
      body: '{invalid-json',
    });
    const response = await route.post(request);

    expect(response.status).toBe(401);
    expect(persistWebhookEvents).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    expect(logOutput()).not.toContain('invalid-json');
  });

  it('reports signed malformed JSON only after signature verification', async () => {
    const body = '{invalid-json';
    const response = await route.post(signedRequest(route, body));

    expect(response.status).toBe(400);
    expect(persistWebhookEvents).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    expect(logOutput()).not.toContain('invalid-json');
  });

  it('persists malformed and unknown siblings only as encrypted event payloads', async () => {
    const unknownEvent = {
      type: 'future-event',
      webhookEventId: route.channel + '-future-event',
      source: { type: 'user', userId: privateUserId },
      replyToken: privateReplyToken,
      data: privateText,
    };
    const validEvent = textEvent(route.channel + '-valid-sibling');
    const body = JSON.stringify({
      channel: 'SPOOFED',
      events: [null, validEvent, unknownEvent],
    });
    const response = await route.post(signedRequest(route, body));

    expect(response.status).toBe(200);
    expect(persistWebhookEvents).toHaveBeenCalledTimes(1);
    const persisted = vi.mocked(persistWebhookEvents).mock.calls[0][0] as IngressEvent[];
    expect(persisted).toHaveLength(3);
    expect(persisted.map((event) => event.channel)).toEqual([
      route.channel,
      route.channel,
      route.channel,
    ]);
    expect(persisted.map((event) => event.eventId)).toContain(route.channel + '-valid-sibling');
    expect(persisted.map((event) => event.eventId)).toContain(route.channel + '-future-event');
    expect(JSON.stringify(persisted)).not.toContain(privateUserId);
    expect(JSON.stringify(persisted)).not.toContain(privateReplyToken);
    expect(JSON.stringify(persisted)).not.toContain(privateText);
    expect(logOutput()).not.toContain(privateUserId);
    expect(logOutput()).not.toContain(privateReplyToken);
    expect(logOutput()).not.toContain(privateText);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects an oversized request through the shared stream-size limit', async () => {
    const body = 'x'.repeat(1_048_577);
    const response = await route.post(signedRequest(route, body));

    expect(response.status).toBe(413);
    expect(persistWebhookEvents).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });
});
