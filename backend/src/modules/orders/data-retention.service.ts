import { BadRequestException, ConflictException, Injectable, Logger } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { Between, DataSource, In, Repository } from 'typeorm';
import { AuditAction, AuditEntity, OrderStatus } from 'src/common/enums';
import { fromPaise, toPaise } from 'src/common/utils/money.util';
import { AuditService, type AuditContext } from 'src/modules/audit/audit.service';
import { Restaurant } from 'src/modules/restaurants/entities/restaurant.entity';
import {
  DeleteTradingDataDto,
  TradingDataDeletedDto,
  TradingDataSummaryDto,
} from './dto/data-retention.dto';
import { KotTicket } from './entities/kot-ticket.entity';
import { OrderCharge } from './entities/order-charge.entity';
import { OrderItem } from './entities/order-item.entity';
import { Order } from './entities/order.entity';

/**
 * Erasing trading history on an owner's instruction.
 *
 * This is the one place in Plateo that destroys records on purpose, so it is
 * built to be hard to do by accident and impossible to do quietly:
 *
 *  - **Owners only**, enforced on the route.
 *  - **The range must be finished.** One open bill blocks the whole operation.
 *    A service that is still running is not history, and deleting half of it
 *    leaves a table with food on it and no bill.
 *  - **The restaurant's name must be typed.** The only guard that still works
 *    on somebody moving fast is one that requires them to state what they are
 *    erasing.
 *  - **The audit record is written first**, in the same transaction, and
 *    carries the totals. Audit rows have no foreign key to orders, so they
 *    survive the delete - which is the point: afterwards, the only account of
 *    what was there is this record.
 *
 * Payment-gateway records are deliberately not deleted. The database detaches
 * them (`ON DELETE SET NULL`) and they stay, because a restaurant erasing its
 * own books must not be able to erase the processor's side of a payment.
 */
@Injectable()
export class DataRetentionService {
  private readonly logger = new Logger(DataRetentionService.name);

