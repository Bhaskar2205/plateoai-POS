import { Body, Controller, Get, Param, ParseIntPipe, Post, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiCreatedResponse,
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
import { ORDER_WRITE_ROLES, TableBookingStatus } from 'src/common/enums';
import { AuditContext } from 'src/modules/audit/audit.service';
import { BookingsService } from './bookings.service';
import { CloseBookingDto, ConfirmBookingDto, QueryBookingsDto } from './dto/booking.dto';
import { TableBooking } from './entities/table-booking.entity';

/**
 * Table bookings, for the restaurant.
 *
 * Reading is open to any signed-in member: a waiter who can see what is booked is
 * a waiter who stops seating the window table at seven. Answering a booking is
 * `ORDER_WRITE_ROLES` - the same people who may take an order - because saying
 * yes to a booking is a promise made on the restaurant's behalf.
 */
@ApiTags('Table bookings')
@ApiAuth()
@ApiNotFoundResponse({
  description: 'No such booking in the authenticated restaurant.',
  type: ErrorResponseDto,
})
@Controller('restaurants/me/bookings')
export class BookingsController {
  constructor(private readonly bookingsService: BookingsService) {}

  @Get()
  @ApiOperation({
    summary: 'Bookings',
    description:
      'With no filter, returns everything still live, soonest first - which is what the screen ' +
      'opens on. Yesterday\'s unanswered requests are included, because a guest who was never ' +
      'replied to does not stop mattering at midnight.',
  })
  @ApiOkResponse({ type: [TableBooking] })
  findAll(
    @ActiveRestaurantId() restaurantId: number,
    @Query() query: QueryBookingsDto,
  ): Promise<TableBooking[]> {
    return this.bookingsService.findAll(restaurantId, query);
  }

  @Get('stale')
  @ApiOperation({
    summary: 'Confirmed bookings whose time has passed',
    description:
      'Surfaced, never closed automatically. Plateo cannot tell a no-show from a guest the staff ' +
      'forgot to mark as seated, and recording the first when it was the second puts a mark ' +
      'against somebody who did turn up.',
  })
  @ApiOkResponse({ type: [TableBooking] })
  findStale(@ActiveRestaurantId() restaurantId: number): Promise<TableBooking[]> {
    return this.bookingsService.findStale(restaurantId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'One booking' })
  @ApiOkResponse({ type: TableBooking })
  findOne(
    @ActiveRestaurantId() restaurantId: number,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<TableBooking> {
    return this.bookingsService.findOne(restaurantId, id);
  }

  @Post(':id/confirm')
  @Roles(...ORDER_WRITE_ROLES)
  @ApiOperation({
    summary: 'Confirm a booking',
    description: 'A table may be named now or left until the night.',
  })
  @ApiCreatedResponse({ type: TableBooking })
  @ApiBadRequestResponse({ description: 'That move is not possible.', type: ErrorResponseDto })
  confirm(
    @ActiveRestaurantId() restaurantId: number,
    @CurrentUser('id') userId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ConfirmBookingDto,
    @RequestContext() context: AuditContext,
  ): Promise<TableBooking> {
    return this.bookingsService.confirm(restaurantId, id, dto, userId, context);
  }

  @Post(':id/decline')
  @Roles(...ORDER_WRITE_ROLES)
  @ApiOperation({ summary: 'Decline a booking' })
  @ApiCreatedResponse({ type: TableBooking })
  decline(
    @ActiveRestaurantId() restaurantId: number,
    @CurrentUser('id') userId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CloseBookingDto,
    @RequestContext() context: AuditContext,
  ): Promise<TableBooking> {
    return this.bookingsService.moveTo(
      restaurantId,
      id,
      TableBookingStatus.DECLINED,
      dto,
      userId,
      context,
    );
  }

  @Post(':id/seat')
  @Roles(...ORDER_WRITE_ROLES)
  @ApiOperation({
    summary: 'Mark the guest as arrived and seated',
    description:
      'Records the arrival against the booking. It does not open a bill - taking the order is ' +
      'the floor\'s job, and a bill opened here would be one nobody asked for.',
  })
  @ApiCreatedResponse({ type: TableBooking })
  seat(
    @ActiveRestaurantId() restaurantId: number,
    @CurrentUser('id') userId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CloseBookingDto,
    @RequestContext() context: AuditContext,
  ): Promise<TableBooking> {
    return this.bookingsService.moveTo(
      restaurantId,
      id,
      TableBookingStatus.SEATED,
      dto,
      userId,
      context,
    );
  }

  @Post(':id/complete')
  @Roles(...ORDER_WRITE_ROLES)
  @ApiOperation({ summary: 'Close a booking out once the guests have left' })
  @ApiCreatedResponse({ type: TableBooking })
  complete(
    @ActiveRestaurantId() restaurantId: number,
    @CurrentUser('id') userId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CloseBookingDto,
    @RequestContext() context: AuditContext,
  ): Promise<TableBooking> {
    return this.bookingsService.moveTo(
      restaurantId,
      id,
      TableBookingStatus.COMPLETED,
      dto,
      userId,
      context,
    );
  }

  @Post(':id/no-show')
  @Roles(...ORDER_WRITE_ROLES)
  @ApiOperation({ summary: 'Record that nobody came' })
  @ApiCreatedResponse({ type: TableBooking })
  noShow(
    @ActiveRestaurantId() restaurantId: number,
    @CurrentUser('id') userId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CloseBookingDto,
    @RequestContext() context: AuditContext,
  ): Promise<TableBooking> {
    return this.bookingsService.moveTo(
      restaurantId,
      id,
      TableBookingStatus.NO_SHOW,
      dto,
      userId,
      context,
    );
  }

  @Post(':id/cancel')
  @Roles(...ORDER_WRITE_ROLES)
  @ApiOperation({
    summary: 'Cancel a booking',
    description: 'For when the guest rings to call it off.',
  })
  @ApiCreatedResponse({ type: TableBooking })
  cancel(
    @ActiveRestaurantId() restaurantId: number,
    @CurrentUser('id') userId: number,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CloseBookingDto,
    @RequestContext() context: AuditContext,
  ): Promise<TableBooking> {
    return this.bookingsService.moveTo(
      restaurantId,
      id,
      TableBookingStatus.CANCELLED,
      dto,
      userId,
      context,
    );
  }
}
