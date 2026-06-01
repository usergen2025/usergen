import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { BrandVideoPostProcessorService } from './brand-video-post-processor.service';
import { BrandLogoResolverService } from './brand-logo-resolver.service';
import { BrandPackagingService } from './brand-packaging.service';
import { BrandPackagingProcessor } from './brand-packaging.processor';
import { BytePlusProvider } from '../rendering/providers/byteplus.provider';
import { StorageModule } from '../common/storage/storage.module';
import { DatabaseModule } from '../common/database/database.module';
import { WebSocketModule } from '../common/websocket/websocket.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { BullModule } from '@nestjs/bullmq';

@Module({
  imports: [
    ConfigModule,
    StorageModule,
    DatabaseModule,
    WebSocketModule,
    NotificationsModule,
    BullModule.registerQueue({ name: 'brand-packaging' }),
  ],
  providers: [
    BrandVideoPostProcessorService,
    BrandLogoResolverService,
    BrandPackagingService,
    BrandPackagingProcessor,
    BytePlusProvider,
  ],
  exports: [BrandVideoPostProcessorService, BrandLogoResolverService, BrandPackagingService],
})
export class BrandModule {}
