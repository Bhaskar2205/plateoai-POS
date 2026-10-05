import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { IdempotencyKey } from './entities/idempotency-key.entity';
import { IdempotencyService } from './idempotency.service';

/**
 * Running an irreversible operation at most once.
 *
 * Global for the same reason as the audit module: the services that need it are
 * spread across ordering, billing and tables, and an endpoint that quietly lost
 * its protection because of a missing import is exactly the failure this is
 * meant to prevent.
 */
@Global()
@Module({
  imports: [TypeOrmModule.forFeature([IdempotencyKey])],
  providers: [IdempotencyService],
  exports: [IdempotencyService],
})
export class IdempotencyModule {}
