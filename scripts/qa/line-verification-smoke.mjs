import 'dotenv/config';
import {createHmac} from 'node:crypto';

const base = new URL(process.env.LINE_TEST_BASE_URL ?? 'http://localhost:3000');
if (!['localhost', '127.0.0.1'].includes(base.hostname) || !['3000', '3001'].includes(base.port)
  || base.protocol !== 'http:' || base.username || base.password || base.pathname !== '/') {
  throw new Error('LOCAL_WEBHOOK_TARGET_REQUIRED');
}
const results = [];
try {
  for (const channel of ['STUDENT', 'STAFF']) {
    const secret = process.env[`LINE_${channel}_CHANNEL_SECRET`];
    if (!secret) throw new Error('CHANNEL_NOT_CONFIGURED');
    const url = new URL(`/api/line/${channel.toLowerCase()}/webhook`, base);
    const body = JSON.stringify({events: []});
    const valid = await fetch(url, {method: 'POST', body, signal: AbortSignal.timeout(10000),
      headers: {'x-line-signature': createHmac('sha256', secret).update(body).digest('base64')}});
    const invalid = await fetch(url, {method: 'POST', body, signal: AbortSignal.timeout(10000),
      headers: {'x-line-signature': 'invalid'}});
    const unsupported = await fetch(url, {signal: AbortSignal.timeout(10000)});
    if (valid.status !== 200 || invalid.status !== 401 || unsupported.status !== 405) throw new Error('WEBHOOK_STATUS_INVALID');
    results.push({channel, validEmpty: 200, invalidSignature: 401, get: 405});
  }
  console.log(JSON.stringify({stage: 'line_verification_smoke', results}));
} catch {
  console.error('LINE_VERIFICATION_SMOKE_FAILED');
  process.exitCode = 1;
}
