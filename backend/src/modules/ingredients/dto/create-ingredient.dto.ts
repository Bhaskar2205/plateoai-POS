import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { IngredientCategory, IngredientUnit } from 'src/common/enums';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class CreateIngredientDto {
  @ApiProperty({ example: 'Paneer', minLength: 1, maxLength: 120 })
  @Transform(trim)
  @IsString()
  @Length(1, 120)
  name: string;

  @ApiPropertyOptional({ example: 'Fresh cottage cheese, made in house.', maxLength: 2000 })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(2000)
  description?: string;

  @ApiPropertyOptional({
    example: 'Contains milk',
    maxLength: 255,
    description:
      'Allergen declaration as supplied by the restaurant. Plateo stores this text verbatim and ' +
      'does not verify it.',
  })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(255)
  allergenInfo?: string;

  @ApiPropertyOptional({ enum: IngredientCategory, default: IngredientCategory.OTHER })
  @IsOptional()
  @IsEnum(IngredientCategory)
  category?: IngredientCategory;

  /**
   * How this ingredient is counted. Changing it later does not reinterpret the
   * stock already recorded, so it is asked for once, up front.
   */
  @ApiPropertyOptional({ enum: IngredientUnit, default: IngredientUnit.GRAM })
  @IsOptional()
  @IsEnum(IngredientUnit)
  unit?: IngredientUnit;

  /**
   * Opening stock. Optional, and usually left out: most restaurants add their
   * first delivery through Add stock, which leaves a movement behind. A figure
   * given here is recorded as OPENING_STOCK for the same reason.
   */
  @ApiPropertyOptional({ example: 10, minimum: 0, description: 'Opening stock, in `unit`.' })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  @Max(9999999)
  openingQuantity?: number;

  @ApiPropertyOptional({ example: 5, minimum: 0, description: 'Warn below this. 0 never warns.' })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  @Max(9999999)
  minimumQuantity?: number;

  @ApiPropertyOptional({ example: 10, minimum: 0, description: 'The usual purchase quantity.' })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 3 })
  @Min(0)
  @Max(9999999)
  reorderQuantity?: number;

  /**
   * Paise, not rupees, and a whole number. ₹320 per kg is 32000. Taking rupees
   * here would mean accepting 320.5 and rounding it somewhere later.
   */
  @ApiPropertyOptional({ example: 32000, minimum: 0, description: 'Cost of one `unit`, in paise.' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100000000)
  costPerUnitPaise?: number;

  @ApiPropertyOptional({ example: true, default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateIngredientDto extends PartialType(CreateIngredientDto) {}
