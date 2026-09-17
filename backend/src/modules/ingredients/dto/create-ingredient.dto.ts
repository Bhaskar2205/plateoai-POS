import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsOptional, IsString, Length, MaxLength } from 'class-validator';

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
}

export class UpdateIngredientDto extends PartialType(CreateIngredientDto) {}
