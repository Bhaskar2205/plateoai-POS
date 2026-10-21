import { ApiProperty } from '@nestjs/swagger';
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Exclude } from 'class-transformer';
import { InventoryConsumptionMode, InventoryMode, RestaurantStatus } from 'src/common/enums';
import { numericTransformer } from 'src/common/transformers/numeric.transformer';
import { RestaurantUser } from './restaurant-user.entity';

/** A tenant. Every menu record in the system hangs off one of these rows. */
@Entity('restaurants')
export class Restaurant {
  @ApiProperty({ example: 1 })
  @PrimaryGeneratedColumn({ type: 'int', unsigned: true })
  id: number;

  @ApiProperty({ example: 'The Green Bowl' })
  @Column({ type: 'varchar', length: 150 })
  name: string;

  @ApiProperty({
    example: 'the-green-bowl',
    description:
      'Unique, URL-safe identifier derived from the current name. Follows renames; used as the ' +
      'canonical public menu URL.',
  })
  @Index('UQ_restaurants_slug', { unique: true })
  @Column({ type: 'varchar', length: 190 })
  slug: string;

  /**
   * Permanent public identifier, set once at registration and never changed by
   * profile edits - table QR codes and shared menu links use it, so they survive
   * renames. It shares one namespace with `slug` (see `RestaurantsService`), so
   * a public menu URL can never resolve to two restaurants.
   */
  @ApiProperty({
    example: 'the-green-bowl',
    description:
      'Permanent menu identifier. Set when the restaurant is created and never changes, so printed ' +
      'QR codes and shared links keep working after a rename. Read-only.',
  })
  @Index('UQ_restaurants_public_slug', { unique: true })
  @Column({ type: 'varchar', length: 190, name: 'public_slug' })
  publicSlug: string;

  /**
   * The code a kitchen screen signs in with.
   *
   * A credential, so it is `@Exclude()`d: it must never ride along in an ordinary
   * restaurant response. The owner reads it from one endpoint that exists only
   * for that purpose.
   */
  @Exclude()
  @Index('UQ_restaurants_kitchen_code', { unique: true })
  @Column({ type: 'varchar', length: 16, name: 'kitchen_code' })
  kitchenCode: string;

  @ApiProperty({ nullable: true, example: 'Seasonal bowls and salads.' })
  @Column({ type: 'text', nullable: true })
  description: string | null;

  @ApiProperty({ nullable: true, example: 'Jaipur, Rajasthan' })
  @Column({ type: 'varchar', length: 255, nullable: true })
  address: string | null;

  @ApiProperty({ nullable: true, example: '+91 98765 43210' })
  @Column({ type: 'varchar', length: 32, nullable: true })
  phone: string | null;

  @ApiProperty({ nullable: true, example: 'https://cdn.example.com/logo.png' })
  @Column({ type: 'varchar', length: 512, nullable: true, name: 'logo_url' })
  logoUrl: string | null;

  @ApiProperty({ enum: RestaurantStatus, example: RestaurantStatus.ACTIVE })
  @Column({ type: 'varchar', length: 16, default: RestaurantStatus.ACTIVE })
  status: RestaurantStatus;

  /**
   * Tax percentage added to every bill this restaurant settles. Defaults to 0, so
   * a restaurant that has not configured tax bills exactly what it charges. The
   * rate in force is copied onto each order when it is settled, so changing it
   * later never rewrites a bill a diner has already paid.
   */
  @ApiProperty({ example: 5, description: 'Tax percentage applied to bills. 0 adds no tax.' })
  @Column({ type: 'decimal', precision: 5, scale: 2, name: 'tax_rate', default: 0, transformer: numericTransformer })
  taxRate: number;

  @ApiProperty({
    nullable: true,
    example: '08AAAAA0000A1Z5',
    description: 'Tax registration number printed on bills, e.g. a GSTIN.',
  })
  @Column({ type: 'varchar', length: 32, name: 'tax_number', nullable: true })
  taxNumber: string | null;

  /**
   * The restaurant's own payment QR, as uploaded by the owner.
   *
   * Plateo neither generates nor reads it: it is a picture of whatever the
   * restaurant's bank or UPI app produced, printed onto the bill so a guest can
   * pay from the table. Because Plateo cannot see where the money goes, nothing
   * in the system treats a scan as a payment - settling the bill is still a
   * person pressing the button.
   */
  @ApiProperty({ nullable: true, example: 'https://api.plateoai.in/uploads/payment-qr/3/a1b2.png' })
  @Column({ type: 'varchar', length: 512, name: 'payment_qr_url', nullable: true })
  paymentQrUrl: string | null;

  /** Printed under the QR, so a guest can check they are paying the right place. */
  @ApiProperty({ nullable: true, example: 'greenbowl@okhdfcbank' })
  @Column({ type: 'varchar', length: 100, name: 'payment_qr_label', nullable: true })
  paymentQrLabel: string | null;

  /**
   * Whether the QR goes on every bill.
   *
   * Off by default, and it stays on once switched on - the owner ticks it once
   * rather than deciding per bill, which is the only way it is any use during a
   * busy service.
   */
  @ApiProperty({ example: false })
  @Column({ type: 'boolean', name: 'print_payment_qr', default: false })
  printPaymentQr: boolean;

  /**
   * Whether Plateo pays any attention to stock.
   *
   * DISABLED for everyone until somebody turns it on, and that default is the
   * whole point: a restaurant that never opens the inventory screen must see its
   * till behave exactly as it did before this feature existed. Nothing is
   * calculated, nothing is deducted, and no warning appears anywhere.
   */
  @ApiProperty({ enum: InventoryMode, example: InventoryMode.DISABLED })
  @Column({ type: 'varchar', length: 16, name: 'inventory_mode', default: InventoryMode.DISABLED })
  inventoryMode: InventoryMode;

  /**
   * When a sale is treated as having used its ingredients.
   *
   * Settlement by default, because a settled bill is the one event in Plateo that
   * is not expected to be undone. Deducting when an order is placed means every
   * cancelled order needs a reversal.
   */
  @ApiProperty({ enum: InventoryConsumptionMode, example: InventoryConsumptionMode.BILL_SETTLED })
  @Column({
    type: 'varchar',
    length: 20,
    name: 'inventory_consumption_mode',
    default: InventoryConsumptionMode.BILL_SETTLED,
  })
  inventoryConsumptionMode: InventoryConsumptionMode;

  /**
   * Whether stock may go below zero.
   *
   * False, and a restaurant should think before changing it. True is honest about
   * one thing - that the kitchen served the dish whatever the computer thought -
   * and dishonest about another, because a negative figure tells you the recipe
   * or the counting is wrong and reads as if it were stock.
   */
  @ApiProperty({ example: false })
  @Column({ type: 'boolean', name: 'allow_negative_stock', default: false })
  allowNegativeStock: boolean;

  /**
   * Reserved. Nothing reads this.
   *
   * The intent is that running out of an ingredient takes its dishes off the
   * menu, but that is not built, and the API no longer accepts or returns it - a
   * setting that cannot be changed and changes nothing is worse than none. The
   * column stays because it is already in production and dropping it would need
   * a migration that buys nothing; delete both together when this is built or
   * abandoned.
   */
  @ApiProperty({ example: false })
  @Column({ type: 'boolean', name: 'auto_disable_out_of_stock_dishes', default: false })
  autoDisableOutOfStockDishes: boolean;

  @ApiProperty()
  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @ApiProperty()
  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @OneToMany(() => RestaurantUser, (membership) => membership.restaurant)
  memberships: RestaurantUser[];
}
