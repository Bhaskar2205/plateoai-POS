import { ApiProperty } from '@nestjs/swagger';
import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { IngredientCategory, IngredientUnit } from 'src/common/enums';
import { quantityTransformer } from 'src/common/transformers/numeric.transformer';
import { Restaurant } from 'src/modules/restaurants/entities/restaurant.entity';
import { DishIngredient } from 'src/modules/dishes/entities/dish-ingredient.entity';

/**
 * A reusable component of the restaurant's pantry. One ingredient row is shared
 * by every dish that uses it, via `dish_ingredients`.
 */
@Entity('ingredients')
@Unique('UQ_ingredients_restaurant_name', ['restaurantId', 'name'])
export class Ingredient {
  @ApiProperty({ example: 1 })
  @PrimaryGeneratedColumn({ type: 'int', unsigned: true })
  id: number;

  @ApiProperty({ example: 1 })
  @Column({ type: 'int', unsigned: true, name: 'restaurant_id' })
  restaurantId: number;

  @ApiProperty({ example: 'Paneer' })
  @Column({ type: 'varchar', length: 120 })
  name: string;

  @ApiProperty({ nullable: true, example: 'Fresh cottage cheese, made in house.' })
  @Column({ type: 'text', nullable: true })
  description: string | null;

  @ApiProperty({
    nullable: true,
    example: 'Contains milk',
    description: 'Free-text allergen declaration supplied by the restaurant.',
  })
  @Column({ type: 'varchar', length: 255, nullable: true, name: 'allergen_info' })
  allergenInfo: string | null;

  /**
   * Inventory. All of it optional, because an ingredient existed in Plateo long
   * before stock did - it is what the public menu lists under "what's inside" -
   * and a restaurant that never opens the inventory screen must keep working
   * exactly as it did.
   */
  @ApiProperty({ enum: IngredientCategory, example: IngredientCategory.DAIRY })
  @Column({ type: 'varchar', length: 24, default: IngredientCategory.OTHER })
  category: IngredientCategory;

  @ApiProperty({ enum: IngredientUnit, example: IngredientUnit.KG, description: 'How it is counted.' })
  @Column({ type: 'varchar', length: 16, default: IngredientUnit.GRAM })
  unit: IngredientUnit;

  @ApiProperty({ example: 8.4, description: 'What is on the shelf now, in `unit`.' })
  @Column({
    type: 'decimal',
    precision: 12,
    scale: 3,
    name: 'current_quantity',
    default: 0,
    transformer: quantityTransformer,
  })
  currentQuantity: number;

  @ApiProperty({ example: 5, description: 'Below this it reads as running low. 0 means never warn.' })
  @Column({
    type: 'decimal',
    precision: 12,
    scale: 3,
    name: 'minimum_quantity',
    default: 0,
    transformer: quantityTransformer,
  })
  minimumQuantity: number;

  @ApiProperty({ example: 10, description: 'How much is usually bought at a time.' })
  @Column({
    type: 'decimal',
    precision: 12,
    scale: 3,
    name: 'reorder_quantity',
    default: 0,
    transformer: quantityTransformer,
  })
  reorderQuantity: number;

  @ApiProperty({ example: 32000, description: 'Cost of one `unit`, in whole paise. 32000 is ₹320.' })
  @Column({ type: 'bigint', name: 'cost_per_unit_paise', default: 0 })
  costPerUnitPaise: string;

  @ApiProperty({ example: true, description: 'Switched off rather than deleted, so history reads straight.' })
  @Column({ type: 'boolean', name: 'is_active', default: true })
  isActive: boolean;

  @ApiProperty()
  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @ApiProperty()
  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @ManyToOne(() => Restaurant, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'restaurant_id', foreignKeyConstraintName: 'FK_ingredients_restaurant' })
  restaurant: Restaurant;

  @OneToMany(() => DishIngredient, (dishIngredient) => dishIngredient.ingredient)
  dishIngredients: DishIngredient[];
}
