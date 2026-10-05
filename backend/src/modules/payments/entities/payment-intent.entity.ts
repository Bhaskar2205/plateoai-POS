import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { PaymentProviderName, PaymentStatus } from 'src/common/enums';

/**
 * One attempt to collect money for a bill.
 *
 * An attempt, not a payment: a bill can have several, because a card declining is
 * ordinary and the guest must be able to try again without the restaurant
 * opening a second bill. The order stays the same and gains another intent.
 *
 * Money is `amount_paise`, a BIGINT of whole paise, and the only money column in
 * the system that is not DECIMAL. That is deliberate rather than inconsistent:
 * every payment provider speaks in the smallest unit, and converting at the
 * boundary - once, here - is safer than converting on every call.
 *
 * `providerPaymentId` is unique per provider where present, so the same provider
 * payment cannot be recorded against two intents. That is the last line of
 * defence behind the webhook event table: if a provider re-sends an event under
 * a new event id, the payment id still collides.
 */
@Entity('payment_intents')
@Index('IDX_payment_intents_restaurant_created', ['restaurantId', 'createdAt'])
@Index('IDX_payment_intents_restaurant_status', ['restaurantId', 'status'])
@Index('IDX_payment_intents_order', ['orderId'])
export class PaymentIntent {
  @ApiProperty({ example: 1 })
  @PrimaryGeneratedColumn({ type: 'int', unsigned: true })
  id: number;

  @ApiProperty({ example: 1 })
  @Column({ type: 'int', unsigned: true, name: 'restaurant_id' })
  restaurantId: number;

  @ApiPropertyOptional({ nullable: true, example: 42, description: 'The bill being paid.' })
  @Column({ type: 'int', unsigned: true, name: 'order_id', nullable: true })
  orderId: number | null;

  /**
   * Kept alongside `orderId` because a bill and an order are the same row today
   * and may not always be. Null until the two are associated.
   */
  @ApiPropertyOptional({ nullable: true, example: 42 })
  @Column({ type: 'int', unsigned: true, name: 'bill_id', nullable: true })
  billId: number | null;

  @ApiProperty({ example: 105000, description: 'Whole paise. 105000 is one thousand and fifty rupees.' })
  @Column({ type: 'bigint', name: 'amount_paise' })
  amountPaise: string;

  @ApiProperty({ example: 'INR' })
  @Column({ type: 'varchar', length: 3, default: 'INR' })
  currency: string;

  @ApiProperty({ enum: PaymentStatus, example: PaymentStatus.CREATED })
  @Column({ type: 'varchar', length: 24, default: PaymentStatus.CREATED })
  status: PaymentStatus;

  @ApiProperty({ enum: PaymentProviderName, example: PaymentProviderName.PLATEO_INTERNAL })
  @Column({ type: 'varchar', length: 24 })
  provider: PaymentProviderName;

  @ApiPropertyOptional({ nullable: true, example: 'pay_Nx8K...' })
  @Column({ type: 'varchar', length: 128, name: 'provider_payment_id', nullable: true })
  providerPaymentId: string | null;

  @ApiPropertyOptional({ nullable: true, example: 'order_Nx8K...' })
  @Column({ type: 'varchar', length: 128, name: 'provider_order_id', nullable: true })
  providerOrderId: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'The key the caller created this with.' })
  @Column({ type: 'varchar', length: 128, name: 'idempotency_key', nullable: true })
  idempotencyKey: string | null;

  /**
   * Context, never credentials. Nothing here is read back into a decision about
   * money; it exists so a person reconstructing an evening has something to go on.
   */
  @ApiPropertyOptional({ nullable: true })
  @Column({ type: 'json', nullable: true })
  metadata: Record<string, unknown> | null;

  @ApiPropertyOptional({ nullable: true, example: 'Card declined by issuing bank' })
  @Column({ type: 'varchar', length: 255, name: 'failure_reason', nullable: true })
  failureReason: string | null;

  @ApiProperty()
  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @ApiProperty()
  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @ApiPropertyOptional({ nullable: true })
  @Column({ type: 'datetime', precision: 6, name: 'authorized_at', nullable: true })
  authorizedAt: Date | null;

  @ApiPropertyOptional({ nullable: true })
  @Column({ type: 'datetime', precision: 6, name: 'captured_at', nullable: true })
  capturedAt: Date | null;

  @ApiPropertyOptional({ nullable: true })
  @Column({ type: 'datetime', precision: 6, name: 'failed_at', nullable: true })
  failedAt: Date | null;

  @ApiPropertyOptional({ nullable: true })
  @Column({ type: 'datetime', precision: 6, name: 'cancelled_at', nullable: true })
  cancelledAt: Date | null;
}
