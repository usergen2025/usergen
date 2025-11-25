import { Module } from '@nestjs/common';
import { PublicUrlService } from './public-url.service';

@Module({
  providers: [PublicUrlService],
  exports: [PublicUrlService],
})
export class StorageModule {}

