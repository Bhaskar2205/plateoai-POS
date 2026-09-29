import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Length,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { DiscountType, KotStatus, OrderStatus, PaymentMethod } from 'src/common/enums';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

/** Changing a line that has not gone to the kitchen yet. */
export class UpdateOrderItemDto {
  @ApiPropertyOptional({ example: 3, minimum: 1, maximum: 99 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(99)
  quantity?: number;

  @ApiPropertyOptional({ example: 'Extra mint chutney', maxLength: 255, nullable: true })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(255)
  note?: string | null;
}

/**
 * Approving the diner's requests onto a kitchen ticket.
 *
 * Omitting `itemIds` approves everything still pending, which is the common case
 * at the table; naming ids lets staff approve part of an order and leave the rest
 * to query with the diner.
 */
export class ApproveOrderItemsDto {
  @ApiPropertyOptional({ type: [Number], example: [120, 121], minItems: 1, maxItems: 50 })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @Type(() => Number)
  @IsInt({ each: true })
  @IsPositive({ each: true })
  itemIds?: number[];
}

export class CancelOrderItemDto {
  @ApiPropertyOptional({ example: 'Guest changed their mind', maxLength: 255 })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(255)
  reason?: string;
}

/**
 * A discount, with the reason it was given.
 *
 * The reason is required rather than optional: a discount is money leaving the
 * till, and an unexplained one is indistinguishable from theft when the owner
 * reads the day's bills back.
 */
export class ApplyDiscountDto {
  @ApiProperty({ enum: DiscountType, example: DiscountType.PERCENT })
  @IsEnum(DiscountType)
  type: DiscountType;

  @ApiProperty({
    example: 10,
    description:
      'A percentage when type is PERCENT, otherwise a flat amount. Either way the discount may ' +
      'not exceed half the subtotal.',
    minimum: 0.01,
  })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  value: number;

  @ApiProperty({ example: 'Regular guest', minLength: 3, maxLength: 255 })
  @Transform(trim)
  @IsString()
  @Length(3, 255)
  reason: string;
}

export class SettleOrderDto {
  @ApiProperty({ enum: PaymentMethod, example: PaymentMethod.UPI })
  @IsEnum(PaymentMethod)
  paymentMethod: PaymentMethod;
}

export class CancelOrderDto {
  @ApiProperty({ example: 'Guests left before ordering', minLength: 3, maxLength: 255 })
  @Transform(trim)
  @IsString()
  @Length(3, 255)
  reason: string;
}

export class UpdateKotStatusDto {
  @ApiProperty({
    enum: KotStatus,
    example: KotStatus.PREPARING,
    description: 'Tickets move NEW -> PREPARING -> READY -> DONE, and may be cancelled from any of those.',
  })
  @IsEnum(KotStatus)
  status: KotStatus;
}

export class QueryOrdersDto {
  @ApiPropertyOptional({ enum: OrderStatus, example: OrderStatus.OPEN })
  @IsOptional()
  @IsEnum(OrderStatus)
  status?: OrderStatus;

  @ApiPropertyOptional({ example: 7 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  tableId?: number;
}

export class QueryKotTicketsDto {
  @ApiPropertyOptional({
    enum: KotStatus,
    isArray: true,
    example: [KotStatus.NEW, KotStatus.PREPARING],
    description: 'Defaults to the tickets the kitchen still has work on: NEW, PREPARING and READY.',
  })
  @IsOptional()
  // A single value arrives as a string, not an array, from ?status=NEW.
  @Transform(({ value }) => (Array.isArray(value) || value === undefined ? value : [value]))
  @IsArray()
  @ArrayMaxSize(5)
  @IsEnum(KotStatus, { each: true })
  status?: KotStatus[];
}
