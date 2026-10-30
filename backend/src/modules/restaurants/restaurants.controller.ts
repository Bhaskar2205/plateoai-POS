import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiConsumes,
  ApiConflictResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { ErrorResponseDto } from 'src/common/dto/error-response.dto';
import { ApiAuth } from 'src/common/decorators/api-auth.decorator';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { ActiveRestaurantId } from 'src/common/decorators/active-restaurant.decorator';
import { RequestContext } from 'src/common/decorators/request-context.decorator';
import type { AuditContext } from 'src/modules/audit/audit.service';
import { Roles } from 'src/common/decorators/roles.decorator';
import { RESTAURANT_ADMIN_ROLES, UserRole } from 'src/common/enums';
import { KitchenCodeDto } from './dto/kitchen-code.dto';
import { PrintSettingsDto, UpdatePrintSettingsDto } from './dto/print-settings.dto';
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

  @Get('me/print-settings')
  @Roles(...RESTAURANT_ADMIN_ROLES)
  @ApiOperation({
    summary: 'What this restaurant prints on its bills',
    description:
      'The payment QR, its caption, and whether it is currently being printed. Everything else ' +
      'about the KOT and the bill - roll width, dot pitch, which fields each document carries - ' +
      'is fixed by the paper and by what a kitchen ticket and a tax invoice have to say.',
  })
  @ApiOkResponse({ type: PrintSettingsDto })
  getPrintSettings(@ActiveRestaurantId() restaurantId: number): Promise<PrintSettingsDto> {
    return this.restaurantsService.getPrintSettings(restaurantId);
  }

  @Patch('me/print-settings')
  @Roles(...RESTAURANT_ADMIN_ROLES)
  @ApiOperation({
    summary: 'Change the caption, or start and stop printing the QR',
    description:
      'Owners only. The image itself is not set here - see `POST /restaurants/me/payment-qr`, ' +
      'which takes the file. Switching printing on without a QR uploaded is refused rather than ' +
      'silently doing nothing.',
  })
  @ApiOkResponse({ type: PrintSettingsDto })
  @ApiConflictResponse({ description: 'Printing switched on with no QR uploaded.', type: ErrorResponseDto })
  updatePrintSettings(
    @ActiveRestaurantId() restaurantId: number,
    @CurrentUser('id') userId: number,
    @Body() dto: UpdatePrintSettingsDto,
    @RequestContext() context: AuditContext,
  ): Promise<PrintSettingsDto> {
    return this.restaurantsService.updatePrintSettings(restaurantId, dto, userId, context);
  }

  @Post('me/payment-qr')
  @HttpCode(HttpStatus.OK)
  @Roles(...RESTAURANT_ADMIN_ROLES)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 12 * 1024 * 1024, files: 1 } }))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  @ApiOperation({
    summary: "Upload the restaurant's payment QR",
    description:
      'Owners only. Takes a JPEG, PNG or WebP picture of the code the restaurant already uses, ' +
      're-encodes it as a lossless PNG on white, stores it and puts it on the restaurant in one ' +
      'step. Any previous code is deleted. ' +
      'Plateo does not read the code, does not know the account behind it, and never treats a ' +
      'scan as a payment: a bill is still settled by a person pressing Settle.',
  })
  @ApiOkResponse({ type: PrintSettingsDto })
  @ApiBadRequestResponse({
    description: 'Not an image, an unreadable image, or larger than the limit.',
    type: ErrorResponseDto,
  })
  setPaymentQr(
    @ActiveRestaurantId() restaurantId: number,
    @CurrentUser('id') userId: number,
    @UploadedFile() file: Express.Multer.File,
    @RequestContext() context: AuditContext,
  ): Promise<PrintSettingsDto> {
    return this.restaurantsService.setPaymentQr(restaurantId, file, userId, context);
  }

  @Post('me/logo')
  @HttpCode(HttpStatus.OK)
  @Roles(...RESTAURANT_ADMIN_ROLES)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 12 * 1024 * 1024, files: 1 } }))
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  @ApiOperation({
    summary: "Upload the logo printed on bills",
    description:
      'Owners only. Takes a JPEG, PNG or WebP image, re-encodes it as a lossless PNG on white, ' +
      'fits it to 600px and puts it on the restaurant in one step. Any previous logo is deleted. ' +
      'It is printed across the top of the customer bill, above the name, address and GSTIN. The ' +
      'kitchen ticket never carries it - a cook does not need the branding and the roll is short.',
  })
  @ApiOkResponse({ type: PrintSettingsDto })
  @ApiBadRequestResponse({
    description: 'Not an image, an unreadable image, or larger than the limit.',
    type: ErrorResponseDto,
  })
  setLogo(
    @ActiveRestaurantId() restaurantId: number,
    @CurrentUser('id') userId: number,
    @UploadedFile() file: Express.Multer.File,
    @RequestContext() context: AuditContext,
  ): Promise<PrintSettingsDto> {
    return this.restaurantsService.setLogo(restaurantId, file, userId, context);
  }

  @Delete('me/logo')
  @HttpCode(HttpStatus.OK)
  @Roles(...RESTAURANT_ADMIN_ROLES)
  @ApiOperation({
    summary: 'Remove the bill logo',
    description: 'Owners only. Bills then print the restaurant name alone at the top.',
  })
  @ApiOkResponse({ type: PrintSettingsDto })
  clearLogo(
    @ActiveRestaurantId() restaurantId: number,
    @CurrentUser('id') userId: number,
    @RequestContext() context: AuditContext,
  ): Promise<PrintSettingsDto> {
    return this.restaurantsService.clearLogo(restaurantId, userId, context);
  }

  @Delete('me/payment-qr')
  @HttpCode(HttpStatus.OK)
  @Roles(...RESTAURANT_ADMIN_ROLES)
  @ApiOperation({
    summary: 'Remove the payment QR',
    description: 'Owners only. Deletes the stored image and stops printing it.',
  })
  @ApiOkResponse({ type: PrintSettingsDto })
  clearPaymentQr(
    @ActiveRestaurantId() restaurantId: number,
    @CurrentUser('id') userId: number,
    @RequestContext() context: AuditContext,
  ): Promise<PrintSettingsDto> {
    return this.restaurantsService.clearPaymentQr(restaurantId, userId, context);
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
