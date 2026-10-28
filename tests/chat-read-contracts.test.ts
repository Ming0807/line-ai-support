import { describe, expect, it } from 'vitest';
import {
  noteChatInputSchema,
  parseInboxQuery,
  parseThreadQuery,
  readChatInputSchema,
} from '../lib/chat/contracts';

const uuid = '7dc4c6bf-9048-4ae5-9044-38a826a3be70';

describe('Inbox query contract', () => {
  it('uses the frozen defaults and preserves existing ticket filters', () => {
    expect(parseInboxQuery(new URLSearchParams())).toEqual({ view: 'all', page: 1, pageSize: 25 });

    expect(parseInboxQuery(new URLSearchParams(
      `view=unread&category=NETWORK:WIFI&department=${uuid}&status=WAITING_USER&priority=HIGH&assignee=${uuid}&from=2026-10-01&to=2026-10-28&q=%20wifi%20&page=3&pageSize=75`,
    ))).toEqual({
      view: 'unread', category: 'NETWORK:WIFI', department: uuid, status: 'WAITING_USER', priority: 'HIGH',
      assignee: uuid, from: '2026-10-01', to: '2026-10-28', q: 'wifi', page: 3, pageSize: 75,
    });
  });

  it.each([
    'unknown=x', 'view=all&view=mine', 'page=1&page=1', 'category=NETWORK&category=NETWORK', 'category=network', 'category=_INTERNAL',
    'category=HAS%20SPACE', 'pageSize=101', 'from=2026-10-29&to=2026-10-28',
  ])('rejects unsupported or invalid Inbox query %s', query => {
    expect(() => parseInboxQuery(new URLSearchParams(query))).toThrow();
  });
});

describe('thread query contract', () => {
  it('defaults to the newest 50 and parses a canonical exclusive cursor', () => {
    expect(parseThreadQuery(new URLSearchParams())).toEqual({ limit: 50 });
    expect(parseThreadQuery(new URLSearchParams('beforeSequence=42&limit=100')))
      .toEqual({ beforeSequence: 42, limit: 100 });
    expect(parseThreadQuery(new URLSearchParams(`beforeSequence=${Number.MAX_SAFE_INTEGER}`)))
      .toEqual({ beforeSequence: Number.MAX_SAFE_INTEGER, limit: 50 });
  });

  it.each([
    'beforeSequence=0', 'beforeSequence=01', 'beforeSequence=-1', 'beforeSequence=1.5',
    'beforeSequence=1e3', 'beforeSequence=9007199254740992', 'beforeSequence=1&beforeSequence=2',
    'limit=50&limit=50', 'limit=101', 'limit=0', 'unknown=x',
  ])('rejects invalid thread query %s', query => {
    expect(() => parseThreadQuery(new URLSearchParams(query))).toThrow();
  });
});

describe('chat read and note inputs', () => {
  it('accepts only a nonnegative safe integer read cursor', () => {
    expect(readChatInputSchema.parse({ throughSequence: 0 })).toEqual({ throughSequence: 0 });
    expect(readChatInputSchema.parse({ throughSequence: Number.MAX_SAFE_INTEGER }).throughSequence)
      .toBe(Number.MAX_SAFE_INTEGER);
    for (const throughSequence of [-1, 1.2, Number.MAX_SAFE_INTEGER + 1, '1']) {
      expect(() => readChatInputSchema.parse({ throughSequence })).toThrow();
    }
    expect(() => readChatInputSchema.parse({ throughSequence: 1, extra: true })).toThrow();
  });

  it('trims bounded note text, allows line breaks and rejects unsafe controls or extra fields', () => {
    expect(noteChatInputSchema.parse({ requestId: uuid, text: '  first\nsecond\r\tthird  ' }))
      .toEqual({ requestId: uuid, text: 'first\nsecond\r\tthird' });
    expect(() => noteChatInputSchema.parse({ requestId: uuid, text: '   ' })).toThrow();
    expect(() => noteChatInputSchema.parse({ requestId: uuid, text: 'bad\u0000text' })).toThrow();
    expect(() => noteChatInputSchema.parse({ requestId: uuid, text: 'bad\u0085text' })).toThrow();
    expect(() => noteChatInputSchema.parse({ requestId: uuid, text: 'x'.repeat(4001) })).toThrow();
    expect(() => noteChatInputSchema.parse({ requestId: 'invalid', text: 'ok' })).toThrow();
    expect(() => noteChatInputSchema.parse({ requestId: uuid, text: 'ok', actorId: uuid })).toThrow();
  });
});
