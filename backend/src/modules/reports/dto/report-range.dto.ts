import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, Matches } from 'class-validator';

/** `YYYY-MM-DD`, the shape `orders.business_date` is stored in. */
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The date range every report runs over.
 *
 * Reports work on **business dates**, not timestamps: a bill settled at 01:30 on
 * Saturday belongs to Friday's service and to Friday's takings (see
 * `business-date.util.ts`). Filtering on the stored `business_date` is what makes
 * "yesterday's sales" mean the same thing here as it does to the person who
 * closed the till.
 *
 * Both ends are inclusive, and both default to today, so a bare request answers
 * "how is today going?".
 */
export class ReportRangeDto {
  @ApiPropertyOptional({ example: '2026-09-01', description: 'First business day, inclusive. Defaults to today.' })
  @IsOptional()
  @Matches(DATE_PATTERN, { message: 'from must be a date in YYYY-MM-DD form' })
  from?: string;

  @ApiPropertyOptional({ example: '2026-09-30', description: 'Last business day, inclusive. Defaults to today.' })
  @IsOptional()
  @Matches(DATE_PATTERN, { message: 'to must be a date in YYYY-MM-DD form' })
  to?: string;
}
