import { ApiProperty } from '@nestjs/swagger';
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { DietType, TaxGroup } from 'src/common/enums';
import { numericTransformer } from 'src/common/transformers/numeric.transformer';
import { Category } from 'src/modules/categories/entities/category.entity';
import { Restaurant } from 'src/modules/restaurants/entities/restaurant.entity';
import { DishIngredient } from './dish-ingredient.entity';

/**
 * A menu item.
 *
 * Money and nutrition use DECIMAL, never FLOAT/DOUBLE: `price` is DECIMAL(10,2)
 * so rupee amounts are exact, and macros are DECIMAL(8,2) grams.
 *
 * Nutrition is **restaurant-entered data**, stored exactly as the restaurant
 * typed it. Plateo neither generates nor verifies these values, and they are not
 * medical or scientific advice. A future version may derive nutrition from
 * `dish_ingredients` quantities joined against a verified nutrition database;
 * when that lands, these columns should gain an explicit `source` marker
 * distinguishing declared values from calculated ones.
 */
@Entity('dishes')
@Index('IDX_dishes_restaurant', ['restaurantId'])
@Index('IDX_dishes_restaurant_category', ['restaurantId', 'categoryId'])
@Index('IDX_dishes_restaurant_available', ['restaurantId', 'isAvailable'])
export class Dish {
  @ApiProperty({ example: 1 })
  @PrimaryGeneratedColumn({ type: 'int', unsigned: true })
  id: number;

  @ApiProperty({ example: 1 })
  @Column({ type: 'int', unsigned: true, name: 'restaurant_id' })
  restaurantId: number;

  @ApiProperty({ example: 1, nullable: true })
  @Column({ type: 'int', unsigned: true, nullable: true, name: 'category_id' })
  categoryId: number | null;

  @ApiProperty({ example: 'Paneer Tikka Bowl' })
  @Column({ type: 'varchar', length: 150 })
  name: string;

  @ApiProperty({ nullable: true, example: 'Grilled paneer with fresh vegetables and mint dressing' })
  @Column({ type: 'text', nullable: true })
  description: string | null;

  @ApiProperty({ example: 299.0, description: 'Menu price in the restaurant currency (DECIMAL 10,2).' })
  @Column({ type: 'decimal', precision: 10, scale: 2, transformer: numericTransformer })
  price: number;

  @ApiProperty({ nullable: true, example: 'https://cdn.example.com/paneer-tikka-bowl.jpg' })
  @Column({ type: 'varchar', length: 512, nullable: true, name: 'image_url' })
  imageUrl: string | null;

  @ApiProperty({ nullable: true, example: 22.0, description: 'Protein in grams (g).' })
  @Column({
    type: 'decimal',
    precision: 8,
    scale: 2,
    nullable: true,
    name: 'protein_grams',
    transformer: numericTransformer,
  })
  proteinGrams: number | null;

  @ApiProperty({ nullable: true, example: 380.0, description: 'Energy in kilocalories (kcal).' })
  @Column({
    type: 'decimal',
    precision: 8,
    scale: 2,
    nullable: true,
    transformer: numericTransformer,
  })
  calories: number | null;

  @ApiProperty({ nullable: true, example: 24.0, description: 'Carbohydrates in grams (g).' })
  @Column({
    type: 'decimal',
    precision: 8,
    scale: 2,
    nullable: true,
    name: 'carbs_grams',
    transformer: numericTransformer,
  })
  carbsGrams: number | null;

  @ApiProperty({ nullable: true, example: 19.0, description: 'Fat in grams (g).' })
  @Column({
    type: 'decimal',
    precision: 8,
    scale: 2,
    nullable: true,
    name: 'fat_grams',
    transformer: numericTransformer,
  })
  fatGrams: number | null;

  @ApiProperty({
    nullable: true,
    example: 15,
    description: 'Typical kitchen preparation time in whole minutes.',
  })
  @Column({ type: 'smallint', unsigned: true, nullable: true, name: 'preparation_time_minutes' })
  preparationTimeMinutes: number | null;

  @ApiProperty({ enum: DietType, nullable: true, example: DietType.VEG })
  @Column({ type: 'varchar', length: 16, nullable: true, name: 'diet_type' })
  dietType: DietType | null;

  /**
   * Which of the restaurant's tax components apply to this dish. Everything is
   * STANDARD unless the restaurant says otherwise, which is right for a menu of
   * food: alcohol is outside GST and has to be marked as such, and a sealed
   * packaged item can carry a different rate from the kitchen's own cooking.
   */
  @ApiProperty({ enum: TaxGroup, example: TaxGroup.STANDARD })
  @Column({ type: 'varchar', length: 16, name: 'tax_group', default: TaxGroup.STANDARD })
  taxGroup: TaxGroup;

  @ApiProperty({ example: true })
  @Column({ type: 'boolean', default: true, name: 'is_available' })
  isAvailable: boolean;

  @ApiProperty()
  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @ApiProperty()
  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @ManyToOne(() => Restaurant, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'restaurant_id', foreignKeyConstraintName: 'FK_dishes_restaurant' })
  restaurant: Restaurant;

  /** Set null rather than cascading: deleting a section must not delete dishes. */
  @ManyToOne(() => Category, (category) => category.dishes, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'category_id', foreignKeyConstraintName: 'FK_dishes_category' })
  category: Category | null;

  @OneToMany(() => DishIngredient, (dishIngredient) => dishIngredient.dish)
  dishIngredients: DishIngredient[];
}
