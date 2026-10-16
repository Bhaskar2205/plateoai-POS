import { Module } from '@nestjs/common';
import { AuditModule } from 'src/modules/audit/audit.module';
import { StaffController } from './staff.controller';
import { StaffService } from './staff.service';

@Module({
  imports: [AuditModule],
  controllers: [StaffController],
  providers: [StaffService],
})
export class StaffModule {}
