import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as amqp from 'amqplib';

@Injectable()
export class MessageQueueService implements OnModuleInit, OnModuleDestroy {
  private connection: amqp.Connection;
  private channel: amqp.Channel;
  private isConnected: boolean = false;

  constructor(private configService: ConfigService) {}

  async onModuleInit() {
    await this.connect();
  }

  async onModuleDestroy() {
    await this.disconnect();
  }

  async connect(): Promise<void> {
    try {
      const rabbitmqUrl = this.configService.get<string>('RABBITMQ_URL', 'amqp://guest:guest@localhost:5672');
      this.connection = await amqp.connect(rabbitmqUrl);
      this.channel = await this.connection.createChannel();
      this.isConnected = true;
      
      console.log('Message queue connected');
    } catch (error) {
      console.warn('Failed to connect to message queue (continuing without it):', error.message);
      this.isConnected = false;
      // Don't throw - allow service to continue without message queue
    }
  }

  async disconnect(): Promise<void> {
    if (this.channel) {
      await this.channel.close();
    }
    if (this.connection) {
      await this.connection.close();
    }
  }

  async publish(exchange: string, routingKey: string, message: any): Promise<void> {
    if (!this.isConnected || !this.channel) {
      console.warn('Message queue not connected, skipping message publish');
      return;
    }

    try {
      await this.channel.assertExchange(exchange, 'topic', { durable: true });
      await this.channel.publish(exchange, routingKey, Buffer.from(JSON.stringify(message)));
    } catch (error) {
      console.error('Failed to publish message:', error.message);
      // Don't throw - allow service to continue even if message publish fails
    }
  }

  async consume(queue: string, callback: (message: any) => Promise<void>): Promise<void> {
    if (!this.isConnected || !this.channel) {
      console.warn('Message queue not connected, cannot consume messages');
      return;
    }

    try {
      await this.channel.assertQueue(queue, { durable: true });
      await this.channel.consume(queue, async (msg) => {
        if (msg) {
          try {
            const content = JSON.parse(msg.content.toString());
            await callback(content);
            this.channel.ack(msg);
          } catch (error) {
            console.error('Failed to process message:', error);
            this.channel.nack(msg, false, false);
          }
        }
      });
    } catch (error) {
      console.error('Failed to consume messages:', error.message);
      // Don't throw - allow service to continue
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      return this.isConnected && this.connection && !this.connection.connection.destroyed;
    } catch (error) {
      return false;
    }
  }
}