  constructor(
    @InjectRepository(Order) private readonly ordersRepository: Repository<Order>,
    @InjectRepository(OrderItem) private readonly itemsRepository: Repository<OrderItem>,
    @InjectRepository(OrderCharge) private readonly chargesRepository: Repository<OrderCharge>,
    @InjectRepository(KotTicket) private readonly ticketsRepository: Repository<KotTicket>,
    @InjectRepository(Restaurant) private readonly restaurantsRepository: Repository<Restaurant>,
    private readonly auditService: AuditService,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  /** What a deletion would take, so an owner sees it before they confirm. */
  async summarise(restaurantId: number, from: string, to: string): Promise<TradingDataSummaryDto> {
    this.assertRange(from, to);

    const orders = await this.ordersRepository.find({
      where: { restaurantId, businessDate: Between(from, to) },
      select: {
        id: true,
        businessDate: true,
        status: true,
        amountPayable: true,
        isNonChargeable: true,
      },
    });

    const open = orders.filter((order) => order.status === OrderStatus.OPEN);
    const closed = orders.filter((order) => order.status === OrderStatus.SETTLED);
    const settled = closed.filter((order) => !order.isNonChargeable);
    const nonChargeable = closed.filter((order) => order.isNonChargeable);
    const voided = orders.filter((order) => order.status === OrderStatus.CANCELLED);

    const ids = orders.map((order) => order.id);
    const dates = orders.map((order) => order.businessDate).sort();

    const blockedReason =
      orders.length === 0
        ? 'There is nothing in this range to delete.'
        : open.length > 0
          ? `${open.length} bill${open.length === 1 ? ' in this range is' : 's in this range are'} still open. Settle or void ${open.length === 1 ? 'it' : 'them'} first.`
          : null;

    return {
      from,
      to,
      settledBills: settled.length,
      voidedBills: voided.length,
      ncBills: nonChargeable.length,
      openBills: open.length,
      items: ids.length === 0 ? 0 : await this.itemsRepository.count({ where: { orderId: In(ids) } }),
      kotTickets:
        ids.length === 0 ? 0 : await this.ticketsRepository.count({ where: { orderId: In(ids) } }),
      charges:
        ids.length === 0 ? 0 : await this.chargesRepository.count({ where: { orderId: In(ids) } }),
      collected: fromPaise(
        settled.reduce((total, order) => total + toPaise(order.amountPayable), 0),
      ),
      firstDate: dates[0] ?? null,
      lastDate: dates[dates.length - 1] ?? null,
      canDelete: blockedReason === null,
      blockedReason,
    };
  }

  /** Erases the range. There is no undo, and nothing here pretends otherwise. */
  async deleteRange(
    restaurantId: number,
    dto: DeleteTradingDataDto,
    userId: number,
    context: AuditContext,
  ): Promise<TradingDataDeletedDto> {
    const summary = await this.summarise(restaurantId, dto.from, dto.to);

    if (!summary.canDelete) {
      throw new ConflictException(summary.blockedReason ?? 'This range cannot be deleted.');
    }

    const restaurant = await this.restaurantsRepository.findOne({ where: { id: restaurantId } });

    if (!restaurant) {
      throw new ConflictException('That restaurant could not be read.');
    }

    // Case and surrounding space forgiven; the words have to be right.
    if (dto.confirmName.trim().toLowerCase() !== restaurant.name.trim().toLowerCase()) {
      throw new BadRequestException(
        'The name does not match this restaurant. Type it exactly as it appears on your bills.',
      );
    }

    const orders = await this.ordersRepository.find({
      where: { restaurantId, businessDate: Between(dto.from, dto.to) },
      select: { id: true },
    });
    const ids = orders.map((order) => order.id);

    // Logged before anything is destroyed and outside the transaction, so the
    // account of it exists even if the delete itself fails halfway.
    this.logger.warn(
      `Restaurant ${restaurantId} (${restaurant.name}) is erasing trading data ` +
        `${dto.from}..${dto.to}: ${ids.length} bills, ${summary.collected} collected, by user ${userId}.`,
    );

    const detached = ids.length === 0 ? 0 : await this.countPaymentRecords(ids);

    await this.dataSource.transaction(async (manager) => {
      // Written first and in the same transaction: if the delete rolls back so
      // does the record, and if it commits the record is already there.
      await this.auditService.recordIn(manager, {
        restaurantId,
        userId,
        action: AuditAction.TRADING_DATA_DELETED,
        entityType: AuditEntity.RESTAURANT,
        entityId: restaurantId,
        oldValue: {
          from: dto.from,
          to: dto.to,
          settledBills: summary.settledBills,
          voidedBills: summary.voidedBills,
          ncBills: summary.ncBills,
          items: summary.items,
          collected: summary.collected,
        },
        newValue: null,
        reason: `Trading data erased for ${dto.from} to ${dto.to}`,
        context,
      });

      if (ids.length > 0) {
        // Items, charges and kitchen tickets go with the bill by cascade; the
        // bill is the only row this has to name.
        await manager.getRepository(Order).delete({ id: In(ids) });
      }
    });

    return {
      from: dto.from,
      to: dto.to,
      deletedBills: ids.length,
      deletedItems: summary.items,
      deletedKotTickets: summary.kotTickets,
      deletedCharges: summary.charges,
      detachedPaymentRecords: detached,
    };
  }

  /**
   * Gateway records pointing at these bills.
   *
   * Counted rather than deleted. The database sets their `order_id` to NULL as
   * the bills go, and they stay as a record that money moved.
   */
  private async countPaymentRecords(orderIds: number[]): Promise<number> {
    const [{ count }] = (await this.dataSource.query(
      `SELECT COUNT(*) AS count FROM payment_intents WHERE order_id IN (${orderIds
        .map(() => '?')
        .join(',')})`,
      orderIds,
    )) as Array<{ count: number | string }>;

    return Number(count);
  }

  private assertRange(from: string, to: string): void {
    if (from > to) {
      throw new BadRequestException('The start of the range is after its end.');
    }
  }
}
