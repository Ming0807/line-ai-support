import { verifyLineSignature } from '@/lib/line/signature';
import { replyToStaffTextEvent } from '@/lib/line/staff-echo';
import { z } from 'zod';
import { receiveLineWebhook } from '@/lib/line/receive-webhook';
import { persistWebhookEvents } from '@/lib/queue/inbox';

export const runtime = 'nodejs';
const webhookSchema = z.object({ events: z.array(z.unknown()).max(100) });

export async function POST(request: Request): Promise<Response> {
  const mode=process.env.LINE_WEBHOOK_MODE?.trim() || 'echo';
  if(mode==='durable') return receiveLineWebhook(request,{
    channel:'STAFF',secret:process.env.LINE_STAFF_CHANNEL_SECRET?.trim(),
    encryptionKey:process.env.ENCRYPTION_KEY,persist:persistWebhookEvents,
  });
  if(mode!=='echo') return Response.json({error:'INVALID_WEBHOOK_MODE'},{status:503});
  // Verify the exact raw bytes before parsing JSON, using only the Staff secret.
  const rawBody = Buffer.from(await request.arrayBuffer());
  if (rawBody.length > 1_048_576) return Response.json({ error: 'BODY_TOO_LARGE' }, { status: 413 });
  const secret = process.env.LINE_STAFF_CHANNEL_SECRET?.trim();
  if (!secret) {
    console.error('LINE staff webhook failed:', { code: 'LINE_STAFF_CHANNEL_SECRET_NOT_CONFIGURED' });
    return Response.json({ error: 'LINE_STAFF_CHANNEL_SECRET_NOT_CONFIGURED' }, { status: 503 });
  }

  if (!verifyLineSignature(rawBody, request.headers.get('x-line-signature'), secret)) {
    return Response.json({ error: 'INVALID_LINE_SIGNATURE' }, { status: 401 });
  }

  let payload: unknown;
  try { payload = JSON.parse(rawBody.toString('utf8')); }
  catch { return Response.json({ error: 'INVALID_JSON' }, { status: 400 }); }

  const parsed = webhookSchema.safeParse(payload);
  if (!parsed.success) return Response.json({ error: 'INVALID_WEBHOOK_PAYLOAD' }, { status: 400 });
  const accessToken = process.env.LINE_STAFF_CHANNEL_ACCESS_TOKEN?.trim();
  // Metadata is enough to diagnose delivery; never log a payload containing tokens.
  console.info('Verified LINE staff webhook:', { eventCount: parsed.data.events.length });
  await Promise.all(parsed.data.events.map((event, index) => replyToStaffTextEvent(event, index, accessToken)));
  // Verification uses events: []; reply failures also safely acknowledge valid envelopes.
  return Response.json({ ok: true }, { status: 200 });
}
