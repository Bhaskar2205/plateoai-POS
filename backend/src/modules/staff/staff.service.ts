import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, QueryFailedError } from 'typeorm';
import { AuditAction, AuditEntity, UserRole } from 'src/common/enums';
import { hashPassword } from 'src/common/security/password';
import { AuditContext, AuditService } from 'src/modules/audit/audit.service';
import { RestaurantUser } from 'src/modules/restaurants/entities/restaurant-user.entity';
import { User } from 'src/modules/users/entities/user.entity';
import {
  ASSIGNABLE_STAFF_ROLES,
  CreateStaffDto,
  ResetStaffPasswordDto,
  StaffMemberDto,
  UpdateStaffDto,
} from './dto/staff.dto';

/**
 * The people who work in one restaurant.
 *
 * Captains sign in with a short code rather than an address, so `users.email` -
 * which is NOT NULL and unique - is filled with a placeholder on the reserved
 * `.invalid` domain. It can never route anywhere, is never shown and is never
 * sent mail. The alternative was making the column nullable, which would have
 * meant auditing every lookup in the codebase that assumes an address is there.
 *
 * Nobody is ever deleted. Removing an account would take its name off every bill
 * it opened and silently rewrite the month's staff report; switching it off ends
 * the logins and leaves the history telling the truth.
 */
@Injectable()
export class StaffService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly auditService: AuditService,
  ) {}

  /** The address a code-based account carries. Never routable, never shown. */
  private static placeholderEmail(code: string): string {
    return `${code}@captain.plateo.invalid`;
  }

  private static assertAssignable(role: UserRole): void {
    if (!ASSIGNABLE_STAFF_ROLES.includes(role as (typeof ASSIGNABLE_STAFF_ROLES)[number])) {
      throw new BadRequestException(
        'A restaurant may add managers, waiters and kitchen staff. Owners are set by Plateo.',
      );
    }
  }

  async findAll(restaurantId: number): Promise<StaffMemberDto[]> {
    const memberships = await this.dataSource.getRepository(RestaurantUser).find({
      where: { restaurantId },
      relations: { user: true },
      order: { id: 'ASC' },
    });

    return memberships
      .filter((membership) => membership.user)
      .map((membership) => ({
        id: membership.user.id,
        name: membership.user.name,
        code: membership.user.staffCode,
        role: membership.user.role,
        isActive: membership.user.isActive,
        joinedAt: membership.createdAt,
      }));
  }

  async create(
    restaurantId: number,
    dto: CreateStaffDto,
    actorId: number,
    context?: AuditContext,
  ): Promise<StaffMemberDto> {
    StaffService.assertAssignable(dto.role);

    const passwordHash = await hashPassword(dto.password);

    try {
      return await this.dataSource.transaction(async (manager) => {
        const users = manager.getRepository(User);

        const user = await users.save(
          users.create({
            name: dto.name,
            email: StaffService.placeholderEmail(dto.code),
            staffCode: dto.code,
            passwordHash,
            role: dto.role,
            isActive: true,
          }),
        );

        const membership = await manager.getRepository(RestaurantUser).save({
          userId: user.id,
          restaurantId,
        });

        // The password never reaches the log, and nor does anything that would
        // let it be guessed - only that an account was opened, and for whom.
        await this.auditService.recordIn(manager, {
          restaurantId,
          userId: actorId,
          action: AuditAction.STAFF_CREATED,
          entityType: AuditEntity.USER,
          entityId: user.id,
          newValue: { name: user.name, code: user.staffCode, role: user.role },
          context,
        });

        return {
          id: user.id,
          name: user.name,
          code: user.staffCode,
          role: user.role,
          isActive: user.isActive,
          joinedAt: membership.createdAt,
        };
      });
    } catch (error) {
      // The unique index is the thing that actually settles a race between two
      // managers adding the same code at once; checking first and inserting
      // after would leave a window between them.
      if (error instanceof QueryFailedError && /Duplicate entry|UNIQUE/i.test(error.message)) {
        throw new ConflictException(
          `The code "${dto.code}" is already in use. Codes are shared across all of Plateo, so pick another.`,
        );
      }

      throw error;
    }
  }

  async update(
    restaurantId: number,
    staffId: number,
    dto: UpdateStaffDto,
    actorId: number,
    context?: AuditContext,
  ): Promise<StaffMemberDto> {
    const user = await this.memberOrFail(restaurantId, staffId);

    if (dto.role !== undefined) StaffService.assertAssignable(dto.role);

    // An owner is not a floor account and must not become one by a PATCH that
    // was aimed at a waiter.
    if (user.role === UserRole.RESTAURANT_OWNER || user.role === UserRole.SUPER_ADMIN) {
      throw new BadRequestException('Owner accounts are managed by Plateo, not from here.');
    }

    const before = { name: user.name, role: user.role, isActive: user.isActive };

    await this.dataSource.transaction(async (manager) => {
      await manager.getRepository(User).update(
        { id: user.id },
        {
          ...(dto.name !== undefined ? { name: dto.name } : {}),
          ...(dto.role !== undefined ? { role: dto.role } : {}),
          ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
        },
      );

      await this.auditService.recordIn(manager, {
        restaurantId,
        userId: actorId,
        action: AuditAction.STAFF_UPDATED,
        entityType: AuditEntity.USER,
        entityId: user.id,
        oldValue: before,
        newValue: { ...before, ...dto },
        context,
      });
    });

    return this.oneOrFail(restaurantId, staffId);
  }

  async resetPassword(
    restaurantId: number,
    staffId: number,
    dto: ResetStaffPasswordDto,
    actorId: number,
    context?: AuditContext,
  ): Promise<void> {
    const user = await this.memberOrFail(restaurantId, staffId);

    if (user.role === UserRole.RESTAURANT_OWNER || user.role === UserRole.SUPER_ADMIN) {
      throw new BadRequestException('Owner passwords are reset by Plateo, not from here.');
    }

    const passwordHash = await hashPassword(dto.password);

    await this.dataSource.transaction(async (manager) => {
      await manager.getRepository(User).update({ id: user.id }, { passwordHash });

      await this.auditService.recordIn(manager, {
        restaurantId,
        userId: actorId,
        action: AuditAction.STAFF_PASSWORD_RESET,
        entityType: AuditEntity.USER,
        entityId: user.id,
        newValue: { name: user.name, code: user.staffCode },
        context,
      });
    });
  }

  /**
   * 404 rather than 403 for somebody who works at a different restaurant: which
   * one they work at is not this restaurant's business to learn.
   */
  private async memberOrFail(restaurantId: number, staffId: number): Promise<User> {
    const membership = await this.dataSource.getRepository(RestaurantUser).findOne({
      where: { restaurantId, userId: staffId },
      relations: { user: true },
    });

    if (!membership?.user) {
      throw new NotFoundException(`No such person works here.`);
    }

    return membership.user;
  }

  private async oneOrFail(restaurantId: number, staffId: number): Promise<StaffMemberDto> {
    const all = await this.findAll(restaurantId);
    const found = all.find((member) => member.id === staffId);

    if (!found) throw new NotFoundException(`No such person works here.`);

    return found;
  }
}
