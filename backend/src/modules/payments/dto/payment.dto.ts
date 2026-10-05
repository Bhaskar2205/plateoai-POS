import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsNotEmpty, IsString, MaxLength, Min } from 'class-validator';
import {
  PaymentProviderName,
  PaymentProviderStatus,
  PaymentStatus,
  ReconciliationIssue,
} from 'src/common/enums';

/**
 * What a caller may say when starting a payment: which bill, and through whom.
 *
 * Conspicuously **not** the amount. A request that could name its own amount
 * could name a smaller one, so the server reads what the bill is owed and the
 * browser is never asked.
 */
export class CreatePaymentIntentDto {
  @ApiProperty({ example: 42, description: 'The bill being paid.' })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  orderId: number;

  @ApiProperty({ enum: PaymentProviderName, example: PaymentProviderName.RAZORPAY })
  @IsEnum(PaymentProviderName)
  provider: PaymentProviderName;
}

export class ResolveExceptionDto {
  @ApiProperty({ example: 'Guest paid in cash; online attempt abandoned.', maxLength: 500 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  note: string;
}

export class PaymentIntentDto {
  @ApiProperty({ example: 1 })
  id: number;

  @ApiPropertyOptional({ nullable: true, example: 42 })
  orderId: number | null;

  @ApiPropertyOptional({ nullable: true, example: 17, description: 'The bill number staff know it by.' })
  orderNumber: number | null;

  @ApiProperty({ example: '105000', description: 'Whole paise.' })
  amountPaise: string;

  @ApiProperty({ example: '₹1,050.00', description: 'The same amount, for reading.' })
  amount: string;

  @ApiProperty({ example: 'INR' })
  currency: string;

  @ApiProperty({ enum: PaymentStatus })
  status: PaymentStatus;

  @ApiProperty({ enum: PaymentProviderName })
  provider: PaymentProviderName;

  @ApiPropertyOptional({ nullable: true })
  providerPaymentId: string | null;

  @ApiPropertyOptional({ nullable: true, example: 'Card declined by issuing bank' })
  failureReason: string | null;

  @ApiProperty()
  createdAt: Date;

  @ApiPropertyOptional({ nullable: true })
  capturedAt: Date | null;
}

export class PaymentProviderStatusDto {
  @ApiProperty({ enum: PaymentProviderName })
  provider: PaymentProviderName;

  @ApiProperty({ enum: PaymentProviderStatus })
  status: PaymentProviderStatus;

  @ApiProperty({ example: 'Not configured', description: 'What to show a restaurant owner.' })
  label: string;

  @ApiProperty({
    example: false,
    description: 'Whether this provider can take a payment right now.',
  })
  usable: boolean;
}

export class PaymentSettingsDto {
  @ApiProperty({ type: [PaymentProviderStatusDto] })
  providers: PaymentProviderStatusDto[];

  @ApiProperty({
    example: false,
    description: 'True when at least one online provider is ready. Manual settlement always works.',
  })
  onlinePaymentsAvailable: boolean;

  @ApiProperty({ example: 30, description: 'Minutes before an unpaid attempt is treated as stale.' })
  intentExpiryMinutes: number;
}

export class ReconciliationExceptionDto {
  @ApiProperty({ example: 1 })
  id: number;

  @ApiProperty({ enum: ReconciliationIssue })
  issue: ReconciliationIssue;

  @ApiProperty({ example: 'Payment captured but the bill is still open.' })
  detail: string;

  @ApiPropertyOptional({ nullable: true, example: 7 })
  paymentIntentId: number | null;

  @ApiPropertyOptional({ nullable: true, example: 42 })
  orderId: number | null;

  @ApiProperty()
  createdAt: Date;

  @ApiPropertyOptional({ nullable: true })
  resolvedAt: Date | null;
}
