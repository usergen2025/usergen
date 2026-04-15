import { Module, Global } from '@nestjs/common';
import { DatabaseModule } from './database/database.module';
import { LoggerModule } from './logger/logger.module';
import { RedisModule } from './redis/redis.module';

@Global()
@Module({
  imports: [
    DatabaseModule,
    LoggerModule,
    RedisModule,
  ],
  exports: [
    DatabaseModule,
    LoggerModule,
    RedisModule,
  ],
})
export class CommonModule {}
