import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DatabaseModule } from '../database/database.module';
import { StorageModule } from '../storage/storage.module';
import { ProjectLogService } from './project-log.service';

@Global()
@Module({
  imports: [ConfigModule, DatabaseModule, StorageModule],
  providers: [ProjectLogService],
  exports: [ProjectLogService],
})
export class ProjectLogModule {}
