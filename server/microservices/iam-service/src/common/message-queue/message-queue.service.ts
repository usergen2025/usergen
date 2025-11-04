import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as amqp from 'amqplib';

@Injectable()
export class MessageQueueService {
  private connection: amqp.Connection;
  private channel: amqp.Channel;

  constructor(private configService: ConfigService) {}

  async connect(): Promise<void> {
    try {
      this.connection = await amqp.connect(this.configService.get('RABBITMQ_URL'));
      this.channel = await this.connection.createChannel();
      
      console.log('Message queue connected');
    } catch (error) {
      console.error('Failed to connect to message queue:', error);
      throw error;
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
    try {
      await this.channel.assertExchange(exchange, 'topic', { durable: true });
      await this.channel.publish(exchange, routingKey, Buffer.from(JSON.stringify(message)));
    } catch (error) {
      console.error('Failed to publish message:', error);
      throw error;
    }
  }

  async consume(queue: string, callback: (message: any) => Promise<void>): Promise<void> {
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
      console.error('Failed to consume messages:', error);
      throw error;
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      return this.connection && !this.connection.connection.destroyed;
    } catch (error) {
      return false;
    }
  }
}
