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
  Query,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { ActiveRestaurantId } from 'src/common/decorators/active-restaurant.decorator';
import { ApiAuth } from 'src/common/decorators/api-auth.decorator';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { Roles } from 'src/common/decorators/roles.decorator';
import { ErrorResponseDto } from 'src/common/dto/error-response.dto';
import { BILLING_ROLES, ORDER_WRITE_ROLES } from 'src/common/enums';
import {
  ApplyDiscountDto,
  ApproveOrderItemsDto,
  CancelOrderDto,
  CancelOrderItemDto,
  QueryOrdersDto,
  SettleOrderDto,
  UpdateOrderItemDto,
} from './dto/order-actions.dto';
import { AddOrderItemsDto, CreateOrderDto } from './dto/order-input.dto';
import { BillDto, KotPrintDto, OrderDto, TableOrderSummaryDto } from './dto/order.dto';
import { OrdersService } from './orders.service';

/**
 * Orders and bills of the *active* restaurant from the access token. There is no
 * `/restaurants/:id/orders`, so a tenant can only ever reach its own tables.
 *
 * Roles are split on purpose, per route rather than per controller:
 *  - `ORDER_WRITE_ROLES` (which includes waiters) take and change orders and send
 *    them to the kitchen;
 *  - `BILLING_ROLES` (owners and managers only) discount, settle and void a bill.
 * Taking an order and taking the money are different responsibilities, and a
 * waiter's phone is the device most likely to be left on a table.
 */
