import { PostValidationService } from './post-validation.service';

describe('PostValidationService', () => {
  const service = new PostValidationService();
  const startDate = new Date('2026-01-01T00:00:00.000Z');
  const campaign = { startDate, actualStartDate: null as Date | null };

  it('rejects posts before campaign start', () => {
    const result = service.validate(
      campaign,
      { timestamp: '2025-12-29T13:13:40.000Z', videoPlayCount: 100 },
    );
    expect(result.ok).toBe(false);
    if (result.ok === false) {
      expect(result.reason).toBe('PRE_CAMPAIGN');
    }
  });

  it('accepts posts on or after campaign start', () => {
    const result = service.validate(
      campaign,
      { timestamp: '2026-01-02T00:00:00.000Z', videoPlayCount: 500 },
    );
    expect(result.ok).toBe(true);
  });

  it('returns NOT_FOUND when scrape is null', () => {
    const result = service.validate(campaign, null);
    expect(result.ok).toBe(false);
    if (result.ok === false) {
      expect(result.reason).toBe('NOT_FOUND');
    }
  });

  it('uses actualStartDate when set for validation', () => {
    const result = service.validate(
      { startDate, actualStartDate: new Date('2026-01-15T10:00:00.000Z') },
      { timestamp: '2026-01-10T00:00:00.000Z', videoPlayCount: 100 },
    );
    expect(result.ok).toBe(false);
    if (result.ok === false) {
      expect(result.reason).toBe('PRE_CAMPAIGN');
    }
  });
});
