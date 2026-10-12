import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsEmail,
  IsEnum,
  IsInt,
  IsISO8601,
  IsOptional,
  IsNumber,
  IsString,
  Length,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { DiscountType, TableBookingStatus } from 'src/common/enums';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

/**
 * A discount promised on a booking.
 *
 * One object rather than three loose fields, so a type can never arrive without
 * a value or a reason to go with it. The reason is required for the same cause
 * it is required on a bill: a discount is money leaving the till, and an
 * unexplained one is indistinguishable from theft when the owner reads the week
 * back.
 *
 * A percentage is capped at 50 because a bill caps any discount at half its
 * subtotal. Promising 60% on a booking would be promising something the till
 * will refuse, and the worst place to find that out is in front of the guest.
 */
export class BookingDiscountDto {
  @ApiProperty({ enum: DiscountType, example: DiscountType.PERCENT })
  @IsEnum(DiscountType)
  type: DiscountType;

  @ApiProperty({
    example: 10,
    description: 'A percentage when type is PERCENT, otherwise a flat amount. Percentages may not exceed 50.',
    minimum: 0.01,
  })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  value: number;

  @ApiProperty({ example: 'Birthday party of eight', minLength: 3, maxLength: 255 })
  @Transform(trim)
  @IsString()
  @Length(3, 255)
  reason: string;
}

/**
 * A booking as it arrives from the Plateo guest app.
 *
 * Validated hard, because this is an anonymous surface: whatever the app sends is
 * what a restaurant will read off a screen and act on. A party size of 400 or a
 * booking for the year 3000 is a bug somewhere, and it should fail here rather
 * than appear in somebody's evening.
 */
export class CreateBookingDto {
  @ApiProperty({ example: 'Ananya Rao', maxLength: 120 })
  @Transform(trim)
  @IsString()
  @Length(1, 120)
  guestName: string;

  @ApiProperty({ example: '+919876543210', maxLength: 32 })
  @Transform(trim)
  @IsString()
  @Length(5, 32)
  guestPhone: string;

  @ApiPropertyOptional({ example: 'ananya@example.com' })
  @IsOptional()
  @Transform(trim)
  @IsEmail()
  @MaxLength(190)
  guestEmail?: string;

  @ApiProperty({ example: 4, minimum: 1, maximum: 100 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  // A hundred is already a private function rather than a booking; past it, a
  // restaurant should be talking to somebody, not reading a notification.
  @Max(100)
  partySize: number;

  @ApiProperty({ example: '2026-10-08T14:00:00.000Z', description: 'When the guest is coming, ISO 8601.' })
  @IsISO8601()
  bookedFor: string;

  @ApiPropertyOptional({ example: 'Window seat if possible.', maxLength: 500 })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(500)
  guestNote?: string;

  @ApiPropertyOptional({
    type: BookingDiscountDto,
    description:
      'A discount the app is promising - a promotion, a loyalty tier. The restaurant sees it and ' +
      'may change or clear it when confirming; nothing applies it to a bill on its own.',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => BookingDiscountDto)
  discount?: BookingDiscountDto;
}

/** Confirming a booking, optionally putting it on a named table. */
export class ConfirmBookingDto {
  @ApiPropertyOptional({
    example: 7,
    description:
      'Optional even here - plenty of restaurants confirm the booking and decide the table on ' +
      'the night.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  tableId?: number;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(500)
  note?: string;

  @ApiPropertyOptional({
    type: BookingDiscountDto,
    nullable: true,
    description:
      'Sets or replaces the discount. Send null to clear one the app promised. Leave it out to ' +
      'keep whatever the booking already carries.',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => BookingDiscountDto)
  discount?: BookingDiscountDto | null;
}

/** Declining, cancelling, or marking a no-show. */
export class CloseBookingDto {
  @ApiPropertyOptional({
    example: 'Fully booked at that time.',
    maxLength: 500,
    description: 'Shown back to the guest, so it should read like something a person wrote.',
  })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class QueryBookingsDto {
  @ApiPropertyOptional({ enum: TableBookingStatus })
  @IsOptional()
  @IsEnum(TableBookingStatus)
  status?: TableBookingStatus;

  @ApiPropertyOptional({ example: '2026-10-08', description: 'Business date. Defaults to today.' })
  @IsOptional()
  @IsString()
  @MaxLength(10)
  date?: string;

  @ApiPropertyOptional({
    example: true,
    description: 'True returns everything still live regardless of date - what the screen opens on.',
  })
  @IsOptional()
  @IsString()
  upcoming?: string;
}
