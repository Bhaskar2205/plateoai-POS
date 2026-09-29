/** Platform-wide role of a user account. */
export enum UserRole {
  SUPER_ADMIN = 'SUPER_ADMIN',
  RESTAURANT_OWNER = 'RESTAURANT_OWNER',
  RESTAURANT_MANAGER = 'RESTAURANT_MANAGER',
  /** Takes orders at the table from a phone; cannot change the menu or settle discounts. */
  WAITER = 'WAITER',
  KITCHEN_STAFF = 'KITCHEN_STAFF',
}

/** Lifecycle of a table's running bill. */
export enum OrderStatus {
  /** Running: items can be added, nothing has been paid. */
  OPEN = 'OPEN',
  SETTLED = 'SETTLED',
  CANCELLED = 'CANCELLED',
}

/** Who created the order. */
export enum OrderSource {
  /** Entered by staff on a phone or the admin dashboard. */
  STAFF = 'STAFF',
  /** Placed by a diner from a table QR menu; needs staff approval before the kitchen sees it. */
  DINER_QR = 'DINER_QR',
}

/**
 * Line lifecycle. Diner-placed lines start PENDING and only reach the kitchen
 * once staff approve them onto a KOT.
 */
export enum OrderItemStatus {
  PENDING = 'PENDING',
  QUEUED = 'QUEUED',
  PREPARING = 'PREPARING',
  READY = 'READY',
  SERVED = 'SERVED',
  CANCELLED = 'CANCELLED',
}

/** Kitchen ticket lifecycle, as shown on the kitchen panel columns. */
export enum KotStatus {
  NEW = 'NEW',
  PREPARING = 'PREPARING',
  READY = 'READY',
  DONE = 'DONE',
  CANCELLED = 'CANCELLED',
}

/**
 * What the kitchen is doing for a table, summarised for the floor view.
 *
 * Derived from the table's live kitchen tickets rather than stored: it is a view
 * of the tickets, and storing it would be a second source of truth to keep in step.
 */
export enum KitchenState {
  /** Nothing with the kitchen: either nothing sent yet, or everything is done. */
  NONE = 'NONE',
  /** At least one ticket is new or being cooked. */
  COOKING = 'COOKING',
  /** Every live ticket is ready to go out. */
  READY = 'READY',
}

export enum DiscountType {
  PERCENT = 'PERCENT',
  AMOUNT = 'AMOUNT',
}

export enum PaymentMethod {
  CASH = 'CASH',
  UPI = 'UPI',
  CARD = 'CARD',
  OTHER = 'OTHER',
}

/** Lifecycle status of a restaurant tenant. */
export enum RestaurantStatus {
  ACTIVE = 'ACTIVE',
  INACTIVE = 'INACTIVE',
}

/** Dietary classification of a dish. */
export enum DietType {
  VEG = 'VEG',
  NON_VEG = 'NON_VEG',
  EGG = 'EGG',
  VEGAN = 'VEGAN',
}

/** Roles allowed to mutate menu + restaurant data. */
export const MENU_WRITE_ROLES: UserRole[] = [
  UserRole.SUPER_ADMIN,
  UserRole.RESTAURANT_OWNER,
  UserRole.RESTAURANT_MANAGER,
];

/** Roles allowed to change the restaurant profile itself. */
export const RESTAURANT_ADMIN_ROLES: UserRole[] = [
  UserRole.SUPER_ADMIN,
  UserRole.RESTAURANT_OWNER,
];

/** Roles allowed to take orders, approve diner orders and send tickets to the kitchen. */
export const ORDER_WRITE_ROLES: UserRole[] = [
  UserRole.SUPER_ADMIN,
  UserRole.RESTAURANT_OWNER,
  UserRole.RESTAURANT_MANAGER,
  UserRole.WAITER,
];

/**
 * Roles allowed to discount and settle a bill. Deliberately excludes waiters:
 * taking an order and taking the money are different responsibilities.
 */
export const BILLING_ROLES: UserRole[] = [
  UserRole.SUPER_ADMIN,
  UserRole.RESTAURANT_OWNER,
  UserRole.RESTAURANT_MANAGER,
];

/** Roles allowed to work the kitchen panel. */
export const KITCHEN_ROLES: UserRole[] = [
  UserRole.SUPER_ADMIN,
  UserRole.RESTAURANT_OWNER,
  UserRole.RESTAURANT_MANAGER,
  UserRole.KITCHEN_STAFF,
];

/** Largest discount any single bill may carry, as a percentage of its subtotal. */
export const MAX_DISCOUNT_PERCENT = 50;
