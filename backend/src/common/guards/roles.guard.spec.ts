import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserRole } from '../enums';
import { RolesGuard } from './roles.guard';

const contextFor = (role?: UserRole): ExecutionContext =>
  ({
    getHandler: () => () => undefined,
    getClass: () => class {},
    switchToHttp: () => ({
      getRequest: () => (role ? { user: { id: 1, role, restaurantId: 1 } } : {}),
    }),
  }) as unknown as ExecutionContext;

describe('RolesGuard', () => {
  const guardWith = (required: UserRole[] | undefined) => {
    const reflector = { getAllAndOverride: jest.fn().mockReturnValue(required) } as unknown as Reflector;
    return new RolesGuard(reflector);
  };

  it('allows any authenticated user when no roles are declared', () => {
    expect(guardWith(undefined).canActivate(contextFor(UserRole.KITCHEN_STAFF))).toBe(true);
    expect(guardWith([]).canActivate(contextFor(UserRole.KITCHEN_STAFF))).toBe(true);
  });

  it('allows a user holding one of the required roles', () => {
    const guard = guardWith([UserRole.RESTAURANT_OWNER, UserRole.RESTAURANT_MANAGER]);

    expect(guard.canActivate(contextFor(UserRole.RESTAURANT_OWNER))).toBe(true);
    expect(guard.canActivate(contextFor(UserRole.RESTAURANT_MANAGER))).toBe(true);
  });

  it('rejects a user whose role is not listed', () => {
    const guard = guardWith([UserRole.RESTAURANT_OWNER]);

    expect(() => guard.canActivate(contextFor(UserRole.KITCHEN_STAFF))).toThrow(ForbiddenException);
  });

  it('rejects a request with no user attached', () => {
    const guard = guardWith([UserRole.RESTAURANT_OWNER]);

    expect(() => guard.canActivate(contextFor(undefined))).toThrow(ForbiddenException);
  });
});
