import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Restaurant } from 'src/modules/restaurants/entities/restaurant.entity';
import { Order } from 'src/modules/orders/entities/order.entity';
import { OrderCharge } from 'src/modules/orders/entities/order-charge.entity';
import { TaxComponent } from './entities/tax-component.entity';
import { TaxesController } from './taxes.controller';
import { TaxesService } from './taxes.service';

/**
 * The restaurant's tax profile: the charges every new bill inherits.
 *
 * Separate from ordering on purpose. Ordering *reads* these components when it
 * recalculates a bill, through `loadTaxComponents`, and never writes them - so
 * the till cannot change what a restaurant charges by taking an order.
 */
@Module({
  imports: [TypeOrmModule.forFeature([TaxComponent, Restaurant, Order, OrderCharge])],
  controllers: [TaxesController],
  providers: [TaxesService],
})
export class TaxesModule {}
