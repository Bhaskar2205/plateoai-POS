import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
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
import {
  InventoryConsumptionMode,
  InventoryMode,
  StockAdjustmentReason,
} from 'src/common/enums';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

/** A delivery arriving. */
export class StockInDto {
  @ApiProperty({ example: 5, description: 'How much arrived, in the ingredient unit.' })
  @IsNumber({ maxDecimalPlaces: 3 })
  @IsPositive()
  @Max(9999999)
  quantity: number;

  /**
   * What it cost this time, per unit, in paise. Optional, and when given it
   * becomes the ingredient's cost from now on - but only from now on. Movements
   * already written keep the value they were written with, so last month's
   * consumption report does not change because onions got dearer.
   */
  @ApiPropertyOptional({ example: 34000, description: 'New cost per unit in paise, if it changed.' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100000000)
  costPerUnitPaise?: number;

  @ApiPropertyOptional({ example: 'Shree Vegetables, invoice 4471', maxLength: 255 })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(255)
  note?: string;
}

/**
 * A correction by hand.
 *
 * The quantity is the amount of the change, not the figure to end up at, and it
 * is always positive - the direction is `increase`. Asking for "the new total"
 * instead would race: two people correcting the same ingredient would each
 * overwrite the other, and the ledger would record a change that did not happen.
 */
export class StockAdjustmentDto {
  @ApiProperty({ example: 0.2, description: 'The size of the change, always positive.' })
  @IsNumber({ maxDecimalPlaces: 3 })
  @IsPositive()
  @Max(9999999)
  quantity: number;

  @ApiProperty({ example: false, description: 'True adds, false takes away.' })
  @IsBoolean()
  increase: boolean;

  @ApiProperty({ enum: StockAdjustmentReason, example: StockAdjustmentReason.COUNT_CORRECTION })
  @IsEnum(StockAdjustmentReason)
  reason: StockAdjustmentReason;

  @ApiPropertyOptional({ example: 'Counted short at close', maxLength: 255 })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(255)
  note?: string;
}

/** Something thrown away. Its own endpoint because it is its own number in a report. */
export class WastageDto {
  @ApiProperty({ example: 0.5 })
  @IsNumber({ maxDecimalPlaces: 3 })
  @IsPositive()
  @Max(9999999)
  quantity: number;

  @ApiProperty({ enum: StockAdjustmentReason, example: StockAdjustmentReason.SPOILAGE })
  @IsEnum(StockAdjustmentReason)
  reason: StockAdjustmentReason;

  @ApiPropertyOptional({ example: 'Left out overnight', maxLength: 255 })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(255)
  note?: string;
}

export class StockCountLineDto {
  @ApiProperty({ example: 10 })
  @IsInt()
  @IsPositive()
  ingredientId: number;

  @ApiProperty({ example: 14, description: 'What was actually on the shelf.' })
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  @Max(9999999)
  countedQuantity: number;
}

/**
 * A physical count.
 *
 * Only the lines that were actually counted are sent. An ingredient left out is
 * left alone, because "not counted" and "counted as zero" are different things
 * and treating the first as the second would wipe out stock nobody checked.
 */
export class StockCountDto {
  @ApiProperty({ type: [StockCountLineDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(500)
  @ValidateNested({ each: true })
  @Type(() => StockCountLineDto)
  lines: StockCountLineDto[];

  @ApiPropertyOptional({ example: 'Monthly count, 30 September', maxLength: 255 })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(255)
  note?: string;
}

/**
 * Turning stock tracking on, and how strict it should be.
 *
 * Its own endpoint rather than part of the restaurant profile, because changing
 * the mode changes how settling a bill behaves and that deserves its own audit
 * record rather than being buried in a profile update alongside a new phone
 * number.
 */
export class InventorySettingsDto {
  @ApiPropertyOptional({ enum: InventoryMode })
  @IsOptional()
  @IsEnum(InventoryMode)
  inventoryMode?: InventoryMode;

  @ApiPropertyOptional({ enum: InventoryConsumptionMode })
  @IsOptional()
  @IsEnum(InventoryConsumptionMode)
  inventoryConsumptionMode?: InventoryConsumptionMode;

  /**
   * Whether somebody may take out more than Plateo thinks is there. A sale is
   * never blocked either way - this governs a decrease typed in by hand, where
   * there is a person present to be asked.
   */
  @ApiPropertyOptional({ example: false })
  @IsOptional()
  @IsBoolean()
  allowNegativeStock?: boolean;

}
