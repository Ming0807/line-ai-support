import type { ChatMessage, InboxThreadResult } from '@/types/inbox';
import { isTicketId, ticketStatusValues, type TicketActionResultView } from './chat-thread-state';

export const OUTBOUND_MAX_BYTES = 10 * 1024 * 1024; // 10 MiB (10,485,760 bytes)
export const OUTBOUND_ALLOWED_MIME_TYPES = ['application/pdf', 'image/jpeg', 'image/png'] as const;
export type OutboundAttachmentMimeType = (typeof OUTBOUND_ALLOWED_MIME_TYPES)[number];

export const STUDENT_ACCESS_VALUES = [
  'WAITING_DELIVERY',
  'AVAILABLE',
  'EXPIRED',
  'REVOKED',
  'NOT_DELIVERED',
] as const;
export type StudentAttachmentAccess = (typeof STUDENT_ACCESS_VALUES)[number];

export interface OutboundAttachmentView {
  id: string;
  name: string;
  mimeType: OutboundAttachmentMimeType;
  size: number;
  studentAccess: StudentAttachmentAccess;
  canRevoke: boolean;
}

export interface OutboundFilesCapability {
  enabled: boolean;
}

export type ChatMessageWithOutbound = ChatMessage & {
  outboundAttachment?: OutboundAttachmentView | null;
};

export type InboxThreadWithOutbound = Omit<InboxThreadResult, 'messages'> & {
  messages: ChatMessageWithOutbound[];
  outboundFiles?: OutboundFilesCapability;
};

export type OutboundUploadResult = { attachmentId: string; status: 'READY' };
export type OutboundConfirmResult = {
  attachmentId: string;
  messageId: string;
  status: TicketActionResultView['status'];
  revision: number;
};
export type OutboundRevokeResult = { attachmentId: string; revoked: true };

export function normalizeOutboundMimeType(rawType: string | null | undefined): OutboundAttachmentMimeType | null {
  if (typeof rawType !== 'string') return null;
  const normalized = rawType.split(';', 1)[0].trim().toLowerCase();
  if ((OUTBOUND_ALLOWED_MIME_TYPES as readonly string[]).includes(normalized)) {
    return normalized as OutboundAttachmentMimeType;
  }
  return null;
}

export type OutboundFileValidation =
  | { ok: true; mimeType: OutboundAttachmentMimeType; size: number; name: string }
  | { ok: false; code: 'UNSUPPORTED_TYPE' | 'EMPTY_FILE' | 'TOO_LARGE'; message: string };

export function validateOutboundFileMeta(input: { name: string; type: string; size: number }): OutboundFileValidation {
  const mimeType = normalizeOutboundMimeType(input.type);
  if (!mimeType) {
    return {
      ok: false,
      code: 'UNSUPPORTED_TYPE',
      message: 'รองรับเฉพาะไฟล์ PDF, JPEG หรือ PNG เท่านั้น',
    };
  }
  if (!Number.isInteger(input.size) || input.size < 1) {
    return {
      ok: false,
      code: 'EMPTY_FILE',
      message: 'ไฟล์ว่างเปล่า (0 ไบต์) ไม่สามารถอัปโหลดได้',
    };
  }
  if (input.size > OUTBOUND_MAX_BYTES) {
    return {
      ok: false,
      code: 'TOO_LARGE',
      message: 'ไฟล์มีขนาดเกิน 10 MiB (10,485,760 ไบต์) กรุณาเลือกไฟล์ที่เล็กกว่า',
    };
  }
  const trimmedName = input.name.trim();
  const fallbackName = mimeType === 'application/pdf' ? 'เอกสาร.pdf' : 'รูปภาพ';
  return { ok: true, mimeType, size: input.size, name: trimmedName || fallbackName };
}

export async function computeSha256Hex(bytes: ArrayBuffer | Uint8Array): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (typeof subtle?.digest !== 'function') {
    throw new Error('SHA256_UNAVAILABLE');
  }
  const buffer = bytes instanceof ArrayBuffer
    ? bytes
    : bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const digest = await subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

