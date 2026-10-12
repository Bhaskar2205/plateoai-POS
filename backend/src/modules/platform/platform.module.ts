import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RestaurantUser } from 'src/modules/restaurants/entities/restaurant-user.entity';
import { Restaurant } from 'src/modules/restaurants/entities/restaurant.entity';
import { RestaurantsModule } from 'src/modules/restaurants/restaurants.module';
import { User } from 'src/modules/users/entities/user.entity';
import { UsersModule } from 'src/modules/users/users.module';
import { PlatformBootstrapService } from './platform-bootstrap.service';
import { PlatformController } from './platform.controller';
import { PlatformService } from './platform.service';

/**
 * Running Plateo rather than running a restaurant.
 *
 * The only module that reaches across tenants on purpose. It reuses the
 * restaurant and user services rather than writing its own inserts, so a
 * restaurant opened from the admin panel is built exactly the way one always
 * was - same slug rules, same kitchen code, same membership row.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([Restaurant, RestaurantUser, User]),
    RestaurantsModule,
    UsersModule,
  ],
  controllers: [PlatformController],
  providers: [PlatformService, PlatformBootstrapService],
  exports: [PlatformService],
})
export class PlatformModule {}
