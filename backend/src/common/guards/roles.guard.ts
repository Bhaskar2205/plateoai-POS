import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { KITCHEN_SCREEN_KEY } from '../decorators/kitchen-screen.decorator';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { UserRole } from '../enums';
import type { AuthenticatedRequest } from '../interfaces/authenticated-request.interface';

/**
 * Enforces `@Roles(...)`, and confines kitchen screens to `@KitchenScreen()`
 * routes.
 *
 * Registered globally; routes without `@Roles` stay open to any authenticated
 * member of the active restaurant. A kitchen screen is the exception: it signed
 * in with a code rather than an account, so it is refused everywhere except the
 * routes explicitly opened to it. That is deliberately the opposite default -
 * a new endpoint is closed to kitchen screens until someone opens it, rather
 * than open until someone remembers to close it.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const { user } = context.switchToHttp().getRequest<AuthenticatedRequest>();

    if (user?.kitchenDevice) {
      const allowed = this.reflector.getAllAndOverride<boolean | undefined>(KITCHEN_SCREEN_KEY, [
        context.getHandler(),
        context.getClass(),
      ]);

      if (!allowed) {
        throw new ForbiddenException(
          'A kitchen screen can only use the kitchen board. Sign in with a staff account for anything else.',
        );
      }
    }

    const required = this.reflector.getAllAndOverride<UserRole[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!required || required.length === 0) {
      return true;
    }

    if (!user || !required.includes(user.role)) {
      throw new ForbiddenException(
        `This action requires one of the following roles: ${required.join(', ')}.`,
      );
    }

    return true;
  }
}
