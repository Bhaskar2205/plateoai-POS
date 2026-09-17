import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsPositive } from 'class-validator';

/**
 * Re-issues a token bound to a different restaurant the user belongs to.
 * Membership is re-verified server-side before the new token is signed.
 */
export class SwitchRestaurantDto {
  @ApiProperty({ example: 2 })
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  restaurantId: number;
}
