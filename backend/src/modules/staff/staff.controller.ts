import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseIntPipe, Patch, Post } from '@nestjs/common';
import {
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { ActiveRestaurantId } from 'src/common/decorators/active-restaurant.decorator';
import { ApiAuth } from 'src/common/decorators/api-auth.decorator';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { RequestContext } from 'src/common/decorators/request-context.decorator';
import { Roles } from 'src/common/decorators/roles.decorator';
import { ErrorResponseDto } from 'src/common/dto/error-response.dto';
import { RESTAURANT_ADMIN_ROLES } from 'src/common/enums';
import type { AuditContext } from 'src/modules/audit/audit.service';
import {
  CreateStaffDto,
  ResetStaffPasswordDto,
  StaffMemberDto,
  UpdateStaffDto,
} from './dto/staff.dto';
import { StaffService } from './staff.service';

/**
 * The floor, as the restaurant manages it.
 *
 * Owners only. Adding somebody who can punch orders, or switching off somebody
 * who can, is a decision about who may move money through the restaurant - it
 * sits with the same people who already control discounts and settlement.
 *
 * Nothing here ever returns a password or a hash. A password is set once when
 * the account is made and replaced wholesale by a reset; there is no route that
 * reads one back, because there is no use for one.
 */
@ApiTags('Staff')
@ApiAuth()
@Roles(...RESTAURANT_ADMIN_ROLES)
@ApiNotFoundResponse({ description: 'No such person works here.', type: ErrorResponseDto })
@Controller('restaurants/me/staff')
export class StaffController {
  constructor(private readonly staffService: StaffService) {}

  @Get()
  @ApiOperation({
    summary: 'Everyone who works at this restaurant',
    description: 'Including the accounts that sign in with an email, which have no code.',
  })
  @ApiOkResponse({ type: [StaffMemberDto] })
  findAll(@ActiveRestaurantId() restaurantId: number): Promise<StaffMemberDto[]> {
    return this.staffService.findAll(restaurantId);
  }

  @Post()
  @ApiOperation({
    summary: 'Add somebody to the floor',
    description:
      'Creates an account that signs in on the captain app with a short code instead of an ' +
      'email address. The code is unique across Plateo, because every restaurant shares one ' +
      'sign-in page and nothing in that form says which restaurant is being signed in to.',
  })
  @ApiCreatedResponse({ type: StaffMemberDto })
  @ApiConflictResponse({ description: 'That code is already in use.', type: ErrorResponseDto })
  create(
    @ActiveRestaurantId() restaurantId: number,
    @CurrentUser('id') actorId: number,
    @Body() dto: CreateStaffDto,
    @RequestContext() context: AuditContext,
  ): Promise<StaffMemberDto> {
    return this.staffService.create(restaurantId, dto, actorId, context);
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Rename somebody, change their role, or switch them off',
    description:
      'Switching somebody off ends their logins on the next request rather than when their ' +
      'token expires, and keeps their name on every bill they already opened.',
  })
  @ApiOkResponse({ type: StaffMemberDto })
  update(
    @ActiveRestaurantId() restaurantId: number,
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser('id') actorId: number,
    @Body() dto: UpdateStaffDto,
    @RequestContext() context: AuditContext,
  ): Promise<StaffMemberDto> {
    return this.staffService.update(restaurantId, id, dto, actorId, context);
  }

  @Post(':id/password')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Give somebody a new password',
    description: 'Hand it to them directly. Plateo never emails it - these accounts have no address.',
  })
  @ApiNoContentResponse()
  resetPassword(
    @ActiveRestaurantId() restaurantId: number,
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser('id') actorId: number,
    @Body() dto: ResetStaffPasswordDto,
    @RequestContext() context: AuditContext,
  ): Promise<void> {
    return this.staffService.resetPassword(restaurantId, id, dto, actorId, context);
  }
}
