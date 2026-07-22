import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from '../redis/redis.service';

const PREFIX = 'pmt:idem:';
const DEFAULT_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days

/**
 * Durable idempotency for money paths. Prefers Redis; falls back to process memory
 * if Redis is unavailable so local/dev still works.
 */
@Injectable()
export class IdempotencyService {
  private readonly logger = new Logger(IdempotencyService.name);
  private readonly memory = new Map<string, { value: string; expiresAt: number }>();

  constructor(private readonly redis: RedisService) {}

  async getJson<T>(key: string): Promise<T | null> {
    const full = PREFIX + key;
    try {
      const raw = await this.redis.get(full);
      if (raw) return JSON.parse(raw) as T;
    } catch (err: any) {
      this.logger.warn(`Redis get failed for idempotency, using memory: ${err?.message}`);
    }
    const mem = this.memory.get(full);
    if (!mem) return null;
    if (Date.now() > mem.expiresAt) {
      this.memory.delete(full);
      return null;
    }
    return JSON.parse(mem.value) as T;
  }

  async setJson(key: string, value: unknown, ttlSeconds = DEFAULT_TTL_SECONDS): Promise<void> {
    const full = PREFIX + key;
    const raw = JSON.stringify(value);
    try {
      await this.redis.set(full, raw, ttlSeconds);
    } catch (err: any) {
      this.logger.warn(`Redis set failed for idempotency, using memory: ${err?.message}`);
    }
    this.memory.set(full, { value: raw, expiresAt: Date.now() + ttlSeconds * 1000 });
  }
}
