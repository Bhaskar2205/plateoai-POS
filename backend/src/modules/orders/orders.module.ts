import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DishIngredient } from 'src/modules/dishes/entities/dish-ingredient.entity';
import { Dish } from 'src/modules/dishes/entities/dish.entity';
import { Restaurant } from 'src/modules/restaurants/entities/restaurant.entity';
import { RestaurantTable } from 'src/modules/tables/entities/restaurant-table.entity';
import { DataRetentionController } from './data-retention.controller';
import { DataRetentionService } from './data-retention.service';
import { DinerOrdersController } from './diner-orders.controller';
import { DinerOrdersService } from './diner-orders.service';
import { InventoryModule } from 'src/modules/inventory/inventory.module';
import { TaxComponent } from 'src/modules/taxes/entities/tax-component.entity';
import { OrderCharge } from './entities/order-charge.entity';
import { KotTicket } from './entities/kot-ticket.entity';
import { OrderItem } from './entities/order-item.entity';
import { Order } from './entities/order.entity';
import { KitchenController } from './kitchen.controller';
import { KitchenService } from './kitchen.service';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';

/**
 * Ordering, kitchen tickets and billing.
 *
 * Three services with three different audiences, deliberately kept apart rather
 * than merged into one "orders" service: staff ordering and billing
 * (`OrdersService`), the kitchen panel (`KitchenService`, which never touches
 * money) and anonymous diner self-ordering (`DinerOrdersService`, which can only
 * ever create pending requests). Depends on repositories rather than on the menu
 * and table services, so none of their write paths are reachable from here.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      Order,
      OrderItem,
      OrderCharge,
      KotTicket,
      TaxComponent,
      Dish,
      DishIngredient,
      RestaurantTable,
      Restaurant,
    ]),
    // Settling a bill deducts what the bill used, in the same transaction.
    InventoryModule,
  ],
  controllers: [OrdersController, KitchenController, DinerOrdersController, DataRetentionController],
  providers: [OrdersService, KitchenService, DinerOrdersService, DataRetentionService],
  // Payments settle bills through the same guarded path the till uses.
  exports: [OrdersService],
})
export class OrdersModule {}
