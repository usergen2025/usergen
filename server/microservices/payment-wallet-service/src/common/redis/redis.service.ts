import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

@Injectable()
export class RedisService {
  private readonly redis: Redis;

  private connecting: Promise<void> | null = null;

  constructor(private configService: ConfigService) {
    this.redis = new Redis(this.configService.get('REDIS_URL') || 'redis://localhost:6379', {
      enableReadyCheck: false,
      maxRetriesPerRequest: null,
      lazyConnect: true,
    });

    this.redis.on('connect', () => {
      console.log('Redis connected');
    });

    this.redis.on('error', (error) => {
      console.error('Redis error:', error);
    });
  }

  private async ensureConnected() {
    if (this.redis.status === 'ready' || this.redis.status === 'connecting') return;
    if (!this.connecting) {
      this.connecting = this.redis.connect().catch((err) => {
        this.connecting = null;
        throw err;
      });
    }
    await this.connecting;
  }

  async get(key: string): Promise<string | null> {
    await this.ensureConnected();
    return this.redis.get(key);
  }

  async set(key: string, value: string, ttl?: number): Promise<void> {
    await this.ensureConnected();
    if (ttl) {
      await this.redis.setex(key, ttl, value);
    } else {
      await this.redis.set(key, value);
    }
  }

  async del(key: string): Promise<void> {
    await this.redis.del(key);
  }

  async exists(key: string): Promise<boolean> {
    const result = await this.redis.exists(key);
    return result === 1;
  }

  async expire(key: string, seconds: number): Promise<void> {
    await this.redis.expire(key, seconds);
  }

  async ttl(key: string): Promise<number> {
    return this.redis.ttl(key);
  }

  async incr(key: string): Promise<number> {
    return this.redis.incr(key);
  }

  async decr(key: string): Promise<number> {
    return this.redis.decr(key);
  }

  async healthCheck(): Promise<boolean> {
    try {
      await this.redis.ping();
      return true;
    } catch (error) {
      return false;
    }
  }

  async disconnect(): Promise<void> {
    await this.redis.disconnect();
  }
}
