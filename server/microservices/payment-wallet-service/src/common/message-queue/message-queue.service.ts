import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as amqp from 'amqplib';

/**
 * RabbitMQ client for publishing credit events.
 * Connection is established on bootstrap and/or lazily before publish.
 * Publish failures are non-fatal so HTTP handlers never fail after DB commits.
 */
@Injectable()
export class MessageQueueService {
  private readonly logger = new Logger(MessageQueueService.name);
  private connection: amqp.Connection | undefined;
  private channel: amqp.Channel | undefined;
  /** Dedupes concurrent connect attempts from parallel publishes */
  private connectInflight: Promise<void> | null = null;

  constructor(private configService: ConfigService) {}

  async connect(): Promise<void> {
    const url = this.configService.get<string>('RABBITMQ_URL');
    if (!url?.trim()) {
      this.logger.warn('RABBITMQ_URL is not set; message queue disabled');
      return;
    }
    if (this.channel) {
      return;
    }
    await this.connectWithUrl(url.trim());
  }

  private async connectWithUrl(url: string): Promise<void> {
    this.connection = await amqp.connect(url);
    this.channel = await this.connection.createChannel();
    this.logger.log('Message queue connected');
  }

  /**
   * Ensures a channel exists; swallows errors so callers can still complete.
   */
  private async ensureReady(): Promise<boolean> {
    if (this.channel) {
      return true;
    }
    const url = this.configService.get<string>('RABBITMQ_URL');
    if (!url?.trim()) {
      return false;
    }

    if (!this.connectInflight) {
      this.connectInflight = (async () => {
        try {
          await this.connectWithUrl(url.trim());
        } catch (err) {
          this.logger.error('Message queue connect failed', err instanceof Error ? err.stack : err);
        } finally {
          this.connectInflight = null;
        }
      })();
    }

    await this.connectInflight;
    return !!this.channel;
  }

  async disconnect(): Promise<void> {
    if (this.channel) {
      try {
        await this.channel.close();
      } catch {
        /* ignore */
      }
      this.channel = undefined;
    }
    if (this.connection) {
      try {
        await this.connection.close();
      } catch {
        /* ignore */
      }
      this.connection = undefined;
    }
  }

  async publish(exchange: string, routingKey: string, message: unknown): Promise<void> {
    try {
      const ok = await this.ensureReady();
      if (!ok || !this.channel) {
        this.logger.warn(
          `Message queue unavailable; skipping publish (${exchange} / ${routingKey})`,
        );
        return;
      }
      await this.channel.assertExchange(exchange, 'topic', { durable: true });
      this.channel.publish(exchange, routingKey, Buffer.from(JSON.stringify(message)));
    } catch (error) {
      this.logger.error(
        `Failed to publish message (non-fatal): ${exchange} / ${routingKey}`,
        error instanceof Error ? error.stack : error,
      );
    }
  }

  async consume(queue: string, callback: (message: unknown) => Promise<void>): Promise<void> {
    const ok = await this.ensureReady();
    if (!ok || !this.channel) {
      throw new Error('Message queue unavailable; cannot consume');
    }
    try {
      await this.channel.assertQueue(queue, { durable: true });
      await this.channel.consume(queue, async (msg) => {
        if (msg) {
          try {
            const content = JSON.parse(msg.content.toString());
            await callback(content);
            this.channel!.ack(msg);
          } catch (error) {
            this.logger.error('Failed to process message', error instanceof Error ? error.stack : error);
            this.channel!.nack(msg, false, false);
          }
        }
      });
    } catch (error) {
      this.logger.error('Failed to consume messages', error instanceof Error ? error.stack : error);
      throw error;
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      const conn = this.connection as { connection?: { destroyed?: boolean } } | undefined;
      return !!this.connection && !conn?.connection?.destroyed;
    } catch {
      return false;
    }
  }
}
