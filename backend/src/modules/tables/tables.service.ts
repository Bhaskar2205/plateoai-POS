import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Not, QueryFailedError, Repository } from 'typeorm';
import type { AppConfig } from 'src/config/configuration';
import { Restaurant } from 'src/modules/restaurants/entities/restaurant.entity';
import { CreateTableDto, UpdateTableDto } from './dto/create-table.dto';
import { RestaurantTableDto } from './dto/restaurant-table.dto';
import {
  AuditAction,
  AuditEntity,
  IdempotencyScope,
} from 'src/common/enums';
import { AuditService, type AuditContext } from 'src/modules/audit/audit.service';
import { IdempotencyService } from 'src/modules/idempotency/idempotency.service';
import { RestaurantTable } from './entities/restaurant-table.entity';
import { generateTableToken } from './table-token';

/** A token collision needs 2^96 tables; retrying is cheaper than reasoning about it. */
const TOKEN_ATTEMPTS = 3;

/**
 * Owner-side table management. Like every tenant service, each method takes the
 * server-validated `restaurantId` first and folds it into the WHERE clause, so
 * another restaurant's table is simply "not found" (404, not 403).
 */
@Injectable()
export class TablesService {
  private readonly publicWebUrl: string;

  constructor(
    @InjectRepository(RestaurantTable)
    private readonly tablesRepository: Repository<RestaurantTable>,
    @InjectRepository(Restaurant)
    private readonly restaurantsRepository: Repository<Restaurant>,
    private readonly auditService: AuditService,
    private readonly idempotencyService: IdempotencyService,
    configService: ConfigService,
  ) {
    this.publicWebUrl = configService.get<AppConfig['publicWebUrl']>('publicWebUrl')!;
  }

  async create(
    restaurantId: number,
    dto: CreateTableDto,
    userId?: number,
    context?: AuditContext,
  ): Promise<RestaurantTableDto> {
    await this.assertNameIsFree(restaurantId, dto.name);

    const table = await this.saveWithFreshToken(
      this.tablesRepository.create({
        restaurantId,
        name: dto.name,
        isActive: dto.isActive ?? true,
      }),
    );

    await this.auditService.record({
      restaurantId,
      userId: userId ?? null,
      action: AuditAction.TABLE_CREATED,
      entityType: AuditEntity.TABLE,
      entityId: table.id,
      newValue: { name: table.name, isActive: table.isActive },
      context,
    });

    return this.toDto(table, await this.restaurantSlug(restaurantId));
  }

