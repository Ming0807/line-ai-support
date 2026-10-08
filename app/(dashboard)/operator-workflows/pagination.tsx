import Link from 'next/link';
import type { OperatorPagination } from './state';

interface OperatorPagerProps {
  pagination: OperatorPagination;
  buildUrl: (targetPage: number) => string;
  label: string;
}

/**
 * Shared accessible pager: previous/next links preserve every valid filter
 * through buildUrl, the current page carries aria-current, and disabled ends
 * are non-focusable spans with aria-disabled. Counts always come from the
 * server pagination object, never from array length.
 */
export default function OperatorPager({ pagination, buildUrl, label }: OperatorPagerProps) {
  return (
    <nav className="opw-pager" aria-label={label}>
      <div className="opw-pager-controls">
        {pagination.hasPrevious ? (
          <Link className="opw-page-btn" href={buildUrl(pagination.page - 1)} aria-label="ไปยังหน้าก่อนหน้า">
            « ก่อนหน้า
          </Link>
        ) : (
          <span className="opw-page-btn is-disabled" aria-disabled="true">
            « ก่อนหน้า
          </span>
        )}
        <span className="opw-page-indicator" aria-current="page">
          หน้า {pagination.page} จาก {pagination.totalPages}
        </span>
        {pagination.hasNext ? (
          <Link className="opw-page-btn" href={buildUrl(pagination.page + 1)} aria-label="ไปยังหน้าถัดไป">
            ถัดไป »
          </Link>
        ) : (
          <span className="opw-page-btn is-disabled" aria-disabled="true">
            ถัดไป »
          </span>
        )}
      </div>
    </nav>
  );
}
