import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { OrderItemStatus, TaxGroup } from 'src/common/enums';
import { numericTransformer } from 'src/common/transformers/numeric.transformer';
import { Dish } from 'src/modules/dishes/entities/dish.entity';
import { Restaurant } from 'src/modules/restaurants/entities/restaurant.entity';
import { User } from 'src/modules/users/entities/user.entity';
import { KotTicket } from './kot-ticket.entity';
import { Order } from './order.entity';

/**
 * One line on a bill.
 *
 * `name` and `unitPrice` are copied from the dish when the line is added, not
 * read through the relation: renaming a dish or changing its price must never
 * alter an order that is already running, let alone a settled bill. `dishId` is
 * kept only for reporting, and goes null if the dish is deleted.
 */
@Entity('order_items')
@Index('IDX_order_items_order', ['orderId'])
@Index('IDX_order_items_restaurant_status', ['restaurantId', 'status'])
@Index('IDX_order_items_kot', ['kotTicketId'])
export class OrderItem {
  @ApiProperty({ example: 120 })
  @PrimaryGeneratedColumn({ type: 'int', unsigned: true })
  id: number;

  @ApiProperty({ example: 41 })
  @Column({ type: 'int', unsigned: true, name: 'order_id' })
  orderId: number;

  @ApiProperty({ example: 3, description: 'Denormalised so kitchen and report queries stay tenant-scoped and indexed.' })
  @Column({ type: 'int', unsigned: true, name: 'restaurant_id' })
  restaurantId: number;

  @ApiProperty({ nullable: true, example: 25 })
  @Column({ type: 'int', unsigned: true, name: 'dish_id', nullable: true })
  dishId: number | null;

  @ApiProperty({ example: 'Paneer Tikka Bowl', description: 'Dish name as it was when ordered.' })
  @Column({ type: 'varchar', length: 150 })
  name: string;

  @ApiProperty({ example: 249.5, description: 'Price as it was when ordered.' })
  @Column({ type: 'decimal', precision: 10, scale: 2, name: 'unit_price', transformer: numericTransformer })
  unitPrice: number;

  @ApiProperty({ example: 2 })
  @Column({ type: 'smallint', unsigned: true })
  quantity: number;

  @ApiProperty({
    enum: TaxGroup,
    example: TaxGroup.STANDARD,
    description: "The dish's tax group as it was when ordered, so reclassifying a dish never rewrites a bill.",
  })
  @Column({ type: 'varchar', length: 16, name: 'tax_group', default: TaxGroup.STANDARD })
  taxGroup: TaxGroup;

  @ApiProperty({ example: 499, description: 'unitPrice x quantity, stored so the bill never depends on re-multiplying.' })
  @Column({ type: 'decimal', precision: 10, scale: 2, name: 'line_total', transformer: numericTransformer })
  lineTotal: number;

  @ApiPropertyOptional({ nullable: true, example: 'No onion, less spicy' })
  @Column({ type: 'varchar', length: 255, nullable: true })
  note: string | null;

  @ApiProperty({ enum: OrderItemStatus, example: OrderItemStatus.PENDING })
  @Column({ type: 'varchar', length: 16, default: OrderItemStatus.PENDING })
  status: OrderItemStatus;

  @ApiProperty({ nullable: true, example: 9, description: 'The kitchen ticket this line went out on; null until approved.' })
  @Column({ type: 'int', unsigned: true, name: 'kot_ticket_id', nullable: true })
  kotTicketId: number | null;

  @ApiProperty({ nullable: true, example: 4, description: 'Null when a diner added it from the QR menu.' })
  @Column({ type: 'int', unsigned: true, name: 'created_by_user_id', nullable: true })
  createdByUserId: number | null;

  @ApiProperty({ nullable: true, example: 'Guest changed their mind' })
  @Column({ type: 'varchar', length: 255, name: 'cancelled_reason', nullable: true })
  cancelledReason: string | null;

  /**
   * Comped: cooked, served and eaten, but not charged for.
   *
   * Distinct from CANCELLED, which means it never reached the guest. The
   * difference matters to stock: a cancelled line consumes nothing, a comped one
   * consumes exactly as much as a sold one.
   */
  @ApiProperty({ example: false })
  @Column({ type: 'boolean', name: 'is_non_chargeable', default: false })
  isNonChargeable: boolean;

  @ApiProperty({ nullable: true, example: 'Guest sent it back - comped' })
  @Column({ type: 'varchar', length: 255, name: 'nc_reason', nullable: true })
  ncReason: string | null;

  @ApiProperty()
  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @ApiProperty()
  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @ManyToOne(() => Order, (order) => order.items, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'order_id', foreignKeyConstraintName: 'FK_order_items_order' })
  order: Order;

  @ManyToOne(() => Restaurant, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'restaurant_id', foreignKeyConstraintName: 'FK_order_items_restaurant' })
  restaurant: Restaurant;

  @ManyToOne(() => Dish, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'dish_id', foreignKeyConstraintName: 'FK_order_items_dish' })
  dish: Dish | null;

  @ManyToOne(() => KotTicket, (ticket) => ticket.items, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'kot_ticket_id', foreignKeyConstraintName: 'FK_order_items_kot' })
  kotTicket: KotTicket | null;

  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'created_by_user_id', foreignKeyConstraintName: 'FK_order_items_created_by' })
  createdBy: User | null;
}
