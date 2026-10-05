import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, Matches, Max, Min } from 'class-validator';
import { AuditAction, AuditEntity } from 'src/common/enums';

/** `YYYY-MM-DD`, matching how the reports take dates. */
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export class QueryAuditLogsDto {
  @ApiPropertyOptional({ example: '2026-09-01', description: 'First day, inclusive.' })
  @IsOptional()
  @Matches(DATE_PATTERN, { message: 'from must be a date in YYYY-MM-DD form' })
  from?: string;

  @ApiPropertyOptional({ example: '2026-09-30', description: 'Last day, inclusive.' })
  @IsOptional()
  @Matches(DATE_PATTERN, { message: 'to must be a date in YYYY-MM-DD form' })
  to?: string;

  @ApiPropertyOptional({ enum: AuditAction })
  @IsOptional()
  @IsEnum(AuditAction)
  action?: AuditAction;

  @ApiPropertyOptional({ enum: AuditEntity })
  @IsOptional()
  @IsEnum(AuditEntity)
  entityType?: AuditEntity;

  @ApiPropertyOptional({ example: 4, description: 'Only what this member did.' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  userId?: number;

  @ApiPropertyOptional({ example: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ example: 50, default: 50, maximum: 200 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  pageSize?: number;
}

export class AuditLogRowDto {
  @ApiProperty({ example: 1 })
  id: number;

  @ApiProperty()
  createdAt: Date;

  @ApiPropertyOptional({ nullable: true, example: 4 })
  userId: number | null;

  @ApiPropertyOptional({
    nullable: true,
    example: 'Asha Menon',
    description: 'Null for a change nobody was signed in for.',
  })
  userName: string | null;

  @ApiProperty({ enum: AuditAction })
  action: AuditAction;

  @ApiProperty({ enum: AuditEntity })
  entityType: AuditEntity;

  @ApiPropertyOptional({ nullable: true, example: 42 })
  entityId: number | null;

  @ApiPropertyOptional({ nullable: true })
  oldValue: Record<string, unknown> | null;

  @ApiPropertyOptional({ nullable: true })
  newValue: Record<string, unknown> | null;

  @ApiPropertyOptional({ nullable: true, example: 'Customer complaint' })
  reason: string | null;

  @ApiPropertyOptional({ nullable: true })
  requestId: string | null;

  @ApiPropertyOptional({ nullable: true, example: '203.0.113.7' })
  ipAddress: string | null;
}

export class AuditLogPageDto {
  @ApiProperty({ type: [AuditLogRowDto] })
  rows: AuditLogRowDto[];

  @ApiProperty({ example: 184, description: 'Matching records, across every page.' })
  total: number;

  @ApiProperty({ example: 1 })
  page: number;

  @ApiProperty({ example: 50 })
  pageSize: number;
}
