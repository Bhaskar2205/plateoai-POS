import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { ReconciliationIssue } from 'src/common/enums';

/**
 * Something about the money that does not add up, written down for a person.
 *
 * Reconciliation never repairs anything. A system that quietly corrects a
 * financial discrepancy destroys the evidence of how it arose, and the second
 * time it happens nobody can tell whether it is the same fault or a new one. So
 * the sweep records what it found, and a human decides.
 *
 * Rows are resolved rather than deleted, for the same reason.
 */
@Entity('payment_reconciliation_exceptions')
@Index('IDX_recon_restaurant_resolved', ['restaurantId', 'resolvedAt'])
export class PaymentReconciliationException {
  @ApiProperty({ example: 1 })
  @PrimaryGeneratedColumn({ type: 'int', unsigned: true })
  id: number;

  @ApiProperty({ example: 1 })
  @Column({ type: 'int', unsigned: true, name: 'restaurant_id' })
  restaurantId: number;

  @ApiProperty({ enum: ReconciliationIssue })
  @Column({ type: 'varchar', length: 48 })
  issue: ReconciliationIssue;

  @ApiPropertyOptional({ nullable: true, example: 7 })
  @Column({ type: 'int', unsigned: true, name: 'payment_intent_id', nullable: true })
  paymentIntentId: number | null;

  @ApiPropertyOptional({ nullable: true, example: 42 })
  @Column({ type: 'int', unsigned: true, name: 'order_id', nullable: true })
  orderId: number | null;

  @ApiProperty({ example: 'Payment captured for 1,050.00 but the bill is still open.' })
  @Column({ type: 'varchar', length: 500 })
  detail: string;

  @ApiPropertyOptional({ nullable: true, description: 'The figures that disagreed.' })
  @Column({ type: 'json', nullable: true })
  context: Record<string, unknown> | null;

  @ApiProperty()
  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @ApiPropertyOptional({ nullable: true, description: 'Set when a person has dealt with it.' })
  @Column({ type: 'datetime', precision: 6, name: 'resolved_at', nullable: true })
  resolvedAt: Date | null;

  @ApiPropertyOptional({ nullable: true })
  @Column({ type: 'varchar', length: 500, name: 'resolution_note', nullable: true })
  resolutionNote: string | null;
}
