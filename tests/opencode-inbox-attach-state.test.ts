import { describe, expect, it } from 'vitest';
import {
  OUTBOUND_MAX_BYTES,
  buildOutboundConfirmBody,
  buildOutboundUploadHeaders,
  canShowOutboundAttachControl,
  computeSha256Hex,
  encodeOutboundFileNameHeader,
  extractSafeErrorCode,
  formatOutboundFileSize,
  mapOutboundConfirmError,
  mapOutboundRevokeError,
  mapOutboundUploadError,
  normalizeOutboundMimeType,
  outboundMimeLabel,
  parseOutboundConfirmResult,
  parseOutboundRevokeResult,
  parseOutboundUploadResult,
  readOutboundAttachment,
  readOutboundFilesEnabled,
  studentAccessLabel,
  validateOutboundFileMeta,
} from '@/app/(dashboard)/tickets/[id]/chat-outbound-state';

const ticketId = '11111111-1111-4111-8111-111111111111';
const attachmentId = '22222222-2222-4222-8222-222222222222';
const requestId = '33333333-3333-4333-8333-333333333333';

describe('outbound file client validation and SHA-256', () => {
  it('accepts only PDF, JPEG, and PNG between 1 byte and 10 MiB (10,485,760)', () => {
    expect(OUTBOUND_MAX_BYTES).toBe(10_485_760);
    expect(normalizeOutboundMimeType('application/pdf')).toBe('application/pdf');
    expect(normalizeOutboundMimeType('IMAGE/JPEG; charset=utf-8')).toBe('image/jpeg');
    expect(normalizeOutboundMimeType('image/png')).toBe('image/png');
    expect(normalizeOutboundMimeType('text/plain')).toBeNull();
    expect(normalizeOutboundMimeType('application/octet-stream')).toBeNull();
    expect(normalizeOutboundMimeType('')).toBeNull();

    expect(validateOutboundFileMeta({ name: 'ok.pdf', type: 'application/pdf', size: 1 })).toEqual({
      ok: true, mimeType: 'application/pdf', size: 1, name: 'ok.pdf',
    });
    expect(validateOutboundFileMeta({ name: 'max.png', type: 'image/png', size: 10_485_760 }).ok).toBe(true);

    const zero = validateOutboundFileMeta({ name: 'empty.pdf', type: 'application/pdf', size: 0 });
    expect(zero.ok).toBe(false);
    if (!zero.ok) expect(zero.code).toBe('EMPTY_FILE');

    const over = validateOutboundFileMeta({ name: 'big.jpg', type: 'image/jpeg', size: 10_485_761 });
    expect(over.ok).toBe(false);
    if (!over.ok) expect(over.code).toBe('TOO_LARGE');

    const badType = validateOutboundFileMeta({ name: 'script.svg', type: 'image/svg+xml', size: 256 });
    expect(badType.ok).toBe(false);
    if (!badType.ok) expect(badType.code).toBe('UNSUPPORTED_TYPE');
  });

  it('computes lowercase 64-hex SHA-256 digest from bytes', async () => {
    const bytes = new TextEncoder().encode('yru-outbound-test-bytes');
    const digest = await computeSha256Hex(bytes);
    expect(digest).toMatch(/^[a-f0-9]{64}$/);
    const emptyDigest = await computeSha256Hex(new Uint8Array(0));
    expect(emptyDigest).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });

  it('builds exact upload headers without Content-Length and percent-encodes Thai file names', () => {
    const headers = buildOutboundUploadHeaders({
      contentType: 'application/pdf',
      requestId,
      revision: 12,
      fileName: 'ใบคำร้อง พิเศษ.pdf',
      sha256: 'A'.repeat(64),
    });
    expect(headers).toEqual({
      'Content-Type': 'application/pdf',
      'X-Yru-Request-Id': requestId,
      'X-Yru-Ticket-Revision': '12',
      'X-Yru-File-Name': encodeURIComponent('ใบคำร้อง พิเศษ.pdf'),
      'X-Yru-Content-SHA256': 'a'.repeat(64),
    });
    expect(Object.keys(headers).some(key => key.toLowerCase() === 'content-length')).toBe(false);
  });

  it('caps huge filenames safely within header limits without breaking UTF-8', () => {
    const longThai = 'ก'.repeat(400) + '.pdf';
    const encoded = encodeOutboundFileNameHeader(longThai);
    expect(encoded.length).toBeLessThanOrEqual(1080);
    expect(() => decodeURIComponent(encoded)).not.toThrow();
  });
});

