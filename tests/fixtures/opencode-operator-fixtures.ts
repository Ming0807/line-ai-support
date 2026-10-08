/**
 * Synthetic fixtures for OC-UI-02 operator workflow tests.
 *
 * Every row here is explicitly synthetic and safe: display names are
 * invented, ticket codes use a TEST prefix that can never collide with real
 * `TK-` numbers, and timestamps are fixed. No real staff, LINE identity,
 * token, secret, or production payload appears in this file.
 */

export interface RawActivityFixture {
  id: string;
  occurredAt: string;
  action: string;
  actorDisplayName: string | null;
  ticketCode: string | null;
  departmentLabel: string | null;
  summary: string;
  [extra: string]: unknown;
}

export interface RawLogFixture {
  id: string;
  loggedAt: string;
  code: string;
  label: string;
  component: string;
  severity: string;
  httpStatus: number | null;
  correlationId: string | null;
  [extra: string]: unknown;
}

export const SYNTHETIC_ACTIVITIES: RawActivityFixture[] = [
  {
    id: '6f63c09c-377e-4f85-8a50-407d14b7ded4',
    occurredAt: '2026-10-06T02:15:00.000Z',
    action: 'CREATE', actionLabel: 'สร้างงาน',
    actorDisplayName: 'สมมติ เจ้าหน้าที่หนึ่ง',
    ticketCode: 'TEST-2026-0001',
    departmentLabel: 'ฝ่ายทดสอบระบบ',
    summary: 'สร้างงาน',
  },
  {
    id: '0f5f8eae-56e5-4ce7-8b58-282781181103',
    occurredAt: '2026-10-06T03:02:00.000Z',
    action: 'REPLY',
    actionLabel: 'ตอบกลับ',
    actorDisplayName: 'สมมติ เจ้าหน้าที่สอง',
    ticketCode: 'TEST-2026-0002',
    departmentLabel: 'ฝ่ายทดสอบระบบ',
    summary: 'ตอบกลับ',
  },
  {
    id: '5f63b219-d1fe-46a0-b880-bfc3aa601f7c',
    occurredAt: '2026-10-05T07:40:00.000Z',
    action: 'REASSIGN',
    actionLabel: 'มอบหมายงาน',
    actorDisplayName: null,
    ticketCode: 'TEST-2026-0003',
    departmentLabel: 'ฝ่ายวิชาการจำลอง',
    summary: 'มอบหมายงาน',
  },
  {
    id: '6a08e8f6-fca4-49fd-a0bf-41da19851e0c',
    occurredAt: '2026-10-04T01:00:00.000Z',
    action: 'RESOLVE',
    actionLabel: 'แก้ไขสำเร็จ',
    actorDisplayName: 'สมมติ เจ้าหน้าที่สาม',
    ticketCode: null,
    departmentLabel: null,
    summary: 'แก้ไขสำเร็จ',
  },
];

export const SYNTHETIC_LOGS: RawLogFixture[] = [
  {
    id: 'line:1',
    loggedAt: '2026-10-06T02:15:01.000Z',
    code: 'LINE_DELIVERED',
    label: 'LINE ยืนยันการส่ง',
    component: 'line-delivery',
    severity: 'INFO',
    httpStatus: 200,
    correlationId: null,
  },
  {
    id: 'ai:6f63c09c-377e-4f85-8a50-407d14b7ded4',
    loggedAt: '2026-10-06T02:16:44.000Z',
    code: 'TIMEOUT',
    label: 'AI ใช้เวลานานเกินกำหนด',
    component: 'ai-gateway',
    severity: 'WARN',
    httpStatus: null,
    correlationId: null,
  },
  {
    id: 'line:2',
    loggedAt: '2026-10-05T15:03:10.000Z',
    code: 'LINE_DELIVERY_FAILED',
    label: 'ส่ง LINE ไม่สำเร็จ',
    component: 'line-delivery',
    severity: 'ERROR',
    httpStatus: 500,
    correlationId: null,
  },
];

export const SECRET_INJECTED_ACTIVITY: RawActivityFixture = {
  id: 'f2ba7403-25c3-4e79-9f6e-79136eefea72',
  occurredAt: '2026-10-06T04:00:00.000Z',
  action: 'REPLY',
  actionLabel: 'ตอบกลับ',
  actorDisplayName: 'ผู้ไม่ประสงค์ออกนาม',
  ticketCode: 'TEST-2026-0099',
  departmentLabel: 'ฝ่ายทดสอบระบบ',
  summary: 'ตอบกลับ',
  lineUserId: 'U-deadbeef_should_never_render',
  accessToken: 'secret-access-token-must-not-render',
  replyToken: 'secret-reply-token-must-not-render',
  password: 'hunter2-must-not-render',
  rawJson: '{"secret":"must-not-render"}',
  stack: 'Error: secret stack must not render',
  requestUrl: 'https://internal.example/secret?key=1',
  ip: '10.9.9.9',
  messageBody: 'private message body must not render',
  sourceNotes: 'private source note must not render',
};

export const SECRET_INJECTED_LOG: RawLogFixture = {
  id: 'ai:0f5f8eae-56e5-4ce7-8b58-282781181103',
  loggedAt: '2026-10-06T04:01:00.000Z',
  code: 'TIMEOUT',
  label: 'ป้ายที่ดูปลอดภัย',
  component: 'ai-gateway',
  severity: 'INFO',
  httpStatus: 200,
  correlationId: null,
  accessToken: 'secret-access-token-must-not-render',
  requestBody: '{"private":"must-not-render"}',
  lineUserId: 'U-deadbeef_should_never_render',
  stack: 'Error: secret stack must not render',
  headers: { authorization: 'Bearer secret-must-not-render' },
};

export const MALFORMED_ACTIVITY_ROWS: unknown[] = [
  null,
  'not-an-object',
  { id: 'opw-act-bad-1' },
  { id: 'opw-act-bad-2', occurredAt: 'เมื่อวาน', action: 'REPLY' },
  { id: 'opw-act-bad-3', occurredAt: '2026-10-06T11:00:00.000+07:00', action: 'HACK_THE_PLANET' },
];

export const MALFORMED_LOG_ROWS: unknown[] = [
  null,
  42,
  { id: 'opw-log-bad-1' },
  { id: 'opw-log-bad-2', loggedAt: '2026-10-06T11:00:00.000+07:00', code: 'X', severity: 'CRITICAL' },
];
