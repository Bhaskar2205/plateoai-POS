import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DishIngredient } from 'src/modules/dishes/entities/dish-ingredient.entity';
import { Ingredient } from 'src/modules/ingredients/entities/ingredient.entity';
import { OrderItem } from 'src/modules/orders/entities/order-item.entity';
import { Restaurant } from 'src/modules/restaurants/entities/restaurant.entity';
import { InventoryMovement } from './entities/inventory-movement.entity';
import { InventoryController } from './inventory.controller';
import { InventoryService } from './inventory.service';

/**
 * Stock.
 *
 * Exports the service because settling a bill has to deduct what the bill used,
 * and that has to happen inside the transaction that settles it. Orders therefore
 * imports this module rather than this module reaching into orders.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([Ingredient, InventoryMovement, DishIngredient, OrderItem, Restaurant]),
  ],
  controllers: [InventoryController],
  providers: [InventoryService],
  exports: [InventoryService],
})
export class InventoryModule {}
