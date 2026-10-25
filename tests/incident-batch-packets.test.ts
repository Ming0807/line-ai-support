import { describe, expect, it } from 'vitest';
import { IncidentError } from '../lib/incidents/contracts';
import { prepareIncidentReplyPackets, type IncidentPacketMember } from '../lib/incidents/batch-packets';

const commonText = 'เจ้าหน้าที่กำลังตรวจสอบและจะแจ้งความคืบหน้า';

function uuid(prefix: string, value: number) {
  return `${prefix}-0000-4000-8000-${value.toString(16).padStart(12, '0')}`;
}

function member(index: number, session = 1, overrides: Partial<IncidentPacketMember> = {}): IncidentPacketMember {
  return {
    ticketId: uuid('50000000', index),
    ticketCode: `CASE-${String(index).padStart(3, '0')}`,
    reporterLabel: `ผู้แจ้ง ${index}`,
    sessionId: uuid('60000000', session),
    ...overrides,
  };
}

function expectInvalid(members: readonly IncidentPacketMember[], text = commonText) {
  let thrown: unknown;
  try {
    prepareIncidentReplyPackets(members, text);
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(IncidentError);
  expect((thrown as IncidentError | undefined)?.code).toBe('INVALID_REQUEST');
}

describe('prepareIncidentReplyPackets', () => {
  it('groups only selected cases by session and keeps recipient identity private', () => {
    const first = member(1, 1);
    const second = member(2, 1);
    const otherSession = member(3, 2);
    const fourth = member(4, 1);
    const packets = prepareIncidentReplyPackets([fourth, otherSession, second, first], commonText);

    expect(packets).toHaveLength(2);
    expect(packets.map(packet => packet.recipientCode)).toEqual(['R1', 'R2']);
    expect(packets[0].cases).toEqual([first, second, fourth].map(({ ticketId, ticketCode, reporterLabel }) => ({ ticketId, ticketCode, reporterLabel })));
    expect(packets[1].cases).toEqual([{ ticketId: otherSession.ticketId, ticketCode: otherSession.ticketCode, reporterLabel: otherSession.reporterLabel }]);
    expect(packets.map(packet => packet.messages.map(message => message.text).join(''))).toEqual([
      `อัปเดตเคส: CASE-001, CASE-002, CASE-004\n\n${commonText}`,
      `อัปเดตเคส: CASE-003\n\n${commonText}`,
    ]);

    const serialized = JSON.stringify(packets);
    for (const sessionId of [first.sessionId, otherSession.sessionId]) expect(serialized).not.toContain(sessionId);
    for (const packet of packets) {
      const studentText = packet.messages.map(message => message.text).join('');
      for (const other of [first, second, otherSession, fourth].filter(item => !packet.cases.some(selected => selected.ticketId === item.ticketId))) {
        expect(studentText).not.toContain(other.ticketCode);
      }
      for (const selected of packet.cases) expect(studentText).not.toContain(selected.reporterLabel);
    }
  });

  it('produces the same recipient and case order regardless of selected input order', () => {
    const selected = [member(9, 1), member(2, 2), member(6, 1), member(1, 3), member(4, 2)];

    expect(prepareIncidentReplyPackets(selected, commonText)).toEqual(
      prepareIncidentReplyPackets([...selected].reverse(), commonText),
    );
    expect(prepareIncidentReplyPackets(selected, commonText).map(packet => packet.cases[0].ticketId)).toEqual(
      [1, 2, 6].map(index => member(index, index === 1 ? 3 : index === 2 ? 2 : 1).ticketId),
    );
  });

  it('splits complete Thai text only at grapheme boundaries and never clips it', () => {
    const selected = Array.from({ length: 60 }, (_, offset) => member(offset + 1, 1, { ticketCode: `ก${String(offset).padStart(99, '0')}` }));
    const text = 'ก\u0e49'.repeat(2000);
    const packets = prepareIncidentReplyPackets(selected, text);
    expect(packets).toHaveLength(1);
    const packet = packets[0];
    const expected = `อัปเดตเคส: ${selected.map(item => item.ticketCode).join(', ')}\n\n${text}`;
    const messages = packet.messages.map(message => message.text);
    const graphemeBoundaries = new Set<number>();
    let graphemeOffset = 0;
    graphemeBoundaries.add(0);
    for (const { segment } of new Intl.Segmenter('th', { granularity: 'grapheme' }).segment(expected)) {
      graphemeOffset += segment.length;
      graphemeBoundaries.add(graphemeOffset);
    }

    expect(messages.length).toBeGreaterThan(1);
    expect(messages.length).toBeLessThanOrEqual(5);
    expect(messages.every(message => message.length <= 5000)).toBe(true);
    expect(messages.join('')).toBe(expected);
    let boundary = 0;
    for (const message of messages.slice(0, -1)) {
      boundary += message.length;
      expect(graphemeBoundaries.has(boundary)).toBe(true);
    }
  });

  it('supports exactly 100 selected cases and assigns the final recipient label R100', () => {
    const selected = Array.from({ length: 100 }, (_, offset) => member(offset + 1, offset + 1));
    const packets = prepareIncidentReplyPackets(selected, commonText);

    expect(packets).toHaveLength(100);
    expect(packets[0].recipientCode).toBe('R1');
    expect(packets[99].recipientCode).toBe('R100');
    expect(packets.flatMap(packet => packet.cases)).toHaveLength(100);
    expectInvalid([...selected, member(101, 101)]);
  });

  it('rejects duplicate canonical ticket IDs, malformed IDs and out-of-bound member/text fields', () => {
    const original = member(1);
    expectInvalid([original, { ...member(2), ticketId: original.ticketId.toUpperCase() }]);
    expectInvalid([{ ...original, ticketId: 'ticket-1' }]);
    expectInvalid([{ ...original, sessionId: 'session-1' }]);
    expectInvalid([{ ...original, ticketCode: '' }]);
    expectInvalid([{ ...original, ticketCode: 'C'.repeat(101) }]);
    expectInvalid([{ ...original, reporterLabel: 'R'.repeat(201) }]);
    expectInvalid([original], '   ');
    expectInvalid([original], 'C'.repeat(4001));
    expectInvalid([original], `bad\u200btext`);
    expectInvalid([]);
  });
});
