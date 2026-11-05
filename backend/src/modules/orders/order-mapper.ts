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

/**
 * Lines the kitchen actually made.
 *
 * Everything not cancelled, comped lines included. This is the question stock
 * asks: a comped dish was cooked and eaten, so its ingredients left the shelf
 * exactly as a sold one's did. Answering it with "is it being charged for"
 * would make every giveaway invisible to inventory and leave the counts drifting
 * upwards all month.
 */
export const wasMade = (item: OrderItem): boolean => item.status !== OrderItemStatus.CANCELLED;

/**
 * Lines that count towards the money.
 *
 * Made, and not given away. This is the question the bill asks, and it is a
 * different question from the one above - keeping them apart is the whole reason
 * an NC line can be free without being free of cost.
 */
export const isBillable = (item: OrderItem): boolean => wasMade(item) && !item.isNonChargeable;

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
    isNonChargeable: item.isNonChargeable,
    ncReason: item.ncReason,
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

/**
 * The bill's tax breakdown, in print order.
 *
 * Empty when the relation was not loaded, which is deliberate: a caller that did
 * not ask for the charges gets no charges rather than a wrong total, and the
 * summary figures on the order still say what was charged.
 */
const chargesOf = (order: Order) =>
  [...(order.charges ?? [])]
    .sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id)
    .map((charge) => ({
      name: charge.name,
      kind: charge.kind,
      rate: charge.rate,
      taxableAmount: charge.taxableAmount,
      amount: charge.amount,
    }));

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
    isNonChargeable: order.isNonChargeable,
    ncReason: order.ncReason,
    ncFor: order.ncFor,
    taxRate: order.taxRate,
    taxAmount: order.taxAmount,
    serviceChargeAmount: order.serviceChargeAmount,
    charges: chargesOf(order),
    tdsRate: order.tdsRate,
    tdsAmount: order.tdsAmount,
    amountPayable: order.amountPayable,
    total: order.total,
    paymentMethod: order.paymentMethod,
    settledAt: order.settledAt,
    notes: order.notes,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
  };
}

/** What goes into a dish, keyed by dish id, for the kitchen board. */
export interface RecipeLookup {
  get(dishId: number): { ingredients: string[]; allergens: string[] } | undefined;
}

const toKitchenItemDto = (item: OrderItem, recipes?: RecipeLookup): KitchenTicketItemDto => {
  // A line whose dish has since been deleted keeps its name and its note; only
  // the recipe is gone, and an empty list says that plainly.
  const recipe = item.dishId === null ? undefined : recipes?.get(item.dishId);

  return {
    id: item.id,
    name: item.name,
    quantity: item.quantity,
    note: item.note,
    status: item.status,
    ingredients: recipe?.ingredients ?? [],
    allergens: recipe?.allergens ?? [],
  };
};

export function toKitchenTicketDto(
  ticket: KotTicket,
  now: Date = new Date(),
  recipes?: RecipeLookup,
): KitchenTicketDto {
  const waitingMs = now.getTime() - ticket.createdAt.getTime();

  return {
    id: ticket.id,
    // Defaulted rather than required: updateStatus maps a ticket it already has
    // in hand, and a kitchen ticket is worth printing at the usual width even
    // if the join behind it was not asked for.
    paperWidthMm: ticket.restaurant?.printPaperWidthMm ?? 80,
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
      .map((item) => toKitchenItemDto(item, recipes)),
    printedAt: ticket.printedAt,
    createdAt: ticket.createdAt,
  };
}

export function toKotPrintDto(ticket: KotTicket, restaurant: Restaurant): KotPrintDto {
  return {
    restaurantName: restaurant.name,
    paperWidthMm: restaurant.printPaperWidthMm,
    ticketNumber: ticket.ticketNumber,
    orderNumber: ticket.order?.orderNumber ?? 0,
    tableName: ticket.order?.table?.name ?? null,
    businessDate: ticket.businessDate,
    items: sortByCreation(ticket.items ?? [])
      .filter((item) => item.status !== OrderItemStatus.CANCELLED)
      .map((item) => toKitchenItemDto(item)),
    createdAt: ticket.createdAt,
  };
}

/**
 * Whether this particular bill carries the restaurant's payment QR.
 *
 * Three things have to be true, and the third is the one worth stating: a
 * settled bill is a receipt, not a request. Printing "scan to pay" across
 * something the guest has already paid is how a restaurant gets paid twice and
 * has to refund one of them, so the code comes off the moment the bill closes.
 * Re-printing a bill that is still open carries it as usual.
 */
function qrFor(order: Order, restaurant: Restaurant): { url: string | null; label: string | null } {
  const print =
    restaurant.printPaymentQr &&
    Boolean(restaurant.paymentQrUrl) &&
    order.status !== OrderStatus.SETTLED;

  return print
    ? { url: restaurant.paymentQrUrl, label: restaurant.paymentQrLabel }
    : { url: null, label: null };
}

export function toBillDto(order: Order, restaurant: Restaurant): BillDto {
  const qr = qrFor(order, restaurant);

  return {
    orderId: order.id,
    orderNumber: order.orderNumber,
    businessDate: order.businessDate,
    restaurantName: restaurant.name,
    restaurantAddress: restaurant.address,
    restaurantPhone: restaurant.phone,
    taxNumber: restaurant.taxNumber,
    logoUrl: restaurant.logoUrl,
    paperWidthMm: restaurant.printPaperWidthMm,
    tableName: order.table?.name ?? null,
    paymentQrUrl: qr.url,
    paymentQrLabel: qr.label,
    // Every line that was made, comped ones included and marked as such. A guest
    // given a dish for nothing should be able to see that it was given.
    lines: sortByCreation(order.items ?? [])
      .filter(wasMade)
      .map((item) => ({
        name: item.name,
        unitPrice: item.unitPrice,
        quantity: item.quantity,
        lineTotal: item.isNonChargeable ? 0 : item.lineTotal,
        isNonChargeable: item.isNonChargeable,
        ncReason: item.ncReason,
      })),
    subtotal: order.subtotal,
    discountAmount: order.discountAmount,
    discountReason: order.discountReason,
    taxRate: order.taxRate,
    taxAmount: order.taxAmount,
    serviceChargeAmount: order.serviceChargeAmount,
    charges: chargesOf(order),
    tdsRate: order.tdsRate,
    tdsAmount: order.tdsAmount,
    amountPayable: order.amountPayable,
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
