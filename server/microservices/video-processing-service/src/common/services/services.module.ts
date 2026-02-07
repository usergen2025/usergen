import { Module } from '@nestjs/common';
import { CompositeImageService } from './composite-image.service';
import { StorageModule } from '../storage/storage.module';

@Module({
  imports: [StorageModule],
  providers: [CompositeImageService],
  exports: [CompositeImageService],
})
export class ServicesModule {}

