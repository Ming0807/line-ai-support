/**
 * CONV-V2-05 short-first LINE presentation for long, already validated knowledge answers.
 *
 * The short text is built by the backend only: it keeps whole leading lines of the validated
 * answer (so every link in it was already checked), says plainly that more steps or conditions
 * follow, and names the source. The complete answer is sent only when the student asks for it,
 * after its evidence is checked again.
 */

/** Answers at or below this length are sent complete, as before. */
export const SHORT_ANSWER_TRIGGER_CHARS = 900;
/** Body budget of the first bubble, roughly eight lines on a phone. */
export const SHORT_ANSWER_MAX_CHARS = 600;
export const SHOW_FULL_LABEL = 'ดูขั้นตอนทั้งหมด';
const CONTINUATION = `ยังมีขั้นตอนหรือเงื่อนไขเพิ่มเติม กด “${SHOW_FULL_LABEL}” เพื่ออ่านต่อครับ`;
const MAX_SOURCES = 2;

export interface ShortAnswerSource {
  title: string;
  academicYear: number | null;
}

function sourceLine(sources: ShortAnswerSource[]): string | null {
  const labels: string[] = [];
  for (const source of sources) {
    const label = `${source.title.replace(/[\r\n]+/gu, ' ').trim()}${source.academicYear === null ? '' : ` (ปี ${source.academicYear})`}`;
    if (label && !labels.includes(label)) labels.push(label);
    if (labels.length === MAX_SOURCES) break;
  }
  return labels.length ? `ที่มา: ${labels.join(' / ')}` : null;
}

/**
 * Returns the short first message, or null when the answer should be sent complete:
 * it is already short, or even its first line does not fit the short budget.
 */
export function shortAnswerText(answer: string, sources: ShortAnswerSource[]): string | null {
  const text = answer.trim();
  if (text.length <= SHORT_ANSWER_TRIGGER_CHARS) return null;

  const kept: string[] = [];
  let length = 0;
  for (const line of text.split(/\r?\n/u)) {
    const added = line.length + (kept.length > 0 ? 1 : 0);
    if (length + added > SHORT_ANSWER_MAX_CHARS) break;
    kept.push(line);
    length += added;
  }
  while (kept.length > 0 && kept[kept.length - 1].trim() === '') kept.pop();
  if (kept.length === 0) return null;

  const source = sourceLine(sources);
  return `${kept.join('\n')}\n…\n${CONTINUATION}${source ? `\n\n${source}` : ''}`;
}
