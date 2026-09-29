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
import { KotStatus } from 'src/common/enums';
import { Restaurant } from 'src/modules/restaurants/entities/restaurant.entity';
import { User } from 'src/modules/users/entities/user.entity';
import { Order } from './order.entity';
import { OrderItem } from './order-item.entity';

/**
 * A Kitchen Order Ticket: the batch of lines sent to the kitchen at one moment.
 *
 * A table that orders again later gets a *second* ticket rather than a reprint,
 * which is how a kitchen actually works - the cooks must see only what is new.
 */
@Entity('kot_tickets')
@Unique('UQ_kot_tickets_restaurant_date_number', ['restaurantId', 'businessDate', 'ticketNumber'])
@Index('IDX_kot_tickets_restaurant_status', ['restaurantId', 'status'])
export class KotTicket {
  @ApiProperty({ example: 9 })
  @PrimaryGeneratedColumn({ type: 'int', unsigned: true })
  id: number;

  @ApiProperty({ example: 3 })
  @Column({ type: 'int', unsigned: true, name: 'restaurant_id' })
  restaurantId: number;

  @ApiProperty({ example: 41 })
  @Column({ type: 'int', unsigned: true, name: 'order_id' })
  orderId: number;

  @ApiProperty({ example: 5, description: 'Restarts at 1 each business day, per restaurant.' })
  @Column({ type: 'int', unsigned: true, name: 'ticket_number' })
  ticketNumber: number;

  @ApiProperty({ example: '2026-09-28' })
  @Column({ type: 'date', name: 'business_date' })
  businessDate: string;

  @ApiProperty({ enum: KotStatus, example: KotStatus.NEW })
  @Column({ type: 'varchar', length: 16, default: KotStatus.NEW })
  status: KotStatus;

  @ApiProperty({ nullable: true, description: 'Set when the ticket was last sent to a printer.' })
  @Column({ type: 'datetime', precision: 6, name: 'printed_at', nullable: true })
  printedAt: Date | null;

  @ApiProperty({ nullable: true, example: 4, description: 'Staff member who approved the items onto this ticket.' })
  @Column({ type: 'int', unsigned: true, name: 'created_by_user_id', nullable: true })
  createdByUserId: number | null;

  @ApiProperty()
  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @ApiProperty()
  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @ManyToOne(() => Restaurant, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'restaurant_id', foreignKeyConstraintName: 'FK_kot_tickets_restaurant' })
  restaurant: Restaurant;

  @ManyToOne(() => Order, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'order_id', foreignKeyConstraintName: 'FK_kot_tickets_order' })
  order: Order;

  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'created_by_user_id', foreignKeyConstraintName: 'FK_kot_tickets_created_by' })
  createdBy: User | null;

  @OneToMany(() => OrderItem, (item) => item.kotTicket)
  items: OrderItem[];
}
