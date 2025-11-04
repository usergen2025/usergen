import { Module } from '@nestjs/common';
import { ScriptsController } from './scripts.controller';
import { ScriptsService } from './scripts.service';
import { LoggerModule } from '../common/logger/logger.module';

@Module({
  imports: [
    LoggerModule,
    // ConfigModule is global, no need to import it here
  ],
  controllers: [ScriptsController],
  providers: [ScriptsService],
  exports: [ScriptsService],
})
export class ScriptsModule {}
