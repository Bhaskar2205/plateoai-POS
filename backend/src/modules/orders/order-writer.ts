import { BadRequestException, NotFoundException } from '@nestjs/common';
import { EntityManager, In, QueryFailedError } from 'typeorm';
import { OrderItemStatus, OrderStatus, TaxGroup } from 'src/common/enums';
import { businessDateFor } from 'src/common/utils/business-date.util';
import { lineTotal } from 'src/common/utils/money.util';
import { computeBill, effectiveTaxRate, type TaxComponentInput } from 'src/common/utils/tax.util';
import { Dish } from 'src/modules/dishes/entities/dish.entity';
import { OrderItemInputDto } from './dto/order-input.dto';
import { KotTicket } from './entities/kot-ticket.entity';
import { OrderCharge } from './entities/order-charge.entity';
import { OrderItem } from './entities/order-item.entity';
import { Order } from './entities/order.entity';
import { isBillable } from './order-mapper';

/**
 * The write paths shared by staff ordering and diner self-ordering.
 *
 * Both surfaces must snapshot prices the same way and recalculate a bill the same
 * way, so that logic lives here once rather than being duplicated - and diverging
 * - across two services.
 */

interface DriverError {
  code?: string;
}

/** True for a unique-index violation on either MySQL or the SQLite test driver. */
export function isDuplicateKeyError(error: unknown): boolean {
  if (!(error instanceof QueryFailedError)) return false;

  const code = (error.driverError as DriverError | undefined)?.code ?? '';

  return code === 'ER_DUP_ENTRY' || code.startsWith('SQLITE_CONSTRAINT');
}

/**
 * The next per-day number for a restaurant's orders or tickets.
 *
 * MAX + 1 read inside the caller's transaction. Two tills opening a bill at the
 * same instant can still read the same maximum, so the *unique index* is the real
 * guarantee and `withNumberRetry` re-runs the loser. A `SELECT ... FOR UPDATE`
 * would serialise this instead, but the SQLite driver the test suite runs on has
 * no pessimistic locking, and retrying is correct on both.
 */
async function nextNumber(
  manager: EntityManager,
  table: 'orders' | 'kot_tickets' | 'table_bookings',
  column: 'order_number' | 'ticket_number' | 'reference_number',
  restaurantId: number,
  businessDate: string,
): Promise<number> {
  const row = await manager.query<Array<{ next: number | string | null }>>(
    `SELECT MAX(${column}) + 1 AS next FROM ${table} WHERE restaurant_id = ? AND business_date = ?`,
    [restaurantId, businessDate],
  );

  return Number(row[0]?.next ?? 1) || 1;
}

export const nextOrderNumber = (manager: EntityManager, restaurantId: number, businessDate: string) =>
  nextNumber(manager, 'orders', 'order_number', restaurantId, businessDate);

export const nextTicketNumber = (manager: EntityManager, restaurantId: number, businessDate: string) =>
  nextNumber(manager, 'kot_tickets', 'ticket_number', restaurantId, businessDate);

/**
 * Bookings number per day the same way bills do, so staff can say "booking 7"
 * to each other. It has its own unique index, so `withNumberRetry` settles a
 * race the same way it does for a bill.
 */
export const nextBookingReference = (
  manager: EntityManager,
  restaurantId: number,
  businessDate: string,
) => nextNumber(manager, 'table_bookings', 'reference_number', restaurantId, businessDate);

/**
 * Runs an insert that claims a per-day number, retrying when another till claimed
 * the same one first. Anything that is not a duplicate-key failure is rethrown
 * immediately - a retry loop must never swallow a real error.
 */
export async function withNumberRetry<T>(attempt: () => Promise<T>, attempts = 5): Promise<T> {
  for (let remaining = attempts; ; remaining -= 1) {
    try {
      return await attempt();
    } catch (error) {
      if (remaining <= 1 || !isDuplicateKeyError(error)) throw error;
    }
  }
}

/**
 * Turns requested dish ids into order lines, with the name and price copied from
 * the menu as it is right now.
 *
 * Every dish is checked against the *authenticated* restaurant, so an id from
 * another tenant is simply not found. Unavailable dishes are refused by name,
 * because "something on your order is unavailable" is useless to a diner holding
 * a phone.
 */
