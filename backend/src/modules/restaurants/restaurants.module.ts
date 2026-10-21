import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Category } from 'src/modules/categories/entities/category.entity';
import { Dish } from 'src/modules/dishes/entities/dish.entity';
import { Ingredient } from 'src/modules/ingredients/entities/ingredient.entity';
import { UploadsModule } from 'src/modules/uploads/uploads.module';
import { RestaurantUser } from './entities/restaurant-user.entity';
import { Restaurant } from './entities/restaurant.entity';
import { RestaurantsController } from './restaurants.controller';
import { RestaurantsService } from './restaurants.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Restaurant, RestaurantUser, Category, Dish, Ingredient]),
    // For the payment QR an owner uploads: stored as a file, like a dish photo.
    UploadsModule,
  ],
  controllers: [RestaurantsController],
  providers: [RestaurantsService],
  exports: [RestaurantsService, TypeOrmModule],
})
export class RestaurantsModule {}
