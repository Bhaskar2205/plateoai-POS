import { Body, Controller, Param, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  ApiBadRequestResponse,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { Public } from 'src/common/decorators/public.decorator';
import { ErrorResponseDto } from 'src/common/dto/error-response.dto';
import { GENERAL_THROTTLE } from 'src/common/throttling';
import { resolveActiveRestaurant } from 'src/modules/public-menu/public-lookup';
import { Restaurant } from 'src/modules/restaurants/entities/restaurant.entity';
import { BookingsService } from './bookings.service';
import { CreateBookingDto } from './dto/booking.dto';
import { GuestBookingReceiptDto } from './dto/guest-booking-receipt.dto';

/**
 * Where the Plateo guest app sends a table booking.
 *
 * Anonymous, like the QR menu it sits beside: there are no diner accounts in
 * Plateo, and inventing one to take a booking would be a login between a guest
 * and a table. The restaurant is named by its public slug, exactly as the menu is.
 *
 * The response is deliberately thin - a reference and a status, nothing about the
 * restaurant's other bookings. A caller here is a stranger, and the booking they
 * just made is the only thing they are entitled to read back.
 *
 * Throttled harder than the menu. Reading a menu is free; creating rows is not,
 * and an unthrottled booking endpoint is a way to fill somebody's evening with
 * invented guests.
 */
@ApiTags('Guest app')
@Controller('public/restaurants')
export class GuestBookingsController {
  constructor(
    private readonly bookingsService: BookingsService,
    @InjectRepository(Restaurant) private readonly restaurants: Repository<Restaurant>,
  ) {}

  @Public()
  @Throttle({ [GENERAL_THROTTLE.name]: { limit: 10, ttl: 60_000 } })
  @Post(':slug/bookings')
  @ApiOperation({
    summary: 'Request a table',
    description:
      'Creates a booking in the REQUESTED state. It is a request, not a reservation: the ' +
      'restaurant has to confirm it, and the guest should be told so rather than shown a table ' +
      'nobody has agreed to.',
  })
  @ApiParam({ name: 'slug', example: 'the-green-bowl' })
  @ApiCreatedResponse({ type: GuestBookingReceiptDto })
  @ApiBadRequestResponse({
    description: 'The booking time is unreadable or in the past.',
    type: ErrorResponseDto,
  })
  @ApiNotFoundResponse({ description: 'No active restaurant with this slug.', type: ErrorResponseDto })
  async request(
    @Param('slug') slug: string,
    @Body() dto: CreateBookingDto,
  ): Promise<GuestBookingReceiptDto> {
    const restaurant = await resolveActiveRestaurant(this.restaurants, slug);
    const booking = await this.bookingsService.create(restaurant.id, dto);

    return {
      reference: booking.referenceNumber,
      status: booking.status,
      bookedFor: booking.bookedFor.toISOString(),
      partySize: booking.partySize,
      restaurantName: restaurant.name,
    };
  }
}