export async function buildOrderItems(
  manager: EntityManager,
  restaurantId: number,
  inputs: OrderItemInputDto[],
  context: { status: OrderItemStatus; createdByUserId: number | null },
): Promise<Array<Partial<OrderItem>>> {
  const dishIds = [...new Set(inputs.map((input) => input.dishId))];

  const dishes = await manager.getRepository(Dish).find({
    where: { id: In(dishIds), restaurantId },
    select: { id: true, name: true, price: true, isAvailable: true, taxGroup: true },
  });

  const byId = new Map(dishes.map((dish) => [dish.id, dish]));

  const missing = dishIds.filter((id) => !byId.has(id));
  if (missing.length > 0) {
    throw new NotFoundException(
      missing.length === 1
        ? `Dish ${missing[0]} was not found.`
        : `Dishes ${missing.join(', ')} were not found.`,
    );
  }

  const unavailable = dishes.filter((dish) => !dish.isAvailable);
  if (unavailable.length > 0) {
    throw new BadRequestException(
      `${unavailable.map((dish) => dish.name).join(', ')} ${
        unavailable.length === 1 ? 'is' : 'are'
      } not available right now.`,
    );
  }

  return inputs.map((input) => {
    const dish = byId.get(input.dishId)!;

    return {
      restaurantId,
      dishId: dish.id,
      name: dish.name,
      unitPrice: dish.price,
      // Snapshotted with the price: reclassifying a dish later must not change
      // the tax on a bill that is already running.
      taxGroup: dish.taxGroup ?? TaxGroup.STANDARD,
      quantity: input.quantity,
      lineTotal: lineTotal({ unitPrice: dish.price, quantity: input.quantity }),
      note: input.note || null,
      status: context.status,
      createdByUserId: context.createdByUserId,
      kotTicketId: null,
      cancelledReason: null,
    };
  });
}

/**
 * Recomputes an open bill from its own lines.
 *
 * Called after every change to an order's items or discount, so the stored
 * totals are never stale. The tax components are refreshed from the restaurant
 * while the bill is open and frozen at settlement, which is why they are passed
 * in rather than read here.
 *
 * The breakdown is rewritten wholesale on every recalculation: the charges are
 * derived from the lines, so editing them in place would mean reconciling two
 * representations of the same arithmetic. `tax_rate` and `tax_amount` are still
 * written, as the single-line summary older screens read, but the `order_charges`
 * rows are what a bill prints.
 */
export async function recalculateOrder(
  manager: EntityManager,
  orderId: number,
  components: TaxComponentInput[],
): Promise<Order> {
  const repository = manager.getRepository(Order);
  const charges = manager.getRepository(OrderCharge);

  const order = await repository.findOneOrFail({
    where: { id: orderId },
    relations: { items: true },
  });

  const billable = order.items.filter(isBillable);

  const bill = computeBill(
    billable.map((item) => ({
      unitPrice: item.unitPrice,
      quantity: item.quantity,
      taxGroup: item.taxGroup ?? TaxGroup.STANDARD,
    })),
    { type: order.discountType, value: order.discountValue },
    components,
    order.tdsRate,
  );

  order.subtotal = bill.subtotal;
  order.discountAmount = bill.discountAmount;
  order.serviceChargeAmount = bill.serviceChargeAmount;
  order.taxAmount = bill.taxAmount;
  order.taxRate = effectiveTaxRate(bill);
  order.total = bill.total;
  order.tdsAmount = bill.tdsAmount;
  order.amountPayable = bill.amountPayable;

  const saved = await repository.save(order);

  await charges.delete({ orderId });
  if (bill.charges.length > 0) {
    await charges.insert(
      bill.charges.map((charge, index) =>
        charges.create({
          orderId,
          name: charge.name,
          kind: charge.kind,
          rate: charge.rate,
          taxableAmount: charge.taxableAmount,
          amount: charge.amount,
          sortOrder: index + 1,
        }),
      ),
    );
  }

  return saved;
}

/** Opens a bill. The caller supplies the number it claimed, inside its own transaction. */
export async function insertOrder(
  manager: EntityManager,
  values: {
    restaurantId: number;
    tableId: number | null;
    orderNumber: number;
    source: Order['source'];
    openedByUserId: number | null;
    notes: string | null;
    taxRate: number;
  },
): Promise<Order> {
  const repository = manager.getRepository(Order);

  return repository.save(
    repository.create({
      ...values,
      businessDate: businessDateFor(),
      status: OrderStatus.OPEN,
      subtotal: 0,
      discountType: null,
      discountValue: null,
      discountAmount: 0,
      discountReason: null,
      taxAmount: 0,
      total: 0,
      paymentMethod: null,
      settledAt: null,
      settledByUserId: null,
      cancelledReason: null,
    }),
  );
}

/** Marks a ticket's own lines with a status the kitchen just moved it to. */
export async function syncTicketItemStatus(
  manager: EntityManager,
  ticket: KotTicket,
  status: OrderItemStatus,
): Promise<void> {
  await manager
    .getRepository(OrderItem)
    .createQueryBuilder()
    .update(OrderItem)
    .set({ status })
    .where('kot_ticket_id = :ticketId', { ticketId: ticket.id })
    // A line cancelled at the table must not be revived by a kitchen action.
    .andWhere('status != :cancelled', { cancelled: OrderItemStatus.CANCELLED })
    .execute();
}
