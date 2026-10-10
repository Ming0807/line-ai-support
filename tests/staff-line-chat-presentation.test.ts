import { describe, expect, it } from 'vitest';
import {
  formatStaffCase,
  formatStaffQueue,
  formatStaffReceipt,
  parseStaffChatControl,
  staffChatMessage,
  type StaffChatButton,
} from '../lib/staff/line-chat-presentation';

const menu: StaffChatButton[] = [
  { label: 'งานของฉัน', data: 'opaque:my-cases' },
  { label: 'คิวฝ่าย', data: 'opaque:queue' },
];

describe('parseStaffChatControl', () => {
  it.each([
    ['งานของฉัน', 'MY_CASES'], [' /cases ', 'MY_CASES'],
    ['คิวฝ่าย', 'DEPARTMENT_QUEUE'], ['/queue', 'DEPARTMENT_QUEUE'],
    ['หยุดคุย', 'STOP'], ['/stop', 'STOP'],
  ] as const)('recognizes the exact control %s', (text, expected) => {
    expect(parseStaffChatControl(text)).toBe(expected);
  });

  it.each(['ขอดูงานของฉันหน่อย', 'ช่วยดูคิวฝ่ายให้ที', 'หยุดคุยเคสนี้', 'cases', '/cases please', ''])('does not classify regular text: %s', (text) => {
    expect(parseStaffChatControl(text)).toBeNull();
  });
});

describe('staffChatMessage', () => {
  it('creates a LINE text message and preserves opaque button data exactly', () => {
    const button = { label: 'เปิดเคส', data: 'v1:case=AB-123&sig=a+b%2Fc' };
    expect(staffChatMessage('พร้อมแล้ว', [button])).toEqual({
      type: 'text',
      text: 'พร้อมแล้ว',
      quickReply: { items: [{ type: 'action', action: { type: 'postback', ...button } }] },
    });
  });

  it('rejects over-limit text and buttons rather than altering tokens', () => {
    expect(() => staffChatMessage('x'.repeat(5001))).toThrow('STAFF_CHAT_PRESENTATION_INVALID');
    expect(() => staffChatMessage('ok', Array.from({ length: 14 }, (_, i) => ({ label: `B${i}`, data: `t${i}` })))).toThrow('STAFF_CHAT_PRESENTATION_INVALID');
    expect(() => staffChatMessage('ok', [{ label: 'x'.repeat(21), data: 'token' }])).toThrow('STAFF_CHAT_PRESENTATION_INVALID');
    expect(() => staffChatMessage('ok', [{ label: 'x', data: 't'.repeat(301) }])).toThrow('STAFF_CHAT_PRESENTATION_INVALID');
  });
});

describe('formatStaffQueue', () => {
  it('shows totals and at most five rows, keeping private rows generic and controls on the message', () => {
    const rows = Array.from({ length: 7 }, (_, index) => ({
      code: `CASE-${index + 1}`,
      status: index === 1 ? 'สถานะลับ' : 'รอรับงาน',
      pendingCount: index + 1,
      privateOnly: index === 1,
      action: { label: `เปิด ${index + 1}`, data: `opaque-${index + 1}` },
    }));
    const [message] = formatStaffQueue({ title: 'คิวฝ่าย', total: 7, page: 2, rows, buttons: menu });
    expect(message.text).toContain('7');
    expect(message.text).toContain('หน้า 2');
    expect(message.text).toContain('CASE-1');
    expect(message.text).not.toContain('CASE-2');
    expect(message.text).not.toContain('สถานะลับ');
    expect(message.text).toContain('ข้อความใหม่จากผู้ใช้ 1');
    expect(message.text).not.toContain('รอผู้ใช้ตอบ');
    expect(message.text).toContain('จำกัดการแสดงรายละเอียด');
    expect(message.quickReply?.items.map((item) => item.action.data)).toEqual(['opaque-1', 'opaque-2', 'opaque-3', 'opaque-4', 'opaque-5', ...menu.map((b) => b.data)]);
    expect(message.quickReply?.items).toHaveLength(7);
  });

  it('renders a clear empty state and rejects a combined button overflow', () => {
    expect(formatStaffQueue({ title: 'งานของฉัน', total: 0, page: 1, rows: [], buttons: menu })[0].text).toMatch(/ไม่มี.*งาน/);
    const rows = Array.from({ length: 5 }, (_, i) => ({ code: `C${i}`, status: 'รอ', pendingCount: 0, privateOnly: false, action: { label: 'เปิด', data: `x${i}` } }));
    expect(() => formatStaffQueue({ title: 'คิว', total: 5, page: 1, rows, buttons: Array.from({ length: 9 }, (_, i) => ({ label: `B${i}`, data: `b${i}` })) })).toThrow('STAFF_CHAT_PRESENTATION_INVALID');
  });
});

describe('formatStaffCase', () => {
  it('keeps current-case context, recent messages, history hints, bounded messages, and menus last', () => {
    const messages = Array.from({ length: 9 }, (_, i) => ({ text: `ข้อความ ${i + 1}` }));
    const result = formatStaffCase({ code: 'YRU-42', messages, hasOlder: true, buttons: menu });
    expect(result.length).toBeLessThanOrEqual(5);
    expect(result.at(-1)?.text).toContain('กำลังคุยเคส YRU-42');
    expect(result.at(-1)?.text).toContain('มีข้อความเก่ากว่านี้');
    expect(result.at(-1)?.quickReply?.items.map((item) => item.action.data)).toEqual(menu.map((b) => b.data));
    expect(result.slice(0, -1).every((message) => !message.quickReply)).toBe(true);
    expect(result.every((message) => message.text.length <= 5000)).toBe(true);
    expect(result.some((message) => message.text.includes('ข้อความ 9'))).toBe(true);
  });

  it('returns a helpful no-message state and notes when long Unicode history was shortened', () => {
    const empty = formatStaffCase({ code: 'YRU-EMPTY', messages: [], hasOlder: false, buttons: [] });
    expect(empty[0].text).toContain('ไม่มีข้อความใหม่');
    const long = '🙂漢字'.repeat(10000);
    const result = formatStaffCase({ code: 'YRU-LONG', messages: [{ text: 'เก่า' }, { text: long }], hasOlder: true, buttons: [] });
    expect(result.length).toBeLessThanOrEqual(5);
    expect(result.every((message) => message.text.length <= 5000)).toBe(true);
    expect(result.some((message) => message.text.includes('ตัดข้อความบางส่วน'))).toBe(true);
    expect(result.at(-1)?.text).toContain('YRU-LONG');
  });
});

describe('formatStaffReceipt', () => {
  it('attaches the provided controls to the receipt', () => {
    expect(formatStaffReceipt({ text: 'รับเรื่องแล้ว', buttons: menu })).toHaveLength(1);
    expect(formatStaffReceipt({ text: 'รับเรื่องแล้ว', buttons: menu })[0].quickReply?.items[1].action.data).toBe('opaque:queue');
  });
});
