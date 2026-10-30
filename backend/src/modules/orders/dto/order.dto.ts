import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  DiscountType,
  KitchenState,
  KotStatus,
  OrderItemStatus,
  OrderSource,
  OrderStatus,
  PaymentMethod,
  TaxKind,
} from 'src/common/enums';

/**
 * Response shapes for the ordering API.
 *
 * These are explicit allow-lists, built by `order-mapper.ts`, rather than
 * serialised entities: an order joins to users, tables and dishes, and returning
 * entities would leak staff email addresses and table QR tokens the moment a
 * relation is eagerly loaded somewhere.
 */

export class OrderItemDto {
  @ApiProperty({ example: 120 })
  id: number;

  @ApiProperty({ nullable: true, example: 25, description: 'Null once the dish has been deleted.' })
  dishId: number | null;

  @ApiProperty({ example: 'Paneer Tikka Bowl', description: 'The name as it was when ordered.' })
  name: string;

  @ApiProperty({ example: 249.5, description: 'The price as it was when ordered.' })
  unitPrice: number;

  @ApiProperty({ example: 2 })
  quantity: number;

  @ApiProperty({ example: 499 })
  lineTotal: number;

  @ApiProperty({ nullable: true, example: 'No onion, less spicy' })
  note: string | null;

  @ApiProperty({ enum: OrderItemStatus, example: OrderItemStatus.QUEUED })
  status: OrderItemStatus;

  @ApiProperty({ nullable: true, example: 9, description: 'Null until the line is sent to the kitchen.' })
  kotTicketId: number | null;

  @ApiProperty({
    example: false,
    description: 'True while the line is waiting for staff to approve a diner request.',
  })
  awaitingApproval: boolean;

  @ApiProperty({
    example: true,
    description: 'True while the line can still be changed - once it is on a ticket it can only be cancelled.',
  })
  editable: boolean;

  @ApiProperty({ nullable: true, example: 'Guest changed their mind' })
  cancelledReason: string | null;

  @ApiProperty({ example: false, description: 'Comped: served, not charged for.' })
  isNonChargeable: boolean;

  @ApiPropertyOptional({ nullable: true, example: 'Guest sent it back - comped' })
  ncReason: string | null;

  @ApiProperty()
  createdAt: Date;
}

export class KotTicketSummaryDto {
  @ApiProperty({ example: 9 })
  id: number;

  @ApiProperty({ example: 5, description: 'Restarts at 1 each business day.' })
  ticketNumber: number;

  @ApiProperty({ enum: KotStatus, example: KotStatus.PREPARING })
  status: KotStatus;

  @ApiProperty({ example: 3 })
  itemCount: number;

  @ApiProperty({ nullable: true })
  printedAt: Date | null;

  @ApiProperty()
  createdAt: Date;
}

/** One line of the bill's tax breakdown, as it was charged. */
export class OrderChargeDto {
  @ApiProperty({ example: 'CGST' })
  name: string;

  @ApiProperty({ enum: TaxKind, example: TaxKind.CGST })
  kind: TaxKind;

  @ApiProperty({ example: 2.5 })
  rate: number;

  @ApiProperty({ example: 600, description: 'What this rate was applied to.' })
  taxableAmount: number;

  @ApiProperty({ example: 15 })
  amount: number;
}

export class OrderDto {
  @ApiProperty({ example: 41 })
  id: number;

  @ApiProperty({ example: 12, description: 'Restarts at 1 each business day.' })
  orderNumber: number;

  @ApiProperty({ example: '2026-09-28' })
  businessDate: string;

  @ApiProperty({ nullable: true, example: 7 })
  tableId: number | null;

  @ApiProperty({ nullable: true, example: 'Table 01' })
  tableName: string | null;

  @ApiProperty({ enum: OrderStatus, example: OrderStatus.OPEN })
  status: OrderStatus;

  @ApiProperty({ enum: OrderSource, example: OrderSource.DINER_QR })
  source: OrderSource;

  @ApiProperty({ type: [OrderItemDto] })
  items: OrderItemDto[];

  @ApiProperty({ type: [KotTicketSummaryDto] })
  kotTickets: KotTicketSummaryDto[];

  @ApiProperty({ example: 1, description: 'Diner-requested lines still waiting for staff approval.' })
  pendingApprovalCount: number;

  @ApiProperty({
    example: 2,
    description: 'Approved lines not yet on a kitchen ticket - what the next KOT would contain.',
  })
  unsentItemCount: number;

  @ApiProperty({ example: 640 })
  subtotal: number;

  @ApiPropertyOptional({ enum: DiscountType, nullable: true })
  discountType: DiscountType | null;

  @ApiProperty({ nullable: true, example: 10 })
  discountValue: number | null;

  @ApiProperty({ example: 64 })
  discountAmount: number;

  @ApiProperty({ nullable: true, example: 'Regular guest' })
  discountReason: string | null;

