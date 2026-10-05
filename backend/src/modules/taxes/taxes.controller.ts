import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
  Post,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiCreatedResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { ActiveRestaurantId } from 'src/common/decorators/active-restaurant.decorator';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { RequestContext } from 'src/common/decorators/request-context.decorator';
import type { AuditContext } from 'src/modules/audit/audit.service';
import { ApiAuth } from 'src/common/decorators/api-auth.decorator';
import { Roles } from 'src/common/decorators/roles.decorator';
import { ErrorResponseDto } from 'src/common/dto/error-response.dto';
import { RESTAURANT_ADMIN_ROLES } from 'src/common/enums';
import {
  ApplyTaxProfileDto,
  CreateTaxComponentDto,
  TaxComponentDto,
  TaxProfileDto,
  UpdateTaxComponentDto,
} from './dto/tax-component.dto';
import { TaxesService } from './taxes.service';

/**
 * What a restaurant charges on top of its menu prices.
 *
 * Owners only. A change here changes every bill the restaurant issues from that
 * moment, which is a different kind of decision from taking an order, so it sits
 * with the people who answer for the restaurant's filings.
 */
@ApiTags('Taxes')
@ApiAuth()
@Roles(...RESTAURANT_ADMIN_ROLES)
@ApiNotFoundResponse({ description: 'No such charge in the authenticated restaurant.', type: ErrorResponseDto })
@Controller('restaurants/me/taxes')
export class TaxesController {
  constructor(private readonly taxesService: TaxesService) {}

  @Get()
  @ApiOperation({
    summary: 'The restaurant tax profile',
    description:
      'Every charge the restaurant adds to a bill, plus suggested starting points for Indian ' +
      'restaurants. An empty list means the restaurant bills its menu prices with nothing on top.',
  })
  @ApiOkResponse({ type: TaxProfileDto })
  profile(@ActiveRestaurantId() restaurantId: number): Promise<TaxProfileDto> {
    return this.taxesService.profile(restaurantId);
  }

  @Post()
  @ApiOperation({
    summary: 'Add a charge',
    description:
      'CGST and SGST are separate charges on purpose: an Indian tax invoice has to show each ' +
      'component on its own line. A service charge is added here too, and is taxed along with the food.',
  })
  @ApiCreatedResponse({ type: TaxComponentDto })
  @ApiBadRequestResponse({ description: 'Invalid rate, or too many charges already.', type: ErrorResponseDto })
  create(
    @ActiveRestaurantId() restaurantId: number,
    @Body() dto: CreateTaxComponentDto,
    @CurrentUser('id') userId: number,
    @RequestContext() context: AuditContext,
  ): Promise<TaxComponentDto> {
    return this.taxesService.create(restaurantId, dto, userId, context);
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Change a charge',
    description:
      'Applies to bills that are still open. Settled bills keep the breakdown they were charged.',
  })
  @ApiOkResponse({ type: TaxComponentDto })
  update(
    @ActiveRestaurantId() restaurantId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateTaxComponentDto,
    @CurrentUser('id') userId: number,
    @RequestContext() context: AuditContext,
  ): Promise<TaxComponentDto> {
    return this.taxesService.update(restaurantId, id, dto, userId, context);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'Remove a charge',
    description: 'To stop charging something but keep it for later, set isActive to false instead.',
  })
  @ApiNoContentResponse({ description: 'Removed.' })
  remove(
    @ActiveRestaurantId() restaurantId: number,
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser('id') userId: number,
    @RequestContext() context: AuditContext,
  ): Promise<void> {
    return this.taxesService.remove(restaurantId, id, userId, context);
  }

  @Post('apply-profile')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Start from a suggested profile',
    description:
      'Replaces the whole profile, so moving from 5% to 18% does not leave a restaurant charging 23%. ' +
      'These are starting points to confirm, not advice: the rate a restaurant owes depends on its own ' +
      'registration and premises.',
  })
  @ApiOkResponse({ type: TaxProfileDto })
  @ApiNotFoundResponse({ description: 'No such suggested profile.', type: ErrorResponseDto })
  applyProfile(
    @ActiveRestaurantId() restaurantId: number,
    @Body() dto: ApplyTaxProfileDto,
    @CurrentUser('id') userId: number,
    @RequestContext() context: AuditContext,
  ): Promise<TaxProfileDto> {
    return this.taxesService.applyProfile(restaurantId, dto, userId, context);
  }
}
