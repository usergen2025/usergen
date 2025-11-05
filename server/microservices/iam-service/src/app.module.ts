import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PermissionsModule } from './permissions/permissions.module';
import { RolesModule } from './roles/roles.module';
import { PoliciesModule } from './policies/policies.module';
import { AccessModule } from './access/access.module';
import { CommonModule } from './common/common.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [
        'microservices/iam-service/.env',
        '.env',
      ],
    }),
    CommonModule,
    PermissionsModule,
    RolesModule,
    PoliciesModule,
    AccessModule,
  ],
})
export class AppModule {}


