export interface DayNameInfo {
  key: string;
  label: string;
}

export interface IntakeBucketResult {
  dayCounts: Record<string, number>;
  dayNamesThai: DayNameInfo[];
  maxDayCount: number;
  bestDayKey: string | null;
  recentCount: number;
}

export const DAY_NAMES_THAI: DayNameInfo[] = [
  { key: 'Mon', label: 'จ' },
  { key: 'Tue', label: 'อ' },
  { key: 'Wed', label: 'พ' },
  { key: 'Thu', label: 'พฤ' },
  { key: 'Fri', label: 'ศ' },
  { key: 'Sat', label: 'ส' },
  { key: 'Sun', label: 'อา' },
];

/**
 * Calculates 7 rolling civil days intake distribution in Asia/Bangkok timezone.
 * Invariant: Must strictly enforce both lower bound (>= 7 days ago) and upper bound (<= referenceNow)
 * to exclude future dates and past dates outside the 7-day window.
 */
export function calculateIntakeBuckets(
  tickets: Array<{ created_at: string }>,
  referenceNow: Date = new Date(),
): IntakeBucketResult {
  const nowMs = referenceNow.getTime();
  const sevenDaysAgoMs = nowMs - (7 * 24 * 60 * 60 * 1000);

  const dayCounts: Record<string, number> = {
    Mon: 0,
    Tue: 0,
    Wed: 0,
    Thu: 0,
    Fri: 0,
    Sat: 0,
    Sun: 0,
  };

  const bangkokDayFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Bangkok',
    weekday: 'short',
  });

  let recentCount = 0;

  for (const t of tickets) {
    if (!t.created_at) continue;
    const time = new Date(t.created_at).getTime();
    // Exclude invalid dates, future dates (> nowMs), and dates older than 7 days (< sevenDaysAgoMs)
    if (!Number.isFinite(time) || time < sevenDaysAgoMs || time > nowMs) {
      continue;
    }

    recentCount += 1;
    try {
      const d = bangkokDayFormatter.format(new Date(time));
      if (dayCounts[d] !== undefined) {
        dayCounts[d] += 1;
      }
    } catch {
      // ignore date formatting errors
    }
  }

  const maxDayCount = Math.max(...Object.values(dayCounts), 1);
  const bestDayEntry = Object.entries(dayCounts).sort((a, b) => b[1] - a[1])[0];
  const bestDayKey = bestDayEntry && bestDayEntry[1] > 0 ? bestDayEntry[0] : null;

  return {
    dayCounts,
    dayNamesThai: DAY_NAMES_THAI,
    maxDayCount,
    bestDayKey,
    recentCount,
  };
}
