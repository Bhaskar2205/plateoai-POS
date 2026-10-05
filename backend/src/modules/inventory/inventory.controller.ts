import { Body, Controller, Get, Param, ParseIntPipe, Patch, Post, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { ActiveRestaurantId } from 'src/common/decorators/active-restaurant.decorator';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { ApiAuth } from 'src/common/decorators/api-auth.decorator';
import { RequestContext } from 'src/common/decorators/request-context.decorator';
import { Roles } from 'src/common/decorators/roles.decorator';
import { ErrorResponseDto } from 'src/common/dto/error-response.dto';
import { MENU_WRITE_ROLES, RESTAURANT_ADMIN_ROLES } from 'src/common/enums';
import { businessDateFor } from 'src/common/utils/business-date.util';
import { AuditContext } from 'src/modules/audit/audit.service';
import { Ingredient } from 'src/modules/ingredients/entities/ingredient.entity';
import { ReportRangeDto } from 'src/modules/reports/dto/report-range.dto';
import {
  InventorySettingsDto,
  StockAdjustmentDto,
  StockCountDto,
  StockInDto,
  WastageDto,
} from './dto/stock.dto';
import { InventoryMovement } from './entities/inventory-movement.entity';
import {
  InventoryReport,
  InventoryService,
  InventorySettings,
  StockCountResult,
} from './inventory.service';

/**
 * Stock.
 *
 * Writing here is `MENU_WRITE_ROLES` - owners and managers - because stock is the
 * same kind of decision as what is on the menu and what it costs. Reading is open
 * to any signed-in member of the restaurant: a waiter who can see the paneer is
 * running out is a waiter who stops promising it.
 *
 * There is no endpoint that sets a quantity to a figure. Every change is a
 * movement of a size, which is both what makes the ledger complete and what stops
 * two people correcting the same ingredient from overwriting each other.
 */
@ApiTags('Inventory')
@ApiAuth()
@ApiNotFoundResponse({
  description: 'No such ingredient in the authenticated restaurant.',
  type: ErrorResponseDto,
})
@Controller('restaurants/me/inventory')
export class InventoryController {
  constructor(private readonly inventoryService: InventoryService) {}

  @Get('settings')
  @ApiOperation({
    summary: 'Inventory settings',
    description:
      'Every restaurant starts DISABLED, which means no stock is calculated and settling a bill ' +
      'behaves exactly as it did before inventory existed.',
  })
  @ApiOkResponse()
  settings(@ActiveRestaurantId() restaurantId: number): Promise<InventorySettings> {
    return this.inventoryService.settingsFor(restaurantId);
  }

  @Patch('settings')
  @Roles(...RESTAURANT_ADMIN_ROLES)
  @ApiOperation({
    summary: 'Turn stock tracking on or off',
    description:
      'Owner-only, and audited on its own, because the mode decides whether settling a bill ' +
      'deducts anything.',
  })
  @ApiOkResponse()
  updateSettings(
    @ActiveRestaurantId() restaurantId: number,
    @CurrentUser('id') userId: number,
    @Body() dto: InventorySettingsDto,
    @RequestContext() context: AuditContext,
  ): Promise<InventorySettings> {
    return this.inventoryService.updateSettings(restaurantId, dto, userId, context);
  }

  @Get('stock')
  @ApiOperation({
    summary: 'What is in stock',
    description:
      'Every active ingredient with the figure on the shelf. Returns normally even when ' +
      'inventory tracking is switched off, in which case the figures are all whatever they were ' +
      'last set to.',
  })
  @ApiQuery({ name: 'includeInactive', required: false, type: Boolean })
  @ApiOkResponse({ type: [Ingredient] })
  listStock(
    @ActiveRestaurantId() restaurantId: number,
    @Query('includeInactive') includeInactive?: string,
  ): Promise<Ingredient[]> {
    return this.inventoryService.listStock(restaurantId, includeInactive === 'true');
  }

  @Get('movements')
  @ApiOperation({
    summary: 'Stock history',
    description:
      'Every change to a stock figure, most recent first. Append-only: a mistake appears here ' +
      'alongside the movement that corrected it, rather than being erased by it.',
  })
  @ApiQuery({ name: 'ingredientId', required: false, type: Number })
  @ApiQuery({ name: 'limit', required: false, type: Number, description: 'Up to 500.' })
  @ApiOkResponse({ type: [InventoryMovement] })
  movements(
    @ActiveRestaurantId() restaurantId: number,
    @Query('ingredientId') ingredientId?: string,
    @Query('limit') limit?: string,
  ): Promise<InventoryMovement[]> {
    return this.inventoryService.movementsFor(
      restaurantId,
      ingredientId ? Number(ingredientId) : undefined,
      limit ? Number(limit) : undefined,
    );
  }

  @Post('ingredients/:id/stock-in')
  @Roles(...MENU_WRITE_ROLES)
  @ApiOperation({
    summary: 'Record a delivery',
    description:
      'Adds to stock. A cost given here becomes the ingredient cost from now on and never ' +
      'changes what an earlier movement was worth, so last month figures stay as they were.',
  })
  @ApiCreatedResponse({ type: InventoryMovement })
  addStock(
    @ActiveRestaurantId() restaurantId: number,
    @CurrentUser('id') userId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: StockInDto,
    @RequestContext() context: AuditContext,
  ): Promise<InventoryMovement> {
    return this.inventoryService.addStock(restaurantId, id, dto, userId, context);
  }

  @Post('ingredients/:id/adjust')
  @Roles(...MENU_WRITE_ROLES)
  @ApiOperation({
    summary: 'Correct a figure by hand',
    description:
      'The quantity is the size of the change, not the total to end up at, and a reason is ' +
      'required. A decrease below zero is refused unless the restaurant allows negative stock.',
  })
  @ApiCreatedResponse({ type: InventoryMovement })
  @ApiBadRequestResponse({
    description: 'The decrease is larger than what is in stock.',
    type: ErrorResponseDto,
  })
  adjustStock(
    @ActiveRestaurantId() restaurantId: number,
    @CurrentUser('id') userId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: StockAdjustmentDto,
    @RequestContext() context: AuditContext,
  ): Promise<InventoryMovement> {
    return this.inventoryService.adjustStock(restaurantId, id, dto, userId, context);
  }

  @Post('ingredients/:id/wastage')
  @Roles(...MENU_WRITE_ROLES)
  @ApiOperation({
    summary: 'Record wastage',
    description:
      'A decrease kept separate from an ordinary correction, because what a kitchen throws away ' +
      'is a number worth seeing on its own.',
  })
  @ApiCreatedResponse({ type: InventoryMovement })
  @ApiBadRequestResponse({
    description: 'More was wasted than was in stock.',
    type: ErrorResponseDto,
  })
  recordWastage(
    @ActiveRestaurantId() restaurantId: number,
    @CurrentUser('id') userId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: WastageDto,
    @RequestContext() context: AuditContext,
  ): Promise<InventoryMovement> {
    return this.inventoryService.recordWastage(restaurantId, id, dto, userId, context);
  }

  @Post('stock-count')
  @Roles(...MENU_WRITE_ROLES)
  @ApiOperation({
    summary: 'Record a physical count',
    description:
      'Send only the ingredients actually counted. One left out is left alone, because "not ' +
      'counted" and "counted as zero" are different things. An ingredient whose figure already ' +
      'matches gets no movement, so submitting the same count twice changes nothing.',
  })
  @ApiCreatedResponse()
  recordStockCount(
    @ActiveRestaurantId() restaurantId: number,
    @CurrentUser('id') userId: number,
    @Body() dto: StockCountDto,
    @RequestContext() context: AuditContext,
  ): Promise<StockCountResult> {
    return this.inventoryService.recordStockCount(restaurantId, dto, userId, context);
  }

  @Get('report')
  @ApiOperation({
    summary: 'What a period did to the shelves',
    description:
      'Consumption, wastage, deliveries and corrections over a range of business days, plus what ' +
      'is on the shelf now and what is running low. Business days, not timestamps, so the range ' +
      'means the same thing it does in the sales report.',
  })
  @ApiOkResponse()
  report(
    @ActiveRestaurantId() restaurantId: number,
    @Query() range: ReportRangeDto,
  ): Promise<InventoryReport> {
    const today = businessDateFor();

    return this.inventoryService.report(
      restaurantId,
      range.from ?? today,
      range.to ?? range.from ?? today,
    );
  }
}
