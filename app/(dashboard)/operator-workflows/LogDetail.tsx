'use client';

import { useEffect, useRef } from 'react';
import Link from 'next/link';
import type { LogItem } from './privacy';
import { LOG_SEVERITY_LABELS } from './privacy';
import { formatBangkokDateTime,dialogTabTarget } from './state';
import { handleDialogKeyDown } from './ActivityDetail';

interface LogDetailProps {
  item: LogItem;
  titleId: string;
  onClose: () => void;
  onReturnFocus: () => void;
}

/**
 * Accessible log detail dialog: same contract as activity detail — labelled
 * title, Escape closes, focus returns to the invoking row, Tab cycles inside.
 * Only allowlisted diagnostic fields render: code, severity label, component,
 * observed time, observed HTTP status when present, and the synthetic request
 * correlation ID. No raw JSON, bodies, headers, or tokens.
 */
export default function LogDetail({ item, titleId, onClose, onReturnFocus }: LogDetailProps) {
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const node = dialogRef.current;
    (node?.querySelector<HTMLElement>('button:not([disabled]), a[href]')??node)?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key !== 'Tab' || !node) return;
      const focusables = Array.from(
        node.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((el) => !el.hasAttribute('disabled') && el.getAttribute('aria-hidden') !== 'true');
      if (focusables.length === 0) {event.preventDefault();node.focus();return;}
      const first = focusables[0] as HTMLElement;
      const last = focusables[focusables.length - 1] as HTMLElement;
      const target=dialogTabTarget(event.shiftKey,document.activeElement===first,document.activeElement===last,document.activeElement===node||!node.contains(document.activeElement));
      if (target==='LAST') {
        event.preventDefault();
        last.focus();
      } else if (target==='FIRST') {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      onReturnFocus();
    };
  }, [onClose, onReturnFocus]);

  return (
    <div className="opw-dialog-backdrop">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="opw-dialog"
        onKeyDown={(event) => handleDialogKeyDown(event, onClose)}
      >
        <div className="opw-dialog-head">
          <h2 id={titleId}>รายละเอียดบันทึก {item.code}</h2>
          <button type="button" className="opw-dialog-close" onClick={onClose} aria-label="ปิดรายละเอียด">
            ปิด ✕
          </button>
        </div>
        <dl className="opw-facts">
          <div>
            <dt>รหัสเหตุการณ์</dt>
            <dd>{item.code}</dd>
          </div>
          <div>
            <dt>ระดับ</dt>
            <dd>{LOG_SEVERITY_LABELS[item.severity] ?? item.severity}</dd>
          </div>
          <div>
            <dt>คอมโพเนนต์</dt>
            <dd>{item.component}</dd>
          </div>
          <div>
            <dt>เวลาที่พบ</dt>
            <dd>{formatBangkokDateTime(item.loggedAt)}</dd>
          </div>
          <div>
            <dt>สถานะ HTTP ที่พบ</dt>
            <dd>{item.httpStatus ?? 'ไม่ระบุ'}</dd>
          </div>
          <div>
            <dt>รหัสอ้างอิงคำขอ</dt>
            <dd>{item.correlationId ?? 'ไม่ระบุ'}</dd>
          </div>
        </dl>
        <p className="opw-dialog-summary">{item.label}</p>
        <Link className="opw-btn opw-btn-secondary" href="/providers">
          ไปหน้าผู้ให้บริการ
        </Link>
      </div>
    </div>
  );
}
