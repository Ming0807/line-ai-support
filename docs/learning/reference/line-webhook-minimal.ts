// ตัวอย่างประกอบบทเรียนเท่านั้น แอปไม่ได้ import ไฟล์นี้
import { createHmac, timingSafeEqual } from 'node:crypto';

export const runtime = 'nodejs';

export async function POST(request: Request): Promise<Response> {
  // 1. อ่านข้อมูลต้นฉบับ ยังไม่ใช้ request.json()
  const rawBody = Buffer.from(await request.arrayBuffer());
  const secret = process.env.LINE_STUDENT_CHANNEL_SECRET;
  if (!secret) return Response.json({ error: 'ยังไม่ได้ตั้งค่า Channel Secret' }, { status: 503 });

  // 2. รับลายเซ็นที่ LINE ส่งมา แล้วคำนวณลายเซ็นของเรา
  const signature = request.headers.get('x-line-signature');
  if (!signature) return Response.json({ error: 'ไม่มีลายเซ็น' }, { status: 401 });
  const expected = createHmac('sha256', secret).update(rawBody).digest();
  const received = Buffer.from(signature, 'base64');

  // 3. ลายเซ็นต้องตรงกัน จึงจะอ่านเนื้อหา
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) {
    return Response.json({ error: 'ลายเซ็นไม่ถูกต้อง' }, { status: 401 });
  }

  // 4. ตอนนี้จึงแปลง JSON และดู payload สำหรับการทดลอง local
  let payload: unknown;
  try { payload = JSON.parse(rawBody.toString('utf8')); }
  catch { return Response.json({ error: 'JSON ไม่ถูกต้อง' }, { status: 400 }); }
  console.info('Verified LINE webhook:', payload);

  // 5. events: [] ก็ถึงบรรทัดนี้ได้ ไม่ต้องมีข้อความก่อนจึงตอบรับ
  return Response.json({ ok: true }, { status: 200 });
}
