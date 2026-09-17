import { ApiProperty } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsNumber,
  IsString,
  Length,
  Max,
  Min,
  IsPositive,
  ValidateNested,
} from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

/** One recipe line. */
export class DishIngredientInputDto {
  @ApiProperty({
    example: 1,
    description: 'Must be an ingredient of the same restaurant as the dish.',
  })
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  ingredientId: number;

  @ApiProperty({
    example: 100,
    minimum: 0,
    maximum: 1000000,
    description: 'Stored as DECIMAL(10,3); at most 3 decimal places.',
  })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 3 }, { message: 'quantity must have at most 3 decimal places' })
  @Min(0)
  @Max(1000000)
  quantity: number;

  @ApiProperty({ example: 'g', maxLength: 16, description: 'Unit of measure: g, ml, piece, tbsp.' })
  @Transform(trim)
  @IsString()
  @Length(1, 16)
  unit: string;
}

/**
 * Payload for both `POST` (add/merge) and `PATCH` (replace) on a dish recipe.
 *
 * `PATCH` treats the list as the complete recipe and applies it in one
 * transaction, so a partially written recipe is never visible.
 */
export class SetDishIngredientsDto {
  @ApiProperty({ type: [DishIngredientInputDto] })
  @IsArray()
  @ArrayMinSize(0)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => DishIngredientInputDto)
  ingredients: DishIngredientInputDto[];
}

/** A recipe line as returned to clients, with the ingredient inlined. */
export class DishIngredientResponseDto {
  @ApiProperty({ example: 1 })
  id: number;

  @ApiProperty({ example: 1 })
  dishId: number;

  @ApiProperty({ example: 2 })
  ingredientId: number;

  @ApiProperty({ example: 'Paneer' })
  ingredientName: string;

  @ApiProperty({ example: 'Contains milk', nullable: true })
  allergenInfo: string | null;

  @ApiProperty({ example: 100 })
  quantity: number;

  @ApiProperty({ example: 'g' })
  unit: string;
}
