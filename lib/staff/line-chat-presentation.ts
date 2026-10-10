import type { LineMessage } from '../line/delivery';

export interface StaffChatButton {
  label: string;
  data: string;
}

export interface StaffQueueRow {
  code: string;
  status: string;
  pendingCount: number;
  privateOnly: boolean;
  action: StaffChatButton;
}

const INVALID_INPUT = 'STAFF_CHAT_PRESENTATION_INVALID';
const MAX_TEXT = 5000;
const MAX_BUTTONS = 13;
const MAX_QUEUE_ROWS = 5;

function validButton(button: StaffChatButton): boolean {
  return typeof button?.label === 'string'
    && button.label.length >= 1
    && button.label.length <= 20
    && typeof button.data === 'string'
    && button.data.length >= 1
    && button.data.length <= 300;
}

function makeMessage(text: string, buttons: readonly StaffChatButton[] = []): LineMessage {
  if (typeof text !== 'string' || text.length < 1 || text.length > MAX_TEXT
    || !Array.isArray(buttons) || buttons.length > MAX_BUTTONS || buttons.some((button) => !validButton(button))) {
    throw new Error(INVALID_INPUT);
  }

  return {
    type: 'text',
    text,
    ...(buttons.length > 0
      ? {
        quickReply: {
          items: buttons.map(({ label, data }) => ({
            type: 'action' as const,
            action: { type: 'postback' as const, label, data },
          })),
        },
      }
      : {}),
  };
}

function requireText(value: unknown, maxLength = 200): asserts value is string {
  if (typeof value !== 'string' || value.length < 1 || value.length > maxLength) throw new Error(INVALID_INPUT);
}

function requireCount(value: unknown, allowZero: boolean): asserts value is number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < (allowZero ? 0 : 1)) {
    throw new Error(INVALID_INPUT);
  }
}

export function parseStaffChatControl(text: string): 'MY_CASES' | 'DEPARTMENT_QUEUE' | 'STOP' | null {
  if (typeof text !== 'string') return null;
  const command = text.trim();
  if (command === 'งานของฉัน' || command === '/cases') return 'MY_CASES';
  if (command === 'คิวฝ่าย' || command === '/queue') return 'DEPARTMENT_QUEUE';
  if (command === 'หยุดคุย' || command === '/stop') return 'STOP';
  return null;
}

export function staffChatMessage(text: string, buttons: readonly StaffChatButton[] = []): LineMessage {
  return makeMessage(text, buttons);
}

export function formatStaffQueue(input: {
  title: string;
  total: number;
  page: number;
  rows: readonly StaffQueueRow[];
  buttons: readonly StaffChatButton[];
}): LineMessage[] {
  requireText(input?.title, 80);
  requireCount(input.total, true);
  requireCount(input.page, false);
  if (!Array.isArray(input.rows) || !Array.isArray(input.buttons)) throw new Error(INVALID_INPUT);

  const rows = input.rows.slice(0, MAX_QUEUE_ROWS);
  const actions = rows.map((row) => {
    if (!row || typeof row !== 'object' || typeof row.privateOnly !== 'boolean') throw new Error(INVALID_INPUT);
    requireText(row.action?.label, 20);
    requireText(row.action?.data, 300);
    if (typeof row.pendingCount !== 'number' || !Number.isSafeInteger(row.pendingCount) || row.pendingCount < 0) {
      throw new Error(INVALID_INPUT);
    }
    if (!row.privateOnly) {
      requireText(row.code, 100);
      requireText(row.status, 100);
    }
    return row.action;
  });
  const allButtons = [...actions, ...input.buttons];
  if (allButtons.length > MAX_BUTTONS) throw new Error(INVALID_INPUT);
  // Validate every supplied control, including those that would otherwise be hidden by a bad count.
  if (input.buttons.some((button) => !validButton(button))) throw new Error(INVALID_INPUT);

  const lines = [`${input.title} — ทั้งหมด ${input.total} เคส · หน้า ${input.page}`];
  if (rows.length === 0) {
    lines.push(input.total === 0 ? 'ตอนนี้ไม่มีงานในรายการ' : 'ไม่พบงานในหน้านี้');
  } else {
    rows.forEach((row,index) => {
      if (row.privateOnly) {
        lines.push(`${index+1}. มีเคสที่จำกัดการแสดงรายละเอียด`);
      } else {
        lines.push(`${index+1}. ${row.code} · ${row.status} · ข้อความใหม่จากผู้ใช้ ${row.pendingCount}`);
      }
    });
    if (input.total > rows.length) lines.push(`แสดง ${rows.length} เคสจากทั้งหมด ${input.total} เคส`);
  }

  return [makeMessage(lines.join('\n'), allButtons)];
}

function safePrefix(text: string, maxUnits: number): string {
  const prefix = text.slice(0, maxUnits);
  if (prefix.length === 0) return '';
  const last = prefix.charCodeAt(prefix.length - 1);
  return last >= 0xd800 && last <= 0xdbff ? prefix.slice(0, -1) : prefix;
}

export function formatStaffCase(input: {
  code: string;
  messages: readonly { text: string }[];
  hasOlder: boolean;
  buttons: readonly StaffChatButton[];
}): LineMessage[] {
  requireText(input?.code, 100);
  if (!Array.isArray(input.messages) || typeof input.hasOlder !== 'boolean' || !Array.isArray(input.buttons)) {
    throw new Error(INVALID_INPUT);
  }
  if (input.buttons.length > MAX_BUTTONS || input.buttons.some((button) => !validButton(button))) throw new Error(INVALID_INPUT);

  const transcriptCapacity = 4;
  const selected = input.messages.slice(-transcriptCapacity);
  let omitted = input.hasOlder || input.messages.length > selected.length;
  const transcript:string[]=[];
  for(const entry of selected){
    if (!entry || typeof entry.text !== 'string') throw new Error(INVALID_INPUT);
    const prefix = `เคส ${input.code} · ข้อความจากผู้ใช้:\n`;
    const marker = '\n…ตัดข้อความบางส่วนเพื่อแสดงใน LINE';
    const available = MAX_TEXT - prefix.length;
    let remaining=entry.text||'(ไม่มีเนื้อหาข้อความ)';
    while(remaining.length&&transcript.length<transcriptCapacity){
      const lastFrame=transcript.length===transcriptCapacity-1;
      if(lastFrame&&remaining.length>available){
        transcript.push(prefix+safePrefix(remaining,available-marker.length)+marker);omitted=true;remaining='';
      }else{
        const body=safePrefix(remaining,available);transcript.push(prefix+body);remaining=remaining.slice(body.length);
      }
    }
    if(remaining.length)omitted=true;
  }

  const footerLines = [`กำลังคุยเคส ${input.code}`];
  if (omitted) footerLines.push('มีข้อความเก่ากว่านี้ ข้อความเพิ่มเติม หรือข้อความที่ตัดบางส่วน อ่านทั้งหมดใน Dashboard');
  if (transcript.length === 0) footerLines.push('ไม่มีข้อความใหม่ที่ยังไม่ได้รับทราบ อ่านประวัติทั้งหมดได้ใน Dashboard');
  const footer = footerLines.join('\n');
  const result = transcript.map((text) => makeMessage(text));
  result.push(makeMessage(footer, input.buttons));
  return result;
}

export function formatStaffReceipt(input: { text: string; buttons: readonly StaffChatButton[] }): LineMessage[] {
  return [makeMessage(input.text, input.buttons)];
}
