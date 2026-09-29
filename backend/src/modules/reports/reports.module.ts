import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Category } from 'src/modules/categories/entities/category.entity';
import { Dish } from 'src/modules/dishes/entities/dish.entity';
import { KotTicket } from 'src/modules/orders/entities/kot-ticket.entity';
import { OrderItem } from 'src/modules/orders/entities/order-item.entity';
import { Order } from 'src/modules/orders/entities/order.entity';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';

/**
 * Reporting. Read-only by construction: it depends on repositories and exposes
 * nothing that writes, so no report can ever change a bill it is counting.
 */
@Module({
  imports: [TypeOrmModule.forFeature([Order, OrderItem, KotTicket, Dish, Category])],
  controllers: [ReportsController],
  providers: [ReportsService],
})
export class ReportsModule {}
