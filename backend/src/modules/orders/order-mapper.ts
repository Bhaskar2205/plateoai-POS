import { KitchenState, KotStatus, OrderItemStatus, OrderStatus } from 'src/common/enums';
import { Restaurant } from 'src/modules/restaurants/entities/restaurant.entity';
import {
  BillDto,
  KitchenTicketDto,
  KitchenTicketItemDto,
  KotPrintDto,
  KotTicketSummaryDto,
  OrderDto,
  OrderItemDto,
  TableOrderSummaryDto,
} from './dto/order.dto';
import { KotTicket } from './entities/kot-ticket.entity';
import { OrderItem } from './entities/order-item.entity';
import { Order } from './entities/order.entity';

/**
 * Entities to response DTOs.
 *
 * Kept out of the service so there is exactly one place that decides what leaves
 * the server, and so the rules below are stated once rather than re-derived by
 * each caller:
 *
 *  - A line is `editable` only while it has not reached the kitchen. After that
 *    it can be cancelled (with a reason) but not quietly altered, because the
 *    food is already being cooked.
 *  - Cancelled lines stay on the order response - staff need to see that
 *    something was cancelled and why - but never appear on the printed bill.
 */

/** Lines that count towards the money: everything not cancelled. */
export const isBillable = (item: OrderItem): boolean => item.status !== OrderItemStatus.CANCELLED;

/** Lines a diner has asked for that staff have not approved yet. */
export const isAwaitingApproval = (item: OrderItem): boolean =>
  item.status === OrderItemStatus.PENDING;

/** Approved lines that no kitchen ticket covers yet - the contents of the next KOT. */
export const isUnsent = (item: OrderItem): boolean =>
  item.status === OrderItemStatus.QUEUED && item.kotTicketId === null;

const sortByCreation = <T extends { id: number; createdAt?: Date }>(rows: T[]): T[] =>
  [...rows].sort((a, b) => a.id - b.id);

export function toOrderItemDto(item: OrderItem): OrderItemDto {
  return {
    id: item.id,
    dishId: item.dishId,
    name: item.name,
    unitPrice: item.unitPrice,
    quantity: item.quantity,
    lineTotal: item.lineTotal,
    note: item.note,
    status: item.status,
    kotTicketId: item.kotTicketId,
    awaitingApproval: isAwaitingApproval(item),
    editable: item.kotTicketId === null && item.status !== OrderItemStatus.CANCELLED,
    cancelledReason: item.cancelledReason,
    createdAt: item.createdAt,
  };
}

export function toKotTicketSummaryDto(ticket: KotTicket): KotTicketSummaryDto {
  return {
    id: ticket.id,
    ticketNumber: ticket.ticketNumber,
    status: ticket.status,
    itemCount: ticket.items?.length ?? 0,
    printedAt: ticket.printedAt,
    createdAt: ticket.createdAt,
  };
}

export function toOrderDto(order: Order, tickets: KotTicket[] = []): OrderDto {
  const items = sortByCreation(order.items ?? []);

  return {
    id: order.id,
    orderNumber: order.orderNumber,
    businessDate: order.businessDate,
    tableId: order.tableId,
    tableName: order.table?.name ?? null,
    status: order.status,
    source: order.source,
    items: items.map(toOrderItemDto),
    kotTickets: sortByCreation(tickets).map(toKotTicketSummaryDto),
    pendingApprovalCount: items.filter(isAwaitingApproval).length,
    unsentItemCount: items.filter(isUnsent).length,
    subtotal: order.subtotal,
    discountType: order.discountType,
    discountValue: order.discountValue,
    discountAmount: order.discountAmount,
    discountReason: order.discountReason,
    taxRate: order.taxRate,
    taxAmount: order.taxAmount,
    total: order.total,
    paymentMethod: order.paymentMethod,
    settledAt: order.settledAt,
    notes: order.notes,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
  };
}

const toKitchenItemDto = (item: OrderItem): KitchenTicketItemDto => ({
  id: item.id,
  name: item.name,
  quantity: item.quantity,
  note: item.note,
  status: item.status,
});

