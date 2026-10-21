import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseIntPipe, Patch, Post } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { ApiAuth } from 'src/common/decorators/api-auth.decorator';
import { RequestContext } from 'src/common/decorators/request-context.decorator';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { Roles } from 'src/common/decorators/roles.decorator';
import { ErrorResponseDto } from 'src/common/dto/error-response.dto';
import { UserRole } from 'src/common/enums';
import { AuditContext } from 'src/modules/audit/audit.service';
import {
  CreateRestaurantAccountDto,
  DeleteRestaurantDto,
  ResetOwnerPasswordDto,
  UpdateRestaurantStatusDto,
} from './dto/platform.dto';
import { PlatformService } from './platform.service';

/**
 * Running Plateo: the screens behind admin.plateoai.in.
 *
 * `@Roles` sits on the controller rather than on each route, so a method added
 * here later is locked to SUPER_ADMIN by default instead of by somebody
 * remembering. Everything under it reaches across tenants, which is the one place
 * in Plateo where that is intended.
 *
 * Note what is *not* here: no endpoint reads a restaurant's orders, bills,
 * takings or guests. Opening an account and suspending one does not require
 * reading what that restaurant sold, and a platform operator who can read every
 * tenant's trading is a much larger thing to protect than one who cannot.
 */
@ApiTags('Platform admin')
@ApiAuth()
@Roles(UserRole.SUPER_ADMIN)
@ApiForbiddenResponse({ description: 'Not a Plateo administrator.', type: ErrorResponseDto })
@Controller('platform')
export class PlatformController {
  constructor(private readonly platformService: PlatformService) {}

  @Get('stats')
  @ApiOperation({ summary: 'How many restaurants, and how many are live' })
  @ApiOkResponse()
  stats() {
    return this.platformService.stats();
  }

  @Get('restaurants')
  @ApiOperation({
    summary: 'Every restaurant on Plateo',
    description: 'Newest first, each with the people who can sign in to it.',
  })
  @ApiOkResponse()
  list() {
    return this.platformService.listRestaurants();
  }

  @Get('restaurants/:id')
  @ApiOperation({ summary: 'One restaurant' })
  @ApiNotFoundResponse({ description: 'No such restaurant.', type: ErrorResponseDto })
  @ApiOkResponse()
  getOne(@Param('id', ParseIntPipe) id: number) {
    return this.platformService.getRestaurant(id);
  }

  @Post('restaurants')
  @ApiOperation({
    summary: 'Open a restaurant account',
    description:
      'Creates the restaurant and the owner who signs in to it, in one transaction. This is the ' +
      'only way a restaurant comes to exist on Plateo - there is no self-registration.',
  })
  @ApiCreatedResponse()
  @ApiConflictResponse({ description: 'That email already has an account.', type: ErrorResponseDto })
  create(@Body() dto: CreateRestaurantAccountDto) {
    return this.platformService.createRestaurantAccount(dto);
  }

  @Patch('restaurants/:id/status')
  @ApiOperation({
    summary: 'Suspend or restore a restaurant',
    description:
      'Takes effect at once rather than when tokens expire: the status is re-read on every ' +
      'request, so a suspended restaurant\'s staff are out on their next click.',
  })
  @ApiOkResponse()
  @ApiConflictResponse({ description: 'Already in that state.', type: ErrorResponseDto })
  setStatus(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateRestaurantStatusDto,
    @RequestContext() context: AuditContext,
  ) {
    return this.platformService.setStatus(id, dto, context);
  }

  @Get('restaurants/:id/export')
  @ApiOperation({
    summary: 'Everything Plateo holds for one restaurant',
    description:
      'A complete copy as JSON - profile, people, menu, bills, bookings and stock. Taken before a ' +
      'deletion, because a deletion takes the bills with it and a restaurant has to keep those for ' +
      'years after it stops trading. No password hashes.',
  })
  @ApiOkResponse()
  exportRestaurant(@Param('id', ParseIntPipe) id: number): Promise<Record<string, unknown>> {
    return this.platformService.exportRestaurant(id);
  }

  @Get('restaurants/:id/deletion-impact')
  @ApiOperation({
    summary: 'What deleting this restaurant would destroy',
    description:
      'So the panel can say it before it happens - how many bills, how many people, and which of ' +
      'those people also work at another Plateo restaurant and would lose that job too.',
  })
  @ApiOkResponse()
  deletionImpact(@Param('id', ParseIntPipe) id: number) {
    return this.platformService.describeDeletion(id);
  }

  /**
   * POST rather than DELETE because it carries a body: the restaurant's name,
   * typed back. A DELETE with a body is legal but proxies and clients drop it
   * often enough that the confirmation would silently stop arriving.
   */
  @Post('restaurants/:id/delete')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Delete a restaurant and everyone who worked there',
    description:
      'Irreversible and total: bills, payments, tickets, bookings, stock and the audit trail all ' +
      'go. Every account linked to the restaurant is deleted, including anyone who also works at ' +
      'another Plateo restaurant. Export first.',
  })
  @ApiOkResponse()
  @ApiBadRequestResponse({ description: 'The name did not match.', type: ErrorResponseDto })
  deleteRestaurant(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser('id') actorId: number,
    @Body() dto: DeleteRestaurantDto,
  ): Promise<{ name: string; staffDeleted: number }> {
    return this.platformService.deleteRestaurant(id, dto.confirmName, actorId);
  }

  @Post('restaurants/:id/reset-password')
  @ApiOperation({
    summary: "Set a new password for somebody at this restaurant",
    description:
      'How an owner locked out gets back in - Plateo has no password reset of its own yet. The ' +
      'new password is handed over out of band and is never returned here.',
  })
  @ApiCreatedResponse()
  @ApiNotFoundResponse({
    description: 'No such account, or it belongs to a different restaurant.',
    type: ErrorResponseDto,
  })
  resetPassword(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ResetOwnerPasswordDto,
    @RequestContext() context: AuditContext,
  ) {
    return this.platformService.resetPassword(id, dto, context);
  }
}
