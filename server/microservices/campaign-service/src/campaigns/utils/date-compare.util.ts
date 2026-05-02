/**
 * Campaign dates are stored as DateTime; deadline/end should include the full calendar day chosen in the UI.
 */
export function endOfUtcDayForInstant(isoOrDate: string | Date): Date {
  const d = typeof isoOrDate === 'string' ? new Date(isoOrDate) : isoOrDate;
  if (Number.isNaN(d.getTime())) {
    return new Date(0);
  }
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 23, 59, 59, 999),
  );
}

/** True if `now` is on or before the end of the calendar day of `deadline` (UTC date parts). */
export function isOnOrBeforeDeadlineDay(deadline: string | Date, now: Date = new Date()): boolean {
  return now.getTime() <= endOfUtcDayForInstant(deadline).getTime();
}

/** True if `now` is after the end of the campaign endDate calendar day. */
export function isAfterCampaignEndDay(endDate: string | Date, now: Date = new Date()): boolean {
  return now.getTime() > endOfUtcDayForInstant(endDate).getTime();
}