  @ApiProperty({ example: false, description: 'The whole bill was given away.' })
  isNonChargeable: boolean;

  @ApiPropertyOptional({ nullable: true, example: 'Owner dining with family' })
  ncReason: string | null;

  @ApiPropertyOptional({ nullable: true, example: 'Owner family', description: 'Who ate.' })
  ncFor: string | null;

  @ApiProperty({ example: 5, description: 'Combined tax percentage, derived from the charges below.' })
  taxRate: number;

  @ApiProperty({ example: 28.8, description: 'Every tax charge summed. Excludes any service charge.' })
  taxAmount: number;

  @ApiProperty({ example: 60, description: "The restaurant's own service charge, which is itself taxed." })
  serviceChargeAmount: number;

  @ApiProperty({ type: [OrderChargeDto], description: 'The breakdown a tax invoice has to print.' })
  charges: OrderChargeDto[];

  @ApiProperty({ example: 604.8 })
  total: number;

  @ApiProperty({ nullable: true, example: 2, description: 'Income tax the payer withholds, if any.' })
  tdsRate: number | null;

  @ApiProperty({ example: 12 })
  tdsAmount: number;

  @ApiProperty({ example: 592.8, description: 'total - TDS. What the restaurant collects.' })
  amountPayable: number;

  @ApiPropertyOptional({ enum: PaymentMethod, nullable: true })
  paymentMethod: PaymentMethod | null;

  @ApiProperty({ nullable: true })
  settledAt: Date | null;

  @ApiProperty({ nullable: true, example: 'Birthday table, cake at the end' })
  notes: string | null;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}

/** One line as the kitchen reads it: what to cook, how many, and any request. */
export class KitchenTicketItemDto {
  @ApiProperty({ example: 120 })
  id: number;

  @ApiProperty({ example: 'Paneer Tikka Bowl' })
  name: string;

  @ApiProperty({ example: 2 })
  quantity: number;

  @ApiProperty({
    nullable: true,
    example: 'No onion, less spicy',
    description: 'What the table asked for. Shown to the cook, never abbreviated.',
  })
  note: string | null;

  @ApiProperty({ enum: OrderItemStatus, example: OrderItemStatus.PREPARING })
  status: OrderItemStatus;

  @ApiProperty({
    type: [String],
    example: ['Paneer', 'Cashew paste', 'Yoghurt'],
    description:
      "What goes into the dish, as the kitchen recorded it on the menu. Empty when the dish has " +
      'no recipe, or when the dish has since been deleted.',
  })
  ingredients: string[];

  @ApiProperty({
    type: [String],
    example: ['Contains milk'],
    description: 'Allergen notes from those ingredients, deduplicated.',
  })
  allergens: string[];
}

/**
 * A ticket on the kitchen panel. Deliberately carries no money at all: the
 * kitchen needs the dish, the quantity and the wait, and nothing else.
 */
export class KitchenTicketDto {
  @ApiProperty({ example: 9 })
  id: number;

  @ApiProperty({ example: 5 })
  ticketNumber: number;

  @ApiProperty({ example: 41 })
  orderId: number;

  @ApiProperty({ example: 12 })
  orderNumber: number;

  @ApiProperty({ nullable: true, example: 'Table 01' })
  tableName: string | null;

  @ApiProperty({ enum: KotStatus, example: KotStatus.NEW })
  status: KotStatus;

  @ApiProperty({ example: 4, description: 'Whole minutes since the ticket reached the kitchen.' })
  waitingMinutes: number;

  @ApiProperty({ type: [KitchenTicketItemDto] })
  items: KitchenTicketItemDto[];

  @ApiProperty({ nullable: true })
  printedAt: Date | null;

  @ApiProperty()
  createdAt: Date;
}

/** Everything a printed KOT needs, so the browser does no lookups of its own. */
export class KotPrintDto {
  @ApiProperty({ example: 'The Green Bowl' })
  restaurantName: string;

  @ApiProperty({ example: 5 })
  ticketNumber: number;

  @ApiProperty({ example: 12 })
  orderNumber: number;

  @ApiProperty({ nullable: true, example: 'Table 01' })
  tableName: string | null;

  @ApiProperty({ example: '2026-09-28' })
  businessDate: string;

  @ApiProperty({ type: [KitchenTicketItemDto] })
  items: KitchenTicketItemDto[];

  @ApiProperty()
  createdAt: Date;
}

export class BillLineDto {
  @ApiProperty({ example: 'Paneer Tikka Bowl' })
  name: string;

  @ApiProperty({ example: 249.5 })
  unitPrice: number;

  @ApiProperty({ example: 2 })
  quantity: number;

  @ApiProperty({ example: 499, description: 'Zero on a comped line - it is shown, not charged.' })
  lineTotal: number;