export function toKitchenTicketDto(ticket: KotTicket, now: Date = new Date()): KitchenTicketDto {
  const waitingMs = now.getTime() - ticket.createdAt.getTime();

  return {
    id: ticket.id,
    ticketNumber: ticket.ticketNumber,
    orderId: ticket.orderId,
    orderNumber: ticket.order?.orderNumber ?? 0,
    tableName: ticket.order?.table?.name ?? null,
    status: ticket.status,
    // Floored, and never negative: a clock skew between API and database must not
    // show a ticket as waiting "-1 minutes".
    waitingMinutes: Math.max(0, Math.floor(waitingMs / 60_000)),
    items: sortByCreation(ticket.items ?? [])
      .filter((item) => item.status !== OrderItemStatus.CANCELLED)
      .map(toKitchenItemDto),
    printedAt: ticket.printedAt,
    createdAt: ticket.createdAt,
  };
}

export function toKotPrintDto(ticket: KotTicket, restaurantName: string): KotPrintDto {
  return {
    restaurantName,
    ticketNumber: ticket.ticketNumber,
    orderNumber: ticket.order?.orderNumber ?? 0,
    tableName: ticket.order?.table?.name ?? null,
    businessDate: ticket.businessDate,
    items: sortByCreation(ticket.items ?? [])
      .filter((item) => item.status !== OrderItemStatus.CANCELLED)
      .map(toKitchenItemDto),
    createdAt: ticket.createdAt,
  };
}

export function toBillDto(order: Order, restaurant: Restaurant): BillDto {
  return {
    orderId: order.id,
    orderNumber: order.orderNumber,
    businessDate: order.businessDate,
    restaurantName: restaurant.name,
    restaurantAddress: restaurant.address,
    restaurantPhone: restaurant.phone,
    taxNumber: restaurant.taxNumber,
    tableName: order.table?.name ?? null,
    lines: sortByCreation(order.items ?? [])
      .filter(isBillable)
      .map((item) => ({
        name: item.name,
        unitPrice: item.unitPrice,
        quantity: item.quantity,
        lineTotal: item.lineTotal,
      })),
    subtotal: order.subtotal,
    discountAmount: order.discountAmount,
    discountReason: order.discountReason,
    taxRate: order.taxRate,
    taxAmount: order.taxAmount,
    total: order.total,
    status: order.status,
    paymentMethod: order.paymentMethod,
    settledAt: order.settledAt,
  };
}

/**
 * What the kitchen is doing, from a table's tickets.
 *
 * READY only when *every* live ticket is ready: a table whose starters are up but
 * whose mains are still cooking is "cooking" to the person reading the floor, not
 * "ready". DONE and CANCELLED tickets are not live, so a table that has been
 * served and is waiting to pay reads as NONE - the bill is the next action, not
 * the kitchen.
 */
export function kitchenStateOf(tickets: KotTicket[]): KitchenState {
  const live = tickets.filter(
    (ticket) => ticket.status !== KotStatus.DONE && ticket.status !== KotStatus.CANCELLED,
  );

  if (live.length === 0) return KitchenState.NONE;

  return live.every((ticket) => ticket.status === KotStatus.READY)
    ? KitchenState.READY
    : KitchenState.COOKING;
}

/**
 * A table plus its open bill, for the admin Tables page.
 *
 * `order` is null for a free table, which is the common case and must not look
 * like an error.
 */
export function toTableOrderSummaryDto(
  table: { id: number; name: string; isActive: boolean },
  order: Order | null,
  tickets: KotTicket[] = [],
): TableOrderSummaryDto {
  const items = (order?.items ?? []).filter(isBillable);

  return {
    kitchenState: kitchenStateOf(tickets),
    tableId: table.id,
    tableName: table.name,
    isActive: table.isActive,
    orderId: order?.id ?? null,
    orderNumber: order?.orderNumber ?? null,
    total: order?.total ?? 0,
    pendingApprovalCount: items.filter(isAwaitingApproval).length,
    unsentItemCount: items.filter(isUnsent).length,
    itemCount: items.length,
    openedAt: order?.createdAt ?? null,
  };
}

/** Whether an order can still be changed at all. */
export const isOpen = (order: Order): boolean => order.status === OrderStatus.OPEN;
