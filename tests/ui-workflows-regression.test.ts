import { describe, expect, it } from 'vitest';
import {
  calculateIntakeBuckets,
  DAY_NAMES_THAI,
} from '../app/(dashboard)/dashboard/intake-helper';
import {
  buildPageUrl,
  parsePageNumber,
  validateSearchQuery,
  parseCanonicalTicketQuery,
} from '../app/(dashboard)/tickets/ticket-helpers';

describe('UI Workflows & Data Truthfulness Regression Suite (Round 4)', () => {
  describe('Ticket pagination URL generation', () => {
    it('builds page URL preserving other search query parameters', () => {
      const currentParams = {
        q: 'ลงทะเบียน',
        department: 'dept-123',
        status: 'WAITING_STAFF',
        page: '1',
      };

      const page2Url = buildPageUrl(currentParams, 2);
      expect(page2Url).toContain('q=%E0%B8%A5%E0%B8%87%E0%B8%97%E0%B8%B0%E0%B9%80%E0%B8%9A%E0%B8%B5%E0%B8%A2%E0%B8%99');
      expect(page2Url).toContain('department=dept-123');
      expect(page2Url).toContain('status=WAITING_STAFF');
      expect(page2Url).toContain('page=2');

      // Page 1 should omit the redundant page=1 parameter
      const page1Url = buildPageUrl(currentParams, 1);
      expect(page1Url).not.toContain('page=');
    });
  });

  describe('Intake 7-Day Window Calculation in Asia/Bangkok (Production Helper)', () => {
    it('strictly excludes future dates and dates older than 7 days', () => {
      const referenceNow = new Date('2026-10-07T12:00:00+07:00');

      const tickets = [
        { created_at: '2026-10-07T08:00:00+07:00' }, // Today: in window
        { created_at: '2026-10-05T10:00:00+07:00' }, // 2 days ago: in window
        { created_at: '2026-10-01T08:00:00+07:00' }, // 6 days ago: in window
        { created_at: '2026-09-20T10:00:00+07:00' }, // 17 days ago: EXCLUDED (too old)
        { created_at: '2026-10-09T10:00:00+07:00' }, // Future date: EXCLUDED (> referenceNow)
      ];

      const result = calculateIntakeBuckets(tickets, referenceNow);

      expect(result.recentCount).toBe(3);
      expect(result.dayNamesThai).toEqual(DAY_NAMES_THAI);
      expect(result.maxDayCount).toBeGreaterThanOrEqual(1);
      expect(result.bestDayKey).not.toBeNull();
    });

    it('returns 0 counts when no tickets are in the 7-day window', () => {
      const referenceNow = new Date('2026-10-07T12:00:00+07:00');
      const tickets = [
        { created_at: '2026-09-01T08:00:00+07:00' },
      ];

      const result = calculateIntakeBuckets(tickets, referenceNow);
      expect(result.recentCount).toBe(0);
      expect(result.bestDayKey).toBeNull();
    });
  });

  describe('Ticket Query Canonical Validation (Round 5 - UX-R5-07 / UX-R5-08)', () => {
    it('parsePageNumber strictly accepts positive integers without leading zeros', () => {
      expect(parsePageNumber('1', 1000)).toBe(1);
      expect(parsePageNumber('42', 1000)).toBe(42);
      expect(parsePageNumber(5, 1000)).toBe(5);
      expect(parsePageNumber('1000', 1000)).toBe(1000);

      // Rejects leading zeros
      expect(parsePageNumber('01', 1000)).toBeNull();
      expect(parsePageNumber('007', 1000)).toBeNull();

      // Rejects non-digits and malformed numbers
      expect(parsePageNumber('1bad', 1000)).toBeNull();
      expect(parsePageNumber('abc', 1000)).toBeNull();
      expect(parsePageNumber('1.5', 1000)).toBeNull();
      expect(parsePageNumber(1.5, 1000)).toBeNull();

      // Rejects zero and negatives
      expect(parsePageNumber('0', 1000)).toBeNull();
      expect(parsePageNumber('-1', 1000)).toBeNull();
      expect(parsePageNumber(0, 1000)).toBeNull();
      expect(parsePageNumber(-5, 1000)).toBeNull();

      // Rejects numbers exceeding maximum
      expect(parsePageNumber('1001', 1000)).toBeNull();
      expect(parsePageNumber(1001, 1000)).toBeNull();
    });

    it('validateSearchQuery validates length and controls characters', () => {
      // Empty and undefined are valid
      expect(validateSearchQuery(undefined)).toEqual({ valid: true });
      expect(validateSearchQuery('')).toEqual({ valid: true, value: undefined });
      expect(validateSearchQuery('   ')).toEqual({ valid: true, value: undefined });

      // Valid search query trimmed
      expect(validateSearchQuery('  ลงทะเบียนเรียน  ')).toEqual({ valid: true, value: 'ลงทะเบียนเรียน' });

      // Rejects query exceeding 200 characters
      const longQuery = 'a'.repeat(201);
      const longResult = validateSearchQuery(longQuery);
      expect(longResult.valid).toBe(false);
      expect(longResult.error).toContain('ยาวเกิน 200 ตัวอักษร');

      // Rejects control characters
      const controlQuery = 'ข้อความ\u0000ลับ';
      const controlResult = validateSearchQuery(controlQuery);
      expect(controlResult.valid).toBe(false);
      expect(controlResult.error).toContain('อักขระควบคุม');
    });

    it('parseCanonicalTicketQuery validates all query parameters', () => {
      const validQuery = parseCanonicalTicketQuery({
        q: 'ทุนการศึกษา',
        page: '2',
        pageSize: '25',
        department: '11111111-1111-4111-8111-111111111111',
        status: 'WAITING_STAFF',
        priority: 'HIGH',
        from: '2026-01-01',
        to: '2026-06-30',
      });
      expect(validQuery.validationError).toBeUndefined();
      expect(validQuery.q).toBe('ทุนการศึกษา');
      expect(validQuery.page).toBe(2);
      expect(validQuery.pageSize).toBe(25);
      expect(validQuery.department).toBe('11111111-1111-4111-8111-111111111111');
      expect(validQuery.status).toBe('WAITING_STAFF');
      expect(validQuery.priority).toBe('HIGH');
      expect(validQuery.from).toBe('2026-01-01');
      expect(validQuery.to).toBe('2026-06-30');

      // Invalid date range error
      const invalidDates = parseCanonicalTicketQuery({
        from: '2026-12-31',
        to: '2026-01-01',
      });
      expect(invalidDates.validationError).toContain('ช่วงวันที่ไม่ถูกต้อง');
    });
  });

});
