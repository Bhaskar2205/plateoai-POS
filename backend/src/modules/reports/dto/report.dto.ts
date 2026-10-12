import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { OrderStatus, PaymentMethod } from 'src/common/enums';

/**
 * Report responses.
 *
 * One rule runs through all of them: **only a settled bill is a sale.** Open
 * bills are money not yet taken and voided bills are money never taken, so
 * neither is counted in takings - they are reported separately, where an owner
 * can see them for what they are.
 */

export class ReportPeriodDto {
  @ApiProperty({ example: '2026-09-01' })
  from: string;

  @ApiProperty({ example: '2026-09-30' })
  to: string;

  @ApiProperty({ example: 30, description: 'Business days covered, inclusive.' })
  days: number;
}

export class PaymentBreakdownDto {
  @ApiProperty({ enum: PaymentMethod, example: PaymentMethod.CASH })
  method: PaymentMethod;

  @ApiProperty({ example: 14 })
  bills: number;

  @ApiProperty({ example: 8450.5 })
  total: number;
}

export class HourlySalesDto {
  @ApiProperty({ example: 20, description: 'Hour of the local day, 0-23.' })
  hour: number;

  @ApiProperty({ example: 6 })
  bills: number;

  @ApiProperty({ example: 4210 })
  total: number;
}

export class DailySalesDto {
  @ApiProperty({ example: '2026-09-28' })
  businessDate: string;

  @ApiProperty({ example: 42 })
  bills: number;

  @ApiProperty({ example: 18240.75 })
  net: number;
}

export class SalesSummaryDto {
  @ApiProperty({ type: ReportPeriodDto })
  period: ReportPeriodDto;

  @ApiProperty({ example: 42, description: 'Settled bills. Open and voided bills are not sales.' })
  bills: number;

  @ApiProperty({ example: 1260, description: 'Items sold across those bills.' })
  itemsSold: number;

  @ApiProperty({ example: 19800, description: 'Before discount and tax.' })
  gross: number;

  @ApiProperty({ example: 1240.5 })
  discounts: number;

  @ApiProperty({ example: 928.5 })
  tax: number;

  @ApiProperty({ example: 19488, description: 'What the restaurant actually took: gross - discounts + tax.' })
  net: number;

  @ApiProperty({ example: 464, description: 'Net divided by the number of bills.' })
  averageBill: number;

  @ApiProperty({ example: 3, description: 'Bills still open at the end of the range.' })
  openBills: number;

  @ApiProperty({ example: 1 })
  voidedBills: number;

  @ApiProperty({ example: 640, description: 'Value of the voided bills, for the record.' })
  voidedValue: number;


  @ApiProperty({ example: 3, description: 'Bills given away. Never counted as sales.' })

  ncBills: number;


  @ApiProperty({ example: 1840, description: 'What those giveaways were worth.' })

  ncValue: number;

  @ApiProperty({ type: [PaymentBreakdownDto] })
  payments: PaymentBreakdownDto[];

  @ApiProperty({ type: [DailySalesDto], description: 'One row per business day in the range.' })
  daily: DailySalesDto[];

  @ApiProperty({
    type: [HourlySalesDto],
    description: 'Local hour of day. Empty for ranges longer than 31 days, where it says nothing useful.',
  })
  hourly: HourlySalesDto[];
}

export class ItemSalesDto {
  @ApiProperty({ nullable: true, example: 25, description: 'Null once the dish has been deleted.' })
  dishId: number | null;

  @ApiProperty({ example: 'Paneer Tikka Bowl', description: 'The name as it was sold under.' })
  name: string;

  @ApiProperty({ nullable: true, example: 'Mains' })
  section: string | null;

  @ApiProperty({ example: 86 })
  quantity: number;

  @ApiProperty({ example: 27520, description: 'Before any bill-level discount.' })
  total: number;

  @ApiProperty({ example: 14.2, description: 'Percentage of gross sales in the range.' })
  share: number;
}

export class SectionSalesDto {
  @ApiProperty({ nullable: true, example: 4 })
  categoryId: number | null;

  @ApiProperty({ example: 'Mains' })
  name: string;

  @ApiProperty({ example: 12, description: 'Distinct dishes sold from this section.' })
  dishes: number;

  @ApiProperty({ example: 340 })
  quantity: number;

  @ApiProperty({ example: 88400 })
  total: number;

  @ApiProperty({ example: 46.1 })
  share: number;
}

export class OrderRowDto {
  @ApiProperty({ example: 41 })
  id: number;

  @ApiProperty({ example: 12 })
  orderNumber: number;

  @ApiProperty({ example: '2026-09-28' })
  businessDate: string;

