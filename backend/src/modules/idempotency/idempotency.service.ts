import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfig } from 'src/config/configuration';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash } from 'node:crypto';
import { LessThan, Repository } from 'typeorm';
import { IdempotencyScope, IdempotencyStatus } from 'src/common/enums';
import { isDuplicateKeyError } from 'src/modules/orders/order-writer';
import { IdempotencyKey } from './entities/idempotency-key.entity';

/**
 * Runs an irreversible operation at most once per key.
 *
 * The protection is the unique index on (restaurant, scope, key), not a lookup.
 * Checking for an existing row first and then inserting would simply move the
 * race earlier: two requests would both look, both find nothing, and both
 * proceed. Instead both try to insert, the database picks a winner, and the
 * loser reads what the winner stored.
 *
 * Three outcomes for a repeat:
 *
 *  - **Same key, same body, finished** - the original response is replayed. The
 *    caller cannot tell it did not run again, which is the point.
 *  - **Same key, same body, still running** - 409. The first request has not
 *    answered yet, and running the operation now would be the duplicate this
 *    exists to prevent.
 *  - **Same key, different body** - 409. That is not a retry; it is a mistake or
 *    an attack, and serving someone else's response would be worse than failing.
 *
 * A failed operation releases its key, so a genuine retry after a server error
 * or a rolled-back transaction can succeed. Without that, one transient failure
 * would poison the key forever and the caller could never complete the action.
 */

export interface IdempotentOutcome<T> {
  result: T;
  /** True when the stored response was replayed rather than the operation run. */
  replayed: boolean;
}

export interface IdempotentOptions {
  scope: IdempotencyScope;
  /** From the caller's `Idempotency-Key` header. Undefined means unprotected. */
  key: string | undefined;
  restaurantId: number | null;
  /** Hashed so a repeat with a different body can be told apart from a retry. */
  payload: unknown;
  resourceType?: string;
}

/** Stable JSON, so key order in the request body cannot change the hash. */
function canonicalise(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalise);

  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([entryKey, item]) => [entryKey, canonicalise(item)]),
    );
  }

  return value;
}

export function hashPayload(payload: unknown): string {
  return createHash('sha256').update(JSON.stringify(canonicalise(payload) ?? null)).digest('hex');
}

/** Keys are kept for a while so a late retry still replays, then swept. */
export const DEFAULT_RETENTION_DAYS = 7;

@Injectable()
export class IdempotencyService {
  private readonly logger = new Logger(IdempotencyService.name);

  constructor(
    @InjectRepository(IdempotencyKey)
    private readonly keysRepository: Repository<IdempotencyKey>,
    private readonly configService: ConfigService,
  ) {}

  async run<T>(options: IdempotentOptions, operation: () => Promise<T>): Promise<IdempotentOutcome<T>> {
    const key = options.key?.trim();

    // Idempotency is opt-in: without a key there is nothing to deduplicate
    // against, and refusing the request would break every existing caller.
    if (!key) {
      return { result: await operation(), replayed: false };
    }

    const restaurantId = options.restaurantId ?? 0;
    const requestHash = hashPayload(options.payload);

    const reserved = await this.reserve(restaurantId, options.scope, key, requestHash);

    if (!reserved) {
      return { result: await this.replay<T>(restaurantId, options.scope, key, requestHash), replayed: true };
    }

    try {
      const result = await operation();

      // Saved on the entity rather than through a partial update: the response
      // is a JSON column, and the entity is the only place its shape is declared.
      reserved.status = IdempotencyStatus.COMPLETED;
      reserved.responseStatus = 200;
      reserved.responseBody = result as Record<string, unknown>;
      reserved.resourceType = options.resourceType ?? null;
      reserved.resourceId = (result as { id?: number } | null)?.id ?? null;
      reserved.completedAt = new Date();

      await this.keysRepository.save(reserved);

      return { result, replayed: false };
    } catch (error) {
      // Release the claim so a real retry can work. A transient failure must not
      // lock the caller out of ever completing this operation.
      await this.keysRepository.delete({ id: reserved.id }).catch((cleanupError: unknown) => {
        this.logger.error(
          `Could not release idempotency key after a failure: ${(cleanupError as Error).message}`,
        );
      });

      throw error;
    }
  }

  /** Returns the row when this caller won the race, or null when it lost. */
  private async reserve(
    restaurantId: number,
    scope: IdempotencyScope,
    key: string,
    requestHash: string,
  ): Promise<IdempotencyKey | null> {
    try {
      return await this.keysRepository.save(
        this.keysRepository.create({
          restaurantId,
          scope,
          key,
          requestHash,
          status: IdempotencyStatus.IN_PROGRESS,
        }),
      );
    } catch (error) {
      if (isDuplicateKeyError(error)) return null;

      throw error;
    }
  }

  private async replay<T>(
    restaurantId: number,
    scope: IdempotencyScope,
    key: string,
    requestHash: string,
  ): Promise<T> {
    const existing = await this.keysRepository.findOne({
      where: { restaurantId, scope, key },
    });

    // Vanishingly rare: the winner failed and released the key between our failed
    // insert and this read. Treat it as a conflict rather than guessing.
    if (!existing) {
      throw new ConflictException(
        'That request is already being processed. Please try again in a moment.',
      );
    }

    if (existing.requestHash !== requestHash) {
      throw new ConflictException(
        'This Idempotency-Key was already used for a different request. Use a new key.',
      );
    }

    if (existing.status !== IdempotencyStatus.COMPLETED) {
      throw new ConflictException(
        'That request is still being processed. Please try again in a moment.',
      );
    }

    return existing.responseBody as T;
  }

  /**
   * Removes keys older than the retention window.
   *
   * Not scheduled from inside the application: with more than one instance every
   * instance would sweep, and a cleanup that runs N times is a cleanup nobody
   * owns. Exposed for an operator or a scheduled job to call.
   */
  async purgeOlderThan(days?: number): Promise<number> {
    const window =
      days ??
      this.configService.get<AppConfig['idempotency']>('idempotency')?.retentionDays ??
      DEFAULT_RETENTION_DAYS;
    const cutoff = new Date(Date.now() - window * 24 * 60 * 60 * 1000);
    const result = await this.keysRepository.delete({ createdAt: LessThan(cutoff) });

    return result.affected ?? 0;
  }
}
