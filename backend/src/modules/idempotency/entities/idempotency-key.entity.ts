import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, Unique } from 'typeorm';
import { IdempotencyScope, IdempotencyStatus } from 'src/common/enums';

/**
 * A claim on one irreversible operation.
 *
 * The unique index is the whole mechanism. Two requests carrying the same key
 * race to insert this row; the database lets exactly one win, and the loser is
 * handed the winner's answer instead of running the operation again. Checking
 * for an existing row in application code first would simply move the race
 * earlier - both callers would look, both would find nothing, and both would
 * proceed.
 *
 * The key is unique per restaurant and per scope rather than globally: two
 * restaurants whose tills generate the same key must not collide, and the same
 * key used to open a bill and to settle one describes two different operations.
 * A diner's key is scoped to the restaurant resolved from the QR link.
 *
 * `requestHash` is what makes a repeat safe to answer from storage. The same key
 * with a different body is not a retry - it is a bug or an attack, and it is
 * refused rather than served someone else's response.
 */
@Entity('idempotency_keys')
@Unique('UQ_idempotency_restaurant_scope_key', ['restaurantId', 'scope', 'key'])
@Index('IDX_idempotency_created', ['createdAt'])
export class IdempotencyKey {
  @ApiProperty({ example: 1 })
  @PrimaryGeneratedColumn({ type: 'int', unsigned: true })
  id: number;

  /**
   * Zero rather than null for an operation with no restaurant yet.
   *
   * MySQL treats NULLs as distinct in a unique index, so a nullable column would
   * let the same key be inserted any number of times - exactly the duplicate the
   * index exists to prevent. Every operation protected here does belong to a
   * restaurant, so in practice this is always set.
   */
  @ApiProperty({ example: 1, description: '0 when the operation belongs to no restaurant.' })
  @Column({ type: 'int', unsigned: true, name: 'restaurant_id', default: 0 })
  restaurantId: number;

  @ApiProperty({ enum: IdempotencyScope, example: IdempotencyScope.ORDER_SETTLE })
  @Column({ type: 'varchar', length: 32 })
  scope: IdempotencyScope;

  @ApiProperty({ example: 'b3f1c0de-...', description: 'Supplied by the caller.' })
  @Column({ type: 'varchar', length: 128 })
  key: string;

  @ApiProperty({
    example: 'c2b1...',
    description: 'SHA-256 of the request body, so a repeat with a different body is refused.',
  })
  @Column({ type: 'varchar', length: 64, name: 'request_hash' })
  requestHash: string;

  @ApiProperty({ enum: IdempotencyStatus, example: IdempotencyStatus.COMPLETED })
  @Column({ type: 'varchar', length: 16, default: IdempotencyStatus.IN_PROGRESS })
  status: IdempotencyStatus;

  @ApiPropertyOptional({ nullable: true, example: 201 })
  @Column({ type: 'smallint', unsigned: true, name: 'response_status', nullable: true })
  responseStatus: number | null;

  @ApiPropertyOptional({ nullable: true, description: 'The original response, replayed verbatim.' })
  @Column({ type: 'json', name: 'response_body', nullable: true })
  responseBody: Record<string, unknown> | null;

  @ApiPropertyOptional({ nullable: true, example: 'ORDER' })
  @Column({ type: 'varchar', length: 32, name: 'resource_type', nullable: true })
  resourceType: string | null;

  @ApiPropertyOptional({ nullable: true, example: 42 })
  @Column({ type: 'int', unsigned: true, name: 'resource_id', nullable: true })
  resourceId: number | null;

  @ApiProperty()
  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @ApiPropertyOptional({ nullable: true })
  @Column({ type: 'datetime', precision: 6, name: 'completed_at', nullable: true })
  completedAt: Date | null;
}
