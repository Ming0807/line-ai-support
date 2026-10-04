import { createHmac } from 'node:crypto';
import dotenv from 'dotenv';

dotenv.config({ quiet: true });
const secret = process.env.LINE_STUDENT_CHANNEL_SECRET?.trim();
if (!secret) throw new Error('LINE_STUDENT_CHANNEL_SECRET_NOT_CONFIGURED');
const origin = process.argv[2] ?? 'http://localhost:3000';
const url = new URL('/api/line/student/webhook', origin);
const body = JSON.stringify({ events: [] });
const signature = createHmac('sha256', secret).update(body).digest('base64');
const cases = [
  { name: 'Signed verification events: []', body, signature, expected: 200 },
  { name: 'Modified raw body', body: ` ${body}`, signature, expected: 401 },
  { name: 'Missing signature', body, expected: 401 },
];
for (const test of cases) {
  const headers = { 'content-type': 'application/json' };
  if (test.signature) headers['x-line-signature'] = test.signature;
  const response = await fetch(url, {
    method: 'POST', headers, body: test.body, signal: AbortSignal.timeout(15_000),
  });
  console.log(`${test.name}: ${response.status} (expected ${test.expected})`);
  if (response.status !== test.expected) process.exitCode = 1;
  await response.text();
}
const getResponse = await fetch(url, { signal: AbortSignal.timeout(15_000) });
console.log(`GET: ${getResponse.status} (expected 405)`);
if (getResponse.status !== 405) process.exitCode = 1;
await getResponse.text();
