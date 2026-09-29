import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { OrderItemStatus, OrderSource, OrderStatus } from 'src/common/enums';
import { businessDateFor } from 'src/common/utils/business-date.util';
import {
  resolveActiveRestaurant,
  resolveActiveTable,
} from 'src/modules/public-menu/public-lookup';
import { Restaurant } from 'src/modules/restaurants/entities/restaurant.entity';
import { RestaurantTable } from 'src/modules/tables/entities/restaurant-table.entity';
import { DinerOrderReceiptDto } from './dto/diner-order.dto';
import { PlaceDinerOrderDto } from './dto/order-input.dto';
import { OrderItem } from './entities/order-item.entity';
import { Order } from './entities/order.entity';
import {
  buildOrderItems,
  insertOrder,
  nextOrderNumber,
  recalculateOrder,
  withNumberRetry,
} from './order-writer';

/** A table cannot have an unbounded number of lines waiting to be confirmed. */
const MAX_PENDING_LINES_PER_TABLE = 40;

/**
 * Diner self-ordering from a table QR code.
 *
 * Anonymous and unauthenticated, so it is written defensively:
 *
 *  - The restaurant and table are resolved from the QR link through the same
 *    helper the public menu uses, so an unknown restaurant, a suspended one, a
 *    foreign table and a deactivated table are indistinguishable 404s.
 *  - Lines land as PENDING. Nothing a diner sends reaches the kitchen until a
 *    member of staff approves it at the table, which is the whole point: the QR
 *    menu is a request, not an instruction to cook.
 *  - Prices come from the menu, never from the request, and a diner can neither
 *    discount nor settle anything - those routes require a staff token.
 *  - A table with too many unconfirmed lines stops accepting more, so a bored
 *    guest (or a script with a photographed QR code) cannot fill the kitchen
 *    screen or a restaurant's database.
 */
@Injectable()
export class DinerOrdersService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(Order) private readonly ordersRepository: Repository<Order>,
    @InjectRepository(OrderItem) private readonly itemsRepository: Repository<OrderItem>,
    @InjectRepository(Restaurant) private readonly restaurantsRepository: Repository<Restaurant>,
    @InjectRepository(RestaurantTable)
    private readonly tablesRepository: Repository<RestaurantTable>,
  ) {}

  /**
   * Adds the diner's requests to their table's bill, opening one if the table is
   * free.
   *
   * `table` is the raw `?table=` value from the QR link, so it is treated as
   * untrusted input all the way down.
   */
  async placeOrder(
    slug: string,
    table: unknown,
    dto: PlaceDinerOrderDto,
  ): Promise<DinerOrderReceiptDto> {
    const restaurant = await resolveActiveRestaurant(this.restaurantsRepository, slug);
    const seatedAt = await resolveActiveTable(this.tablesRepository, restaurant.id, table);

    await this.assertPendingWithinLimit(restaurant.id, seatedAt.id, dto.items.length);

    const taxRate = await this.taxRateFor(restaurant.id);

    const placed = await withNumberRetry(() =>
      this.dataSource.transaction(async (manager) => {
        const order = await this.openOrFindOrder(manager, restaurant.id, seatedAt.id, taxRate);

        const rows = await buildOrderItems(manager, restaurant.id, dto.items, {
          status: OrderItemStatus.PENDING,
          createdByUserId: null,
        });

        const repository = manager.getRepository(OrderItem);
        const saved = await repository.save(
          rows.map((row) => repository.create({ ...row, orderId: order.id })),
        );

        await recalculateOrder(manager, order.id, taxRate);

        return saved;
      }),
    );

    const awaitingApprovalCount = await this.countPendingAtTable(restaurant.id, seatedAt.id);

    return {
      tableName: seatedAt.name,
      items: placed.map((item) => ({
        name: item.name,
        quantity: item.quantity,
        note: item.note,
      })),
      awaitingApprovalCount,
      message: 'Sent to the restaurant. A member of staff will confirm your order shortly.',
    };
  }

  /**
   * The table's open bill, or a new one.
   *
   * A diner ordering at a table staff already opened a bill for adds to *that*
   * bill rather than starting a second one - otherwise a table would be handed two
   * bills at the end of the meal.
   */
  private async openOrFindOrder(
    manager: EntityManager,
    restaurantId: number,
    tableId: number,
    taxRate: number,
  ): Promise<Order> {
    const existing = await manager.getRepository(Order).findOne({
      where: { restaurantId, tableId, status: OrderStatus.OPEN },
    });

    if (existing) return existing;

    const businessDate = businessDateFor();

    return insertOrder(manager, {
      restaurantId,
      tableId,
      orderNumber: await nextOrderNumber(manager, restaurantId, businessDate),
      source: OrderSource.DINER_QR,
      openedByUserId: null,
      notes: null,
      taxRate,
    });
  }

  private async assertPendingWithinLimit(
    restaurantId: number,
    tableId: number,
    incoming: number,
  ): Promise<void> {
    const pending = await this.countPendingAtTable(restaurantId, tableId);

    if (pending + incoming > MAX_PENDING_LINES_PER_TABLE) {
      throw new BadRequestException(
        'There are already several requests waiting at this table. Please ask a member of staff.',
      );
    }
  }

  /** Lines still waiting for staff approval on the table's open bill. */
  private countPendingAtTable(restaurantId: number, tableId: number): Promise<number> {
    return this.itemsRepository
      .createQueryBuilder('item')
      .innerJoin('item.order', 'order')
      .where('item.restaurant_id = :restaurantId', { restaurantId })
      .andWhere('item.status = :pending', { pending: OrderItemStatus.PENDING })
      .andWhere('order.table_id = :tableId', { tableId })
      .andWhere('order.status = :open', { open: OrderStatus.OPEN })
      .getCount();
  }

  private async taxRateFor(restaurantId: number): Promise<number> {
    const restaurant = await this.restaurantsRepository.findOne({
      where: { id: restaurantId },
      select: { id: true, taxRate: true },
    });

    return restaurant?.taxRate ?? 0;
  }
}
