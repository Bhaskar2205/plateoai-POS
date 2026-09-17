import { ApiProperty } from '@nestjs/swagger';
import { RestaurantStatus } from 'src/common/enums';

/** Aggregate counters powering the restaurant admin dashboard. */
export class RestaurantStatsDto {
  @ApiProperty({ example: 1 })
  restaurantId: number;

  @ApiProperty({ example: 'The Green Bowl' })
  restaurantName: string;

  @ApiProperty({ enum: RestaurantStatus, example: RestaurantStatus.ACTIVE })
  status: RestaurantStatus;

  @ApiProperty({ example: 4 })
  totalCategories: number;

  @ApiProperty({ example: 3 })
  activeCategories: number;

  @ApiProperty({ example: 18 })
  totalDishes: number;

  @ApiProperty({ example: 15 })
  availableDishes: number;

  @ApiProperty({ example: 27 })
  totalIngredients: number;

  @ApiProperty({ example: 2 })
  totalUsers: number;
}
