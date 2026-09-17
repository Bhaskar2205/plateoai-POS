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
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { Restaurant } from 'src/modules/restaurants/entities/restaurant.entity';
import { Dish } from 'src/modules/dishes/entities/dish.entity';

/** A menu section ("Starters", "Bowls"), scoped to a single restaurant. */
@Entity('categories')
@Unique('UQ_categories_restaurant_name', ['restaurantId', 'name'])
@Index('IDX_categories_restaurant_sort', ['restaurantId', 'sortOrder'])
export class Category {
  @ApiProperty({ example: 1 })
  @PrimaryGeneratedColumn({ type: 'int', unsigned: true })
  id: number;

  @ApiProperty({ example: 1 })
  @Column({ type: 'int', unsigned: true, name: 'restaurant_id' })
  restaurantId: number;

  @ApiProperty({ example: 'Signature Bowls' })
  @Column({ type: 'varchar', length: 120 })
  name: string;

  @ApiProperty({ example: 0, description: 'Ascending display order within the menu.' })
  @Column({ type: 'int', default: 0, name: 'sort_order' })
  sortOrder: number;

  @ApiProperty({ example: true })
  @Column({ type: 'boolean', default: true, name: 'is_active' })
  isActive: boolean;

  @ApiProperty()
  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @ApiProperty()
  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @ManyToOne(() => Restaurant, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'restaurant_id', foreignKeyConstraintName: 'FK_categories_restaurant' })
  restaurant: Restaurant;

  @OneToMany(() => Dish, (dish) => dish.category)
  dishes: Dish[];
}
