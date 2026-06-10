/**
 * Campaign dates are stored as DateTime; deadline/end should include the full calendar day
 * chosen in the UI. All day-boundary logic uses IST (UTC+5:30).
 */
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

function istDateParts(isoOrDate: string | Date): { year: number; month: number; day: number } {
  const d = typeof isoOrDate === 'string' ? new Date(isoOrDate) : isoOrDate;
  if (Number.isNaN(d.getTime())) {
    return { year: 1970, month: 0, day: 1 };
  }
  const istTime = d.getTime() + IST_OFFSET_MS;
  const istDate = new Date(istTime);
  return {
    year: istDate.getUTCFullYear(),
    month: istDate.getUTCMonth(),
    day: istDate.getUTCDate(),
  };
}

/** End of the IST calendar day (23:59:59.999 IST) for the date represented by `isoOrDate`. */
export function endOfIstDay(isoOrDate: string | Date): Date {
  const { year, month, day } = istDateParts(isoOrDate);
  // 23:59:59.999 IST = 18:29:59.999 UTC on the same civil date
  return new Date(Date.UTC(year, month, day, 18, 29, 59, 999));
}

/** Start of the IST calendar day (00:00:00.000 IST) for the date represented by `isoOrDate`. */
export function startOfIstDay(isoOrDate: string | Date): Date {
  const { year, month, day } = istDateParts(isoOrDate);
  // 00:00:00 IST = 18:30:00 UTC on the previous civil date
  return new Date(Date.UTC(year, month, day - 1, 18, 30, 0, 0));
}

/** @deprecated Use endOfIstDay for campaign deadline/end boundaries. */
export function endOfUtcDayForInstant(isoOrDate: string | Date): Date {
  return endOfIstDay(isoOrDate);
}

/** True if `now` is on or before the end of the IST calendar day of `deadline`. */
export function isOnOrBeforeDeadlineDay(deadline: string | Date, now: Date = new Date()): boolean {
  return now.getTime() <= endOfIstDay(deadline).getTime();
}

/** True if `now` is after the end of the campaign endDate IST calendar day. */
export function isAfterCampaignEndDay(endDate: string | Date, now: Date = new Date()): boolean {
  return now.getTime() > endOfIstDay(endDate).getTime();
}

/** True if `now` is on or after the start of the campaign startDate IST calendar day. */
export function isOnOrAfterCampaignStartDay(startDate: string | Date, now: Date = new Date()): boolean {
  return now.getTime() >= startOfIstDay(startDate).getTime();
}

/** Validate that startDate is at least one IST calendar day after deadlineToApply. */
export function isStartAtLeastOneDayAfterDeadline(
  deadlineToApply: string | Date,
  startDate: string | Date,
): boolean {
  const deadlineEnd = endOfIstDay(deadlineToApply);
  const earliestStart = startOfIstDay(
    new Date(deadlineEnd.getTime() + 24 * 60 * 60 * 1000),
  );
  const start = startOfIstDay(startDate);
  return start.getTime() >= earliestStart.getTime();
}
