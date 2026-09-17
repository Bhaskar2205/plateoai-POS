import { Body, Controller, Get, Patch } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiAuth } from 'src/common/decorators/api-auth.decorator';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { ActiveRestaurantId } from 'src/common/decorators/active-restaurant.decorator';
import { Roles } from 'src/common/decorators/roles.decorator';
import { RESTAURANT_ADMIN_ROLES, UserRole } from 'src/common/enums';
import { RestaurantStatsDto } from './dto/restaurant-stats.dto';
import { RestaurantUserDto } from './dto/restaurant-user.dto';
import { UpdateRestaurantDto } from './dto/update-restaurant.dto';
import { Restaurant } from './entities/restaurant.entity';
import { RestaurantsService } from './restaurants.service';

/**
 * All routes operate on the *active* restaurant taken from the JWT. There is no
 * `/restaurants/:id` endpoint by design - a tenant can only address itself.
 */
@ApiTags('Restaurants')
@ApiAuth()
@Controller('restaurants')
export class RestaurantsController {
  constructor(private readonly restaurantsService: RestaurantsService) {}

  @Get('me')
  @ApiOperation({ summary: 'Get the authenticated restaurant profile' })
  @ApiOkResponse({ type: Restaurant })
  getMyRestaurant(@ActiveRestaurantId() restaurantId: number): Promise<Restaurant> {
    return this.restaurantsService.findById(restaurantId);
  }

  @Patch('me')
  @Roles(...RESTAURANT_ADMIN_ROLES)
  @ApiOperation({
    summary: 'Update the authenticated restaurant profile',
    description:
      'Owners only. Changing the name regenerates the unique slug; duplicate names get a numeric ' +
      'suffix. `status` is reserved for Plateo support (SUPER_ADMIN) - see the field description.',
  })
  @ApiOkResponse({ type: Restaurant })
  updateMyRestaurant(
    @ActiveRestaurantId() restaurantId: number,
    @CurrentUser('role') actorRole: UserRole,
    @Body() dto: UpdateRestaurantDto,
  ): Promise<Restaurant> {
    return this.restaurantsService.updateRestaurant(restaurantId, dto, actorRole);
  }

  @Get('me/users')
  @Roles(...RESTAURANT_ADMIN_ROLES)
  @ApiOperation({ summary: 'List users who belong to the authenticated restaurant' })
  @ApiOkResponse({ type: [RestaurantUserDto] })
  getMyRestaurantUsers(@ActiveRestaurantId() restaurantId: number): Promise<RestaurantUserDto[]> {
    return this.restaurantsService.findMembers(restaurantId);
  }

  @Get('me/stats')
  @ApiOperation({ summary: 'Dashboard counters for the authenticated restaurant' })
  @ApiOkResponse({ type: RestaurantStatsDto })
  getMyRestaurantStats(@ActiveRestaurantId() restaurantId: number): Promise<RestaurantStatsDto> {
    return this.restaurantsService.getStats(restaurantId);
  }
}
