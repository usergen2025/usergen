import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApifyClient as ApifySdkClient } from 'apify-client';
import { ApifyReelResult, InstagramReelScraperInput } from './apify.types';

@Injectable()
export class ApifyClientService {
  private readonly logger = new Logger(ApifyClientService.name);
  private sdk: ApifySdkClient | null = null;

  constructor(private readonly configService: ConfigService) {}

  isConfigured(): boolean {
    return Boolean(this.configService.get<string>('APIFY_TOKEN'));
  }

  private getSdk(): ApifySdkClient {
    const token = this.configService.get<string>('APIFY_TOKEN');
    if (!token) {
      throw new ServiceUnavailableException('Apify is not configured (APIFY_TOKEN missing)');
    }
    if (!this.sdk) {
      this.sdk = new ApifySdkClient({ token });
    }
    return this.sdk;
  }

  getActorId(): string {
    return this.configService.get<string>('APIFY_ACTOR_ID') || 'apify/instagram-reel-scraper';
  }

  async scrapeReels(urls: string[]): Promise<{ items: ApifyReelResult[]; apifyRunId?: string }> {
    if (!urls.length) {
      return { items: [] };
    }
    const actorId = this.getActorId();
    const input: InstagramReelScraperInput = {
      username: urls,
      skipPinnedPosts: false,
      includeSharesCount: false,
      includeTranscript: false,
      includeDownloadedVideo: false,
    };
    this.logger.log(`Starting Apify actor ${actorId} for ${urls.length} reel URL(s)`);
    const client = this.getSdk();
    const run = await client.actor(actorId).call(input, {
      waitSecs: 300,
      memory: 2048,
    });
    const { items } = await client.dataset(run.defaultDatasetId).listItems();
    return {
      items: (items || []) as ApifyReelResult[],
      apifyRunId: run.id,
    };
  }
}
