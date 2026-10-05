import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  Length,
  Max,
  MaxLength,
  Min,
  IsPositive,
  ValidateNested,
} from 'class-validator';
import { DietType, TaxGroup } from 'src/common/enums';
import { DishIngredientInputDto } from './dish-ingredients.dto';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

/** Shared constraints for the four nutrition columns. */
const NUTRITION_DECIMALS = { maxDecimalPlaces: 2 } as const;

export class CreateDishDto {
  @ApiPropertyOptional({
    example: 1,
    description:
      'Must be a category of the authenticated restaurant. Omit or send null for an ' +
      'uncategorised dish.',
    nullable: true,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  categoryId?: number | null;

  @ApiProperty({ example: 'Paneer Tikka Bowl', minLength: 1, maxLength: 150 })
  @Transform(trim)
  @IsString()
  @Length(1, 150)
  name: string;

  @ApiPropertyOptional({
    example: 'Grilled paneer with fresh vegetables and mint dressing',
    maxLength: 2000,
  })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(2000)
  description?: string;

  @ApiProperty({
    example: 299,
    minimum: 0,
    maximum: 99999999.99,
    description: 'Menu price. Stored as DECIMAL(10,2); at most 2 decimal places.',
  })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'price must have at most 2 decimal places' })
  @Min(0)
  @Max(99999999.99)
  price: number;

  @ApiPropertyOptional({ example: 'https://cdn.example.com/paneer-tikka-bowl.jpg' })
  @IsOptional()
  @Transform(trim)
  @IsUrl(
    { require_protocol: true, require_tld: false, protocols: ['http', 'https'] },
    { message: 'imageUrl must be a valid http(s) URL' },
  )
  @MaxLength(512)
  imageUrl?: string;

  @ApiPropertyOptional({
    example: 22,
    minimum: 0,
    maximum: 10000,
    description:
      'Protein in grams (g), as declared by the restaurant. Plateo stores this value as entered ' +
      'and does not verify it - it is not medical or nutritional advice.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber(NUTRITION_DECIMALS)
  @Min(0)
  @Max(10000)
  proteinGrams?: number;

  @ApiPropertyOptional({
    example: 380,
    minimum: 0,
    maximum: 20000,
    description: 'Energy in kilocalories (kcal), as declared by the restaurant.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber(NUTRITION_DECIMALS)
  @Min(0)
  @Max(20000)
  calories?: number;

  @ApiPropertyOptional({
    example: 24,
    minimum: 0,
    maximum: 10000,
    description: 'Carbohydrates in grams (g), as declared by the restaurant.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber(NUTRITION_DECIMALS)
  @Min(0)
  @Max(10000)
  carbsGrams?: number;

  @ApiPropertyOptional({
    example: 19,
    minimum: 0,
    maximum: 10000,
    description: 'Fat in grams (g), as declared by the restaurant.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber(NUTRITION_DECIMALS)
  @Min(0)
  @Max(10000)
  fatGrams?: number;

  @ApiPropertyOptional({
    example: 15,
    minimum: 1,
    maximum: 600,
    nullable: true,
    description: 'Typical preparation time in whole minutes (1-600). Send null to clear.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'preparationTimeMinutes must be a whole number of minutes' })
  @Min(1)
  @Max(600)
  preparationTimeMinutes?: number | null;

  @ApiPropertyOptional({
    enum: DietType,
    example: DietType.VEG,
    description: 'Dietary classification declared by the restaurant.',
  })
  @IsOptional()
  @IsIn(Object.values(DietType))
  dietType?: DietType;

  @ApiPropertyOptional({
    enum: TaxGroup,
    default: TaxGroup.STANDARD,
    description:
      'Which of the restaurant tax components apply. Alcohol sits outside GST and takes state VAT; ' +
      'a sealed packaged item can carry its own rate. Defaults to ordinary food and drink.',
  })
  @IsOptional()
  @IsIn(Object.values(TaxGroup))
  taxGroup?: TaxGroup;

  @ApiPropertyOptional({ example: true, default: true })
  @IsOptional()
  @IsBoolean()
  isAvailable?: boolean;

  @ApiPropertyOptional({
    type: [DishIngredientInputDto],
    description:
      'Optional recipe, written in the same transaction as the dish. On create it becomes the ' +
      'recipe; on update it replaces the whole recipe. Omit it to leave the recipe untouched. ' +
      'Every ingredient must belong to the authenticated restaurant.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => DishIngredientInputDto)
  ingredients?: DishIngredientInputDto[];
}

export class UpdateDishDto extends PartialType(CreateDishDto) {}