  async findAll(restaurantId: number): Promise<RestaurantTableDto[]> {
    const [tables, slug] = await Promise.all([
      this.tablesRepository.find({ where: { restaurantId } }),
      this.restaurantSlug(restaurantId),
    ]);

    // Natural order, so "Table 2" sorts before "Table 10".
    const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });
    tables.sort((a, b) => collator.compare(a.name, b.name) || a.id - b.id);

    return tables.map((table) => this.toDto(table, slug));
  }

  async findOne(restaurantId: number, id: number): Promise<RestaurantTableDto> {
    const table = await this.findEntity(restaurantId, id);
    return this.toDto(table, await this.restaurantSlug(restaurantId));
  }

  async update(
    restaurantId: number,
    id: number,
    dto: UpdateTableDto,
    userId?: number,
    context?: AuditContext,
  ): Promise<RestaurantTableDto> {
    const table = await this.findEntity(restaurantId, id);

    if (dto.name !== undefined && dto.name !== table.name) {
      await this.assertNameIsFree(restaurantId, dto.name, id);
      table.name = dto.name;
    }

    // Only a change of activation is recorded. A rename is housekeeping, and a
    // log full of renames is a log nobody reads when it matters.
    const wasActive = table.isActive;
    if (dto.isActive !== undefined) table.isActive = dto.isActive;

    const saved = await this.tablesRepository.save(table);

    if (dto.isActive !== undefined && dto.isActive !== wasActive) {
      await this.auditService.record({
        restaurantId,
        userId: userId ?? null,
        action: dto.isActive ? AuditAction.TABLE_REACTIVATED : AuditAction.TABLE_DEACTIVATED,
        entityType: AuditEntity.TABLE,
        entityId: saved.id,
        oldValue: { isActive: wasActive },
        newValue: { isActive: saved.isActive, name: saved.name },
        context,
      });
    }

    return this.toDto(saved, await this.restaurantSlug(restaurantId));
  }

  async remove(restaurantId: number, id: number): Promise<void> {
    const table = await this.findEntity(restaurantId, id);
    await this.tablesRepository.remove(table);
  }

  /**
   * Issues a new QR token. The previous menu URL stops working immediately, so a
   * lost, photographed or tampered-with QR card can be retired without deleting
   * the table.
   */
  /**
   * Issues a new QR token, invalidating the printed card.
   *
   * Idempotent because it is irreversible: a retry after a timeout must not
   * burn a second token and invalidate the card that the first call had just
   * made valid.
   */
  async regenerateQr(
    restaurantId: number,
    id: number,
    userId?: number,
    context?: AuditContext,
    idempotencyKey?: string,
  ): Promise<RestaurantTableDto> {
    const outcome = await this.idempotencyService.run(
      {
        scope: IdempotencyScope.TABLE_REGENERATE_QR,
        key: idempotencyKey,
        restaurantId,
        payload: { tableId: id },
        resourceType: 'TABLE',
      },
      () => this.regenerateQrOnce(restaurantId, id, userId, context),
    );

    return outcome.result;
  }

  private async regenerateQrOnce(
    restaurantId: number,
    id: number,
    userId?: number,
    context?: AuditContext,
  ): Promise<RestaurantTableDto> {
    const table = await this.findEntity(restaurantId, id);
    const saved = await this.saveWithFreshToken(table);

    // The token itself is never recorded: it is the credential printed on the
    // card, and a log that holds it hands out table access to anyone who reads
    // the log.
    await this.auditService.record({
      restaurantId,
      userId: userId ?? null,
      action: AuditAction.QR_REGENERATED,
      entityType: AuditEntity.TABLE,
      entityId: saved.id,
      newValue: { name: saved.name },
      reason: 'Previous QR code invalidated',
      context,
    });

    return this.toDto(saved, await this.restaurantSlug(restaurantId));
  }

  private async findEntity(restaurantId: number, id: number): Promise<RestaurantTable> {
    const table = await this.tablesRepository.findOne({ where: { id, restaurantId } });

    if (!table) {
      throw new NotFoundException(`Table ${id} was not found.`);
    }

    return table;
  }

  private async saveWithFreshToken(table: RestaurantTable): Promise<RestaurantTable> {
    for (let attempt = 1; ; attempt++) {
      table.qrToken = generateTableToken();

      try {
        return await this.tablesRepository.save(table);
      } catch (error) {
        if (attempt < TOKEN_ATTEMPTS && TablesService.isTokenCollision(error)) continue;
        throw error;
      }
    }
  }

  private static isTokenCollision(error: unknown): boolean {
    if (!(error instanceof QueryFailedError)) return false;
    const message = String((error.driverError as { message?: string } | undefined)?.message ?? error.message);
    // MySQL names the index; SQLite (tests) names the column.
    return message.includes('UQ_restaurant_tables_qr_token') || message.includes('restaurant_tables.qr_token');
  }

  /**
   * Table names are unique per restaurant (`UQ_restaurant_tables_restaurant_name`,
   * case-insensitive under the MySQL collation); this turns the constraint into
   * a readable 409.
   */
  private async assertNameIsFree(restaurantId: number, name: string, excludeId?: number): Promise<void> {
    const clash = await this.tablesRepository.count({
      where: { restaurantId, name, ...(excludeId ? { id: Not(excludeId) } : {}) },
    });

    if (clash > 0) {
      throw new ConflictException(`A table named "${name}" already exists.`);
    }
  }

  /**
   * The restaurant's permanent `publicSlug`, not its current `slug`: a QR code
   * is printed once and must keep working after the restaurant is renamed.
   */
  private async restaurantSlug(restaurantId: number): Promise<string> {
    const restaurant = await this.restaurantsRepository.findOne({
      where: { id: restaurantId },
      select: { id: true, publicSlug: true },
    });

    if (!restaurant) {
      throw new NotFoundException('Restaurant not found.');
    }

    return restaurant.publicSlug;
  }

  private toDto(table: RestaurantTable, publicSlug: string): RestaurantTableDto {
    const menuPath = `/menu/${encodeURIComponent(publicSlug)}?table=${encodeURIComponent(table.qrToken)}`;

    return {
      id: table.id,
      name: table.name,
      isActive: table.isActive,
      menuPath,
      menuUrl: `${this.publicWebUrl}${menuPath}`,
      createdAt: table.createdAt,
      updatedAt: table.updatedAt,
    };
  }
}
