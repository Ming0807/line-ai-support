import { z } from 'zod';

const textEventSchema = z.object({
  type: z.literal('message'),
  replyToken: z.string().min(1),
  message: z.object({ type: z.literal('text'), text: z.string().min(1) }),
});

const MAX_TEXT_CODE_UNITS = 5_000;
const MAX_REPLY_MESSAGES = 5;

function echoMessages(originalText: string) {
  const text = `ได้รับข้อความแล้วครับ: ${originalText}`;
  const messages: Array<{ type: 'text'; text: string }> = [];
  for (let offset = 0; offset < text.length;) {
    let end = Math.min(offset + MAX_TEXT_CODE_UNITS, text.length);
    // LINE counts UTF-16 units. Keep both halves of an emoji together.
    const before = text.charCodeAt(end - 1);
    const after = text.charCodeAt(end);
    if (before >= 0xD800 && before <= 0xDBFF && after >= 0xDC00 && after <= 0xDFFF) end--;
    messages.push({ type: 'text', text: text.slice(offset, end) });
    offset = end;
  }
  return messages;
}

/** Only a verified webhook may call this temporary text echo test. */
export async function replyToStudentTextEvent(
  event: unknown,
  eventIndex: number,
  accessToken: string | undefined,
): Promise<void> {
  const parsed = textEventSchema.safeParse(event);
  // Follow, image, postback and malformed events are intentionally ignored.
  if (!parsed.success) return;
  if (!accessToken) {
    console.error('LINE student reply failed:', {
      code: 'LINE_STUDENT_CHANNEL_ACCESS_TOKEN_NOT_CONFIGURED', eventIndex,
    });
    return;
  }
  const messages = echoMessages(parsed.data.message.text);
  if (messages.length > MAX_REPLY_MESSAGES) {
    console.error('LINE student reply failed:', { code: 'LINE_REPLY_TEXT_TOO_LONG', eventIndex });
    return;
  }

  try {
    const response = await fetch('https://api.line.me/v2/bot/message/reply', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({
        replyToken: parsed.data.replyToken,
        messages,
      }),
      signal: AbortSignal.timeout(5_000),
    });
    // Never log LINE's response body, headers, token or an exception object.
    await response.body?.cancel();
    if (!response.ok) {
      console.error('LINE student reply failed:', {
        code: 'LINE_REPLY_API_ERROR', status: response.status, eventIndex,
      });
      return;
    }
    console.info('LINE student reply sent:', { status: response.status, eventIndex });
  } catch {
    console.error('LINE student reply failed:', { code: 'LINE_REPLY_NETWORK_ERROR', eventIndex });
  }
}
