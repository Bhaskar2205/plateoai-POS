import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from 'src/modules/users/entities/user.entity';
import { AuditController } from './audit.controller';
import { AuditQueryService } from './audit-query.service';
import { AuditService } from './audit.service';
import { AuditLog } from './entities/audit-log.entity';

/**
 * Recording what happened.
 *
 * Global because almost every module that changes something needs to write a
 * record, and threading an import through each of them would mean a module that
 * forgot the import silently stops being audited. Only the writer is exported;
 * reading the log goes through the controller, which is owner-only.
 */
@Global()
@Module({
  imports: [TypeOrmModule.forFeature([AuditLog, User])],
  controllers: [AuditController],
  providers: [AuditService, AuditQueryService],
  exports: [AuditService],
})
export class AuditModule {}
