import { Body, Controller, Get, HttpCode, HttpStatus, Patch, Post } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiAuth } from 'src/common/decorators/api-auth.decorator';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { ActiveRestaurantId } from 'src/common/decorators/active-restaurant.decorator';
import { RequestContext } from 'src/common/decorators/request-context.decorator';
import type { AuditContext } from 'src/modules/audit/audit.service';
import { Roles } from 'src/common/decorators/roles.decorator';
import { RESTAURANT_ADMIN_ROLES, UserRole } from 'src/common/enums';
import { KitchenCodeDto } from './dto/kitchen-code.dto';
import { formatKitchenCode } from './kitchen-code';
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
      'suffix. `publicSlug` never changes, so QR codes and shared menu links survive a rename. ' +
      '`status` is reserved for Plateo support (SUPER_ADMIN) - see the field description.',
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

  @Get('me/kitchen-code')
  @Roles(...RESTAURANT_ADMIN_ROLES)
  @ApiOperation({
    summary: 'The code a kitchen screen signs in with',
    description:
      'Owners only. This is a credential, so it is never included in an ordinary restaurant ' +
      'response - it is read here, shown in the admin app, and typed into the kitchen screen.',
  })
  @ApiOkResponse({ type: KitchenCodeDto })
  async getKitchenCode(@ActiveRestaurantId() restaurantId: number): Promise<KitchenCodeDto> {
    const code = await this.restaurantsService.kitchenCode(restaurantId);

    return { code, display: formatKitchenCode(code) };
  }

  @Post('me/kitchen-code/regenerate')
  @HttpCode(HttpStatus.OK)
  @Roles(...RESTAURANT_ADMIN_ROLES)
  @ApiOperation({
    summary: 'Issue a new kitchen code',
    description:
      'The old code stops working immediately, which is how a restaurant cuts off a screen it no ' +
      'longer controls. Every kitchen screen must then be signed in again with the new code.',
  })
  @ApiOkResponse({ type: KitchenCodeDto })
  async regenerateKitchenCode(
    @ActiveRestaurantId() restaurantId: number,
    @CurrentUser('id') userId: number,
    @RequestContext() context: AuditContext,
  ): Promise<KitchenCodeDto> {
    const code = await this.restaurantsService.regenerateKitchenCode(restaurantId, userId, context);

    return { code, display: formatKitchenCode(code) };
  }

  @Get('me/stats')
  @ApiOperation({ summary: 'Dashboard counters for the authenticated restaurant' })
  @ApiOkResponse({ type: RestaurantStatsDto })
  getMyRestaurantStats(@ActiveRestaurantId() restaurantId: number): Promise<RestaurantStatsDto> {
    return this.restaurantsService.getStats(restaurantId);
  }
}