export function encodeOutboundFileNameHeader(name: string): string {
  const trimmed = name.trim() || 'attachment';
  // The server limit is 360 UTF-16 code units (JavaScript string length), so count units, and only cut
  // between code points so an emoji is never split into a lone surrogate.
  let candidate = '';
  for (const char of trimmed) {
    if (candidate.length + char.length > 360) break;
    candidate += char;
  }
  let encoded = encodeURIComponent(candidate);
  while (encoded.length > 1080 && candidate.length > 1) {
    const reduced = Array.from(candidate);
    reduced.pop();
    candidate = reduced.join('') || 'attachment';
    encoded = encodeURIComponent(candidate);
  }
  return encoded;
}

export function buildOutboundUploadHeaders(input: {
  contentType: OutboundAttachmentMimeType;
  requestId: string;
  revision: number;
  fileName: string;
  sha256: string;
}): Record<string, string> {
  return {
    'Content-Type': input.contentType,
    'X-Yru-Request-Id': input.requestId,
    'X-Yru-Ticket-Revision': String(input.revision),
    'X-Yru-File-Name': encodeOutboundFileNameHeader(input.fileName),
    'X-Yru-Content-SHA256': input.sha256.toLowerCase(),
  };
}

/** Strict 3-key JSON payload for POST .../confirm (never send extra keys). */
export function buildOutboundConfirmBody(input: {
  requestId: string;
  revision: number;
  ticketNo: string;
}): { requestId: string; revision: number; ticketNo: string } {
  return {
    requestId: input.requestId,
    revision: input.revision,
    ticketNo: input.ticketNo,
  };
}

export function canShowOutboundAttachControl(input: {
  outboundFiles?: OutboundFilesCapability | null;
  canReply: boolean;
  ticketMode: 'AI' | 'HUMAN' | string;
  composerKind: 'reply' | 'note';
}): boolean {
  return input.composerKind === 'reply'
    && input.canReply === true
    && input.ticketMode === 'HUMAN'
    && input.outboundFiles?.enabled === true;
}

