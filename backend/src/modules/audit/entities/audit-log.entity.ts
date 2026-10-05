import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { AuditAction, AuditEntity } from 'src/common/enums';

/**
 * One thing that happened, recorded as it happened.
 *
 * Append-only by design. There is no update or delete path anywhere in the
 * application: a log an operator can edit answers no question worth asking,
 * because the first thing anyone covering something up would edit is the log.
 * The only `createdAt` is written by the database.
 *
 * Records are deliberately small. They hold what changed and why, never the
 * whole object - a settled bill is already stored in full, and copying it here
 * would duplicate money figures that could then disagree with the bill.
 *
 * Financial actions write their record inside the same transaction as the change
 * itself, so a settlement that rolls back leaves no trace of having settled, and
 * a settlement that commits can never be missing from the log.
 */
@Entity('audit_logs')
@Index('IDX_audit_logs_restaurant_created', ['restaurantId', 'createdAt'])
@Index('IDX_audit_logs_restaurant_action', ['restaurantId', 'action'])
@Index('IDX_audit_logs_entity', ['restaurantId', 'entityType', 'entityId'])
export class AuditLog {
  @ApiProperty({ example: 1 })
  @PrimaryGeneratedColumn({ type: 'int', unsigned: true })
  id: number;

  @ApiProperty({ example: 1 })
  @Column({ type: 'int', unsigned: true, name: 'restaurant_id' })
  restaurantId: number;

  @ApiPropertyOptional({
    nullable: true,
    example: 4,
    description: 'Null when nobody was signed in - a diner ordering from a QR code.',
  })
  @Column({ type: 'int', unsigned: true, name: 'user_id', nullable: true })
  userId: number | null;

  @ApiProperty({ enum: AuditAction, example: AuditAction.BILL_SETTLED })
  @Column({ type: 'varchar', length: 40 })
  action: AuditAction;

  @ApiProperty({ enum: AuditEntity, example: AuditEntity.ORDER })
  @Column({ type: 'varchar', length: 24, name: 'entity_type' })
  entityType: AuditEntity;

  @ApiPropertyOptional({ nullable: true, example: 42 })
  @Column({ type: 'int', unsigned: true, name: 'entity_id', nullable: true })
  entityId: number | null;

  @ApiPropertyOptional({
    nullable: true,
    example: { discountValue: 10 },
    description: 'Only the fields that changed, never a whole record and never a credential.',
  })
  @Column({ type: 'json', name: 'old_value', nullable: true })
  oldValue: Record<string, unknown> | null;

  @ApiPropertyOptional({ nullable: true, example: { discountValue: 20 } })
  @Column({ type: 'json', name: 'new_value', nullable: true })
  newValue: Record<string, unknown> | null;

  @ApiPropertyOptional({ nullable: true, example: 'Customer complaint' })
  @Column({ type: 'varchar', length: 255, nullable: true })
  reason: string | null;

  @ApiPropertyOptional({
    nullable: true,
    example: '0f8c2a1e-6b1a-4f2e-9a3b-6f1d2c3b4a5e',
    description: 'Ties this record to the request that caused it.',
  })
  @Column({ type: 'varchar', length: 64, name: 'request_id', nullable: true })
  requestId: string | null;

  @ApiPropertyOptional({ nullable: true, example: '203.0.113.7' })
  @Column({ type: 'varchar', length: 45, name: 'ip_address', nullable: true })
  ipAddress: string | null;

  @ApiPropertyOptional({ nullable: true })
  @Column({ type: 'varchar', length: 255, name: 'user_agent', nullable: true })
  userAgent: string | null;

  @ApiProperty()
  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