describe('outbound confirm payload and strict DTO parsers', () => {
  it('builds strict confirm JSON with exact 3 keys only', () => {
    const payload = buildOutboundConfirmBody({ requestId, revision: 9, ticketNo: 'YRU-20260001' });
    expect(Object.keys(payload)).toEqual(['requestId', 'revision', 'ticketNo']);
    expect(payload).toEqual({ requestId, revision: 9, ticketNo: 'YRU-20260001' });
  });

  it('validates strict upload/confirm/revoke responses and 02H optional fields', () => {
    expect(parseOutboundUploadResult({ attachmentId, status: 'READY' })).toEqual({ attachmentId, status: 'READY' });
    expect(parseOutboundUploadResult({ attachmentId: 'not-uuid', status: 'READY' })).toBeNull();
    expect(parseOutboundUploadResult({ attachmentId, status: 'UPLOADING' })).toBeNull();
    expect(parseOutboundUploadResult(null)).toBeNull();

    expect(parseOutboundConfirmResult({
      attachmentId, messageId: '44444444-4444-4444-8444-444444444444', status: 'WAITING_USER', revision: 10,
    }, attachmentId)).toEqual({
      attachmentId, messageId: '44444444-4444-4444-8444-444444444444', status: 'WAITING_USER', revision: 10,
    });
    expect(parseOutboundConfirmResult({ attachmentId: ticketId, messageId: 'm-1', status: 'WAITING_USER', revision: 10 }, attachmentId)).toBeNull();
    expect(parseOutboundConfirmResult({ attachmentId, messageId: 'm-1', status: 'UNKNOWN_STATUS', revision: 10 }, attachmentId)).toBeNull();

    expect(parseOutboundRevokeResult({ attachmentId, revoked: true }, attachmentId)).toEqual({ attachmentId, revoked: true });
    expect(parseOutboundRevokeResult({ attachmentId, revoked: false }, attachmentId)).toBeNull();
    expect(parseOutboundRevokeResult({ attachmentId: ticketId, revoked: true }, attachmentId)).toBeNull();

    expect(readOutboundFilesEnabled(undefined)).toBe(false);
    expect(readOutboundFilesEnabled({ outboundFiles: { enabled: false } })).toBe(false);
    expect(readOutboundFilesEnabled({ outboundFiles: { enabled: true } })).toBe(true);

    expect(readOutboundAttachment({
      outboundAttachment: {
        id: attachmentId,
        name: 'guide.pdf',
        mimeType: 'application/pdf',
        size: 4096,
        studentAccess: 'AVAILABLE',
        canRevoke: true,
      },
    })).toEqual({
      id: attachmentId,
      name: 'guide.pdf',
      mimeType: 'application/pdf',
      size: 4096,
      studentAccess: 'AVAILABLE',
      canRevoke: true,
    });
    expect(readOutboundAttachment({ outboundAttachment: { id: attachmentId, studentAccess: 'BOGUS' } })).toBeNull();
  });
});

