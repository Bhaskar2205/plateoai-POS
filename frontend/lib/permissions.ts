import type { UserRole } from './types';

/**
 * Mirrors the API's `RESTAURANT_ADMIN_ROLES` for table management. The API is
 * the real boundary; this only decides what to show, so other roles see an
 * explanation instead of a 403 error.
 */
export const TABLE_ADMIN_ROLES: UserRole[] = ['SUPER_ADMIN', 'RESTAURANT_OWNER'];

export const canManageTables = (role: UserRole | undefined): boolean =>
  role !== undefined && TABLE_ADMIN_ROLES.includes(role);
