import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
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
import { numericTransformer } from 'src/common/transformers/numeric.transformer';
import { DiscountType, OrderSource, OrderStatus, PaymentMethod } from 'src/common/enums';
import { Restaurant } from 'src/modules/restaurants/entities/restaurant.entity';
import { RestaurantTable } from 'src/modules/tables/entities/restaurant-table.entity';
import { User } from 'src/modules/users/entities/user.entity';
import { OrderItem } from './order-item.entity';

/**
 * One running bill for a table: everything ordered between seating and payment.
 *
 * Money columns are DECIMAL and are always recalculated on the server from the
 * order's own lines - a client never sends a total. They are stored rather than
 * derived so a settled bill keeps the exact figures the diner paid, even if the
 * menu, the tax rate or a dish price changes afterwards.
 */
@Entity('orders')
@Unique('UQ_orders_restaurant_date_number', ['restaurantId', 'businessDate', 'orderNumber'])
@Index('IDX_orders_restaurant_status', ['restaurantId', 'status'])
@Index('IDX_orders_table_status', ['tableId', 'status'])
export class Order {
  @ApiProperty({ example: 41 })
  @PrimaryGeneratedColumn({ type: 'int', unsigned: true })
  id: number;

  @ApiProperty({ example: 3 })
  @Column({ type: 'int', unsigned: true, name: 'restaurant_id' })
  restaurantId: number;

  @ApiProperty({ nullable: true, example: 7, description: 'Null once the table is deleted; the bill survives.' })
  @Column({ type: 'int', unsigned: true, name: 'table_id', nullable: true })
  tableId: number | null;

  @ApiProperty({ example: 12, description: 'Restarts at 1 each business day, per restaurant.' })
  @Column({ type: 'int', unsigned: true, name: 'order_number' })
  orderNumber: number;

  @ApiProperty({ example: '2026-09-28', description: 'Trading day the order belongs to (starts at 05:00 local time).' })
  @Column({ type: 'date', name: 'business_date' })
  businessDate: string;

  @ApiProperty({ enum: OrderStatus, example: OrderStatus.OPEN })
  @Column({ type: 'varchar', length: 16, default: OrderStatus.OPEN })
  status: OrderStatus;

  @ApiProperty({ enum: OrderSource, example: OrderSource.DINER_QR })
  @Column({ type: 'varchar', length: 16, default: OrderSource.STAFF })
  source: OrderSource;

  @ApiProperty({ example: 640, description: 'Sum of the live lines, before discount and tax.' })
  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0, transformer: numericTransformer })
  subtotal: number;

  @ApiPropertyOptional({ enum: DiscountType, nullable: true })
  @Column({ type: 'varchar', length: 8, name: 'discount_type', nullable: true })
  discountType: DiscountType | null;

  @ApiProperty({ nullable: true, example: 10, description: 'Percent, or a flat amount, depending on discountType.' })
  @Column({ type: 'decimal', precision: 10, scale: 2, name: 'discount_value', nullable: true, transformer: numericTransformer })
  discountValue: number | null;

  @ApiProperty({ example: 64, description: 'Money actually taken off, computed server-side.' })
  @Column({ type: 'decimal', precision: 10, scale: 2, name: 'discount_amount', default: 0, transformer: numericTransformer })
  discountAmount: number;

  @ApiProperty({ nullable: true, example: 'Regular guest' })
  @Column({ type: 'varchar', length: 255, name: 'discount_reason', nullable: true })
  discountReason: string | null;

  @ApiProperty({ example: 5, description: 'Tax percentage applied to this bill, copied from the restaurant at settlement.' })
  @Column({ type: 'decimal', precision: 5, scale: 2, name: 'tax_rate', default: 0, transformer: numericTransformer })
  taxRate: number;

  @ApiProperty({ example: 28.8 })
  @Column({ type: 'decimal', precision: 10, scale: 2, name: 'tax_amount', default: 0, transformer: numericTransformer })
  taxAmount: number;

  @ApiProperty({ example: 604.8, description: 'subtotal - discount + tax.' })
  @Column({ type: 'decimal', precision: 10, scale: 2, default: 0, transformer: numericTransformer })
  total: number;

  @ApiPropertyOptional({ enum: PaymentMethod, nullable: true })
  @Column({ type: 'varchar', length: 16, name: 'payment_method', nullable: true })
  paymentMethod: PaymentMethod | null;

  @ApiProperty({ nullable: true })
  @Column({ type: 'datetime', precision: 6, name: 'settled_at', nullable: true })
  settledAt: Date | null;

  @ApiProperty({ nullable: true, example: 4 })
  @Column({ type: 'int', unsigned: true, name: 'settled_by_user_id', nullable: true })
  settledByUserId: number | null;

  @ApiProperty({ nullable: true, example: 4, description: 'Null when a diner opened it by scanning.' })
  @Column({ type: 'int', unsigned: true, name: 'opened_by_user_id', nullable: true })
  openedByUserId: number | null;

  @ApiProperty({ nullable: true, example: 'Guests left before ordering' })
  @Column({ type: 'varchar', length: 255, name: 'cancelled_reason', nullable: true })
  cancelledReason: string | null;

  @ApiProperty({ nullable: true, example: 'Birthday table, cake at the end' })
  @Column({ type: 'varchar', length: 500, nullable: true })
  notes: string | null;

  @ApiProperty()
  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @ApiProperty()
  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @ManyToOne(() => Restaurant, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'restaurant_id', foreignKeyConstraintName: 'FK_orders_restaurant' })
  restaurant: Restaurant;

  @ManyToOne(() => RestaurantTable, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'table_id', foreignKeyConstraintName: 'FK_orders_table' })
  table: RestaurantTable | null;

  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'settled_by_user_id', foreignKeyConstraintName: 'FK_orders_settled_by' })
  settledBy: User | null;

  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'opened_by_user_id', foreignKeyConstraintName: 'FK_orders_opened_by' })
  openedBy: User | null;

  @OneToMany(() => OrderItem, (item) => item.order)
  items: OrderItem[];
}
