import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DeepPartial, EntityManager, Repository } from 'typeorm';
import { AuditAction, AuditEntity } from 'src/common/enums';
import { AuditLog } from './entities/audit-log.entity';

/**
 * Where a change gets written down.
 *
 * Two ways in, and the difference matters:
 *
 *  - `recordIn(manager, ...)` writes through a transaction the caller already
 *    owns. Financial actions use this, so the record and the money move together:
 *    a settlement that rolls back leaves nothing behind, and one that commits
 *    cannot be missing from the log.
 *  - `record(...)` writes on its own, for changes that are a single statement
 *    anyway - a dish price, a table being deactivated.
 *
 * Callers pass only the fields that changed. Writing whole objects here would
 * copy money figures out of the bill and let the two disagree, and would be the
 * easiest way to end up with a credential in a log.
 */
export interface AuditEntry {
  restaurantId: number;
  /** Null when nobody was signed in, which is a diner ordering from a QR code. */
  userId: number | null;
  action: AuditAction;
  entityType: AuditEntity;
  entityId?: number | null;
  oldValue?: Record<string, unknown> | null;
  newValue?: Record<string, unknown> | null;
  reason?: string | null;
  context?: AuditContext;
}

/** Who asked, from the request rather than from the body. */
export interface AuditContext {
  requestId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
}

/**
 * Fields that must never reach an audit record, whatever a caller passes.
 *
 * A deny-list is the wrong shape for a security boundary on its own - callers
 * are expected to pass only what changed - but it is cheap insurance against the
 * one call site that someday passes a whole entity.
 */
const FORBIDDEN_KEYS = new Set([
  'password',
  'passwordhash',
  'password_hash',
  'token',
  'accesstoken',
  'access_token',
  'refreshtoken',
  'jwt',
  'secret',
  'apikey',
  'api_key',
  'kitchencode',
  'kitchen_code',
  'cardnumber',
  'card_number',
  'cvv',
]);

const MAX_VALUE_LENGTH = 500;

/** Strips anything sensitive and keeps the record small enough to read. */
export function sanitiseAuditValue(
  value: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
  if (!value) return null;

  const clean: Record<string, unknown> = {};

  for (const [key, raw] of Object.entries(value)) {
    if (FORBIDDEN_KEYS.has(key.toLowerCase())) continue;
    if (raw === undefined) continue;

    clean[key] =
      typeof raw === 'string' && raw.length > MAX_VALUE_LENGTH
        ? `${raw.slice(0, MAX_VALUE_LENGTH)}...`
        : raw;
  }

  return Object.keys(clean).length > 0 ? clean : null;
}

const toRow = (entry: AuditEntry): DeepPartial<AuditLog> => ({
  restaurantId: entry.restaurantId,
  userId: entry.userId,
  action: entry.action,
  entityType: entry.entityType,
  entityId: entry.entityId ?? null,
  oldValue: sanitiseAuditValue(entry.oldValue),
  newValue: sanitiseAuditValue(entry.newValue),
  reason: entry.reason ?? null,
  requestId: entry.context?.requestId ?? null,
  ipAddress: entry.context?.ipAddress ?? null,
  userAgent: entry.context?.userAgent?.slice(0, 255) ?? null,
});

@Injectable()
export class AuditService {
  constructor(
    @InjectRepository(AuditLog) private readonly auditRepository: Repository<AuditLog>,
  ) {}

  /** Writes inside the caller's transaction. Use this for anything financial. */
  async recordIn(manager: EntityManager, entry: AuditEntry): Promise<void> {
    const repository = manager.getRepository(AuditLog);

    await repository.save(repository.create(toRow(entry)));
  }

  /** Writes on its own, for a change that is already a single statement. */
  async record(entry: AuditEntry): Promise<void> {
    await this.auditRepository.save(this.auditRepository.create(toRow(entry)));
  }
}
