import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

/**
 * One requested line.
 *
 * Only a dish id and a quantity: the name and the price are read from the
 * restaurant's own menu and snapshotted server-side. A client that could send a
 * price could set its own.
 */
export class OrderItemInputDto {
  @ApiProperty({ example: 25, description: 'A dish of this restaurant. Must be available.' })
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  dishId: number;

  @ApiProperty({ example: 2, minimum: 1, maximum: 99 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(99)
  quantity: number;

  @ApiPropertyOptional({ example: 'No onion, less spicy', maxLength: 255 })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(255)
  note?: string;
}

/** Shared list constraints: enough for a large table, small enough to bound a request. */
export class OrderItemsDto {
  @ApiProperty({ type: [OrderItemInputDto], minItems: 1, maxItems: 50 })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => OrderItemInputDto)
  items: OrderItemInputDto[];
}

export class CreateOrderDto extends OrderItemsDto {
  @ApiPropertyOptional({
    example: 7,
    nullable: true,
    description:
      'The table being served. Omit for a counter or takeaway bill that is not tied to a table.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  tableId?: number | null;

  @ApiPropertyOptional({ example: 'Birthday table, cake at the end', maxLength: 500 })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(500)
  notes?: string;
}

export class AddOrderItemsDto extends OrderItemsDto {}

/**
 * Records income tax the payer withholds on this bill.
 *
 * Not a tax the restaurant charges: a company settling a bill deducts it and
 * pays it to the department on the restaurant's behalf, so it reduces what is
 * collected without changing what is owed in GST. Null clears it.
 */
export class SetTdsDto {
  @ApiPropertyOptional({
    nullable: true,
    example: 2,
    minimum: 0,
    maximum: 30,
    description: 'Percentage withheld, on the value before GST. Null or 0 removes it.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(30)
  rate?: number | null;
}

/** What a diner sends from a table QR menu. The table comes from the QR token. */
export class PlaceDinerOrderDto extends OrderItemsDto {}
