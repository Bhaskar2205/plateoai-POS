import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Category } from 'src/modules/categories/entities/category.entity';
import { DishIngredient } from 'src/modules/dishes/entities/dish-ingredient.entity';
import { Dish } from 'src/modules/dishes/entities/dish.entity';
import { Restaurant } from 'src/modules/restaurants/entities/restaurant.entity';
import { RestaurantTable } from 'src/modules/tables/entities/restaurant-table.entity';
import { PublicMenuController } from './public-menu.controller';
import { PublicMenuService } from './public-menu.service';

/**
 * Read-only public menu. Deliberately depends on repositories only, not on the
 * owner-facing services, so none of their write paths are reachable from here.
 */
@Module({
  imports: [TypeOrmModule.forFeature([Restaurant, Category, Dish, DishIngredient, RestaurantTable])],
  controllers: [PublicMenuController],
  providers: [PublicMenuService],
})
export class PublicMenuModule {}
