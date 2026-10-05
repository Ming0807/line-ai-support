import { afterEach, describe, expect, it, vi } from 'vitest';
import { readRetryEvidence } from '../lib/ai/retry-evidence';

const OBSERVED_AT = Date.parse('2026-10-05T12:00:00.000Z');

function retryHeaders(value?: string): Headers {
  const headers = new Headers();
  if (value !== undefined) headers.set('Retry-After', value);
  return headers;
}

describe('readRetryEvidence', () => {
  afterEach(() => vi.useRealTimers());

  it.each([429, 500, 503, 599])('accepts retry evidence for HTTP %s', (status) => {
    expect(readRetryEvidence(status, retryHeaders('30'), OBSERVED_AT)).toEqual({
      source: 'RETRY_AFTER',
      observedAt: '2026-10-05T12:00:00.000Z',
      retryAt: '2026-10-05T12:00:30.000Z',
    });
  });

  it.each([200, 302, 400, 499, 600, 429.5, Number.NaN])(
    'ignores Retry-After for unsupported HTTP status %s',
    (status) => {
      expect(readRetryEvidence(status, retryHeaders('30'), OBSERVED_AT)).toBeUndefined();
    },
  );

  it.each([
    ['zero delay', '0', 0],
    ['one second', '1', 1_000],
    ['leading zeroes', '0007', 7_000],
    ['maximum delay', '86400', 86_400_000],
  ])('anchors %s to the supplied observation time', (_name, header, delayMs) => {
    const receivedAt = OBSERVED_AT + 1_234;
    const evidence = readRetryEvidence(429, retryHeaders(header), receivedAt);

    expect(evidence).toEqual({
      source: 'RETRY_AFTER',
      observedAt: new Date(receivedAt).toISOString(),
      retryAt: new Date(receivedAt + delayMs).toISOString(),
    });
  });

  it.each([
    '',
    '+1',
    '-1',
    '1.5',
    '1e3',
    'Infinity',
    'NaN',
    '86401',
    '9007199254740993',
    '0x10',
    '1, 2',
  ])('rejects malformed, negative, overflowing, or over-limit delay %j', (header) => {
    expect(readRetryEvidence(429, retryHeaders(header), OBSERVED_AT)).toBeUndefined();
  });

  it('rejects an excessively long field value before interpreting it', () => {
    expect(readRetryEvidence(429, retryHeaders('0'.repeat(129)), OBSERVED_AT)).toBeUndefined();
  });

  it('rejects duplicate Retry-After field values', () => {
    const headers = new Headers();
    headers.append('Retry-After', '30');
    headers.append('Retry-After', '30');

    expect(readRetryEvidence(429, headers, OBSERVED_AT)).toBeUndefined();
  });

  it('accepts a strict IMF-fixdate at the 24-hour boundary', () => {
    expect(
      readRetryEvidence(
        503,
        retryHeaders('Tue, 06 Oct 2026 12:00:00 GMT'),
        OBSERVED_AT,
      ),
    ).toEqual({
      source: 'RETRY_AFTER',
      observedAt: '2026-10-05T12:00:00.000Z',
      retryAt: '2026-10-06T12:00:00.000Z',
    });
  });

  it('accepts both obsolete HTTP-date formats', () => {
    const rfc850 = readRetryEvidence(
      429,
      retryHeaders('Tuesday, 06-Oct-26 12:00:00 GMT'),
      OBSERVED_AT,
    );
    const asctime = readRetryEvidence(
      429,
      retryHeaders('Tue Oct  6 12:00:00 2026'),
      OBSERVED_AT,
    );

    expect(rfc850?.retryAt).toBe('2026-10-06T12:00:00.000Z');
    expect(asctime?.retryAt).toBe('2026-10-06T12:00:00.000Z');
  });

  it('accepts a real leap day without calendar rollover', () => {
    const observedAt = Date.parse('2028-02-28T00:00:00.000Z');

    expect(
      readRetryEvidence(429, retryHeaders('Tue, 29 Feb 2028 00:00:00 GMT'), observedAt),
    ).toMatchObject({ retryAt: '2028-02-29T00:00:00.000Z' });
  });

  it.each([
    'Mon, 29 Feb 2027 00:00:00 GMT',
    'Wed, 06 Oct 2026 12:00:00 GMT',
    'Tue, 32 Oct 2026 12:00:00 GMT',
    'Tue, 06 Oct 2026 24:00:00 GMT',
    'Tue, 06 Oct 2026 12:00:00 +0000',
    'Tue, 06 Oct 2026 12:00:00 UTC',
    'Oct 6, 2026 12:00:00 GMT',
    'tue, 06 Oct 2026 12:00:00 GMT',
  ])('rejects invalid or non-HTTP date %j', (header) => {
    expect(readRetryEvidence(429, retryHeaders(header), OBSERVED_AT)).toBeUndefined();
  });

  it('rejects dates in the past and dates more than 24 hours away', () => {
    expect(
      readRetryEvidence(429, retryHeaders('Mon, 05 Oct 2026 11:59:59 GMT'), OBSERVED_AT),
    ).toBeUndefined();
    expect(
      readRetryEvidence(429, retryHeaders('Tue, 06 Oct 2026 12:00:01 GMT'), OBSERVED_AT),
    ).toBeUndefined();
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER])(
    'rejects invalid observation timestamps %s',
    (observedAt) => {
      expect(readRetryEvidence(429, retryHeaders('1'), observedAt)).toBeUndefined();
    },
  );

  it('uses Date.now when no observation time is supplied', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(OBSERVED_AT));

    expect(readRetryEvidence(429, retryHeaders('1'))).toMatchObject({
      observedAt: '2026-10-05T12:00:00.000Z',
      retryAt: '2026-10-05T12:00:01.000Z',
    });
  });
});
