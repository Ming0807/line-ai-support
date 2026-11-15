import {describe, expect, it} from 'vitest';
import {shortAnswerText, SHORT_ANSWER_MAX_CHARS, SHORT_ANSWER_TRIGGER_CHARS, SHOW_FULL_LABEL} from '../lib/line/answer-presentation';
import {isTurnFailureText, TURN_FAILED_TEXT, TURN_OFFICIAL_FAILED_TEXT} from '../lib/ai/turn-flow-v2';

const sources = [{title: 'คู่มือ Wi-Fi มหาวิทยาลัย', academicYear: 2568}, {title: 'คู่มือ Wi-Fi มหาวิทยาลัย', academicYear: 2568}];

function steps(count: number, size = 120): string {
  return Array.from({length: count}, (_, index) => `${index + 1}. ${'ข'.repeat(size)}`).join('\n');
}

describe('shortAnswerText', () => {
  it('keeps a short answer as it is', () => {
    expect(shortAnswerText('1. เปิด Wi-Fi\n2. เลือก YRU', sources)).toBeNull();
    expect(shortAnswerText('ก'.repeat(SHORT_ANSWER_TRIGGER_CHARS), sources)).toBeNull();
  });

  it('keeps whole leading lines, says more steps follow and names the source once', () => {
    const answer = steps(10);
    const short = shortAnswerText(answer, sources)!;
    expect(short).not.toBeNull();
    const body = short.split('\n…\n')[0];
    expect(answer.startsWith(body)).toBe(true);
    expect(body.length).toBeLessThanOrEqual(SHORT_ANSWER_MAX_CHARS);
    expect(body.split('\n').every(line => answer.split('\n').includes(line))).toBe(true);
    expect(short).toContain(SHOW_FULL_LABEL);
    expect(short).toContain('เงื่อนไขเพิ่มเติม');
    expect(short.match(/คู่มือ Wi-Fi มหาวิทยาลัย/gu)).toHaveLength(1);
    expect(short).toContain('(ปี 2568)');
  });

  it('sends the full answer when even the first line is too long to shorten', () => {
    expect(shortAnswerText('ก'.repeat(SHORT_ANSWER_MAX_CHARS + 1) + '\n' + steps(5), sources)).toBeNull();
  });

  it('lists at most two distinct sources', () => {
    const many = [1, 2, 3].map(n => ({title: `เอกสาร ${n}`, academicYear: null}));
    const short = shortAnswerText(steps(10), many)!;
    expect(short).toContain('เอกสาร 1');
    expect(short).toContain('เอกสาร 2');
    expect(short).not.toContain('เอกสาร 3');
  });
});

describe('isTurnFailureText', () => {
  it('recognises only the V2 short failure messages', () => {
    expect(isTurnFailureText(TURN_FAILED_TEXT)).toBe(true);
    expect(isTurnFailureText(TURN_OFFICIAL_FAILED_TEXT)).toBe(true);
    expect(isTurnFailureText('กรุณาระบุรุ่นปีครับ')).toBe(false);
  });
});
