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
  isAvailable: boolean;
  createdAt: string;
  updatedAt: string;
  category?: Category | null;
}

export interface Ingredient {
  id: number;
  restaurantId: number;
  name: string;
  description: string | null;
  allergenInfo: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DishIngredient {
  id: number;
  dishId: number;
  ingredientId: number;
  ingredientName: string;
  allergenInfo: string | null;
  quantity: number;
  unit: string;
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
  taxRate: number;
  taxAmount: number;
  total: number;
  paymentMethod: PaymentMethod | null;
  settledAt: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
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
  lines: BillLine[];
  subtotal: number;
  discountAmount: number;
  discountReason: string | null;
  taxRate: number;
  taxAmount: number;
  total: number;
  status: OrderStatus;
  paymentMethod: PaymentMethod | null;
  settledAt: string | null;
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

