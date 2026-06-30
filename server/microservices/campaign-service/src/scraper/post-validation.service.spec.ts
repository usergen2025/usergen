import { PostValidationService } from './post-validation.service';

describe('PostValidationService', () => {
  const startDate = new Date('2026-01-01T00:00:00.000Z');
  const campaign = { startDate, actualStartDate: null as Date | null };

  const build = (enforceDateChecks = true) => {
    const configService = {
      get: jest.fn((key: string, defaultValue?: string) => {
        if (key === 'CAMPAIGN_ENFORCE_POST_DATE_CHECKS') {
          return enforceDateChecks ? 'true' : 'false';
        }
        return defaultValue;
      }),
    };
    return new PostValidationService(configService as any);
  };

  it('rejects posts before campaign start when date checks enabled', () => {
    const service = build(true);
    const result = service.validate(
      campaign,
      { timestamp: '2025-12-29T13:13:40.000Z', videoPlayCount: 100 },
    );
    expect(result.ok).toBe(false);
    if (result.ok === false) {
      expect(result.reason).toBe('PRE_CAMPAIGN');
    }
  });

  it('accepts pre-campaign posts when date checks disabled', () => {
    const service = build(false);
    const result = service.validate(
      campaign,
      { timestamp: '2025-12-29T13:13:40.000Z', videoPlayCount: 100 },
    );
    expect(result.ok).toBe(true);
  });

  it('accepts posts on or after campaign start', () => {
    const service = build(true);
    const result = service.validate(
      campaign,
      { timestamp: '2026-01-02T00:00:00.000Z', videoPlayCount: 500 },
    );
    expect(result.ok).toBe(true);
  });

  it('returns NOT_FOUND when scrape is null', () => {
    const service = build(true);
    const result = service.validate(campaign, null);
    expect(result.ok).toBe(false);
    if (result.ok === false) {
      expect(result.reason).toBe('NOT_FOUND');
    }
  });

  it('uses actualStartDate when set for validation', () => {
    const service = build(true);
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
