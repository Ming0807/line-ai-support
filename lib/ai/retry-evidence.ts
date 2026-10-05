export type RetryEvidence = {
  source: 'RETRY_AFTER';
  observedAt: string;
  retryAt: string;
};

const MAX_RETRY_AFTER_LENGTH = 128;
const MAX_RETRY_WAIT_MS = 24 * 60 * 60 * 1_000;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const SHORT_WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const LONG_WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

type DateParts = {
  weekday: string;
  weekdayNames: readonly string[];
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
};

function dateFromParts(parts: DateParts): number | undefined {
  if (
    parts.month < 1 || parts.month > 12 ||
    parts.day < 1 || parts.day > 31 ||
    parts.hour > 23 || parts.minute > 59 || parts.second > 60
  ) {
    return undefined;
  }

  const date = new Date(0);
  date.setUTCFullYear(parts.year, parts.month - 1, parts.day);
  date.setUTCHours(parts.hour, parts.minute, Math.min(parts.second, 59), 0);

  if (
    date.getUTCFullYear() !== parts.year ||
    date.getUTCMonth() !== parts.month - 1 ||
    date.getUTCDate() !== parts.day ||
    date.getUTCHours() !== parts.hour ||
    date.getUTCMinutes() !== parts.minute ||
    date.getUTCSeconds() !== Math.min(parts.second, 59) ||
    parts.weekdayNames[date.getUTCDay()] !== parts.weekday
  ) {
    return undefined;
  }

  return date.getTime() + (parts.second === 60 ? 1_000 : 0);
}

function compareDatePartsToUtc(parts: DateParts, year: number, date: Date): number {
  const candidate = [year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second];
  const boundary = [
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
    date.getUTCHours(),
    date.getUTCMinutes(),
    date.getUTCSeconds(),
  ];

  for (let index = 0; index < candidate.length; index += 1) {
    if (candidate[index] !== boundary[index]) {
      return candidate[index]! > boundary[index]! ? 1 : -1;
    }
  }

  return 0;
}

function expandRfc850Year(twoDigitYear: number, parts: DateParts, observedAtMs: number): number {
  const observedAt = new Date(observedAtMs);
  let year = Math.floor(observedAt.getUTCFullYear() / 100) * 100 + twoDigitYear;
  const fiftyYearsFromObservation = new Date(observedAtMs);
  fiftyYearsFromObservation.setUTCFullYear(fiftyYearsFromObservation.getUTCFullYear() + 50);

  if (compareDatePartsToUtc(parts, year, fiftyYearsFromObservation) > 0) {
    year -= 100;
  }

  return year;
}

function parseHttpDate(value: string, observedAtMs: number): number | undefined {
  const imfFixdate = /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun), ([0-9]{2}) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) ([0-9]{4}) ([0-9]{2}):([0-9]{2}):([0-9]{2}) GMT$/;
  const rfc850Date = /^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday), ([0-9]{2})-(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)-([0-9]{2}) ([0-9]{2}):([0-9]{2}):([0-9]{2}) GMT$/;
  const asctimeDate = /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) ([0-9]{2}| [0-9]) ([0-9]{2}):([0-9]{2}):([0-9]{2}) ([0-9]{4})$/;

  let match = imfFixdate.exec(value);
  if (match) {
    return dateFromParts({
      weekday: match[1]!,
      weekdayNames: SHORT_WEEKDAYS,
      day: Number(match[2]),
      month: MONTHS.indexOf(match[3]!) + 1,
      year: Number(match[4]),
      hour: Number(match[5]),
      minute: Number(match[6]),
      second: Number(match[7]),
    });
  }

  match = rfc850Date.exec(value);
  if (match) {
    const parts: DateParts = {
      weekday: match[1]!,
      weekdayNames: LONG_WEEKDAYS,
      day: Number(match[2]),
      month: MONTHS.indexOf(match[3]!) + 1,
      year: 0,
      hour: Number(match[5]),
      minute: Number(match[6]),
      second: Number(match[7]),
    };
    parts.year = expandRfc850Year(Number(match[4]), parts, observedAtMs);
    return dateFromParts(parts);
  }

  match = asctimeDate.exec(value);
  if (match) {
    return dateFromParts({
      weekday: match[1]!,
      weekdayNames: SHORT_WEEKDAYS,
      month: MONTHS.indexOf(match[2]!) + 1,
      day: Number(match[3]!.trim()),
      hour: Number(match[4]),
      minute: Number(match[5]),
      second: Number(match[6]),
      year: Number(match[7]),
    });
  }

  return undefined;
}

export function readRetryEvidence(
  httpStatus: number,
  headers: Headers,
  observedAtMs = Date.now(),
): RetryEvidence | undefined {
  if (!(httpStatus === 429 || (Number.isInteger(httpStatus) && httpStatus >= 500 && httpStatus <= 599))) {
    return undefined;
  }

  if (!Number.isSafeInteger(observedAtMs)) return undefined;
  const observedAt = new Date(observedAtMs);
  if (!Number.isFinite(observedAt.getTime())) return undefined;

  const fieldValue = headers.get('Retry-After');
  if (fieldValue === null) return undefined;
  const value = fieldValue.replace(/^[\t ]+|[\t ]+$/g, '');
  if (value.length === 0 || value.length > MAX_RETRY_AFTER_LENGTH) return undefined;

  let retryAtMs: number | undefined;
  if (/^[0-9]+$/.test(value)) {
    const delaySeconds = BigInt(value);
    const maximumDelaySeconds = BigInt(MAX_RETRY_WAIT_MS / 1_000);
    if (delaySeconds > maximumDelaySeconds) return undefined;
    retryAtMs = observedAtMs + Number(delaySeconds) * 1_000;
  } else {
    retryAtMs = parseHttpDate(value, observedAtMs);
  }

  if (
    retryAtMs === undefined ||
    !Number.isFinite(retryAtMs) ||
    retryAtMs < observedAtMs ||
    retryAtMs - observedAtMs > MAX_RETRY_WAIT_MS
  ) {
    return undefined;
  }

  const retryAt = new Date(retryAtMs);
  if (!Number.isFinite(retryAt.getTime())) return undefined;

  return {
    source: 'RETRY_AFTER',
    observedAt: observedAt.toISOString(),
    retryAt: retryAt.toISOString(),
  };
}