  /**
   * Shown on the bill rather than hidden from it. A guest given a dish for
   * nothing should be able to see that it was given, and a guest who cannot see
   * it has no reason to believe it happened.
   */
  @ApiProperty({ example: false })
  isNonChargeable: boolean;

  @ApiPropertyOptional({ nullable: true, example: 'Guest sent it back - comped' })
  ncReason: string | null;
}

/**
 * A bill ready to print. Cancelled lines are left out - the diner should not be
 * shown, let alone charged for, something the kitchen never made.
 */
export class BillDto {
  @ApiProperty({ example: 41 })
  orderId: number;

  @ApiProperty({ example: 12 })
  orderNumber: number;

  @ApiProperty({ example: '2026-09-28' })
  businessDate: string;

  @ApiProperty({ example: 'The Green Bowl' })
  restaurantName: string;

  @ApiProperty({ nullable: true, example: 'Jaipur, Rajasthan' })
  restaurantAddress: string | null;

  @ApiProperty({ nullable: true, example: '+91 98765 43210' })
  restaurantPhone: string | null;

  @ApiProperty({ nullable: true, example: '08AAAAA0000A1Z5' })
  taxNumber: string | null;

  @ApiProperty({
    nullable: true,
    example: 'https://api.plateoai.in/uploads/logo/3/a1b2.png',
    description: "The restaurant's logo, printed above its name at the top of the bill.",
  })
  logoUrl: string | null;

  @ApiProperty({ nullable: true, example: 'Table 01' })
  tableName: string | null;

  @ApiProperty({
    nullable: true,
    example: 'https://api.plateoai.in/uploads/payment-qr/3/a1b2.png',
    description:
      "The restaurant's payment code, to print on this bill, or null. Null unless the owner has " +
      'uploaded one and switched printing on - and null once the bill is settled, so a paid ' +
      'receipt never asks for payment a second time.',
  })
  paymentQrUrl: string | null;

  @ApiProperty({ nullable: true, example: 'greenbowl@okhdfcbank' })
  paymentQrLabel: string | null;

  @ApiProperty({ type: [BillLineDto] })
  lines: BillLineDto[];

  @ApiProperty({ example: 640 })
  subtotal: number;

  @ApiProperty({ example: 64 })
  discountAmount: number;

  @ApiProperty({ nullable: true, example: 'Regular guest' })
  discountReason: string | null;

  @ApiProperty({ example: 5, description: 'Combined tax percentage, derived from the charges below.' })
  taxRate: number;

  @ApiProperty({ example: 28.8, description: 'Every tax charge summed. Excludes any service charge.' })
  taxAmount: number;

  @ApiProperty({ example: 60, description: "The restaurant's own service charge, which is itself taxed." })
  serviceChargeAmount: number;

  @ApiProperty({ type: [OrderChargeDto], description: 'The breakdown a tax invoice has to print.' })
  charges: OrderChargeDto[];

  @ApiProperty({ example: 604.8 })
  total: number;

  @ApiProperty({ nullable: true, example: 2, description: 'Income tax the payer withholds, if any.' })
  tdsRate: number | null;

  @ApiProperty({ example: 12 })
  tdsAmount: number;

  @ApiProperty({ example: 592.8, description: 'total - TDS. What the restaurant collects.' })
  amountPayable: number;

  @ApiProperty({ enum: OrderStatus, example: OrderStatus.SETTLED })
  status: OrderStatus;

  @ApiPropertyOptional({ enum: PaymentMethod, nullable: true })
  paymentMethod: PaymentMethod | null;

  @ApiProperty({ nullable: true })
  settledAt: Date | null;
}

/** A table on the admin Tables page, with whatever is happening at it right now. */
export class TableOrderSummaryDto {
  @ApiProperty({ example: 7 })
  tableId: number;

  @ApiProperty({ example: 'Table 01' })
  tableName: string;

  @ApiProperty({ example: true })
  isActive: boolean;

  @ApiProperty({ nullable: true, example: 41, description: 'The open bill at this table, if any.' })
  orderId: number | null;

  @ApiProperty({ nullable: true, example: 12 })
  orderNumber: number | null;

  @ApiProperty({ example: 604.8, description: 'Running total of the open bill, 0 when the table is free.' })
  total: number;

  @ApiProperty({ example: 1, description: 'Diner requests waiting for staff approval.' })
  pendingApprovalCount: number;

  @ApiProperty({ example: 2, description: 'Approved lines not yet sent to the kitchen.' })
  unsentItemCount: number;

  @ApiProperty({ example: 4, description: 'Lines on the bill, cancelled ones excluded.' })
  itemCount: number;

  @ApiProperty({
    enum: KitchenState,
    example: KitchenState.COOKING,
    description: 'What the kitchen is doing for this table right now.',
  })
  kitchenState: KitchenState;

  @ApiProperty({ nullable: true, description: 'When the bill was opened.' })
  openedAt: Date | null;
}
