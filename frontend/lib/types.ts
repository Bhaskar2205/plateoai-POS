/** Mirrors the backend DTOs. Kept in one place so pages stay type-safe. */

export type UserRole =
  | 'SUPER_ADMIN'
  | 'RESTAURANT_OWNER'
  | 'RESTAURANT_MANAGER'
  | 'WAITER'
  | 'KITCHEN_STAFF';

export type RestaurantStatus = 'ACTIVE' | 'INACTIVE';

export type DietType = 'VEG' | 'NON_VEG' | 'EGG' | 'VEGAN';

export interface AuthUser {
  id: number;
  name: string;
  email: string;
  role: UserRole;
}

export interface Restaurant {
  id: number;
  name: string;
  /** Follows the name; the canonical public menu URL. */
  slug: string;
  /** Permanent: set at registration, never changes. Use it for any link that is shared or printed. */
  publicSlug: string;
  description: string | null;
  address: string | null;
  phone: string | null;
  logoUrl: string | null;
  status: RestaurantStatus;
  /** Percentage added to every bill. 0 means the bill is exactly the menu prices. */
  taxRate: number;
  /** Printed on bills, e.g. a GSTIN. */
  taxNumber: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AuthResponse {
  accessToken: string;
  tokenType: string;
  expiresIn: number;
  user: AuthUser;
  restaurant: Restaurant;
  restaurants: Restaurant[];
}

export interface MeResponse {
  user: AuthUser;
  restaurant: Restaurant;
  restaurants: Restaurant[];
}

export interface RestaurantMember {
  id: number;
  name: string;
  email: string;
  role: UserRole;
  joinedAt: string;
}

export interface RestaurantStats {
  restaurantId: number;
  restaurantName: string;
  status: RestaurantStatus;
  totalCategories: number;
  activeCategories: number;
  totalDishes: number;
  availableDishes: number;
  totalIngredients: number;
  totalUsers: number;
}

export interface Category {
  id: number;
  restaurantId: number;
  name: string;
  sortOrder: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Dish {
  id: number;
  restaurantId: number;
  categoryId: number | null;
  name: string;
  description: string | null;
  price: number;
  imageUrl: string | null;
  proteinGrams: number | null;
  calories: number | null;
  carbsGrams: number | null;
  fatGrams: number | null;
  preparationTimeMinutes: number | null;
  dietType: DietType | null;
  taxGroup: TaxGroup;
  isAvailable: boolean;
  createdAt: string;
  updatedAt: string;
  category?: Category | null;
}

export type IngredientUnit = 'KG' | 'GRAM' | 'LITRE' | 'ML' | 'PIECE' | 'PACK' | 'BOX' | 'BOTTLE';

export type IngredientCategory =
  | 'VEGETABLES'
  | 'FRUITS'
  | 'DAIRY'
  | 'MEAT'
  | 'SEAFOOD'
  | 'GRAINS'
  | 'SPICES'
  | 'BEVERAGES'
  | 'PACKAGING'
  | 'OTHER';

export type InventoryMovementType =
  | 'OPENING_STOCK'
  | 'STOCK_IN'
  | 'SALE_CONSUMPTION'
  | 'ADJUSTMENT_INCREASE'
  | 'ADJUSTMENT_DECREASE'
  | 'WASTAGE'
  | 'REVERSAL';

export type StockAdjustmentReason =
  | 'WASTAGE'
  | 'SPOILAGE'
  | 'BREAKAGE'
  | 'COUNT_CORRECTION'
  | 'STAFF_USE'
  | 'OTHER';

export type InventoryMode = 'DISABLED' | 'TRACKING' | 'STRICT';

export interface Ingredient {
  id: number;
  restaurantId: number;
  name: string;
  description: string | null;
  allergenInfo: string | null;
  category: IngredientCategory;
  unit: IngredientUnit;
  /** Carried as a number: the API rounds it to the three decimals the column holds. */
  currentQuantity: number;
  minimumQuantity: number;
  reorderQuantity: number;
  /** Whole paise, as a string, because the API sends BIGINT as a string. */
  costPerUnitPaise: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface InventoryMovement {
  id: number;
  ingredientId: number;
  ingredient?: Ingredient;
  movementType: InventoryMovementType;
  quantity: number;
  unit: IngredientUnit;
  quantityBefore: number;
  quantityAfter: number;
  valuePaise: string;
  referenceType: 'ORDER' | 'STOCK_COUNT' | null;
  referenceId: number | null;
  reason: StockAdjustmentReason | null;
  note: string | null;
  businessDate: string;
  createdBy: number | null;
  createdAt: string;
}

export interface InventorySettings {
  mode: InventoryMode;
  allowNegativeStock: boolean;
}

export interface StockCountLine {
  ingredientId: number;
  ingredientName: string;
  unit: IngredientUnit;
  expected: number;
  counted: number;
  variance: number;
  variancePaise: number;
}

export interface InventoryReportLine {
  ingredientId: number;
  ingredientName: string;
  unit: IngredientUnit;
  category: IngredientCategory;
  consumed: number;
  consumedPaise: number;
  wasted: number;
  wastedPaise: number;
  adjusted: number;
  adjustedPaise: number;
  received: number;
  receivedPaise: number;
  onHand: number;
  onHandPaise: number;
}

export interface InventoryReport {
  from: string;
  to: string;
  lines: InventoryReportLine[];
  totals: {
    consumedPaise: number;
    wastedPaise: number;
    adjustedPaise: number;
    receivedPaise: number;
    onHandPaise: number;
  };
  lowStock: Array<{
    ingredientId: number;
    ingredientName: string;
    unit: IngredientUnit;
    onHand: number;
    minimum: number;
    reorderQuantity: number;
  }>;
}

export interface DishIngredient {
  id: number;
  dishId: number;
  ingredientId: number;
  ingredientName: string;
  allergenInfo: string | null;
  quantity: number;
  unit: string;
  /** Null when the line cannot be costed - see `costNote` for why. */
  costPaise: number | null;
  costNote: string | null;
}

/**
 * A restaurant table. The QR token is never a field of its own: it only exists
 * inside `menuUrl`, the link that is encoded into the printed QR code.
 */
export interface RestaurantTable {
  id: number;
  name: string;
  isActive: boolean;
  /** `/menu/<slug>?table=<identifier>` */
  menuPath: string;
  /** Absolute URL on the public Plateo origin - what the QR code encodes. */
  menuUrl: string;
  createdAt: string;
  updatedAt: string;
}

// --- Orders, kitchen tickets and bills ---------------------------------------

export type OrderStatus = 'OPEN' | 'SETTLED' | 'CANCELLED';
export type OrderSource = 'STAFF' | 'DINER_QR';
export type OrderItemStatus =
  | 'PENDING'
  | 'QUEUED'
  | 'PREPARING'
  | 'READY'
  | 'SERVED'
  | 'CANCELLED';
export type KotStatus = 'NEW' | 'PREPARING' | 'READY' | 'DONE' | 'CANCELLED';
/** What the kitchen is doing for a table, summarised for the floor view. */
export type KitchenState = 'NONE' | 'COOKING' | 'READY';

export type DiscountType = 'PERCENT' | 'AMOUNT';
export type PaymentMethod = 'CASH' | 'UPI' | 'CARD' | 'OTHER';

export interface OrderItem {
  id: number;
  dishId: number | null;
  /** The name as it was when ordered - not the dish's current name. */
  name: string;
  unitPrice: number;
  quantity: number;
  lineTotal: number;
  note: string | null;
  status: OrderItemStatus;
  kotTicketId: number | null;
  /** A diner asked for this and staff have not confirmed it yet. */
  awaitingApproval: boolean;
  /** False once the kitchen has it: cancel instead of changing it. */
  editable: boolean;
  cancelledReason: string | null;
  /** Comped: cooked and served, not charged for. Still came out of stock. */
  isNonChargeable: boolean;
  ncReason: string | null;
  createdAt: string;
}

export interface KotTicketSummary {
  id: number;
  ticketNumber: number;
  status: KotStatus;
  itemCount: number;
  printedAt: string | null;
  createdAt: string;
}

export interface Order {
  id: number;
  orderNumber: number;
  businessDate: string;
  tableId: number | null;
  tableName: string | null;
  status: OrderStatus;
  source: OrderSource;
  items: OrderItem[];
  kotTickets: KotTicketSummary[];
  pendingApprovalCount: number;
  /** Approved lines not yet on a ticket - what the next KOT would contain. */
  unsentItemCount: number;
  subtotal: number;
  discountType: DiscountType | null;
  discountValue: number | null;
  discountAmount: number;
  discountReason: string | null;
  /** The whole bill was given away. Settles, but is never revenue. */
  isNonChargeable: boolean;
  ncReason: string | null;
  /** Who ate - not who authorised it. */
  ncFor: string | null;
  taxRate: number;
  taxAmount: number;
  /** The restaurant's own service charge. Not a tax, and taxed itself. */
  serviceChargeAmount: number;
  /** The breakdown a tax invoice prints: CGST and SGST on separate lines. */
  charges: OrderCharge[];
  total: number;
  /** Income tax a corporate payer withholds. Never charged to the guest. */
  tdsRate: number | null;
  tdsAmount: number;
  /** total - TDS: what the restaurant actually collects. */
  amountPayable: number;
  paymentMethod: PaymentMethod | null;
  settledAt: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

/** What a charge on a bill is. CGST and SGST are separate lines by law. */
export type TaxKind =
  | 'CGST'
  | 'SGST'
  | 'IGST'
  | 'UTGST'
  | 'CESS'
  | 'VAT'
  | 'SERVICE_CHARGE'
  | 'OTHER';

/** Which lines a charge applies to. Alcohol sits outside GST. */
export type TaxGroup = 'STANDARD' | 'ALCOHOL' | 'PACKAGED' | 'EXEMPT';

/** One line of a bill's tax breakdown, as it was charged. */
export interface OrderCharge {
  name: string;
  kind: TaxKind;
  rate: number;
  taxableAmount: number;
  amount: number;
}

/** One charge in the restaurant's tax profile. */
export interface TaxComponent {
  id: number;
  name: string;
  kind: TaxKind;
  rate: number;
  appliesTo: TaxGroup;
  isActive: boolean;
  sortOrder: number;
}

export interface SuggestedTaxProfile {
  id: string;
  label: string;
  description: string;
  totalRate: number;
}

export interface TaxProfile {
  components: TaxComponent[];
  suggested: SuggestedTaxProfile[];
  standardRate: number;
  taxNumber: string | null;
}

export type PaymentStatus =
  | 'CREATED'
  | 'PENDING'
  | 'AUTHORIZED'
  | 'CAPTURED'
  | 'FAILED'
  | 'CANCELLED'
  | 'REFUNDED'
  | 'PARTIALLY_REFUNDED';

export type PaymentProviderName = 'PLATEO_INTERNAL' | 'RAZORPAY' | 'CASHFREE_FUTURE';

export type PaymentProviderStatus = 'READY' | 'NOT_CONFIGURED' | 'UNAVAILABLE';

/** One attempt to collect what a bill is owed. */
export interface PaymentIntent {
  id: number;
  orderId: number | null;
  orderNumber: number | null;
  amountPaise: string;
  /** The same amount, already formatted for reading. */
  amount: string;
  currency: string;
  status: PaymentStatus;
  provider: PaymentProviderName;
  providerPaymentId: string | null;
  failureReason: string | null;
  createdAt: string;
  capturedAt: string | null;
}

export interface PaymentSettings {
  providers: Array<{
    provider: PaymentProviderName;
    status: PaymentProviderStatus;
    label: string;
    usable: boolean;
  }>;
  onlinePaymentsAvailable: boolean;
  intentExpiryMinutes: number;
}

export interface ReconciliationException {
  id: number;
  issue: string;
  detail: string;
  paymentIntentId: number | null;
  orderId: number | null;
  createdAt: string;
  resolvedAt: string | null;
}

/** What an audit record describes. Only actions the system can perform. */
export type AuditAction =
  | 'BILL_DISCOUNTED'
  | 'BILL_DISCOUNT_REMOVED'
  | 'BILL_SETTLED'
  | 'BILL_VOIDED'
  | 'BILL_TDS_RECORDED'
  | 'TAX_CONFIGURATION_CHANGED'
  | 'SERVICE_CHARGE_CHANGED'
  | 'DISH_PRICE_CHANGED'
  | 'DISH_TAX_GROUP_CHANGED'
  | 'DISH_AVAILABILITY_CHANGED'
  | 'TABLE_CREATED'
  | 'TABLE_DEACTIVATED'
  | 'TABLE_REACTIVATED'
  | 'QR_REGENERATED'
  | 'KITCHEN_CODE_REGENERATED';

export type AuditEntity = 'ORDER' | 'TAX_COMPONENT' | 'DISH' | 'TABLE' | 'RESTAURANT';

export interface AuditLogRow {
  id: number;
  createdAt: string;
  userId: number | null;
  userName: string | null;
  action: AuditAction;
  entityType: AuditEntity;
  entityId: number | null;
  oldValue: Record<string, unknown> | null;
  newValue: Record<string, unknown> | null;
  reason: string | null;
  requestId: string | null;
  ipAddress: string | null;
}

export interface AuditLogPage {
  rows: AuditLogRow[];
  total: number;
  page: number;
  pageSize: number;
}

/** The day-end statement a till is closed on. */
export interface DayEndTaxLine {
  name: string;
  kind: TaxKind;
  rate: number;
  taxableAmount: number;
  amount: number;
  bills: number;
}

export interface DayEndReport {
  businessDate: string;
  isClosed: boolean;
  openBills: number;
  openValue: number;
  bills: number;
  itemsSold: number;
  gross: number;
  discounts: number;
  netSales: number;
  serviceCharge: number;
  taxes: DayEndTaxLine[];
  taxTotal: number;
  total: number;
  tdsWithheld: number;
  collected: number;
  payments: Array<{ method: PaymentMethod; bills: number; total: number }>;
  averageBill: number;
  voidedBills: number;
  voidedValue: number;
  /** Bills given away. Never counted as sales. */
  ncBills: number;
  /** What those giveaways were worth. */
  ncValue: number;
  firstSettledAt: string | null;
  lastSettledAt: string | null;
}

/** A table on the floor view, with whatever is happening at it right now. */
export interface TableOrderSummary {
  tableId: number;
  tableName: string;
  isActive: boolean;
  orderId: number | null;
  orderNumber: number | null;
  total: number;
  pendingApprovalCount: number;
  unsentItemCount: number;
  itemCount: number;
  /** Derived from the table's live kitchen tickets. */
  kitchenState: KitchenState;
  openedAt: string | null;
}

export interface KitchenTicketItem {
  id: number;
  name: string;
  quantity: number;
  /** What the table asked for. Shown to the cook in full. */
  note: string | null;
  status: OrderItemStatus;
  /** What goes into the dish, as recorded on the menu. Empty when it has no recipe. */
  ingredients: string[];
  /** Allergen notes from those ingredients, deduplicated. */
  allergens: string[];
}

/** Carries no money: a kitchen screen is often on a wall. */
export interface KitchenTicket {
  id: number;
  ticketNumber: number;
  orderId: number;
  orderNumber: number;
  tableName: string | null;
  status: KotStatus;
  waitingMinutes: number;
  items: KitchenTicketItem[];
  printedAt: string | null;
  createdAt: string;
}

export interface KotPrint {
  restaurantName: string;
  ticketNumber: number;
  orderNumber: number;
  tableName: string | null;
  businessDate: string;
  items: KitchenTicketItem[];
  createdAt: string;
}

export interface BillLine {
  name: string;
  unitPrice: number;
  quantity: number;
  lineTotal: number;
}

export interface Bill {
  orderId: number;
  orderNumber: number;
  businessDate: string;
  restaurantName: string;
  restaurantAddress: string | null;
  restaurantPhone: string | null;
  taxNumber: string | null;
  tableName: string | null;
  /**
   * The restaurant's payment code, to print on this bill, or null.
   *
   * Null unless the owner uploaded one and switched printing on - and null once
   * the bill is settled, so a paid receipt never asks for payment twice. The API
   * makes that decision; the printer just renders what it is given.
   */
  paymentQrUrl: string | null;
  paymentQrLabel: string | null;
  lines: BillLine[];
  subtotal: number;
  discountAmount: number;
  discountReason: string | null;
  taxRate: number;
  taxAmount: number;
  /** The restaurant's own service charge. Not a tax, and taxed itself. */
  serviceChargeAmount: number;
  /** The breakdown a tax invoice prints: CGST and SGST on separate lines. */
  charges: OrderCharge[];
  total: number;
  /** Income tax a corporate payer withholds. Never charged to the guest. */
  tdsRate: number | null;
  tdsAmount: number;
  /** total - TDS: what the restaurant actually collects. */
  amountPayable: number;
  status: OrderStatus;
  paymentMethod: PaymentMethod | null;
  settledAt: string | null;
}

/**
 * What this restaurant prints on its bills, beyond the figures.
 *
 * Only the payment QR is per-restaurant. Everything else about the two printed
 * documents is fixed by the paper and by what a kitchen ticket and a tax invoice
 * have to say - see `lib/print-config.ts`.
 */
export interface PrintSettings {
  paymentQrUrl: string | null;
  paymentQrLabel: string | null;
  printPaymentQr: boolean;
}

/** What a diner gets back from the public menu after ordering. */
export interface DinerOrderReceipt {
  tableName: string;
  items: Array<{ name: string; quantity: number; note: string | null }>;
  awaitingApprovalCount: number;
  message: string;
}

// --- Reports -----------------------------------------------------------------

export interface ReportPeriod {
  from: string;
  to: string;
  days: number;
}

export interface PaymentBreakdown {
  method: PaymentMethod;
  bills: number;
  total: number;
}

export interface HourlySales {
  hour: number;
  bills: number;
  total: number;
}

export interface DailySales {
  businessDate: string;
  bills: number;
  net: number;
}

export interface SalesSummary {
  period: ReportPeriod;
  bills: number;
  itemsSold: number;
  gross: number;
  discounts: number;
  tax: number;
  net: number;
  averageBill: number;
  openBills: number;
  voidedBills: number;
  voidedValue: number;
  /** Bills given away. Never counted as sales. */
  ncBills: number;
  /** What those giveaways were worth. */
  ncValue: number;
  payments: PaymentBreakdown[];
  daily: DailySales[];
  /** Empty for ranges longer than 31 days, where an hourly average says nothing. */
  hourly: HourlySales[];
}

export interface ItemSales {
  dishId: number | null;
  name: string;
  section: string | null;
  quantity: number;
  total: number;
  share: number;
}

export interface SectionSales {
  categoryId: number | null;
  name: string;
  dishes: number;
  quantity: number;
  total: number;
  share: number;
}

export interface OrderRow {
  id: number;
  orderNumber: number;
  businessDate: string;
  tableName: string | null;
  status: OrderStatus;
  source: OrderSource;
  items: number;
  gross: number;
  discount: number;
  tax: number;
  total: number;
  paymentMethod: PaymentMethod | null;
  settledBy: string | null;
  openedAt: string;
  settledAt: string | null;
}

export interface StaffSales {
  userId: number | null;
  name: string;
  role: string;
  billsOpened: number;
  billsSettled: number;
  settledValue: number;
  discountsGiven: number;
}

export interface TableSales {
  tableId: number | null;
  name: string;
  bills: number;
  total: number;
  averageBill: number;
  averageMinutes: number;
}

export interface DiscountRow {
  orderId: number;
  orderNumber: number;
  businessDate: string;
  tableName: string | null;
  amount: number;
  reason: string | null;
  billTotal: number;
  settledBy: string | null;
}

export interface VoidedRow {
  orderId: number;
  orderNumber: number;
  businessDate: string;
  tableName: string | null;
  value: number;
  reason: string | null;
}

export interface CancelledItemRow {
  name: string;
  times: number;
  quantity: number;
  value: number;
  reasons: string[];
}

export interface AdjustmentsReport {
  period: ReportPeriod;
  discountTotal: number;
  discounts: DiscountRow[];
  voidedTotal: number;
  voided: VoidedRow[];
  cancelledTotal: number;
  cancelledItems: CancelledItemRow[];
}

// --- Table bookings ----------------------------------------------------------

export type TableBookingStatus =
  | 'REQUESTED'
  | 'CONFIRMED'
  | 'SEATED'
  | 'COMPLETED'
  | 'DECLINED'
  | 'CANCELLED'
  | 'NO_SHOW';

/** A discount as it is set on a booking: all three parts, or none at all. */
export interface BookingDiscount {
  type: DiscountType;
  value: number;
  reason: string;
}

export interface TableBooking {
  id: number;
  restaurantId: number;
  referenceNumber: number;
  businessDate: string;
  guestName: string;
  guestPhone: string;
  guestEmail: string | null;
  partySize: number;
  bookedFor: string;
  status: TableBookingStatus;
  tableId: number | null;
  table: { id: number; name: string } | null;
  /**
   * A discount the bill should carry, if this party is seated. An intention, not
   * money - there is no amount until there is a subtotal to take it off.
   */
  discountType: DiscountType | null;
  discountValue: number | null;
  discountReason: string | null;
  guestNote: string | null;
  restaurantNote: string | null;
  respondedAt: string | null;
  seatedAt: string | null;
  handledByUserId: number | null;
  createdAt: string;
  updatedAt: string;
}

// --- The floor, and the captain app ------------------------------------------

/** One person who works at the restaurant, as the POS lists them. */
export interface StaffMember {
  id: number;
  name: string;
  /** Null for accounts that sign in with an email rather than a code. */
  code: string | null;
  role: UserRole;
  isActive: boolean;
  joinedAt: string;
}

/**
 * One dish on a captain's order board.
 *
 * Deliberately small: a waiter knows the menu, so the app sends names and prices
 * rather than descriptions, photos and nutrition over mobile data mid-service.
 */
export interface OrderBoardDish {
  id: number;
  name: string;
  price: number;
  categoryName: string | null;
  dietType: DietType | null;
}

// --- Month statement, and erasing history ------------------------------------

/** One business day in a range statement. Same figures as the day-end report. */
export interface DayEndDay {
  businessDate: string;
  isClosed: boolean;
  openBills: number;
  bills: number;
  itemsSold: number;
  gross: number;
  discounts: number;
  netSales: number;
  serviceCharge: number;
  taxTotal: number;
  total: number;
  tdsWithheld: number;
  collected: number;
  voidedBills: number;
  voidedValue: number;
  ncBills: number;
  ncValue: number;
  taxes: DayEndTaxLine[];
  payments: Array<{ method: PaymentMethod; bills: number; total: number }>;
}

export interface DayEndTotals {
  tradingDays: number;
  bills: number;
  itemsSold: number;
  gross: number;
  discounts: number;
  netSales: number;
  serviceCharge: number;
  taxTotal: number;
  total: number;
  tdsWithheld: number;
  collected: number;
  voidedBills: number;
  voidedValue: number;
  ncBills: number;
  ncValue: number;
  averageBill: number;
  daysNotClosed: number;
}

/**
 * The day-end statement across a range - what a month-end is filed from.
 *
 * `taxes` is folded over the whole range rather than summed from the days, so a
 * rate that changed mid-month stays two lines instead of becoming an average
 * nobody can file.
 */
export interface DayEndSeries {
  from: string;
  to: string;
  days: DayEndDay[];
  totals: DayEndTotals;
  taxes: DayEndTaxLine[];
  payments: Array<{ method: PaymentMethod; bills: number; total: number }>;
}

/** What erasing a range of trading history would destroy. */
export interface TradingDataSummary {
  from: string;
  to: string;
  settledBills: number;
  voidedBills: number;
  ncBills: number;
  /** Any at all blocks the deletion: an unfinished service is not history yet. */
  openBills: number;
  items: number;
  kotTickets: number;
  charges: number;
  collected: number;
  firstDate: string | null;
  lastDate: string | null;
  canDelete: boolean;
  blockedReason: string | null;
}

export interface TradingDataDeleted {
  from: string;
  to: string;
  deletedBills: number;
  deletedItems: number;
  deletedKotTickets: number;
  deletedCharges: number;
  detachedPaymentRecords: number;
}

/** Result of putting a batch of dishes into one tax group. */
export interface BulkTaxGroupResult {
  updated: number;
  unchanged: number;
  notFound: number;
}
