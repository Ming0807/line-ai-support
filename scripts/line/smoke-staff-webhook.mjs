import { createHmac } from 'node:crypto';
import dotenv from 'dotenv';

dotenv.config({ quiet: true });
const secret = process.env.LINE_STAFF_CHANNEL_SECRET?.trim();
if (!secret) throw new Error('LINE_STAFF_CHANNEL_SECRET_NOT_CONFIGURED');
const origin = process.argv[2] ?? 'http://localhost:3000';
const url = new URL('/api/line/staff/webhook', origin);
const body = JSON.stringify({ events: [] });
const signature = createHmac('sha256', secret).update(body).digest('base64');
const cases = [
  { name: 'Staff signed verification events: []', body, signature, expected: 200 },
  { name: 'Modified raw body', body: ` ${body}`, signature, expected: 401 },
  { name: 'Missing signature', body, expected: 401 },
];
const studentSecret = process.env.LINE_STUDENT_CHANNEL_SECRET?.trim();
if (studentSecret && studentSecret !== secret) {
  cases.push({ name: 'Student signature at Staff endpoint', body,
    signature: createHmac('sha256', studentSecret).update(body).digest('base64'), expected: 401 });
}
for (const test of cases) {
  const headers = { 'content-type': 'application/json' };
  if (test.signature) headers['x-line-signature'] = test.signature;
  try {
    const response = await fetch(url, { method: 'POST', headers, body: test.body, signal: AbortSignal.timeout(15_000) });
    console.log(`${test.name}: ${response.status} (expected ${test.expected})`);
    if (response.status !== test.expected) process.exitCode = 1;
    await response.body?.cancel();
  } catch {
    console.error(`${test.name}: HTTP_SMOKE_NETWORK_ERROR`);
    process.exitCode = 1;
  }
}
try {
  const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  console.log(`GET: ${response.status} (expected 405)`);
  if (response.status !== 405) process.exitCode = 1;
  await response.body?.cancel();
} catch {
  console.error('GET: HTTP_SMOKE_NETWORK_ERROR');
  process.exitCode = 1;
}