  @ApiProperty({ nullable: true, example: 'Table 01' })
  tableName: string | null;

  @ApiProperty({ enum: OrderStatus, example: OrderStatus.SETTLED })
  status: OrderStatus;

  @ApiProperty({ example: 'STAFF' })
  source: string;

  @ApiProperty({ example: 4 })
  items: number;

  @ApiProperty({ example: 640 })
  gross: number;

  @ApiProperty({ example: 64 })
  discount: number;

  @ApiProperty({ example: 28.8 })
  tax: number;

  @ApiProperty({ example: 604.8 })
  total: number;

  @ApiPropertyOptional({ enum: PaymentMethod, nullable: true })
  paymentMethod: PaymentMethod | null;

  @ApiProperty({ nullable: true, example: 'Asha Verma' })
  settledBy: string | null;

  @ApiProperty()
  openedAt: Date;

  @ApiProperty({ nullable: true })
  settledAt: Date | null;
}

export class StaffSalesDto {
  @ApiProperty({ nullable: true, example: 4 })
  userId: number | null;

  @ApiProperty({ example: 'Asha Verma' })
  name: string;

  @ApiProperty({ example: 'RESTAURANT_MANAGER' })
  role: string;

  @ApiProperty({ example: 18, description: 'Bills this person opened.' })
  billsOpened: number;

  @ApiProperty({ example: 22, description: 'Bills this person took payment for.' })
  billsSettled: number;

  @ApiProperty({ example: 10420, description: 'Value of the bills they settled.' })
  settledValue: number;

  @ApiProperty({ example: 240.5, description: 'Discount they gave away, across those bills.' })
  discountsGiven: number;
}

export class TableSalesDto {
  @ApiProperty({ nullable: true, example: 7 })
  tableId: number | null;

  @ApiProperty({ example: 'Table 01' })
  name: string;

  @ApiProperty({ example: 24 })
  bills: number;

  @ApiProperty({ example: 11400 })
  total: number;

  @ApiProperty({ example: 475 })
  averageBill: number;

  @ApiProperty({ example: 62, description: 'Average minutes from opening the bill to settling it.' })
  averageMinutes: number;
}

export class DiscountRowDto {
  @ApiProperty({ example: 41 })
  orderId: number;

  @ApiProperty({ example: 12 })
  orderNumber: number;

  @ApiProperty({ example: '2026-09-28' })
  businessDate: string;

  @ApiProperty({ nullable: true, example: 'Table 01' })
  tableName: string | null;

  @ApiProperty({ example: 64 })
  amount: number;

  @ApiProperty({ nullable: true, example: 'Regular guest' })
  reason: string | null;

  @ApiProperty({ example: 640 })
  billTotal: number;

  @ApiProperty({ nullable: true, example: 'Asha Verma' })
  settledBy: string | null;
}

export class VoidedRowDto {
  @ApiProperty({ example: 44 })
  orderId: number;

  @ApiProperty({ example: 15 })
  orderNumber: number;

  @ApiProperty({ example: '2026-09-28' })
  businessDate: string;

  @ApiProperty({ nullable: true, example: 'Table 03' })
  tableName: string | null;

  @ApiProperty({ example: 820, description: 'What the bill was worth when it was voided.' })
  value: number;

  @ApiProperty({ nullable: true, example: 'Guests left' })
  reason: string | null;
}

export class CancelledItemRowDto {
  @ApiProperty({ example: 'Paneer Tikka Bowl' })
  name: string;

  @ApiProperty({ example: 3 })
  times: number;

  @ApiProperty({ example: 4 })
  quantity: number;

  @ApiProperty({ example: 1280, description: 'Value taken off bills.' })
  value: number;

  @ApiProperty({ type: [String], example: ['Guest changed their mind', 'Out of stock'] })
  reasons: string[];
}

/**
 * Everything that took money off a bill, in one place.
 *
 * This is the report an owner reads when the takings look light: who discounted
 * what and why, which bills were voided, and which items were struck off after
 * being ordered.
 */
export class AdjustmentsReportDto {
  @ApiProperty({ type: ReportPeriodDto })
  period: ReportPeriodDto;

  @ApiProperty({ example: 1240.5 })
  discountTotal: number;

  @ApiProperty({ type: [DiscountRowDto] })
  discounts: DiscountRowDto[];

  @ApiProperty({ example: 820 })
  voidedTotal: number;

  @ApiProperty({ type: [VoidedRowDto] })
  voided: VoidedRowDto[];

  @ApiProperty({ example: 1280 })
  cancelledTotal: number;

  @ApiProperty({ type: [CancelledItemRowDto] })
  cancelledItems: CancelledItemRowDto[];
}
