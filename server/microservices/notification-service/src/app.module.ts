import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { NotificationController } from './notification/notification.controller';
import { NotificationService } from './notification/notification.service';
import { EmailModule } from './email/email.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['../../.env.local', '../../.env', '.env.local', '.env'],
      expandVariables: true,
    }),
    EmailModule,
  ],
  controllers: [NotificationController],
  providers: [NotificationService],
})
export class AppModule {}

