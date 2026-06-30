const DISQUALIFIED_REASON_LABELS: Record<string, string> = {
  POST_CREATED_BEFORE_CAMPAIGN_START: 'Post published before campaign start',
};

export function formatDisqualifiedReason(reason: string | null | undefined): string {
  if (!reason?.trim()) return 'Disqualified';
  return DISQUALIFIED_REASON_LABELS[reason] ?? reason;
}