@ApiTags('Orders')
@ApiAuth()
@ApiNotFoundResponse({
  description: 'No such order, line or table in the authenticated restaurant.',
  type: ErrorResponseDto,
})
@Controller('restaurants/me')
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Get('floor')
  @Roles(...ORDER_WRITE_ROLES)
  @ApiOperation({
    summary: 'Every table with its open bill',
    description:
      'What the admin Tables page shows: each table, whether a bill is open at it, its running ' +
      'total, and how many diner requests are waiting for approval.',
  })
  @ApiOkResponse({ type: [TableOrderSummaryDto] })
  tableOverview(@ActiveRestaurantId() restaurantId: number): Promise<TableOrderSummaryDto[]> {
    return this.ordersService.findTableSummaries(restaurantId);
  }

  @Get('floor/:tableId/order')
  @Roles(...ORDER_WRITE_ROLES)
  @ApiOperation({
    summary: 'The open bill at one table',
    description: 'Returns null when the table is free, which is not an error.',
  })
  @ApiOkResponse({ type: OrderDto, description: 'The open bill, or null.' })
  openOrderForTable(
    @ActiveRestaurantId() restaurantId: number,
    @Param('tableId', ParseIntPipe) tableId: number,
  ): Promise<OrderDto | null> {
    return this.ordersService.findOpenForTable(restaurantId, tableId);
  }

  @Get('orders')
  @Roles(...ORDER_WRITE_ROLES)
  @ApiOperation({
    summary: 'List orders',
    description:
      'Open bills whatever their date, plus bills closed during the current business day. ' +
      'Filterable by status and table.',
  })
  @ApiOkResponse({ type: [OrderDto] })
  findAll(
    @ActiveRestaurantId() restaurantId: number,
    @Query() query: QueryOrdersDto,
  ): Promise<OrderDto[]> {
    return this.ordersService.findAll(restaurantId, query);
  }

  @Get('orders/:id')
  @Roles(...ORDER_WRITE_ROLES)
  @ApiOperation({ summary: 'Get one order with its lines and kitchen tickets' })
  @ApiOkResponse({ type: OrderDto })
  findOne(
    @ActiveRestaurantId() restaurantId: number,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<OrderDto> {
    return this.ordersService.findOne(restaurantId, id);
  }

  @Post('orders')
  @Roles(...ORDER_WRITE_ROLES)
  @ApiOperation({
    summary: 'Open a bill',
    description:
      'Prices are taken from the menu, never from the request. Lines entered by staff are ' +
      'approved already and wait only for a kitchen ticket.',
  })
  @ApiCreatedResponse({ type: OrderDto })
  @ApiBadRequestResponse({ description: 'Unavailable dish, or inactive table.', type: ErrorResponseDto })
  @ApiConflictResponse({ description: 'The table already has an open bill.', type: ErrorResponseDto })
  create(
    @ActiveRestaurantId() restaurantId: number,
    @CurrentUser('id') userId: number,
    @Body() dto: CreateOrderDto,
  ): Promise<OrderDto> {
    return this.ordersService.create(restaurantId, userId, dto);
  }

  @Post('orders/:id/items')
  @HttpCode(HttpStatus.OK)
  @Roles(...ORDER_WRITE_ROLES)
  @ApiOperation({ summary: 'Add lines to an open bill' })
  @ApiOkResponse({ type: OrderDto })
  @ApiBadRequestResponse({ description: 'Bill is closed, or a dish is unavailable.', type: ErrorResponseDto })
  addItems(
    @ActiveRestaurantId() restaurantId: number,
    @CurrentUser('id') userId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: AddOrderItemsDto,
  ): Promise<OrderDto> {
    return this.ordersService.addItems(restaurantId, id, userId, dto);
  }

  @Patch('orders/:id/items/:itemId')
  @Roles(...ORDER_WRITE_ROLES)
  @ApiOperation({
    summary: 'Change a line',
    description: 'Only while it has not gone to the kitchen. After that, cancel it instead.',
  })
  @ApiOkResponse({ type: OrderDto })
  @ApiBadRequestResponse({ description: 'The line is already with the kitchen.', type: ErrorResponseDto })
  updateItem(
    @ActiveRestaurantId() restaurantId: number,
    @Param('id', ParseIntPipe) id: number,
    @Param('itemId', ParseIntPipe) itemId: number,
    @Body() dto: UpdateOrderItemDto,
  ): Promise<OrderDto> {
    return this.ordersService.updateItem(restaurantId, id, itemId, dto);
  }

  @Post('orders/:id/items/:itemId/cancel')
  @HttpCode(HttpStatus.OK)
  @Roles(...ORDER_WRITE_ROLES)
  @ApiOperation({
    summary: 'Cancel a line',
    description:
      'The line stays on the order with its reason, so an owner can see afterwards what came off ' +
      'the bill. Cancelling the last live line of a kitchen ticket cancels the ticket too.',
  })
  @ApiOkResponse({ type: OrderDto })
  cancelItem(
    @ActiveRestaurantId() restaurantId: number,
    @Param('id', ParseIntPipe) id: number,
    @Param('itemId', ParseIntPipe) itemId: number,
    @Body() dto: CancelOrderItemDto,
  ): Promise<OrderDto> {
    return this.ordersService.cancelItem(restaurantId, id, itemId, dto);
  }

  @Post('orders/:id/approve')
  @HttpCode(HttpStatus.OK)
  @Roles(...ORDER_WRITE_ROLES)
  @ApiOperation({
    summary: 'Approve diner requests',
    description: 'With no ids, approves every line still waiting at this table.',
  })
  @ApiOkResponse({ type: OrderDto })
  @ApiBadRequestResponse({ description: 'Nothing is waiting for approval.', type: ErrorResponseDto })
  approve(
    @ActiveRestaurantId() restaurantId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ApproveOrderItemsDto,
  ): Promise<OrderDto> {
    return this.ordersService.approveItems(restaurantId, id, dto);
  }

  @Post('orders/:id/kot')
  @Roles(...ORDER_WRITE_ROLES)
  @ApiOperation({
    summary: 'Send the approved lines to the kitchen',
    description:
      'Creates a new kitchen ticket from everything approved but not yet sent, and returns it ready ' +
      'to print. Ordering again later produces a second ticket rather than a reprint, so the kitchen ' +
      'only ever sees what is new.',
  })
  @ApiCreatedResponse({ type: KotPrintDto })
  @ApiBadRequestResponse({
    description: 'Nothing new to send, or requests still need approval.',
    type: ErrorResponseDto,
  })
  sendToKitchen(
    @ActiveRestaurantId() restaurantId: number,
    @CurrentUser('id') userId: number,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<KotPrintDto> {
    return this.ordersService.createKotTicket(restaurantId, id, userId);
  }

  @Get('orders/:id/kot/:ticketId')
  @Roles(...ORDER_WRITE_ROLES)
  @ApiOperation({ summary: 'Fetch a kitchen ticket again, to reprint it' })
  @ApiOkResponse({ type: KotPrintDto })
  kot(
    @ActiveRestaurantId() restaurantId: number,
    @Param('id', ParseIntPipe) id: number,
    @Param('ticketId', ParseIntPipe) ticketId: number,
  ): Promise<KotPrintDto> {
    return this.ordersService.kotPrint(restaurantId, id, ticketId);
  }

  @Get('orders/:id/bill')
  @Roles(...ORDER_WRITE_ROLES)
  @ApiOperation({
    summary: 'The bill, ready to print',
    description: 'Cancelled lines are left off. Works before and after settlement.',
  })
  @ApiOkResponse({ type: BillDto })
  bill(
    @ActiveRestaurantId() restaurantId: number,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<BillDto> {
    return this.ordersService.bill(restaurantId, id);
  }

  @Post('orders/:id/discount')
  @HttpCode(HttpStatus.OK)
  @Roles(...BILLING_ROLES)
  @ApiOperation({
    summary: 'Discount a bill',
    description:
      'Owners and managers only, never waiters. A reason is required, and no discount may exceed ' +
      'half the subtotal, whether it is expressed as a percentage or a flat amount.',
  })
  @ApiOkResponse({ type: OrderDto })
  @ApiBadRequestResponse({ description: 'Discount too large, or the bill is empty or closed.', type: ErrorResponseDto })
  applyDiscount(
    @ActiveRestaurantId() restaurantId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ApplyDiscountDto,
  ): Promise<OrderDto> {
    return this.ordersService.applyDiscount(restaurantId, id, dto);
  }

  @Delete('orders/:id/discount')
  @Roles(...BILLING_ROLES)
  @ApiOperation({ summary: 'Remove a discount' })
  @ApiOkResponse({ type: OrderDto })
  removeDiscount(
    @ActiveRestaurantId() restaurantId: number,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<OrderDto> {
    return this.ordersService.removeDiscount(restaurantId, id);
  }

  @Post('orders/:id/settle')
  @HttpCode(HttpStatus.OK)
  @Roles(...BILLING_ROLES)
  @ApiOperation({
    summary: 'Settle a bill',
    description:
      'Freezes the restaurant\'s current tax rate onto the bill, so a later change to that rate ' +
      'cannot rewrite what a diner already paid. Pending diner requests must be approved or ' +
      'cancelled first.',
  })
  @ApiOkResponse({ type: OrderDto })
  @ApiBadRequestResponse({
    description: 'Empty bill, already closed, or requests still pending.',
    type: ErrorResponseDto,
  })
  settle(
    @ActiveRestaurantId() restaurantId: number,
    @CurrentUser('id') userId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SettleOrderDto,
  ): Promise<OrderDto> {
    return this.ordersService.settle(restaurantId, id, userId, dto);
  }

  @Post('orders/:id/cancel')
  @HttpCode(HttpStatus.OK)
  @Roles(...BILLING_ROLES)
  @ApiOperation({
    summary: 'Void a whole bill',
    description: 'Keeps the order and its lines, with the reason recorded, and stops its tickets.',
  })
  @ApiOkResponse({ type: OrderDto })
  cancel(
    @ActiveRestaurantId() restaurantId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CancelOrderDto,
  ): Promise<OrderDto> {
    return this.ordersService.cancel(restaurantId, id, dto);
  }
}
