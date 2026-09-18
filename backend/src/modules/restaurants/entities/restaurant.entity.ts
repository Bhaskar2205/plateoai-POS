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
import { RestaurantStatus } from 'src/common/enums';
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

  @ApiProperty()
  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @ApiProperty()
  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @OneToMany(() => RestaurantUser, (membership) => membership.restaurant)
  memberships: RestaurantUser[];
}
