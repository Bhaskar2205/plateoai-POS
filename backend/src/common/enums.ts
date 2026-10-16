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

/**
 * What a charge on a bill is.
 *
 * An Indian GST bill has to show each component on its own line - CGST and SGST
 * separately for a sale within the state, IGST for one across states - so a
 * single "Tax 5%" line is not a tax invoice. The kind is stored per line rather
 * than inferred from the name, because the name is whatever the restaurant typed.
 *
 * SERVICE_CHARGE is not a tax: it is the restaurant's own charge, it is taxable
 * itself, and under the 2022 CCPA guidelines it cannot be added without the
 * guest's agreement - so it is always removable from a bill.
 */
export enum TaxKind {
  CGST = 'CGST',
  SGST = 'SGST',
  IGST = 'IGST',
  UTGST = 'UTGST',
  /** Compensation cess, e.g. on aerated drinks. */
  CESS = 'CESS',
  /** State VAT, which still applies to alcohol because it is outside GST. */
  VAT = 'VAT',
  SERVICE_CHARGE = 'SERVICE_CHARGE',
  OTHER = 'OTHER',
}

/** Charges that are a tax, as opposed to the restaurant's own service charge. */
export const TAX_KINDS: TaxKind[] = [
  TaxKind.CGST,
  TaxKind.SGST,
  TaxKind.IGST,
  TaxKind.UTGST,
  TaxKind.CESS,
  TaxKind.VAT,
  TaxKind.OTHER,
];

/**
 * Which lines a charge applies to.
 *
 * Not everything on a restaurant bill is taxed the same way: food and drink
 * served is a restaurant service, alcohol sits outside GST entirely and attracts
 * state VAT, and a sealed packaged item can carry its own rate. A dish belongs to
 * one group, and a charge names the group it applies to.
 */
