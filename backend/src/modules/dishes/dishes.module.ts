import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CategoriesModule } from 'src/modules/categories/categories.module';
import { IngredientsModule } from 'src/modules/ingredients/ingredients.module';
import { DishIngredientsService } from './dish-ingredients.service';
import { DishesController } from './dishes.controller';
import { DishesService } from './dishes.service';
import { DishIngredient } from './entities/dish-ingredient.entity';
import { Dish } from './entities/dish.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([Dish, DishIngredient]),
    CategoriesModule,
    IngredientsModule,
  ],
  controllers: [DishesController],
  providers: [DishesService, DishIngredientsService],
  exports: [DishesService, DishIngredientsService, TypeOrmModule],
})
export class DishesModule {}