export function formatOutboundFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${Math.trunc(bytes)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function outboundMimeLabel(mimeType: OutboundAttachmentMimeType): { badge: 'PDF' | 'JPEG' | 'PNG'; label: string } {
  if (mimeType === 'application/pdf') return { badge: 'PDF', label: 'เอกสาร PDF' };
  if (mimeType === 'image/jpeg') return { badge: 'JPEG', label: 'รูปภาพ JPEG' };
  return { badge: 'PNG', label: 'รูปภาพ PNG' };
}

export function studentAccessLabel(status: StudentAttachmentAccess): {
  text: string;
  tone: 'pending' | 'available' | 'expired' | 'revoked' | 'failed';
} {
  switch (status) {
    case 'WAITING_DELIVERY':
      return { text: 'รอส่งถึง LINE', tone: 'pending' };
    case 'AVAILABLE':
      return { text: 'นักศึกษาเปิดได้', tone: 'available' };
    case 'EXPIRED':
      return { text: 'หมดเวลาเปิด (30 วัน)', tone: 'expired' };
    case 'REVOKED':
      return { text: 'ถอนสิทธิ์แล้ว', tone: 'revoked' };
    case 'NOT_DELIVERED':
      return { text: 'ส่งไม่สำเร็จ', tone: 'failed' };
  }
}

/** Extract only a fixed-format error code token; raw server messages never leave to UI. */
export function extractSafeErrorCode(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const raw = (payload as Record<string, unknown>).error;
  if (typeof raw !== 'string') return null;
  return /^[A-Z0-9_]{2,64}$/u.test(raw) ? raw : null;
}

export function mapOutboundUploadError(
  status: number | 'network',
  errorCode: string | null,
): { retryableSameRequest: boolean; accessLossStatus: 401 | 403 | 404 | null; refreshThread: boolean; message: string } {
  if (status === 'network') {
    return {
      retryableSameRequest: true,
      accessLossStatus: null,
      refreshThread: false,
      message: 'การเชื่อมต่อขาดหายระหว่างอัปโหลด · กดลองอัปโหลดอีกครั้งเพื่อใช้คำขอเดิม',
    };
  }
  if (status === 401) {
    return {
      retryableSameRequest: false,
      accessLossStatus: 401,
      refreshThread: false,
      message: 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบอีกครั้ง',
    };
  }
  if (status === 403) {
    return {
      retryableSameRequest: false,
      accessLossStatus: 403,
      refreshThread: false,
      message: 'ไม่ได้รับอนุญาตให้อัปโหลดไฟล์ในเคสนี้',
    };
  }
  if (status === 404) {
    return {
      retryableSameRequest: false,
      accessLossStatus: 404,
      refreshThread: false,
      message: 'ไม่พบเคสนี้หรือยังไม่เปิดใช้งานการแนบไฟล์',
    };
  }
  if (status === 413 || errorCode === 'TOO_LARGE') {
    return {
      retryableSameRequest: false,
      accessLossStatus: null,
      refreshThread: false,
      message: 'ไฟล์มีขนาดเกิน 10 MiB ไม่สามารถอัปโหลดได้',
    };
  }
  if (status === 409) {
    if (errorCode === 'DRAFT_FAILED') {
      return {
        retryableSameRequest: false,
        accessLossStatus: null,
        refreshThread: false,
        message: 'การอัปโหลดร่างไฟล์ไม่สำเร็จ · กรุณาเลือกไฟล์ใหม่อีกครั้ง',
      };
    }
    if (errorCode === 'STALE_LEASE') {
      return {
        retryableSameRequest: false,
        accessLossStatus: null,
        refreshThread: false,
        message: 'หมดเวลาการอัปโหลดร่างไฟล์ · กรุณาเลือกไฟล์ใหม่อีกครั้ง',
      };
    }
    return {
      retryableSameRequest: false,
      accessLossStatus: null,
      refreshThread: true,
      message: 'เคสมีการเปลี่ยนแปลง · โหลดข้อมูลล่าสุดแล้ว กรุณาตรวจสอบก่อนเลือกไฟล์ใหม่อีกครั้ง',
    };
  }
  if (status === 400) {
    if (errorCode === 'UNSUPPORTED_TYPE') {
      return {
        retryableSameRequest: false,
        accessLossStatus: null,
        refreshThread: false,
        message: 'รองรับเฉพาะไฟล์ PDF, JPEG หรือ PNG เท่านั้น',
      };
    }
    if (errorCode === 'INVALID_ATTACHMENT') {
      return {
        retryableSameRequest: false,
        accessLossStatus: null,
        refreshThread: false,
        message: 'ไฟล์ไม่สมบูรณ์หรือไม่ผ่านการตรวจสอบรูปแบบไฟล์',
      };
    }
    return {
      retryableSameRequest: false,
      accessLossStatus: null,
      refreshThread: false,
      message: 'ข้อมูลคำขออัปโหลดไม่ถูกต้อง กรุณาตรวจสอบไฟล์แล้วลองใหม่',
    };
  }
  if (status >= 500) {
    return {
      retryableSameRequest: true,
      accessLossStatus: null,
      refreshThread: false,
      message: 'ระบบอัปโหลดยังไม่พร้อมหรือยืนยันผลไม่ได้ · กดลองอัปโหลดอีกครั้งเพื่อใช้คำขอเดิม',
    };
  }
  return {
    retryableSameRequest: false,
    accessLossStatus: null,
    refreshThread: false,
    message: 'ไม่สามารถอัปโหลดร่างไฟล์ได้ · กรุณาลองใหม่อีกครั้ง',
  };
}

export function mapOutboundConfirmError(
  status: number | 'network',
  errorCode: string | null,
): { retryableSameRequest: boolean; accessLossStatus: 401 | 403 | 404 | null; isConflict: boolean; refreshThread: boolean; message: string } {
  if (status === 'network') {
    return {
      retryableSameRequest: true,
      accessLossStatus: null,
      isConflict: false,
      refreshThread: false,
      message: 'การเชื่อมต่อขาดหาย ยังไม่ทราบผลการส่ง · กดยืนยันซ้ำด้วยคำขอเดิมได้',
    };
  }
  if (status === 401) {
    return {
      retryableSameRequest: false,
      accessLossStatus: 401,
      isConflict: false,
      refreshThread: false,
      message: 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบอีกครั้ง',
    };
  }
  if (status === 403) {
    return {
      retryableSameRequest: false,
      accessLossStatus: 403,
      isConflict: false,
      refreshThread: false,
      message: 'ไม่ได้รับอนุญาตให้ยืนยันส่งไฟล์ในเคสนี้',
    };
  }
  if (status === 404) {
    return {
      retryableSameRequest: false,
      accessLossStatus: 404,
      isConflict: false,
      refreshThread: false,
      message: 'ไม่พบร่างไฟล์หรือเคสนี้ หรือสิทธิ์ของคุณเปลี่ยนไป',
    };
  }
  if (status === 409) {
    if (errorCode === 'INVALID_ACTION') {
      return {
        retryableSameRequest: false,
        accessLossStatus: null,
        isConflict: true,
        refreshThread: true,
        message: 'เคสไม่อยู่ในโหมดตอบโดยเจ้าหน้าที่หรือสถานะไม่อนุญาตให้ส่ง · โหลดข้อมูลล่าสุดแล้ว กรุณาตรวจสอบอีกครั้ง',
      };
    }
    return {
      retryableSameRequest: false,
      accessLossStatus: null,
      isConflict: true,
      refreshThread: true,
      message: 'ข้อมูลเคส ผู้รับ หรือสิทธิ์เปลี่ยนแปลง · โหลดข้อมูลล่าสุดแล้ว กรุณาตรวจทานแล้วกดยืนยันส่งใหม่อีกครั้ง',
    };
  }
  if (status === 413 || errorCode === 'TOO_LARGE') {
    return {
      retryableSameRequest: false,
      accessLossStatus: null,
      isConflict: false,
      refreshThread: false,
      message: 'ข้อมูลคำขอยืนยันมีขนาดเกินกำหนด',
    };
  }
  if (status === 400) {
    return {
      retryableSameRequest: false,
      accessLossStatus: null,
      isConflict: false,
      refreshThread: false,
      message: 'ข้อมูลการยืนยันไม่ถูกต้อง กรุณาตรวจสอบข้อมูลล่าสุดแล้วลองอีกครั้ง',
    };
  }
  if (status >= 500) {
    return {
      retryableSameRequest: true,
      accessLossStatus: null,
      isConflict: false,
      refreshThread: false,
      message: 'ระบบยังยืนยันการส่งไม่ได้ · คำขอเดิมยังคงอยู่ กดยืนยันซ้ำด้วยคำขอเดิมได้',
    };
  }
  return {
    retryableSameRequest: false,
    accessLossStatus: null,
    isConflict: false,
    refreshThread: false,
    message: 'ไม่สามารถยืนยันส่งไฟล์ได้ในขณะนี้',
  };
}

export function mapOutboundRevokeError(
  status: number | 'network',
  errorCode: string | null,
): { retryable: boolean; accessLossStatus: 401 | 403 | 404 | null; refreshThread: boolean; message: string } {
  if (status === 'network') {
    return {
      retryable: true,
      accessLossStatus: null,
      refreshThread: false,
      message: 'การเชื่อมต่อขาดหายระหว่างถอนสิทธิ์ · กดยืนยันถอนสิทธิ์อีกครั้งได้',
    };
  }
  if (status === 401) {
    return {
      retryable: false,
      accessLossStatus: 401,
      refreshThread: false,
      message: 'เซสชันหมดอายุ กรุณาเข้าสู่ระบบอีกครั้ง',
    };
  }
  if (status === 403) {
    return {
      retryable: false,
      accessLossStatus: 403,
      refreshThread: false,
      message: 'ไม่ได้รับอนุญาตให้ถอนสิทธิ์ไฟล์นี้',
    };
  }
  if (status === 404) {
    return {
      retryable: false,
      accessLossStatus: 404,
      refreshThread: false,
      message: 'ไม่พบไฟล์นี้หรือสิทธิ์ของคุณเปลี่ยนไป',
    };
  }
  if (status === 400 || status === 409) {
    void errorCode;
    return {
      retryable: false,
      accessLossStatus: null,
      refreshThread: true,
      message: 'ไม่สามารถถอนสิทธิ์ไฟล์นี้ได้ในสถานะปัจจุบัน · กำลังโหลดข้อมูลล่าสุด',
    };
  }
  return {
    retryable: status >= 500,
    accessLossStatus: null,
    refreshThread: false,
    message: 'ระบบยังไม่สามารถถอนสิทธิ์ได้ในขณะนี้ · กรุณาลองอีกครั้ง',
  };
}

export function parseOutboundUploadResult(payload: unknown): OutboundUploadResult | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const record = payload as Record<string, unknown>;
  if (typeof record.attachmentId !== 'string' || !isTicketId(record.attachmentId)) return null;
  if (record.status !== 'READY') return null;
  return { attachmentId: record.attachmentId, status: 'READY' };
}

