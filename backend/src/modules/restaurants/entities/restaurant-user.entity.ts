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
import { User } from 'src/modules/users/entities/user.entity';
import { Restaurant } from './restaurant.entity';

/**
 * Membership join table: which users may act on behalf of which restaurant.
 *
 * This is the authority the JWT strategy consults on every request - a token
 * whose `rid` no longer has a matching row here stops working immediately.
 */
@Entity('restaurant_users')
@Unique('UQ_restaurant_users_user_restaurant', ['userId', 'restaurantId'])
export class RestaurantUser {
  @ApiProperty({ example: 1 })
  @PrimaryGeneratedColumn({ type: 'int', unsigned: true })
  id: number;

  @ApiProperty({ example: 1 })
  @Index('IDX_restaurant_users_user')
  @Column({ type: 'int', unsigned: true, name: 'user_id' })
  userId: number;

  @ApiProperty({ example: 1 })
  @Index('IDX_restaurant_users_restaurant')
  @Column({ type: 'int', unsigned: true, name: 'restaurant_id' })
  restaurantId: number;

  @ApiProperty()
  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @ManyToOne(() => User, (user) => user.memberships, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'user_id', foreignKeyConstraintName: 'FK_restaurant_users_user' })
  user: User;

  @ManyToOne(() => Restaurant, (restaurant) => restaurant.memberships, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'restaurant_id', foreignKeyConstraintName: 'FK_restaurant_users_restaurant' })
  restaurant: Restaurant;
}
