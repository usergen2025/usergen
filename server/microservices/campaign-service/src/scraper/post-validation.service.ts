import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Campaign } from '@prisma/client';
import { ApifyReelResult, ScrapeResultStatus } from './apify.types';
import { startOfIstDay } from '../campaigns/utils/date-compare.util';

export type ValidationOutcome =
  | { ok: true; scrape: ApifyReelResult }
  | { ok: false; reason: ScrapeResultStatus; detail: string };

@Injectable()
export class PostValidationService {
  constructor(private readonly configService: ConfigService) {}

  /** When false, reel publish date vs campaign start is not enforced (dev/testing). */
  isPostDateCheckEnabled(): boolean {
    const raw = this.configService.get<string>('CAMPAIGN_ENFORCE_POST_DATE_CHECKS', 'true');
    return !/^(false|0|off|no)$/i.test(String(raw ?? '').trim());
  }

  validate(
    campaign: Pick<Campaign, 'startDate' | 'actualStartDate'>,
    scrape: ApifyReelResult | null | undefined,
  ): ValidationOutcome {
    if (!scrape) {
      return { ok: false, reason: 'NOT_FOUND', detail: 'No data returned from Instagram for this URL' };
    }
    if (scrape.error || scrape.errorDescription) {
      const msg = scrape.errorDescription || scrape.error || 'Scrape error';
      if (/private|not found|404|unavailable/i.test(msg)) {
        return { ok: false, reason: 'PRIVATE', detail: msg };
      }
      return { ok: false, reason: 'ERROR', detail: msg };
    }
    if (!scrape.timestamp) {
      return { ok: false, reason: 'ERROR', detail: 'Missing post timestamp from scrape result' };
    }
    const postDate = new Date(scrape.timestamp);
    if (Number.isNaN(postDate.getTime())) {
      return { ok: false, reason: 'ERROR', detail: 'Invalid post timestamp from scrape result' };
    }
    if (this.isPostDateCheckEnabled()) {
      const effectiveStartDate = campaign.actualStartDate
        ? new Date(campaign.actualStartDate)
        : startOfIstDay(campaign.startDate);
      if (postDate < effectiveStartDate) {
        return {
          ok: false,
          reason: 'PRE_CAMPAIGN',
          detail: `Post was published ${postDate.toISOString()} before campaign start ${effectiveStartDate.toISOString()}`,
        };
      }
    }
    return { ok: true, scrape };
  }
}
