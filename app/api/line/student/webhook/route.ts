import { verifyLineSignature } from '@/lib/line/signature';
import { replyToStudentTextEvent } from '@/lib/line/student-echo';
import { z } from 'zod';

export const runtime = 'nodejs';
const webhookSchema = z.object({ events: z.array(z.unknown()).max(100) });

// Keep the verified event readable in dev logs without exposing LINE routing identifiers.
function logPayload(value: unknown, protectedValues: readonly string[], depth = 0): unknown {
  if (depth > 12) return '[omitted]';
  if (Array.isArray(value)) return value.map(item => logPayload(item, protectedValues, depth + 1));
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [
      key, ['userId', 'groupId', 'roomId', 'replyToken', 'quoteToken', 'markAsReadToken', 'destination'].includes(key)
        ? '[protected]' : logPayload(item, protectedValues, depth + 1),
    ]));
  }
  return typeof value === 'string'
    ? protectedValues.reduce((text, token) => text.replaceAll(token, '[protected]'), value)
    : value;
}

export async function POST(request: Request): Promise<Response> {
  // Verify the exact bytes before parsing JSON. This step has no AI/database dependency.
  const rawBody = Buffer.from(await request.arrayBuffer());
  if (rawBody.length > 1_048_576) return Response.json({ error: 'BODY_TOO_LARGE' }, { status: 413 });
  const secret = process.env.LINE_STUDENT_CHANNEL_SECRET?.trim();
  if (!secret) return Response.json({ error: 'LINE_STUDENT_CHANNEL_SECRET_NOT_CONFIGURED' }, { status: 503 });

  if (!verifyLineSignature(rawBody, request.headers.get('x-line-signature'), secret)) {
    return Response.json({ error: 'INVALID_LINE_SIGNATURE' }, { status: 401 });
  }

  let payload: unknown;
  try { payload = JSON.parse(rawBody.toString('utf8')); }
  catch { return Response.json({ error: 'INVALID_JSON' }, { status: 400 }); }

  const parsed = webhookSchema.safeParse(payload);
  if (!parsed.success) return Response.json({ error: 'INVALID_WEBHOOK_PAYLOAD' }, { status: 400 });
  const accessToken = process.env.LINE_STUDENT_CHANNEL_ACCESS_TOKEN?.trim();
  const protectedValues = [secret, accessToken].filter((value): value is string => Boolean(value));
  console.info('Verified LINE webhook:', JSON.stringify(logPayload(payload, protectedValues)));
  await Promise.all(parsed.data.events.map((event, index) => replyToStudentTextEvent(event, index, accessToken)));
  // LINE verification sends events: []; it succeeds through the same path.
  return Response.json({ ok: true }, { status: 200 });
}
