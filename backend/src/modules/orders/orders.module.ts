import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Dish } from 'src/modules/dishes/entities/dish.entity';
import { Restaurant } from 'src/modules/restaurants/entities/restaurant.entity';
import { RestaurantTable } from 'src/modules/tables/entities/restaurant-table.entity';
import { DinerOrdersController } from './diner-orders.controller';
import { DinerOrdersService } from './diner-orders.service';
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
    TypeOrmModule.forFeature([Order, OrderItem, KotTicket, Dish, RestaurantTable, Restaurant]),
  ],
  controllers: [OrdersController, KitchenController, DinerOrdersController],
  providers: [OrdersService, KitchenService, DinerOrdersService],
})
export class OrdersModule {}
