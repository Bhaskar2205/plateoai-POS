import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Restaurant } from 'src/modules/restaurants/entities/restaurant.entity';
import { RestaurantTable } from 'src/modules/tables/entities/restaurant-table.entity';
import { BookingsController } from './bookings.controller';
import { BookingsService } from './bookings.service';
import { TableBooking } from './entities/table-booking.entity';
import { GuestBookingsController } from './guest-bookings.controller';

/**
 * Table bookings made through the Plateo guest app.
 *
 * Depends on repositories rather than on the tables or orders services, so none
 * of their write paths are reachable from a booking - confirming a booking must
 * never be able to deactivate a table or open a bill.
 */
@Module({
  imports: [TypeOrmModule.forFeature([TableBooking, RestaurantTable, Restaurant])],
  controllers: [BookingsController, GuestBookingsController],
  providers: [BookingsService],
  exports: [BookingsService],
})
export class BookingsModule {}
