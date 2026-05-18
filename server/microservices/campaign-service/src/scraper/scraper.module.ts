import { Module, forwardRef } from '@nestjs/common';
import { DatabaseModule } from '../common/database/database.module';
import { CampaignsModule } from '../campaigns/campaigns.module';
import { ApifyClientService } from './apify.client';
import { PostValidationService } from './post-validation.service';
import { PostScraperService } from './post-scraper.service';

@Module({
  imports: [DatabaseModule, forwardRef(() => CampaignsModule)],
  providers: [ApifyClientService, PostValidationService, PostScraperService],
  exports: [PostScraperService, ApifyClientService],
})
export class ScraperModule {}