export enum TaxGroup {
  /** Food and beverage prepared and served. The ordinary case. */
  STANDARD = 'STANDARD',
  /** Outside GST; state excise and VAT apply instead. */
  ALCOHOL = 'ALCOHOL',
  /** Sold sealed, as bought - a bottle of water, a packet of crisps. */
  PACKAGED = 'PACKAGED',
  /** Carries no tax at all. */
  EXEMPT = 'EXEMPT',
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


/**
 * What an audit record describes.
 *
 * Only actions this system can actually perform appear here. There is no staff
 * management, inventory or refund in Plateo yet, so there are no audit actions
 * for them: an action nobody can take would be a line in a log that is never
 * written, which reads as coverage and is not.
 */
export enum AuditAction {
  BILL_DISCOUNTED = 'BILL_DISCOUNTED',
  BILL_DISCOUNT_REMOVED = 'BILL_DISCOUNT_REMOVED',
  BILL_SETTLED = 'BILL_SETTLED',
  BILL_VOIDED = 'BILL_VOIDED',
  BILL_TDS_RECORDED = 'BILL_TDS_RECORDED',
  TAX_CONFIGURATION_CHANGED = 'TAX_CONFIGURATION_CHANGED',
  SERVICE_CHARGE_CHANGED = 'SERVICE_CHARGE_CHANGED',
  DISH_PRICE_CHANGED = 'DISH_PRICE_CHANGED',
  DISH_TAX_GROUP_CHANGED = 'DISH_TAX_GROUP_CHANGED',
  DISH_AVAILABILITY_CHANGED = 'DISH_AVAILABILITY_CHANGED',
  TABLE_CREATED = 'TABLE_CREATED',
  TABLE_DEACTIVATED = 'TABLE_DEACTIVATED',
  TABLE_REACTIVATED = 'TABLE_REACTIVATED',
  QR_REGENERATED = 'QR_REGENERATED',
  KITCHEN_CODE_REGENERATED = 'KITCHEN_CODE_REGENERATED',
  PAYMENT_INTENT_CREATED = 'PAYMENT_INTENT_CREATED',
  PAYMENT_AUTHORIZED = 'PAYMENT_AUTHORIZED',
  PAYMENT_CAPTURED = 'PAYMENT_CAPTURED',
  PAYMENT_FAILED = 'PAYMENT_FAILED',
  PAYMENT_CANCELLED = 'PAYMENT_CANCELLED',
  PAYMENT_REFUNDED = 'PAYMENT_REFUNDED',
  PAYMENT_RECONCILIATION_EXCEPTION = 'PAYMENT_RECONCILIATION_EXCEPTION',
  INGREDIENT_CREATED = 'INGREDIENT_CREATED',
  INGREDIENT_UPDATED = 'INGREDIENT_UPDATED',
  STOCK_ADDED = 'STOCK_ADDED',
  STOCK_ADJUSTED = 'STOCK_ADJUSTED',
  WASTAGE_RECORDED = 'WASTAGE_RECORDED',
  STOCK_COUNT_COMPLETED = 'STOCK_COUNT_COMPLETED',
  RECIPE_UPDATED = 'RECIPE_UPDATED',
  INVENTORY_MODE_CHANGED = 'INVENTORY_MODE_CHANGED',
  STAFF_CREATED = 'STAFF_CREATED',
  STAFF_UPDATED = 'STAFF_UPDATED',
  STAFF_PASSWORD_RESET = 'STAFF_PASSWORD_RESET',
  ORDER_ITEM_COMPED = 'ORDER_ITEM_COMPED',
  ORDER_ITEM_COMP_CLEARED = 'ORDER_ITEM_COMP_CLEARED',
  ORDER_MARKED_NC = 'ORDER_MARKED_NC',
  ORDER_NC_CLEARED = 'ORDER_NC_CLEARED',
  /** A no-charge bill erased by an owner. The bill goes; this record stays. */
  NC_ORDER_DELETED = 'NC_ORDER_DELETED',
  BOOKING_CONFIRMED = 'BOOKING_CONFIRMED',
  BOOKING_DECLINED = 'BOOKING_DECLINED',
  BOOKING_SEATED = 'BOOKING_SEATED',
  BOOKING_CLOSED = 'BOOKING_CLOSED',
  RESTAURANT_ACCOUNT_CREATED = 'RESTAURANT_ACCOUNT_CREATED',
  RESTAURANT_STATUS_CHANGED = 'RESTAURANT_STATUS_CHANGED',
  OWNER_PASSWORD_RESET = 'OWNER_PASSWORD_RESET',
}

/** What an audit record is about, so the log can be filtered by the thing changed. */
export enum AuditEntity {
  ORDER = 'ORDER',
  TAX_COMPONENT = 'TAX_COMPONENT',
  DISH = 'DISH',
  TABLE = 'TABLE',
  RESTAURANT = 'RESTAURANT',
  PAYMENT = 'PAYMENT',
  INGREDIENT = 'INGREDIENT',
  TABLE_BOOKING = 'TABLE_BOOKING',
  USER = 'USER',
}

/**
 * Whether a reserved idempotency key has produced an answer yet.
 *
 * IN_PROGRESS exists so a retry that arrives while the first request is still
 * running is told to wait rather than being allowed to run the operation twice.
 */
export enum IdempotencyStatus {
  IN_PROGRESS = 'IN_PROGRESS',
  COMPLETED = 'COMPLETED',
}

/** Operations protected by an idempotency key. One scope per irreversible action. */
export enum IdempotencyScope {
  /** Staff opening a bill. */
  ORDER_CREATE = 'ORDER_CREATE',
  /** A diner submitting from a table QR menu. */
  DINER_ORDER = 'DINER_ORDER',
  ORDER_SETTLE = 'ORDER_SETTLE',
  TABLE_REGENERATE_QR = 'TABLE_REGENERATE_QR',
  PAYMENT_INTENT_CREATE = 'PAYMENT_INTENT_CREATE',
  STOCK_IN = 'STOCK_IN',
  STOCK_ADJUSTMENT = 'STOCK_ADJUSTMENT',
  STOCK_COUNT = 'STOCK_COUNT',
}


/**
 * Where a payment has got to.
 *
 * Deliberately separate from `OrderStatus`. A bill can be served and unpaid, or
 * paid and still open while the kitchen finishes; merging the two into one field
 * means every future question about money has to be answered by inferring it
 * from a status that was really about food.
 */
export enum PaymentStatus {
  /** The intent exists; nothing has been asked of a provider yet. */
  CREATED = 'CREATED',
  /** Handed to a provider, waiting on the payer. */
  PENDING = 'PENDING',
  /** The payer's bank has held the money but it has not been taken. */
  AUTHORIZED = 'AUTHORIZED',
  /** Taken. This is the only state that may settle a bill. */
  CAPTURED = 'CAPTURED',
  FAILED = 'FAILED',
  CANCELLED = 'CANCELLED',
  REFUNDED = 'REFUNDED',
  PARTIALLY_REFUNDED = 'PARTIALLY_REFUNDED',
}

/** Payment states from which nothing further can happen. */
export const TERMINAL_PAYMENT_STATUSES: PaymentStatus[] = [
  PaymentStatus.FAILED,
  PaymentStatus.CANCELLED,
  PaymentStatus.REFUNDED,
];

/**
 * Who moves the money.
 *
 * PLATEO_INTERNAL covers what the till already does - cash, a UPI transfer the
 * restaurant watched arrive, a card machine that is not ours. There is no
 * provider to call and nothing to verify, but the payment still deserves a
 * record, so the same domain holds it.
 */
export enum PaymentProviderName {
  PLATEO_INTERNAL = 'PLATEO_INTERNAL',
  RAZORPAY = 'RAZORPAY',
  CASHFREE_FUTURE = 'CASHFREE_FUTURE',
}

/** Whether a provider can actually be used right now. */
export enum PaymentProviderStatus {
  /** Usable. */
  READY = 'READY',
  /** Implemented, but its credentials are absent. */
  NOT_CONFIGURED = 'NOT_CONFIGURED',
  /** A placeholder for something not written yet. */
  UNAVAILABLE = 'UNAVAILABLE',
}

/** What a webhook delivery did. */
export enum WebhookEventStatus {
  PROCESSED = 'PROCESSED',
  /** Recognised as one we have already handled; deliberately a success. */
  DUPLICATE = 'DUPLICATE',
  IGNORED = 'IGNORED',
  FAILED = 'FAILED',
}

/** What reconciliation found that a person has to decide about. */
export enum ReconciliationIssue {
  PAYMENT_CAPTURED_BILL_OPEN = 'PAYMENT_CAPTURED_BILL_OPEN',
  BILL_SETTLED_PAYMENT_MISSING = 'BILL_SETTLED_PAYMENT_MISSING',
  AMOUNT_MISMATCH = 'AMOUNT_MISMATCH',
  DUPLICATE_PROVIDER_PAYMENT = 'DUPLICATE_PROVIDER_PAYMENT',
  UNKNOWN_PROVIDER_PAYMENT = 'UNKNOWN_PROVIDER_PAYMENT',
  PAYMENT_STATE_MISMATCH = 'PAYMENT_STATE_MISMATCH',
  WEBHOOK_AFTER_UNEXPECTED_STATE = 'WEBHOOK_AFTER_UNEXPECTED_STATE',
  REFUND_MISMATCH = 'REFUND_MISMATCH',
  STALE_PENDING_PAYMENT = 'STALE_PENDING_PAYMENT',
}


/**
 * Units an ingredient is counted in.
 *
 * A deliberately short list, and conversion is only allowed inside a family -
 * kilograms to grams, litres to millilitres. There is no gram-to-millilitre rule
 * because there is no correct one: a litre of oil and a litre of honey weigh
 * different amounts, and a system that guessed would quietly misreport stock.
 */
export enum IngredientUnit {
  KG = 'KG',
  GRAM = 'GRAM',
  LITRE = 'LITRE',
  ML = 'ML',
  PIECE = 'PIECE',
  PACK = 'PACK',
  BOX = 'BOX',
  BOTTLE = 'BOTTLE',
}

/** Loose grouping, for finding things on a long list. Never required. */
export enum IngredientCategory {
  VEGETABLES = 'VEGETABLES',
  FRUITS = 'FRUITS',
  DAIRY = 'DAIRY',
  MEAT = 'MEAT',
  BAKERY = 'BAKERY',
  BEVERAGES = 'BEVERAGES',
  SPICES = 'SPICES',
  OIL = 'OIL',
  PACKAGING = 'PACKAGING',
  OTHER = 'OTHER',
}

/**
 * Why a quantity changed.
 *
 * Movements are append-only: the current quantity is the operational number, and
 * these rows are how anyone answers "why is it that number". Correcting a
 * mistake means adding a movement, never editing or deleting one.
 */
export enum InventoryMovementType {
  OPENING_STOCK = 'OPENING_STOCK',
  STOCK_IN = 'STOCK_IN',
  /** Worked out from the recipe when a bill is settled. Never entered by hand. */
  SALE_CONSUMPTION = 'SALE_CONSUMPTION',
  ADJUSTMENT_INCREASE = 'ADJUSTMENT_INCREASE',
  ADJUSTMENT_DECREASE = 'ADJUSTMENT_DECREASE',
  WASTAGE = 'WASTAGE',
  REVERSAL = 'REVERSAL',
}

/** Movements that add to stock. Everything else takes away. */
export const INCOMING_MOVEMENTS: InventoryMovementType[] = [
  InventoryMovementType.OPENING_STOCK,
  InventoryMovementType.STOCK_IN,
  InventoryMovementType.ADJUSTMENT_INCREASE,
  InventoryMovementType.REVERSAL,
];

/**
 * What a movement points back at.
 *
 * Left NULL for anything a person typed in by hand, which is what keeps the
 * idempotency index out of their way: two separate deliveries of the same
 * ingredient on the same day are two real movements, and a unique index over
 * NULL references does not treat them as one.
 */
export enum InventoryReferenceType {
  ORDER = 'ORDER',
  STOCK_COUNT = 'STOCK_COUNT',
}

/** What a person has to say when they change a number by hand. */
export enum StockAdjustmentReason {
  WASTAGE = 'WASTAGE',
  SPOILAGE = 'SPOILAGE',
  BREAKAGE = 'BREAKAGE',
  COUNT_CORRECTION = 'COUNT_CORRECTION',
  STAFF_USE = 'STAFF_USE',
  OTHER = 'OTHER',
}

/**
 * How much notice Plateo takes of stock.
 *
 * DISABLED by default, and that default matters: a restaurant that has never
 * opened the inventory screen must see no change in how its till behaves.
 */
export enum InventoryMode {
  /** No stock is tracked and nothing is calculated. */
  DISABLED = 'DISABLED',
  /** Stock is tracked and reported. A sale is never blocked. */
  TRACKING = 'TRACKING',
  /** Stock can affect what may be sold, according to the restaurant's settings. */
  STRICT = 'STRICT',
}

/** The moment a sale is treated as having used its ingredients. */
export enum InventoryConsumptionMode {
  BILL_SETTLED = 'BILL_SETTLED',
  ORDER_CONFIRMED = 'ORDER_CONFIRMED',
  ORDER_SERVED = 'ORDER_SERVED',
}

/**
 * A table booked through the Plateo app.
 *
 * Walk-ins are not bookings - they are a waiter seating somebody, which the floor
 * already handles. Everything here arrived from a guest's phone before they did.
 */
export enum TableBookingStatus {
  /** The guest asked. Nobody has answered yet. */
  REQUESTED = 'REQUESTED',
  CONFIRMED = 'CONFIRMED',
  /** The guest arrived and was sat down. */
  SEATED = 'SEATED',
  COMPLETED = 'COMPLETED',
  /** The restaurant could not take it. */
  DECLINED = 'DECLINED',
  /** The guest called it off. */
  CANCELLED = 'CANCELLED',
  /** Confirmed, and nobody came. Kept apart from a cancellation on purpose: one
   *  is a guest being considerate and the other is a table held for nothing. */
  NO_SHOW = 'NO_SHOW',
}

/** Bookings that are no longer going anywhere. */
export const CLOSED_BOOKING_STATUSES: TableBookingStatus[] = [
  TableBookingStatus.COMPLETED,
  TableBookingStatus.DECLINED,
  TableBookingStatus.CANCELLED,
  TableBookingStatus.NO_SHOW,
];

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
