import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { TaxGroup, TaxKind } from 'src/common/enums';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

/**
 * A rate is a percentage with at most two decimals, capped at 100: a charge
 * larger than the thing it is charged on is a typo, not a tax, and letting one
 * through would quietly double a guest's bill.
 */
export class CreateTaxComponentDto {
  @ApiProperty({ example: 'CGST', maxLength: 40, description: 'What prints on the bill.' })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  name: string;

  @ApiProperty({ enum: TaxKind, example: TaxKind.CGST })
  @IsEnum(TaxKind)
  kind: TaxKind;

  @ApiProperty({ example: 2.5, minimum: 0, maximum: 100 })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  rate: number;

  @ApiPropertyOptional({ enum: TaxGroup, default: TaxGroup.STANDARD })
  @IsOptional()
  @IsEnum(TaxGroup)
  appliesTo?: TaxGroup;

  @ApiPropertyOptional({ example: true, default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ example: 1, description: 'Order the components print in.' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(99)
  sortOrder?: number;
}

export class UpdateTaxComponentDto {
  @ApiPropertyOptional({ example: 'CGST', maxLength: 40 })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  name?: string;

  @ApiPropertyOptional({ enum: TaxKind })
  @IsOptional()
  @IsEnum(TaxKind)
  kind?: TaxKind;

  @ApiPropertyOptional({ example: 2.5, minimum: 0, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  rate?: number;

  @ApiPropertyOptional({ enum: TaxGroup })
  @IsOptional()
  @IsEnum(TaxGroup)
  appliesTo?: TaxGroup;

  @ApiPropertyOptional({ example: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(99)
  sortOrder?: number;
}

/** Replaces the whole profile with one of the suggested starting points. */
export class ApplyTaxProfileDto {
  @ApiProperty({ example: 'restaurant-5', description: 'Id of a suggested profile.' })
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  profileId: string;
}

export class TaxComponentDto {
  @ApiProperty({ example: 1 })
  id: number;

  @ApiProperty({ example: 'CGST' })
  name: string;

  @ApiProperty({ enum: TaxKind })
  kind: TaxKind;

  @ApiProperty({ example: 2.5 })
  rate: number;

  @ApiProperty({ enum: TaxGroup })
  appliesTo: TaxGroup;

  @ApiProperty({ example: true })
  isActive: boolean;

  @ApiProperty({ example: 1 })
  sortOrder: number;
}

export class SuggestedProfileDto {
  @ApiProperty({ example: 'restaurant-5' })
  id: string;

  @ApiProperty({ example: 'Restaurant · 5% GST' })
  label: string;

  @ApiProperty({ example: 'A standalone restaurant, cafe or coffee shop.' })
  description: string;

  @ApiProperty({ example: 5, description: 'Combined percentage on standard food lines.' })
  totalRate: number;
}

/** The whole tax screen in one response. */
export class TaxProfileDto {
  @ApiProperty({ type: [TaxComponentDto] })
  components: TaxComponentDto[];

  @ApiProperty({ type: [SuggestedProfileDto] })
  suggested: SuggestedProfileDto[];

  @ApiProperty({
    example: 5,
    description: 'Combined percentage currently charged on standard food lines.',
  })
  standardRate: number;

  @ApiProperty({ nullable: true, example: '22AAAAA0000A1Z5' })
  taxNumber: string | null;
}
