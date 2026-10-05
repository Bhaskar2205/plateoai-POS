import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from 'src/modules/users/entities/user.entity';
import { AuditLogPageDto, AuditLogRowDto, QueryAuditLogsDto } from './dto/audit-log.dto';
import { AuditLog } from './entities/audit-log.entity';

/** A page nobody asked to size is a page of fifty. */
const DEFAULT_PAGE_SIZE = 50;

/**
 * Reading the audit log.
 *
 * Separate from `AuditService`, which only writes. Keeping the two apart means
 * nothing on a write path can accidentally reach a query, and nothing on the
 * read path has any way to insert.
 *
 * Every query is scoped to the restaurant on the token. There is no endpoint
 * that takes a restaurant id, so one restaurant cannot read another's history
 * even by guessing.
 */
@Injectable()
export class AuditQueryService {
  constructor(
    @InjectRepository(AuditLog) private readonly auditRepository: Repository<AuditLog>,
    @InjectRepository(User) private readonly usersRepository: Repository<User>,
  ) {}

  async find(restaurantId: number, query: QueryAuditLogsDto): Promise<AuditLogPageDto> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? DEFAULT_PAGE_SIZE;

    if (query.from && query.to && query.from > query.to) {
      throw new BadRequestException('The start of the range is after its end.');
    }

    const builder = this.auditRepository
      .createQueryBuilder('log')
      .where('log.restaurant_id = :restaurantId', { restaurantId });

    if (query.from) {
      builder.andWhere('log.created_at >= :from', { from: `${query.from}T00:00:00.000Z` });
    }

    if (query.to) {
      // Inclusive of the whole closing day, not of its first instant.
      builder.andWhere('log.created_at < :to', {
        to: new Date(Date.parse(`${query.to}T00:00:00.000Z`) + 24 * 60 * 60 * 1000),
      });
    }

    if (query.action) builder.andWhere('log.action = :action', { action: query.action });
    if (query.entityType) {
      builder.andWhere('log.entity_type = :entityType', { entityType: query.entityType });
    }
    if (query.userId) builder.andWhere('log.user_id = :userId', { userId: query.userId });

    const [rows, total] = await builder
      // Newest first, with the id breaking ties so two records written in the
      // same millisecond keep a stable order across pages.
      .orderBy('log.created_at', 'DESC')
      .addOrderBy('log.id', 'DESC')
      .skip((page - 1) * pageSize)
      .take(pageSize)
      .getManyAndCount();

    return {
      rows: await this.withUserNames(rows),
      total,
      page,
      pageSize,
    };
  }

  /** Names are looked up per page, so a deleted member still reads as an id. */
  private async withUserNames(rows: AuditLog[]): Promise<AuditLogRowDto[]> {
    const ids = [...new Set(rows.map((row) => row.userId).filter((id): id is number => id !== null))];

    const users =
      ids.length === 0
        ? []
        : await this.usersRepository.find({
            where: ids.map((id) => ({ id })),
            select: { id: true, name: true, email: true },
          });

    const byId = new Map(users.map((user) => [user.id, user.name || user.email]));

    return rows.map((row) => ({
      id: row.id,
      createdAt: row.createdAt,
      userId: row.userId,
      userName: row.userId === null ? null : (byId.get(row.userId) ?? null),
      action: row.action,
      entityType: row.entityType,
      entityId: row.entityId,
      oldValue: row.oldValue,
      newValue: row.newValue,
      reason: row.reason,
      requestId: row.requestId,
      ipAddress: row.ipAddress,
    }));
  }
}
