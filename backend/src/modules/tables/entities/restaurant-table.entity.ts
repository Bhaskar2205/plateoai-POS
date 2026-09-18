import { Exclude } from 'class-transformer';
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { Restaurant } from 'src/modules/restaurants/entities/restaurant.entity';

/**
 * A physical table in a restaurant, reached by diners through its QR code.
 *
 * `qrToken` is the table's identifier in the public menu URL
 * (`/menu/<restaurant-slug>?table=<qrToken>`). It is random rather than derived
 * from the name, so table URLs cannot be guessed and regenerating the token
 * really retires a printed QR code. The owner API never returns it as a field -
 * only inside the menu URL the owner prints - and the public API never returns
 * it at all. `@Exclude()` is a backstop in case an entity is ever serialised.
 */
@Entity('restaurant_tables')
@Unique('UQ_restaurant_tables_restaurant_name', ['restaurantId', 'name'])
export class RestaurantTable {
  @PrimaryGeneratedColumn({ type: 'int', unsigned: true })
  id: number;

  @Column({ type: 'int', unsigned: true, name: 'restaurant_id' })
  restaurantId: number;

  @Column({ type: 'varchar', length: 60 })
  name: string;

  @Exclude()
  @Index('UQ_restaurant_tables_qr_token', { unique: true })
  @Column({ type: 'varchar', length: 64, name: 'qr_token' })
  qrToken: string;

  @Column({ type: 'boolean', default: true, name: 'is_active' })
  isActive: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @ManyToOne(() => Restaurant, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'restaurant_id', foreignKeyConstraintName: 'FK_restaurant_tables_restaurant' })
  restaurant: Restaurant;
}
