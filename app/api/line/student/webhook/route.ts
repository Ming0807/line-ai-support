import { verifyLineSignature } from '@/lib/line/signature';

export const runtime = 'nodejs';

// Keep the verified event readable in dev logs without exposing LINE routing identifiers.
function logPayload(value: unknown, depth = 0): unknown {
  if (depth > 12) return '[omitted]';
  if (Array.isArray(value)) return value.map(item => logPayload(item, depth + 1));
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [
      key, ['userId', 'groupId', 'roomId', 'replyToken', 'destination'].includes(key)
        ? '[protected]' : logPayload(item, depth + 1),
    ]));
  }
  return value;
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

  console.info('Verified LINE webhook:', JSON.stringify(logPayload(payload)));
  // LINE verification sends events: []; it succeeds through the same path.
  return Response.json({ ok: true }, { status: 200 });
}
