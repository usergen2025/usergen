import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { NotificationController } from './notification/notification.controller';
import { NotificationService } from './notification/notification.service';
import { EmailModule } from './email/email.module';
import { DatabaseModule } from './common/database/database.module';
import { InAppModule } from './in-app/in-app.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [
        'microservices/notification-service/.env',
        '.env',
      ],
      expandVariables: true,
    }),
    DatabaseModule,
    InAppModule,
    EmailModule,
  ],
  controllers: [NotificationController],
  providers: [NotificationService],
})
export class AppModule {}

