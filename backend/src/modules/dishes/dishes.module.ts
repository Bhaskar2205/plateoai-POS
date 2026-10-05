import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CategoriesModule } from 'src/modules/categories/categories.module';
import { IngredientsModule } from 'src/modules/ingredients/ingredients.module';
import { UploadsModule } from 'src/modules/uploads/uploads.module';
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
    // Replacing or deleting a dish photo has to remove the file it leaves
    // behind, which is billed per image once photos live in Cloudflare.
    UploadsModule,
  ],
  controllers: [DishesController],
  providers: [DishesService, DishIngredientsService],
  exports: [DishesService, DishIngredientsService, TypeOrmModule],
})
export class DishesModule {}
