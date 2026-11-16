import { describe, expect, it } from 'vitest';
import {
  acknowledgeCursor,
  catchUpAfterFetch,
  rawFromURLSearchParams,
  type ThreadSpan,
} from '@/app/(dashboard)/tickets/[id]/chat-thread-state';
import { shouldAcknowledgeRead } from '../app/(dashboard)/inbox/controller';
import type { ChatMessage } from '@/types/inbox';

function message(sequence: number, id = `m-${sequence}`): ChatMessage {
  return {
    id, sequence, senderType: 'USER', staffName: null,
    content: `ข้อความ ${sequence}`, createdAt: `2026-10-28T01:00:${String(sequence % 60).padStart(2, '0')}.000Z`,
    deliveryStatus: null, attachments: [],
  };
}

describe('read acknowledgement decisions', () => {
  it('acknowledges only the visible rendered tail of the selected ticket', () => {
    const visible = {
      documentVisible: true, rendered: true, sentinelVisible: true,
      latestSequence: 51, readThroughSequence: 50,
    };
    expect(shouldAcknowledgeRead({ ...visible, documentVisible: false })).toBe(false);
    expect(shouldAcknowledgeRead({ ...visible, rendered: false })).toBe(false);
    expect(shouldAcknowledgeRead({ ...visible, sentinelVisible: false })).toBe(false);
    expect(shouldAcknowledgeRead({ ...visible, latestSequence: 50, readThroughSequence: 50 })).toBe(false);
    expect(shouldAcknowledgeRead(visible)).toBe(true);
  });

  it('keeps the cursor monotone when slow older server responses land last', () => {
    expect(acknowledgeCursor(50, 51)).toBe(51);
    expect(acknowledgeCursor(51, 5)).toBe(51);
    expect(acknowledgeCursor(0, 0)).toBe(0);
  });
});

describe('bounded catch-up after a fetched window', () => {
  const gapSpans: ThreadSpan[] = [{ lo: 51, hi: 100 }, { lo: 151, hi: 200 }];

  it('closes the hole when the fetched window bridges the gap', () => {
    const outcome = catchUpAfterFetch({ spans: gapSpans, empties: [] }, { cursor: 151, window: { messages: [message(101), message(150)], hasMore: false, nextBefore: null } });
    expect(outcome.spans).toEqual([{ lo: 51, hi: 200 }]);
    expect(outcome.firstCatchUpBefore).toBeNull();
  });

  it('narrows the hole to the next cursor when the server window is shorter', () => {
    const outcome = catchUpAfterFetch({ spans: gapSpans, empties: [] }, { cursor: 151, window: { messages: [message(120), message(150)], hasMore: false, nextBefore: null } });
    expect(outcome.spans).toEqual([{ lo: 51, hi: 100 }, { lo: 120, hi: 200 }]);
    expect(outcome.firstCatchUpBefore).toBe(120);
  });

  it('closes a sparse hole honestly: the newest-N window below the cursor proves absence in between', () => {
    // First bounded attempt short of the floor: [75..100] stays unknown.
    const first = catchUpAfterFetch({ spans: [{ lo: 51, hi: 74 }, { lo: 151, hi: 200 }], empties: [] }, { cursor: 151, window: { messages: [message(101), message(150)], hasMore: false, nextBefore: null } });
    expect(first.spans).toEqual([{ lo: 51, hi: 74 }, { lo: 101, hi: 200 }]);
    expect(first.firstCatchUpBefore).toBe(101);
    // The next attempt proves sequences [75..100] truly do not exist (the fetch before 101 returned nothing newer).
    const second = catchUpAfterFetch({ spans: first.spans, empties: first.empties }, { cursor: 101, window: { messages: [message(61), message(74)], hasMore: false, nextBefore: null } });
    expect(second.empties).toEqual([{ lo: 75, hi: 100 }]);
    expect(second.firstCatchUpBefore).toBeNull();
  });

  it('proves absence in one call when the fetched window is empty below the cursor', () => {
    const outcome = catchUpAfterFetch({ spans: [{ lo: 51, hi: 74 }, { lo: 101, hi: 200 }], empties: [] }, { cursor: 101, window: { messages: [], hasMore: false, nextBefore: null } });
    expect(outcome.empties).toEqual([{ lo: 1, hi: 100 }]);
    expect(outcome.firstCatchUpBefore).toBeNull();
  });
});

describe('search-param record bridge', () => {
  it('splits repeated keys into arrays for the state validator', () => {
    const params = new URLSearchParams('view=unread&page=2&page=3');
    expect(rawFromURLSearchParams(params)).toEqual({ view: 'unread', page: ['2', '3'] });
  });
});
