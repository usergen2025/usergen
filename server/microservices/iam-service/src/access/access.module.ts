import { Module } from '@nestjs/common';
import { AccessControlService } from './access-control.service';
import { AccessController } from './access.controller';
import { CommonModule } from '../common/common.module';

@Module({
  imports: [CommonModule],
  controllers: [AccessController],
  providers: [AccessControlService],
  exports: [AccessControlService],
})
export class AccessModule {}