export function parseOutboundConfirmResult(
  payload: unknown,
  expectedAttachmentId: string,
): OutboundConfirmResult | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const record = payload as Record<string, unknown>;
  if (typeof record.attachmentId !== 'string' || record.attachmentId !== expectedAttachmentId) return null;
  if (typeof record.messageId !== 'string' || record.messageId.trim() === '') return null;
  if (typeof record.status !== 'string' || !(ticketStatusValues as readonly string[]).includes(record.status)) return null;
  if (typeof record.revision !== 'number' || !Number.isInteger(record.revision) || record.revision < 0) return null;
  return {
    attachmentId: record.attachmentId,
    messageId: record.messageId,
    status: record.status as TicketActionResultView['status'],
    revision: record.revision,
  };
}

export function parseOutboundRevokeResult(
  payload: unknown,
  expectedAttachmentId: string,
): OutboundRevokeResult | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const record = payload as Record<string, unknown>;
  if (typeof record.attachmentId !== 'string' || record.attachmentId !== expectedAttachmentId) return null;
  if (record.revoked !== true) return null;
  return { attachmentId: record.attachmentId, revoked: true };
}

export function readOutboundFilesEnabled(thread: unknown): boolean {
  if (!thread || typeof thread !== 'object' || Array.isArray(thread)) return false;
  const outboundFiles = (thread as Record<string, unknown>).outboundFiles;
  if (!outboundFiles || typeof outboundFiles !== 'object' || Array.isArray(outboundFiles)) return false;
  return (outboundFiles as Record<string, unknown>).enabled === true;
}

export function readOutboundAttachment(message: unknown): OutboundAttachmentView | null {
  if (!message || typeof message !== 'object' || Array.isArray(message)) return null;
  const raw = (message as Record<string, unknown>).outboundAttachment;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  if (typeof record.id !== 'string' || record.id.trim() === '') return null;
  if (typeof record.name !== 'string' || record.name.trim() === '') return null;
  const mimeType = normalizeOutboundMimeType(typeof record.mimeType === 'string' ? record.mimeType : null);
  if (!mimeType) return null;
  if (typeof record.size !== 'number' || !Number.isFinite(record.size) || record.size < 0) return null;
  if (typeof record.studentAccess !== 'string' || !(STUDENT_ACCESS_VALUES as readonly string[]).includes(record.studentAccess)) {
    return null;
  }
  if (typeof record.canRevoke !== 'boolean') return null;
  return {
    id: record.id,
    name: record.name,
    mimeType,
    size: record.size,
    studentAccess: record.studentAccess as StudentAttachmentAccess,
    canRevoke: record.canRevoke,
  };
}
