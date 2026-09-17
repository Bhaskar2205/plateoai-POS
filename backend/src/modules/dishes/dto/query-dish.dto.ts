import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, IsString, MaxLength, IsPositive } from 'class-validator';

const toOptionalBoolean = ({ value }: { value: unknown }) => {
  if (value === undefined || value === '') return undefined;
  if (typeof value === 'boolean') return value;
  if (value === 'true' || value === '1') return true;
  if (value === 'false' || value === '0') return false;
  return value;
};

export class QueryDishDto {
  @ApiPropertyOptional({ example: 1, description: 'Only dishes in this category.' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  categoryId?: number;

  @ApiPropertyOptional({ example: true, description: 'Filter by availability.' })
  @IsOptional()
  @Transform(toOptionalBoolean)
  @IsBoolean()
  isAvailable?: boolean;

  @ApiPropertyOptional({ example: 'paneer', description: 'Case-insensitive name filter.' })
  @IsOptional()
  @IsString()
  @MaxLength(150)
  search?: string;
}
