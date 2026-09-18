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
import { Roles } from 'src/common/decorators/roles.decorator';
import { ErrorResponseDto } from 'src/common/dto/error-response.dto';
import { RESTAURANT_ADMIN_ROLES } from 'src/common/enums';
import { CreateTableDto, UpdateTableDto } from './dto/create-table.dto';
import { RestaurantTableDto } from './dto/restaurant-table.dto';
import { TablesService } from './tables.service';

/**
 * Tables of the *active* restaurant from the access token - there is no
 * `/restaurants/:id/tables`, so a tenant can only ever address its own tables.
 * Owners (and Plateo support) only: table URLs are what gets printed and placed
 * in front of diners.
 */
@ApiTags('Tables')
@ApiAuth()
@Roles(...RESTAURANT_ADMIN_ROLES)
@ApiNotFoundResponse({ description: 'No such table in the authenticated restaurant.', type: ErrorResponseDto })
@Controller('restaurants/me/tables')
export class TablesController {
  constructor(private readonly tablesService: TablesService) {}

  @Post()
  @ApiOperation({ summary: 'Create a table with a new QR code' })
  @ApiCreatedResponse({ type: RestaurantTableDto })
  @ApiBadRequestResponse({ description: 'Invalid table name.', type: ErrorResponseDto })
  @ApiConflictResponse({ description: 'A table with this name already exists.', type: ErrorResponseDto })
  create(
    @ActiveRestaurantId() restaurantId: number,
    @Body() dto: CreateTableDto,
  ): Promise<RestaurantTableDto> {
    return this.tablesService.create(restaurantId, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List tables in natural name order' })
  @ApiOkResponse({ type: [RestaurantTableDto] })
  findAll(@ActiveRestaurantId() restaurantId: number): Promise<RestaurantTableDto[]> {
    return this.tablesService.findAll(restaurantId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get one table' })
  @ApiOkResponse({ type: RestaurantTableDto })
  findOne(
    @ActiveRestaurantId() restaurantId: number,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<RestaurantTableDto> {
    return this.tablesService.findOne(restaurantId, id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Rename a table or change whether it is active' })
  @ApiOkResponse({ type: RestaurantTableDto })
  @ApiConflictResponse({ description: 'Duplicate table name.', type: ErrorResponseDto })
  update(
    @ActiveRestaurantId() restaurantId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateTableDto,
  ): Promise<RestaurantTableDto> {
    return this.tablesService.update(restaurantId, id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a table', description: 'Its QR code stops working immediately.' })
  @ApiNoContentResponse({ description: 'Table deleted.' })
  remove(
    @ActiveRestaurantId() restaurantId: number,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<void> {
    return this.tablesService.remove(restaurantId, id);
  }

  @Post(':id/regenerate-qr')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Regenerate the table QR code',
    description: 'Issues a new random table token. The previous menu URL and printed QR code stop working.',
  })
  @ApiOkResponse({ type: RestaurantTableDto })
  regenerateQr(
    @ActiveRestaurantId() restaurantId: number,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<RestaurantTableDto> {
    return this.tablesService.regenerateQr(restaurantId, id);
  }
}