describe('Thai status, labels, visibility, and safe error mapping', () => {
  it('maps every studentAccess value to fixed Thai copy', () => {
    expect(studentAccessLabel('WAITING_DELIVERY').text).toBe('รอส่งถึง LINE');
    expect(studentAccessLabel('AVAILABLE').text).toBe('นักศึกษาเปิดได้');
    expect(studentAccessLabel('EXPIRED').text).toBe('หมดเวลาเปิด (30 วัน)');
    expect(studentAccessLabel('REVOKED').text).toBe('ถอนสิทธิ์แล้ว');
    expect(studentAccessLabel('NOT_DELIVERED').text).toBe('ส่งไม่สำเร็จ');
  });

  it('allows attach control ONLY when enabled, reply-permitted, HUMAN mode, and reply composer', () => {
    expect(canShowOutboundAttachControl({
      outboundFiles: { enabled: true }, canReply: true, ticketMode: 'HUMAN', composerKind: 'reply',
    })).toBe(true);
    expect(canShowOutboundAttachControl({
      outboundFiles: undefined, canReply: true, ticketMode: 'HUMAN', composerKind: 'reply',
    })).toBe(false);
    expect(canShowOutboundAttachControl({
      outboundFiles: { enabled: false }, canReply: true, ticketMode: 'HUMAN', composerKind: 'reply',
    })).toBe(false);
    expect(canShowOutboundAttachControl({
      outboundFiles: { enabled: true }, canReply: false, ticketMode: 'HUMAN', composerKind: 'reply',
    })).toBe(false);
    expect(canShowOutboundAttachControl({
      outboundFiles: { enabled: true }, canReply: true, ticketMode: 'AI', composerKind: 'reply',
    })).toBe(false);
    expect(canShowOutboundAttachControl({
      outboundFiles: { enabled: true }, canReply: true, ticketMode: 'HUMAN', composerKind: 'note',
    })).toBe(false);
  });

  it('maps server error codes to Thai copy without ever leaking raw server error text', () => {
    const rawSecret = 'RAW_PG_SELECT_FAILED_SECRET_XYZ';
    expect(extractSafeErrorCode({ error: rawSecret, message: 'leak' })).toBe(rawSecret);

    const uploadUnavail = mapOutboundUploadError(503, rawSecret);
    expect(uploadUnavail.retryableSameRequest).toBe(true);
    expect(uploadUnavail.message).not.toContain(rawSecret);
    expect(uploadUnavail.message).not.toContain('leak');

    expect(mapOutboundUploadError(409, 'DRAFT_FAILED').retryableSameRequest).toBe(false);
    expect(mapOutboundUploadError(409, 'STALE_LEASE').retryableSameRequest).toBe(false);
    expect(mapOutboundUploadError(409, 'CONFLICT').refreshThread).toBe(true);
    expect(mapOutboundUploadError(400, 'UNSUPPORTED_TYPE').message).toContain('PDF');
    expect(mapOutboundUploadError(413, 'TOO_LARGE').message).toContain('10 MiB');
    expect(mapOutboundUploadError(401, 'UNAUTHENTICATED').accessLossStatus).toBe(401);
    expect(mapOutboundUploadError(403, 'INVALID_ORIGIN').accessLossStatus).toBe(403);
    expect(mapOutboundUploadError(404, 'NOT_FOUND').accessLossStatus).toBe(404);

    const confirmConflict = mapOutboundConfirmError(409, 'CONFLICT');
    expect(confirmConflict.isConflict).toBe(true);
    expect(confirmConflict.refreshThread).toBe(true);
    expect(confirmConflict.retryableSameRequest).toBe(false);
    expect(mapOutboundConfirmError(409, 'INVALID_ACTION').message).toContain('โหมดตอบโดยเจ้าหน้าที่');
    expect(mapOutboundConfirmError('network', null).retryableSameRequest).toBe(true);
    expect(mapOutboundConfirmError(503, rawSecret).message).not.toContain(rawSecret);

    expect(mapOutboundRevokeError(503, rawSecret).message).not.toContain(rawSecret);
    expect(mapOutboundRevokeError(401, 'UNAUTHENTICATED').accessLossStatus).toBe(401);
    expect(mapOutboundRevokeError(404, 'NOT_FOUND').accessLossStatus).toBe(404);
  });

  it('formats sizes and MIME labels cleanly', () => {
    expect(formatOutboundFileSize(512)).toBe('512 B');
    expect(formatOutboundFileSize(2048)).toBe('2.0 KB');
    expect(formatOutboundFileSize(2 * 1024 * 1024)).toBe('2.00 MB');
    expect(outboundMimeLabel('application/pdf')).toEqual({ badge: 'PDF', label: 'เอกสาร PDF' });
    expect(outboundMimeLabel('image/jpeg')).toEqual({ badge: 'JPEG', label: 'รูปภาพ JPEG' });
    expect(outboundMimeLabel('image/png')).toEqual({ badge: 'PNG', label: 'รูปภาพ PNG' });
  });
});
