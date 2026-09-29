import type { UserRole } from './types';

/**
 * Mirrors the API's role groups. The API is the real boundary; these only decide
 * what to show, so a role that cannot do something sees an explanation instead of
 * a 403 error.
 */

/** `RESTAURANT_ADMIN_ROLES`: table QR codes are printed and put in front of diners. */
export const TABLE_ADMIN_ROLES: UserRole[] = ['SUPER_ADMIN', 'RESTAURANT_OWNER'];

/** `ORDER_WRITE_ROLES`: taking orders and sending them to the kitchen. */
export const ORDER_WRITE_ROLES: UserRole[] = [
  'SUPER_ADMIN',
  'RESTAURANT_OWNER',
  'RESTAURANT_MANAGER',
  'WAITER',
];

/** `BILLING_ROLES`: discounting and settling. Deliberately excludes waiters. */
export const BILLING_ROLES: UserRole[] = ['SUPER_ADMIN', 'RESTAURANT_OWNER', 'RESTAURANT_MANAGER'];

/** `KITCHEN_ROLES`: the kitchen panel. */
export const KITCHEN_ROLES: UserRole[] = [
  'SUPER_ADMIN',
  'RESTAURANT_OWNER',
  'RESTAURANT_MANAGER',
  'KITCHEN_STAFF',
];

const allows = (roles: UserRole[], role: UserRole | undefined): boolean =>
  role !== undefined && roles.includes(role);

export const canManageTables = (role: UserRole | undefined): boolean =>
  allows(TABLE_ADMIN_ROLES, role);

export const canTakeOrders = (role: UserRole | undefined): boolean =>
  allows(ORDER_WRITE_ROLES, role);

/** Discounting and settling: a waiter takes the order, a manager takes the money. */
export const canBill = (role: UserRole | undefined): boolean => allows(BILLING_ROLES, role);

export const canWorkKitchen = (role: UserRole | undefined): boolean => allows(KITCHEN_ROLES, role);

/** The largest discount the API accepts, shown in the UI so the cap is not a surprise. */
export const MAX_DISCOUNT_PERCENT = 50;
