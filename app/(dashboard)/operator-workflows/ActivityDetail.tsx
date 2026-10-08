'use client';

import { useEffect, useRef } from 'react';
import Link from 'next/link';
import type { ActivityItem } from './privacy';
import { formatBangkokDateTime,dialogTabTarget } from './state';

export function isEscapeKey(event: { key: string }): boolean {
  return event.key === 'Escape';
}

export function handleDialogKeyDown(event: { key: string }, onEscape: () => void): void {
  if (isEscapeKey(event)) onEscape();
}

interface ActivityDetailProps {
  item: ActivityItem;
  titleId: string;
  onClose: () => void;
  onReturnFocus: () => void;
}

/**
 * Accessible activity detail dialog: labelled title, Escape closes, focus
 * moves into the dialog on open and returns to the invoking control on close,
 * Tab cycles inside while open. Content is safe text nodes only; the only
 * navigation is the section-level ticket list link because fixture rows carry
 * no validated internal ticket route IDs.
 */
export default function ActivityDetail({ item, titleId, onClose, onReturnFocus }: ActivityDetailProps) {
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
          <h2 id={titleId}>รายละเอียดกิจกรรม {item.ticketCode ?? 'ไม่ระบุรหัส'}</h2>
          <button type="button" className="opw-dialog-close" onClick={onClose} aria-label="ปิดรายละเอียด">
            ปิด ✕
          </button>
        </div>
        <dl className="opw-facts">
          <div>
            <dt>เวลา</dt>
            <dd>{formatBangkokDateTime(item.occurredAt)}</dd>
          </div>
          <div>
            <dt>กิจกรรม</dt>
            <dd>{item.actionLabel}</dd>
          </div>
          <div>
            <dt>ผู้ดำเนินการ</dt>
            <dd>{item.actorDisplayName ?? 'ไม่ระบุ'}</dd>
          </div>
          <div>
            <dt>หน่วยงาน</dt>
            <dd>{item.departmentLabel ?? 'ไม่ระบุ'}</dd>
          </div>
          <div>
            <dt>รหัสคำร้อง</dt>
            <dd>{item.ticketCode ?? 'ไม่ระบุ'}</dd>
          </div>
        </dl>
        <p className="opw-dialog-summary">{item.summary}</p>
        <Link className="opw-btn opw-btn-secondary" href="/tickets">
          ไปหน้างานรับเรื่อง
        </Link>
      </div>
    </div>
  );
}
