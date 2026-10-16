import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsEnum, IsOptional, IsString, Length, Matches } from 'class-validator';
import { UserRole } from 'src/common/enums';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const fold = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;

/** Roles a restaurant may hand out to its own people. */
export const ASSIGNABLE_STAFF_ROLES = [
  UserRole.RESTAURANT_MANAGER,
  UserRole.WAITER,
  UserRole.KITCHEN_STAFF,
] as const;

/**
 * Adding somebody to the floor.
 *
 * The code is what they type to sign in, so it is deliberately narrow: letters,
 * digits, dots and hyphens only. A code with a space in it is a code somebody
 * mistypes at a table during service, and a code that differs from another only
 * by case is one that gets blamed on the app.
 */
export class CreateStaffDto {
  @ApiProperty({ example: 'Ramesh Kumar', maxLength: 120 })
  @Transform(trim)
  @IsString()
  @Length(2, 120)
  name: string;

  @ApiProperty({
    example: 'ramesh',
    minLength: 3,
    maxLength: 32,
    description: 'Unique across Plateo. Case is folded, so RAMESH and ramesh are the same code.',
  })
  @Transform(fold)
  @IsString()
  @Length(3, 32)
  @Matches(/^[a-z0-9.-]+$/, {
    message: 'code may contain only letters, numbers, dots and hyphens',
  })
  code: string;

  @ApiProperty({ example: 'Shift2026!', minLength: 8, maxLength: 128 })
  @IsString()
  @Length(8, 128)
  @Matches(/[a-z]/, { message: 'password must include a lowercase letter' })
  @Matches(/[A-Z]/, { message: 'password must include an uppercase letter' })
  @Matches(/\d/, { message: 'password must include a number' })
  password: string;

  @ApiProperty({ enum: ASSIGNABLE_STAFF_ROLES, example: UserRole.WAITER })
  @IsEnum(UserRole)
  role: UserRole;
}

/** Changing somebody already on the floor. Their code is never reissued. */
export class UpdateStaffDto {
  @ApiPropertyOptional({ example: 'Ramesh Kumar', maxLength: 120 })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @Length(2, 120)
  name?: string;

  @ApiPropertyOptional({ enum: ASSIGNABLE_STAFF_ROLES })
  @IsOptional()
  @IsEnum(UserRole)
  role?: UserRole;

  @ApiPropertyOptional({
    example: false,
    description: 'Switching somebody off stops their logins at once and keeps their history.',
  })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class ResetStaffPasswordDto {
  @ApiProperty({ example: 'NewShift2026!', minLength: 8, maxLength: 128 })
  @IsString()
  @Length(8, 128)
  @Matches(/[a-z]/, { message: 'password must include a lowercase letter' })
  @Matches(/[A-Z]/, { message: 'password must include an uppercase letter' })
  @Matches(/\d/, { message: 'password must include a number' })
  password: string;
}

/** One member of the floor, as the POS lists them. Never carries a hash. */
export class StaffMemberDto {
  @ApiProperty({ example: 12 })
  id: number;

  @ApiProperty({ example: 'Ramesh Kumar' })
  name: string;

  @ApiProperty({ nullable: true, example: 'ramesh', description: 'Null for accounts that sign in with an email.' })
  code: string | null;

  @ApiProperty({ enum: UserRole, example: UserRole.WAITER })
  role: UserRole;

  @ApiProperty({ example: true })
  isActive: boolean;

  @ApiProperty({ description: 'When they were added to this restaurant.' })
  joinedAt: Date;
}
