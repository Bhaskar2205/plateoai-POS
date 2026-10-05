import { ApiProperty } from '@nestjs/swagger';
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { InventoryMovementType, InventoryReferenceType, StockAdjustmentReason } from 'src/common/enums';
import { quantityTransformer } from 'src/common/transformers/numeric.transformer';
import { Ingredient } from 'src/modules/ingredients/entities/ingredient.entity';
import { Restaurant } from 'src/modules/restaurants/entities/restaurant.entity';

/**
 * Every change to a stock figure, written down once and never edited.
 *
 * `ingredients.current_quantity` is a running total kept for speed, but this
 * table is the truth: if the two ever disagree the ledger wins, because a total
 * can be wrong in one place while a ledger is wrong in a way you can trace.
 * Nothing here is updated or deleted - a mistake is corrected by a further
 * movement, so the history of how a figure got wrong survives.
 *
 * Both the quantity before and after are stored. It is redundant, and it is what
 * lets someone answer "we had eight kilos on Tuesday, where did they go" without
 * replaying the whole table.
 */
@Entity('inventory_movements')
// The question actually asked of this table: what happened to this ingredient,
// most recent first.
@Index('IDX_inventory_movements_ingredient', ['ingredientId', 'createdAt'])
@Index('IDX_inventory_movements_restaurant_date', ['restaurantId', 'businessDate'])
@Index('IDX_inventory_movements_reference', ['restaurantId', 'referenceType', 'referenceId'])
/**
 * The one thing standing between a re-settled bill and double consumption.
 *
 * A bill cannot deduct the same ingredient twice because the second insert
 * collides here, in the database, inside the settle transaction. Checking first
 * and inserting after would leave a window two concurrent settles fit through.
 *
 * Manual movements carry NULL references, and SQL unique indexes treat NULLs as
 * distinct, so this constraint never interferes with a person adding stock twice
 * in one afternoon.
 */
@Unique('UQ_inventory_movements_reference_line', [
  'restaurantId',
  'referenceType',
  'referenceId',
  'ingredientId',
  'movementType',
])
export class InventoryMovement {
  @ApiProperty({ example: 1 })
  @PrimaryGeneratedColumn({ type: 'int', unsigned: true })
  id: number;

  @ApiProperty({ example: 1 })
  @Column({ type: 'int', unsigned: true, name: 'restaurant_id' })
  restaurantId: number;

  @ManyToOne(() => Restaurant, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'restaurant_id' })
  restaurant: Restaurant;

  @ApiProperty({ example: 4 })
  @Column({ type: 'int', unsigned: true, name: 'ingredient_id' })
  ingredientId: number;

  @ManyToOne(() => Ingredient, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'ingredient_id' })
  ingredient: Ingredient;

  @ApiProperty({ enum: InventoryMovementType, example: InventoryMovementType.STOCK_IN })
  @Column({ type: 'varchar', length: 24, name: 'movement_type' })
  movementType: InventoryMovementType;

  /**
   * Always positive. Which way it moves is the movement type's business, not the
   * sign's - a negative STOCK_IN would be a second way of saying WASTAGE, and
   * two ways of saying one thing is how a report ends up disagreeing with itself.
   */
  @ApiProperty({ example: 0.3, description: 'How much moved, always positive, in the ingredient unit.' })
  @Column({ type: 'decimal', precision: 12, scale: 3, transformer: quantityTransformer })
  quantity: number;

  @ApiProperty({ example: 'GRAM', description: 'The unit the movement was recorded in.' })
  @Column({ type: 'varchar', length: 16 })
  unit: string;

  @ApiProperty({ example: 10, description: 'The stock figure before this movement.' })
  @Column({
    type: 'decimal',
    precision: 12,
    scale: 3,
    name: 'quantity_before',
    transformer: quantityTransformer,
  })
  quantityBefore: number;

  @ApiProperty({ example: 9.7, description: 'The stock figure after it.' })
  @Column({
    type: 'decimal',
    precision: 12,
    scale: 3,
    name: 'quantity_after',
    transformer: quantityTransformer,
  })
  quantityAfter: number;

  /**
   * What this much of the ingredient was worth when it moved, in whole paise.
   *
   * Snapshotted, not looked up later. A supplier raising their price next month
   * must not change what last month's wastage cost, and a cost per unit that
   * drifts would silently rewrite every report built on it.
   */
  @ApiProperty({ example: 4800, description: 'Value of the movement in paise, as at the time.' })
  @Column({ type: 'bigint', name: 'value_paise', default: 0 })
  valuePaise: string;

  @ApiProperty({ enum: InventoryReferenceType, nullable: true })
  @Column({ type: 'varchar', length: 16, name: 'reference_type', nullable: true })
  referenceType: InventoryReferenceType | null;

  @ApiProperty({ example: 42, nullable: true, description: 'The bill or count this came from.' })
  @Column({ type: 'int', unsigned: true, name: 'reference_id', nullable: true })
  referenceId: number | null;

  @ApiProperty({ enum: StockAdjustmentReason, nullable: true })
  @Column({ type: 'varchar', length: 24, nullable: true })
  reason: StockAdjustmentReason | null;

  @ApiProperty({ example: 'Dropped a tray', nullable: true })
  @Column({ type: 'varchar', length: 255, nullable: true })
  note: string | null;

  /**
   * The service this movement belongs to, as `YYYY-MM-DD`.
   *
   * Stored rather than derived from `created_at`, for the same reason orders
   * store it: a bill settled at 01:30 on Saturday belongs to Friday's service,
   * and so does the paneer it used. Without this, an inventory report over a date
   * range would quietly disagree with the sales report over the same range, and
   * reconciling what was sold against what was used is the main thing anybody
   * does with these figures.
   */
  @ApiProperty({ example: '2026-10-02' })
  @Column({ type: 'date', name: 'business_date' })
  businessDate: string;

  /** Null when Plateo worked it out itself rather than a person doing it. */
  @ApiProperty({ example: 3, nullable: true })
  @Column({ type: 'int', unsigned: true, name: 'created_by', nullable: true })
  createdBy: number | null;

  @ApiProperty()
  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
