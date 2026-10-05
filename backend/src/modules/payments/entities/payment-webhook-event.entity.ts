import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, Unique } from 'typeorm';
import { PaymentProviderName, WebhookEventStatus } from 'src/common/enums';

/**
 * One delivery from a payment provider.
 *
 * The unique index on (provider, provider_event_id) is what makes a repeat
 * delivery harmless. Providers retry — that is their correct behaviour when they
 * do not get a prompt 2xx — so the same `payment.captured` arriving three times
 * is normal traffic, not an attack. The row is inserted before the event is
 * acted on, so the second delivery collides and is answered as a duplicate
 * without the business transition running again.
 *
 * The payload is stored hashed rather than whole by default. A provider payload
 * can carry a payer's name, contact details and card metadata, and keeping it
 * forever means keeping somebody else's personal data forever to answer a
 * question nobody has asked yet. The hash is enough to prove two deliveries were
 * the same, which is the question that actually gets asked.
 */
@Entity('payment_webhook_events')
@Unique('UQ_webhook_provider_event', ['provider', 'providerEventId'])
@Index('IDX_webhook_created', ['createdAt'])
export class PaymentWebhookEvent {
  @ApiProperty({ example: 1 })
  @PrimaryGeneratedColumn({ type: 'int', unsigned: true })
  id: number;

  @ApiProperty({ enum: PaymentProviderName })
  @Column({ type: 'varchar', length: 24 })
  provider: PaymentProviderName;

  @ApiProperty({ example: 'evt_Nx8K...', description: "The provider's own id for this delivery." })
  @Column({ type: 'varchar', length: 128, name: 'provider_event_id' })
  providerEventId: string;

  @ApiProperty({ example: 'payment.captured' })
  @Column({ type: 'varchar', length: 64, name: 'event_type' })
  eventType: string;

  @ApiProperty({ example: 'c2b1...', description: 'SHA-256 of the raw body, so a repeat is provable.' })
  @Column({ type: 'varchar', length: 64, name: 'payload_hash' })
  payloadHash: string;

  @ApiPropertyOptional({ nullable: true, example: 7, description: 'The intent this delivery concerned.' })
  @Column({ type: 'int', unsigned: true, name: 'payment_intent_id', nullable: true })
  paymentIntentId: number | null;

  @ApiProperty({ enum: WebhookEventStatus })
  @Column({ type: 'varchar', length: 16, default: WebhookEventStatus.PROCESSED })
  status: WebhookEventStatus;

  @ApiPropertyOptional({ nullable: true })
  @Column({ type: 'datetime', precision: 6, name: 'processed_at', nullable: true })
  processedAt: Date | null;

  @ApiPropertyOptional({ nullable: true, example: 'Amount did not match the bill' })
  @Column({ type: 'varchar', length: 500, name: 'error_message', nullable: true })
  errorMessage: string | null;

  @ApiProperty()
  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
