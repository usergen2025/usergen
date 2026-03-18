import { Module } from '@nestjs/common';
import { UrlProcessingService } from './url-processing.service';
import { CheerioProvider } from './providers/cheerio.provider';
import { LoggerModule } from '../common/logger/logger.module';

@Module({
  imports: [LoggerModule],
  providers: [UrlProcessingService, CheerioProvider],
  exports: [UrlProcessingService],
})
export class UrlProcessingModule {}
