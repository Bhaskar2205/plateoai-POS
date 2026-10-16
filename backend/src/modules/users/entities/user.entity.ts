import { ApiProperty } from '@nestjs/swagger';
import { Exclude } from 'class-transformer';
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { UserRole } from 'src/common/enums';
import { RestaurantUser } from 'src/modules/restaurants/entities/restaurant-user.entity';

/**
 * A platform account. A user is not itself a tenant: tenancy comes from the
 * `restaurant_users` rows linking this account to one or more restaurants.
 *
 * Enum-like columns are stored as VARCHAR rather than MySQL ENUM. That keeps
 * adding a role a data concern instead of a schema migration, and keeps the
 * entities portable to the SQLite datasource used by the e2e suite.
 */
@Entity('users')
export class User {
  @ApiProperty({ example: 1 })
  @PrimaryGeneratedColumn({ type: 'int', unsigned: true })
  id: number;

  @ApiProperty({ example: 'Asha Verma' })
  @Column({ type: 'varchar', length: 120 })
  name: string;

  @ApiProperty({ example: 'owner@example.com' })
  @Index('UQ_users_email', { unique: true })
  @Column({ type: 'varchar', length: 190 })
  email: string;

  /** Argon2id hash. Never serialised - see `ClassSerializerInterceptor`. */
  @Exclude()
  @Column({ type: 'varchar', length: 255, name: 'password_hash' })
  passwordHash: string;

  @ApiProperty({ enum: UserRole, example: UserRole.RESTAURANT_OWNER })
  @Column({ type: 'varchar', length: 32, default: UserRole.RESTAURANT_OWNER })
  role: UserRole;

  /**
   * How floor staff sign in: a short code instead of an email address.
   *
   * Unique across Plateo, not per restaurant, because every restaurant's
   * captains share one sign-in page and nothing in that form says which
   * restaurant is being signed in to.
   *
   * Null for everybody who signs in with an address, which is every owner and
   * manager. A unique index permits many nulls, so that costs nothing.
   */
  @Index('UQ_users_staff_code', { unique: true })
  @Column({ type: 'varchar', length: 32, name: 'staff_code', nullable: true })
  staffCode: string | null;

  /**
   * Switched off rather than deleted when somebody leaves.
   *
   * Deleting would take their name off every bill they opened and rewrite the
   * month's staff report; this stops the logins and leaves the history alone.
   */
  @ApiProperty({ example: true })
  @Column({ type: 'boolean', name: 'is_active', default: true })
  isActive: boolean;

  @ApiProperty()
  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @ApiProperty()
  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;

  @OneToMany(() => RestaurantUser, (membership) => membership.user)
  memberships: RestaurantUser[];
}
