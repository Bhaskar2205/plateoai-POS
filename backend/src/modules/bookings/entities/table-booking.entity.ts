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
  UpdateDateColumn,
} from 'typeorm';
import { DiscountType, TableBookingStatus } from 'src/common/enums';
import { numericTransformer } from 'src/common/transformers/numeric.transformer';
import { Restaurant } from 'src/modules/restaurants/entities/restaurant.entity';
import { RestaurantTable } from 'src/modules/tables/entities/restaurant-table.entity';
import { User } from 'src/modules/users/entities/user.entity';

/**
 * A table a guest booked through the Plateo app.
 *
 * Only app bookings live here. A waiter seating a walk-in is the floor's job and
 * always has been; mixing the two would mean the booking list stopped being the
 * list of people the restaurant has made a promise to.
 *
 * The guest's details are copied onto the row rather than joined from an account.
 * Plateo has no diner accounts, the app is not built yet, and a booking has to
 * stay readable - who, how many, when - long after whatever sent it has changed.
 */
@Entity('table_bookings')
@Unique('UQ_table_bookings_restaurant_date_reference', ['restaurantId', 'businessDate', 'referenceNumber'])
// The question the screen asks: what is coming, soonest first.
@Index('IDX_table_bookings_restaurant_time', ['restaurantId', 'bookedFor'])
@Index('IDX_table_bookings_restaurant_status', ['restaurantId', 'status'])
export class TableBooking {
  @ApiProperty({ example: 1 })
  @PrimaryGeneratedColumn({ type: 'int', unsigned: true })
  id: number;

  @ApiProperty({ example: 3 })
  @Column({ type: 'int', unsigned: true, name: 'restaurant_id' })
  restaurantId: number;

  @ManyToOne(() => Restaurant, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'restaurant_id', foreignKeyConstraintName: 'FK_table_bookings_restaurant' })
  restaurant: Restaurant;

  /**
   * Short, per-restaurant, and restarted daily like a bill number, so staff can
   * say "booking 4" to each other instead of reading out a database id.
   */
  @ApiProperty({ example: 4 })
  @Column({ type: 'int', unsigned: true, name: 'reference_number' })
  referenceNumber: number;

  /** The service this booking belongs to, so a late-evening booking files correctly. */
  @ApiProperty({ example: '2026-10-08' })
  @Column({ type: 'date', name: 'business_date' })
  businessDate: string;

  @ApiProperty({ example: 'Ananya Rao' })
  @Column({ type: 'varchar', length: 120, name: 'guest_name' })
  guestName: string;

  @ApiProperty({ example: '+919876543210' })
  @Column({ type: 'varchar', length: 32, name: 'guest_phone' })
  guestPhone: string;

  @ApiProperty({ nullable: true, example: 'ananya@example.com' })
  @Column({ type: 'varchar', length: 190, name: 'guest_email', nullable: true })
  guestEmail: string | null;

  @ApiProperty({ example: 4, description: 'How many people are coming.' })
  @Column({ type: 'smallint', unsigned: true, name: 'party_size' })
  partySize: number;

  /** When the guest is coming. Stored UTC, like every other instant in Plateo. */
  @ApiProperty({ example: '2026-10-08T14:00:00.000Z' })
  @Column({ type: 'datetime', precision: 6, name: 'booked_for' })
  bookedFor: Date;

  @ApiProperty({ enum: TableBookingStatus, example: TableBookingStatus.REQUESTED })
  @Column({ type: 'varchar', length: 16, default: TableBookingStatus.REQUESTED })
  status: TableBookingStatus;

  /**
   * Assigned when the booking is confirmed, and optional even then - plenty of
   * restaurants confirm a booking and decide the table on the night.
   */
  @ApiProperty({ nullable: true, example: 7 })
  @Column({ type: 'int', unsigned: true, name: 'table_id', nullable: true })
  tableId: number | null;

  @ManyToOne(() => RestaurantTable, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'table_id', foreignKeyConstraintName: 'FK_table_bookings_table' })
  table: RestaurantTable | null;

  /**
   * A discount the bill should carry when this party is seated.
   *
   * An intention, not money. A booking has no bill to compute against, so there
   * is no `discountAmount` here the way there is on an order - the amount is
   * worked out once there is a subtotal to take it off. Type and value match
   * `orders` exactly, so what staff read here is what they enter on the bill.
   *
   * It may arrive from the Plateo app - a promotion, a loyalty tier - and staff
   * may change or clear it when they confirm. Nothing applies it automatically:
   * a discount reaching a bill is somebody's decision, and it stays that way.
   */
  @ApiProperty({ enum: DiscountType, nullable: true })
  @Column({ type: 'varchar', length: 8, name: 'discount_type', nullable: true })
  discountType: DiscountType | null;

  @ApiProperty({ nullable: true, example: 10, description: 'Percent, or a flat amount, depending on discountType.' })
  @Column({
    type: 'decimal',
    precision: 10,
    scale: 2,
    name: 'discount_value',
    nullable: true,
    transformer: numericTransformer,
  })
  discountValue: number | null;

  @ApiProperty({ nullable: true, example: 'Regular - birthday party of 8' })
  @Column({ type: 'varchar', length: 255, name: 'discount_reason', nullable: true })
  discountReason: string | null;

  @ApiProperty({ nullable: true, example: 'Window seat if possible. One highchair.' })
  @Column({ type: 'varchar', length: 500, name: 'guest_note', nullable: true })
  guestNote: string | null;

  /** Why it was declined, or anything the restaurant wants on the record. */
  @ApiProperty({ nullable: true, example: 'Fully booked at that time.' })
  @Column({ type: 'varchar', length: 500, name: 'restaurant_note', nullable: true })
  restaurantNote: string | null;

  @ApiProperty({ nullable: true })
  @Column({ type: 'datetime', precision: 6, name: 'responded_at', nullable: true })
  respondedAt: Date | null;

  @ApiProperty({ nullable: true })
  @Column({ type: 'datetime', precision: 6, name: 'seated_at', nullable: true })
  seatedAt: Date | null;

  @ApiProperty({ nullable: true, description: 'Who answered the booking.' })
  @Column({ type: 'int', unsigned: true, name: 'handled_by_user_id', nullable: true })
  handledByUserId: number | null;

  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'handled_by_user_id', foreignKeyConstraintName: 'FK_table_bookings_handler' })
  handledBy: User | null;

  @ApiProperty()
  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @ApiProperty()
  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
