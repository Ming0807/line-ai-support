import { describe, expect, it } from 'vitest';
import {
  isTypedRouteNavigation,
  resolveTypedRouteChoice,
  contextChoiceOptions,
  contextChoiceText,
} from '../lib/conversation/quick-reply';
import type { RouteCandidate } from '../lib/conversation/router';
import type { TicketStatus } from '../lib/conversation/state-machine';

function candidate(overrides: Partial<RouteCandidate> = {}): RouteCandidate {
  return {
    conversationId: 'conversation-ai',
    conversationRevision: 4,
    mode: 'AI',
    topicLabel: 'Library',
    ticketId: null,
    ticketRevision: null,
    ticketStatus: null,
    ...overrides,
  };
}

function humanCandidate(
  overrides: Partial<RouteCandidate> = {},
): RouteCandidate {
  return candidate({
    conversationId: 'conversation-human',
    conversationRevision: 8,
    mode: 'HUMAN',
    topicLabel: 'Registration request',
    ticketId: 'ticket-21',
    ticketRevision: 12,
    ticketStatus: 'WAITING_USER',
    ...overrides,
  });
}

describe('typed offered route choices', () => {
  it('retains the legacy generic alias only for a unique current AI context', () => {
    expect(resolveTypedRouteChoice('ต่อ เรื่องที่กำลังคุย', [humanCandidate(),candidate()])).toEqual({action:'CONTINUE',conversationId:'conversation-ai'});
    expect(resolveTypedRouteChoice('ต่อ เรื่องที่กำลังคุย', [humanCandidate()])).toBeNull();
    expect(resolveTypedRouteChoice('ต่อ เรื่องที่กำลังคุย', [candidate(),candidate({conversationId:'second',topicLabel:'Other'})])).toBeNull();
  });
  it('presents distinct bounded buttons and matching subjects for competing owned contexts', () => {
    const candidates = [candidate({conversationId:'registration',topicLabel:'registration'}),candidate({conversationId:'library',topicLabel:'library'})];
    const options=contextChoiceOptions(candidates);
    expect(options).toEqual([{label:'เริ่มเรื่องใหม่',value:{action:'NEW'}},{label:'ต่อ เรื่อง 1',value:{action:'CONTINUE',conversationId:'registration'}},{label:'ต่อ เรื่อง 2',value:{action:'CONTINUE',conversationId:'library'}}]);
    expect(new Set(options.map(option=>option.label)).size).toBe(3);
    expect(options.every(option=>Array.from(option.label).length<=20)).toBe(true);
    expect(contextChoiceText('เลือกเรื่องครับ',candidates)).toBe('เลือกเรื่องครับ\n1. registration\n2. library');
    expect(resolveTypedRouteChoice('ต่อ เรื่อง 2',candidates)).toEqual({action:'CONTINUE',conversationId:'library'});
  });
  it('keeps numbered navigation exact, reserved when stale, and terminal/overflow fenced', () => {
    expect(isTypedRouteNavigation('ต่อ เรื่อง 2',[])).toBe(true);
    expect(resolveTypedRouteChoice('ต่อ เรื่อง 2',[candidate()])).toBeNull();
    expect(isTypedRouteNavigation('ต่อ เรื่อง 2 แต่ถามเรื่องใหม่',[])).toBe(false);
    expect(resolveTypedRouteChoice('ต่อ เรื่อง 1',[humanCandidate({ticketStatus:'CLOSED'})])).toBeNull();
    expect(resolveTypedRouteChoice('ต่อ เรื่อง 1',Array.from({length:13},(_,i)=>candidate({conversationId:String(i)})))).toBeNull();
  });
  it('bounds only the display preview and keeps repeated subjects distinguishable by number', () => {
    const topic='หัวข้อ🧑‍💻'.repeat(100),candidates=[candidate({conversationId:'first',topicLabel:topic}),candidate({conversationId:'second',topicLabel:topic})],before=structuredClone(candidates);
    const text=contextChoiceText('เลือกเรื่องครับ',candidates);
    expect(text.length).toBeLessThan(600);
    expect(text).toContain('\n1. ');expect(text).toContain('\n2. ');
    expect(candidates).toEqual(before);
    expect(resolveTypedRouteChoice('ต่อ เรื่อง 2',candidates)).toEqual({action:'CONTINUE',conversationId:'second'});
  });
  it('starts a new topic only for the exact offered command', () => {
    expect(resolveTypedRouteChoice('เริ่มเรื่องใหม่', [candidate()])).toEqual({
      action: 'NEW',
    });
    expect(resolveTypedRouteChoice('  เริ่มเรื่องใหม่  ', [humanCandidate()])).toEqual({
      action: 'NEW',
    });
  });

  it.each([
    ['AI', candidate(), 'Library', 'conversation-ai'],
    ['HUMAN', humanCandidate(), 'Registration request', 'conversation-human'],
  ] as const)(
    'continues the uniquely labeled current %s conversation',
    (_mode, current, label, conversationId) => {
      expect(resolveTypedRouteChoice(`ต่อ ${label}`, [current])).toEqual({
        action: 'CONTINUE',
        conversationId,
      });
      expect(resolveTypedRouteChoice(`  ต่อ ${label}  `, [current])).toEqual({
        action: 'CONTINUE',
        conversationId,
      });
    },
  );

  it('does not interpret a command prefix when the message also contains new content', () => {
    const candidates = [candidate()];

    expect(resolveTypedRouteChoice('ต่อ Library สมัครไม่ได้', candidates)).toBeNull();
    expect(resolveTypedRouteChoice('เริ่มเรื่องใหม่ แล้วช่วยเรื่องลงทะเบียนด้วย', candidates)).toBeNull();
    expect(resolveTypedRouteChoice('ช่วยต่อ Library หน่อย', candidates)).toBeNull();
  });

  it('reserves exact standalone navigation even when the referenced route is stale', () => {
    expect(isTypedRouteNavigation(' เริ่มเรื่องใหม่ ', [])).toBe(true);
    expect(isTypedRouteNavigation('ต่อ เรื่องที่กำลังคุย', [])).toBe(true);
    expect(isTypedRouteNavigation('ต่อ YRU-00000174', [])).toBe(true);
    expect(isTypedRouteNavigation('ต่อ Library', [candidate()])).toBe(true);
    expect(isTypedRouteNavigation('ต่อ Library', [
      candidate({ conversationId: 'first' }),
      candidate({ conversationId: 'second' }),
    ])).toBe(true);
  });

  it('does not reserve navigation-like text when it also carries substantive content', () => {
    const candidates = [candidate()];

    expect(isTypedRouteNavigation('ต่อ Library สมัครไม่ได้', candidates)).toBe(false);
    expect(isTypedRouteNavigation('เริ่มเรื่องใหม่ แล้วช่วยเรื่องลงทะเบียนด้วย', candidates)).toBe(false);
    expect(isTypedRouteNavigation('ต่อ YRU-00000174 เข้าไม่ได้', candidates)).toBe(false);
    expect(isTypedRouteNavigation('ช่วยต่อ Library หน่อย', candidates)).toBe(false);
    expect(isTypedRouteNavigation('ต่อ Unknown topic', candidates)).toBe(false);
  });

  it('fails closed when a continuation label is duplicated or absent', () => {
    const first = candidate({ conversationId: 'conversation-first' });
    const duplicate = candidate({ conversationId: 'conversation-second' });

    expect(resolveTypedRouteChoice('ต่อ Library', [first, duplicate])).toBeNull();
    expect(resolveTypedRouteChoice('ต่อ Unknown topic', [first])).toBeNull();
    expect(resolveTypedRouteChoice('ต่อ ', [candidate({ topicLabel: null })])).toBeNull();
    expect(resolveTypedRouteChoice('ต่อ null', [candidate({ topicLabel: null })])).toBeNull();
  });

  it('rejects empty, unavailable, and over-limit candidate snapshots', () => {
    const twelveCandidates = Array.from({ length: 12 }, (_, index) => candidate({
      conversationId: `conversation-${index}`,
      topicLabel: `Topic ${index}`,
    }));
    const thirteenCandidates = [
      ...twelveCandidates,
      candidate({ conversationId: 'conversation-12', topicLabel: 'Topic 12' }),
    ];

    expect(resolveTypedRouteChoice('เริ่มเรื่องใหม่', [])).toBeNull();
    expect(resolveTypedRouteChoice('ต่อ Library', [])).toBeNull();
    expect(resolveTypedRouteChoice('   ', [candidate()])).toBeNull();
    expect(resolveTypedRouteChoice('เริ่มเรื่องใหม่', twelveCandidates)).toEqual({
      action: 'NEW',
    });
    expect(resolveTypedRouteChoice('เริ่มเรื่องใหม่', thirteenCandidates)).toBeNull();
    expect(resolveTypedRouteChoice('ต่อ Topic 0', thirteenCandidates)).toBeNull();
  });

  it.each(['RESOLVED', 'CLOSED', 'CANCELLED'] as const)(
    'does not continue a terminal HUMAN ticket in %s state',
    (ticketStatus: TicketStatus) => {
      expect(resolveTypedRouteChoice('ต่อ Registration request', [
        humanCandidate({ ticketStatus }),
      ])).toBeNull();
    },
  );

  it('does not continue an inconsistent HUMAN candidate without a current ticket', () => {
    expect(resolveTypedRouteChoice('ต่อ Registration request', [
      humanCandidate({ ticketId: null }),
    ])).toBeNull();
    expect(resolveTypedRouteChoice('ต่อ Registration request', [
      humanCandidate({ ticketRevision: null }),
    ])).toBeNull();
    expect(resolveTypedRouteChoice('ต่อ Registration request', [
      humanCandidate({ ticketStatus: null }),
    ])).toBeNull();
  });
});
