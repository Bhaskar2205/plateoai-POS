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
