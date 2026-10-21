import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayNotEmpty, IsArray, IsEnum, IsInt, Min } from 'class-validator';
import { TaxGroup } from 'src/common/enums';

/**
 * Reclassifying a batch of dishes for tax in one go.
 *
 * Which dishes are taxed, and at what, is a decision about the whole menu:
 * every soft drink, every bottle of beer, every sealed packet. Making that
 * decision one dish at a time through the dish form means sixty edits and one
 * missed bottle that is still being billed wrongly a month later.
 */
export class BulkTaxGroupDto {
  @ApiProperty({
    type: [Number],
    example: [12, 13, 19],
    description: "Dishes to reclassify. Ids belonging to another restaurant are not found.",
  })
  @IsArray()
  @ArrayNotEmpty()
  // A whole menu at once is the point; a thousand is somebody scripting.
  @ArrayMaxSize(500)
  @Type(() => Number)
  @IsInt({ each: true })
  @Min(1, { each: true })
  dishIds: number[];

  @ApiProperty({
    enum: TaxGroup,
    example: TaxGroup.EXEMPT,
    description:
      'The group to put them in. Tax components are matched against this, so EXEMPT dishes are ' +
      'billed with no tax at all.',
  })
  @IsEnum(TaxGroup)
  taxGroup: TaxGroup;
}

export class BulkTaxGroupResultDto {
  @ApiProperty({ example: 14, description: 'Dishes whose group actually changed.' })
  updated: number;

  @ApiProperty({ example: 3, description: 'Dishes that were already in that group.' })
  unchanged: number;

  @ApiProperty({
    example: 0,
    description: "Ids that are not this restaurant's. Reported, never an error, so one stale id in a selection does not lose the rest.",
  })
  notFound: number;
}
