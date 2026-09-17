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
import { numericTransformer } from 'src/common/transformers/numeric.transformer';
import { Ingredient } from 'src/modules/ingredients/entities/ingredient.entity';
import { Dish } from './dish.entity';

/**
 * Recipe line: how much of one ingredient goes into one dish.
 *
 * `quantity` is DECIMAL(10,3) so fractional grams / millilitres survive a round
 * trip. Both sides of the mapping are validated to belong to the same restaurant
 * before a row is written (see `DishIngredientsService`).
 */
@Entity('dish_ingredients')
@Unique('UQ_dish_ingredients_dish_ingredient', ['dishId', 'ingredientId'])
@Index('IDX_dish_ingredients_ingredient', ['ingredientId'])
export class DishIngredient {
  @ApiProperty({ example: 1 })
  @PrimaryGeneratedColumn({ type: 'int', unsigned: true })
  id: number;

  @ApiProperty({ example: 1 })
  @Column({ type: 'int', unsigned: true, name: 'dish_id' })
  dishId: number;

  @ApiProperty({ example: 2 })
  @Column({ type: 'int', unsigned: true, name: 'ingredient_id' })
  ingredientId: number;

  @ApiProperty({ example: 100, description: 'Amount of the ingredient, expressed in `unit`.' })
  @Column({ type: 'decimal', precision: 10, scale: 3, transformer: numericTransformer })
  quantity: number;

  @ApiProperty({ example: 'g', description: 'Unit of measure, e.g. g, ml, piece, tbsp.' })
  @Column({ type: 'varchar', length: 16 })
  unit: string;

  @ApiProperty()
  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @ManyToOne(() => Dish, (dish) => dish.dishIngredients, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'dish_id', foreignKeyConstraintName: 'FK_dish_ingredients_dish' })
  dish: Dish;

  @ManyToOne(() => Ingredient, (ingredient) => ingredient.dishIngredients, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'ingredient_id', foreignKeyConstraintName: 'FK_dish_ingredients_ingredient' })
  ingredient: Ingredient;
}
