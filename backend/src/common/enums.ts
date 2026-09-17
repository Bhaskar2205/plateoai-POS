/** Platform-wide role of a user account. */
export enum UserRole {
  SUPER_ADMIN = 'SUPER_ADMIN',
  RESTAURANT_OWNER = 'RESTAURANT_OWNER',
  RESTAURANT_MANAGER = 'RESTAURANT_MANAGER',
  KITCHEN_STAFF = 'KITCHEN_STAFF',
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
