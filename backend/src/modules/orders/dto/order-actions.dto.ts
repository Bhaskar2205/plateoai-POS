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

/**
 * Taking a line off the bill.
 *
 * The reason is optional in the type and required by the service once the
 * kitchen has the line, because the two cases are not the same thing. Untapping
 * a mis-tap before anyone has cooked it is a correction. Removing a dish that was
 * cooked, plated and carried to a table is a write-off of food and money, and an
 * owner reading the day back is entitled to know why it happened.
 */
export class CancelOrderItemDto {
  @ApiPropertyOptional({
    example: 'Guest sent it back - too salty',
    maxLength: 255,
    description: 'Required once the line has gone to the kitchen.',
  })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(3, 255)
  reason?: string;
}

/**
 * Comping one line inside a bill the guest is otherwise paying.
 *
 * Not a 100% discount: a discount is money taken off a sale, and this is not a
 * sale. Keeping them apart is what lets an owner ask "what did we give away"
 * without that answer being tangled up with what they discounted to win custom.
 */
export class MarkItemNonChargeableDto {
  @ApiProperty({ example: 'Guest sent it back - comped', minLength: 3, maxLength: 255 })
  @Transform(trim)
  @IsString()
  @Length(3, 255)
  reason: string;
}

/**
 * The whole bill given away: the owner eating, a staff meal, a friend of the
 * house.
 *
 * `forWhom` is who ate, not who authorised it - the person who punched it is
 * already on the order and in the audit log. It is the question an owner
 * actually asks at the end of a month.
 */
export class MarkOrderNonChargeableDto {
  @ApiProperty({ example: "Owner's family", minLength: 2, maxLength: 120 })
  @Transform(trim)
  @IsString()
  @Length(2, 120)
  forWhom: string;

  @ApiProperty({ example: 'Sunday lunch, owner dining with family', minLength: 3, maxLength: 255 })
  @Transform(trim)
  @IsString()
  @Length(3, 255)
  reason: string;
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
