import { Global, Module } from '@nestjs/common';
import { RedisModule } from '../redis/redis.module';
import { IdempotencyService } from './idempotency.service';

@Global()
@Module({
  imports: [RedisModule],
  providers: [IdempotencyService],
  exports: [IdempotencyService],
})
export class IdempotencyModule {}
