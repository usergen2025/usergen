import { Module } from '@nestjs/common';
import { ScriptsController } from './scripts.controller';
import { ScriptsService } from './scripts.service';
import { ScriptWebSearchService } from './script-web-search.service';
import { LoggerModule } from '../common/logger/logger.module';
import { StorageModule } from '../common/storage/storage.module';

@Module({
  imports: [
    LoggerModule,
    StorageModule,
    // ConfigModule is global, no need to import it here
  ],
  controllers: [ScriptsController],
  providers: [ScriptsService, ScriptWebSearchService],
  exports: [ScriptsService, ScriptWebSearchService],
})
export class ScriptsModule {}
