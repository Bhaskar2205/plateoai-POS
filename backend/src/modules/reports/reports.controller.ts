import { Controller, Get, Query } from '@nestjs/common';
import { ApiBadRequestResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ActiveRestaurantId } from 'src/common/decorators/active-restaurant.decorator';
import { ApiAuth } from 'src/common/decorators/api-auth.decorator';
import { Roles } from 'src/common/decorators/roles.decorator';
import { ErrorResponseDto } from 'src/common/dto/error-response.dto';
import { BILLING_ROLES } from 'src/common/enums';
import { DayEndSeriesDto } from './dto/day-end-series.dto';
import { DayEndReportDto } from './dto/day-end.dto';
import { ReportRangeDto } from './dto/report-range.dto';
import {
  AdjustmentsReportDto,
  ItemSalesDto,
  OrderRowDto,
  SalesSummaryDto,
  SectionSalesDto,
  StaffSalesDto,
  TableSalesDto,
} from './dto/report.dto';
import { ReportsService } from './reports.service';

/**
 * Reports for the people who count the money.
 *
 * Restricted to `BILLING_ROLES` - owners and managers. A waiter takes orders and
 * a cook works tickets; neither needs to see what the restaurant earned, and a
 * waiter's phone is the device most likely to be left on a table.
 *
 * Every report runs over **business days** (a trading day starts at 05:00), so
 * "yesterday" means the same thing here as it does to whoever closed the till.
 */
@ApiTags('Reports')
@ApiAuth()
@Roles(...BILLING_ROLES)
@ApiBadRequestResponse({ description: 'Malformed or excessive date range.', type: ErrorResponseDto })
@Controller('restaurants/me/reports')
export class ReportsController {
  constructor(private readonly reportsService: ReportsService) {}

  @Get('sales')
  @ApiOperation({
    summary: 'Sales summary',
    description:
      'Takings for the range: bills, gross, discounts, tax, net and average bill, split by payment ' +
      'method, by business day, and by hour of day. Only settled bills count as sales; open and ' +
      'voided bills are reported separately and never added in.',
  })
  @ApiOkResponse({ type: SalesSummaryDto })
  sales(
    @ActiveRestaurantId() restaurantId: number,
    @Query() range: ReportRangeDto,
  ): Promise<SalesSummaryDto> {
    return this.reportsService.salesSummary(restaurantId, range);
  }

  @Get('day-end')
  @ApiOperation({
    summary: 'Day-end statement (Z report)',
    description:
      'What a till is closed on: one business day, with the tax broken down component by component - ' +
      'CGST and SGST are filed on different lines, so a single tax total is not enough. Bills still ' +
      'open are counted and shown but never added in, and the statement says so, because their money ' +
      'has not been taken yet. Defaults to today. A business day starts at 05:00, so a bill settled ' +
      'at 01:30 belongs to the night before.',
  })
  @ApiOkResponse({ type: DayEndReportDto })
  dayEnd(
    @ActiveRestaurantId() restaurantId: number,
    @Query() range: ReportRangeDto,
  ): Promise<DayEndReportDto> {
    // `from` names the day; a day-end statement never spans a range.
    return this.reportsService.dayEnd(restaurantId, range.from);
  }

  @Get('day-end/series')
  @ApiOperation({
    summary: 'Day-end statements across a range (month statement)',
    description:
      'The same figures as the day-end statement, one row per business day that traded, plus the ' +
      'component-by-component totals a monthly GST return is filled in from. Built for export: a ' +
      'month comes back in one call rather than thirty-one. Dead days are left out, and a day with ' +
      'a bill still open is flagged rather than quietly reported as final.',
  })
  @ApiOkResponse({ type: DayEndSeriesDto })
  dayEndSeries(
    @ActiveRestaurantId() restaurantId: number,
    @Query() range: ReportRangeDto,
  ): Promise<DayEndSeriesDto> {
    return this.reportsService.dayEndSeries(restaurantId, range);
  }

  @Get('items')
  @ApiOperation({
    summary: 'Item summary',
    description: 'What sold, dish by dish, with quantity, value and share of sales.',
  })
  @ApiOkResponse({ type: [ItemSalesDto] })
  items(
    @ActiveRestaurantId() restaurantId: number,
    @Query() range: ReportRangeDto,
  ): Promise<ItemSalesDto[]> {
    return this.reportsService.itemSales(restaurantId, range);
  }

  @Get('sections')
  @ApiOperation({
    summary: 'Section summary',
    description: 'The same sales gathered into the menu sections diners see.',
  })
  @ApiOkResponse({ type: [SectionSalesDto] })
  sections(
    @ActiveRestaurantId() restaurantId: number,
    @Query() range: ReportRangeDto,
  ): Promise<SectionSalesDto[]> {
    return this.reportsService.sectionSales(restaurantId, range);
  }

  @Get('orders')
  @ApiOperation({
    summary: 'Bill register',
    description: 'Every bill in the range with its status, payment method and who settled it.',
  })
  @ApiOkResponse({ type: [OrderRowDto] })
  orders(
    @ActiveRestaurantId() restaurantId: number,
    @Query() range: ReportRangeDto,
  ): Promise<OrderRowDto[]> {
    return this.reportsService.orderRows(restaurantId, range);
  }

  @Get('staff')
  @ApiOperation({
    summary: 'Staff summary',
    description: 'Bills opened and settled per person, with the discounts they gave.',
  })
  @ApiOkResponse({ type: [StaffSalesDto] })
  staff(
    @ActiveRestaurantId() restaurantId: number,
    @Query() range: ReportRangeDto,
  ): Promise<StaffSalesDto[]> {
    return this.reportsService.staffSales(restaurantId, range);
  }

  @Get('tables')
  @ApiOperation({
    summary: 'Table summary',
    description: 'Which tables earn, and how long a bill stays open at each.',
  })
  @ApiOkResponse({ type: [TableSalesDto] })
  tables(
    @ActiveRestaurantId() restaurantId: number,
    @Query() range: ReportRangeDto,
  ): Promise<TableSalesDto[]> {
    return this.reportsService.tableSales(restaurantId, range);
  }

  @Get('adjustments')
  @ApiOperation({
    summary: 'Discounts, voids and cancellations',
    description:
      'Everything that took money off a bill: discounts with their reasons and who gave them, ' +
      'voided bills, and items struck off after being ordered.',
  })
  @ApiOkResponse({ type: AdjustmentsReportDto })
  adjustments(
    @ActiveRestaurantId() restaurantId: number,
    @Query() range: ReportRangeDto,
  ): Promise<AdjustmentsReportDto> {
    return this.reportsService.adjustments(restaurantId, range);
  }
}
