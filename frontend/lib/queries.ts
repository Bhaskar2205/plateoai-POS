'use client';

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationOptions,
} from '@tanstack/react-query';
import { apiFetch } from './api';
import type {
  AdjustmentsReport,
  AuditAction,
  AuditEntity,
  AuditLogPage,
  Bill,
  Category,
  DayEndReport,
  DiscountType,
  Dish,
  DishIngredient,
  Ingredient,
  BookingDiscount,
  TableBooking,
  IngredientCategory,
  IngredientUnit,
  InventoryMode,
  InventoryMovement,
  InventoryReport,
  InventorySettings,
  StockAdjustmentReason,
  StockCountLine,
  ItemSales,
  KitchenTicket,
  KotPrint,
  KotStatus,
  Order,
  OrderRow,
  PaymentIntent,
  PaymentMethod,
  PaymentSettings,
  ReconciliationException,
  Restaurant,
  RestaurantMember,
  RestaurantStats,
  RestaurantTable,
  SalesSummary,
  SectionSales,
  StaffSales,
  TableOrderSummary,
  TableSales,
  TaxComponent,
  TaxGroup,
  TaxProfile,
} from './types';

/**
 * Query keys are flat and explicit so mutations can invalidate precisely.
 * Everything is implicitly scoped to the signed-in restaurant, because the API
 * derives the tenant from the token - the client never sends a restaurant id.
 */
export const queryKeys = {
  restaurant: ['restaurant'] as const,
  restaurantMembers: ['restaurant', 'members'] as const,
  stats: ['restaurant', 'stats'] as const,
  categories: ['categories'] as const,
  dishes: ['dishes'] as const,
  ingredients: ['ingredients'] as const,
  dishIngredients: (dishId: number) => ['dishes', dishId, 'ingredients'] as const,
  tables: ['tables'] as const,
  floor: ['floor'] as const,
  orders: ['orders'] as const,
  order: (id: number) => ['orders', id] as const,
  /** Every table's open bill, so one mutation can invalidate them all. */
  tableOrders: ['table-order'] as const,
  tableOrder: (tableId: number) => ['table-order', tableId] as const,
  kitchenTickets: ['kitchen', 'tickets'] as const,
  reports: {
    sales: ['reports', 'sales'] as const,
    items: ['reports', 'items'] as const,
    sections: ['reports', 'sections'] as const,
    orders: ['reports', 'orders'] as const,
    staff: ['reports', 'staff'] as const,
    tables: ['reports', 'tables'] as const,
    adjustments: ['reports', 'adjustments'] as const,
    dayEnd: ['reports', 'day-end'] as const,
  },
  taxes: ['taxes'] as const,
  auditLogs: ['audit-logs'] as const,
  payments: ['payments'] as const,
  // One root so a stock change can invalidate the shelf, the ledger and the
  // report in a single call.
  inventory: ['inventory'] as const,
  inventorySettings: ['inventory', 'settings'] as const,
  inventoryStock: ['inventory', 'stock'] as const,
  inventoryMovements: ['inventory', 'movements'] as const,
  inventoryReport: ['inventory', 'report'] as const,
  bookings: ['bookings'] as const,
};

// --- Restaurant --------------------------------------------------------------

export const useRestaurant = () =>
  useQuery({
    queryKey: queryKeys.restaurant,
    queryFn: () => apiFetch<Restaurant>('/restaurants/me'),
  });

/** Owner-only on the API (403 for other roles) - pass `enabled: false` for them. */
export const useRestaurantMembers = ({ enabled = true }: { enabled?: boolean } = {}) =>
  useQuery({
    queryKey: queryKeys.restaurantMembers,
    queryFn: () => apiFetch<RestaurantMember[]>('/restaurants/me/users'),
    enabled,
  });

export const useRestaurantStats = () =>
  useQuery({
    queryKey: queryKeys.stats,
    queryFn: () => apiFetch<RestaurantStats>('/restaurants/me/stats'),
  });

export const useUpdateRestaurant = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body: Partial<Restaurant>) =>
      apiFetch<Restaurant>('/restaurants/me', { method: 'PATCH', body }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.restaurant });
      void queryClient.invalidateQueries({ queryKey: queryKeys.stats });
    },
  });
};

// --- Categories --------------------------------------------------------------

export const useCategories = () =>
  useQuery({
    queryKey: queryKeys.categories,
    queryFn: () => apiFetch<Category[]>('/categories'),
  });

export interface CategoryPayload {
  name: string;
  sortOrder: number;
  isActive: boolean;
}

export const useSaveCategory = (options?: UseMutationOptions<Category, Error, {
  id?: number;
  body: CategoryPayload;
}>) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, body }) =>
      apiFetch<Category>(id ? `/categories/${id}` : '/categories', {
        method: id ? 'PATCH' : 'POST',
        body,
      }),
    ...options,
    onSuccess: (...args) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.categories });
      void queryClient.invalidateQueries({ queryKey: queryKeys.stats });
      // Dishes embed their category, so their cached copies are stale too.
      void queryClient.invalidateQueries({ queryKey: queryKeys.dishes });
      options?.onSuccess?.(...args);
    },
  });
};

export const useDeleteCategory = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: number) => apiFetch<void>(`/categories/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.categories });
      void queryClient.invalidateQueries({ queryKey: queryKeys.dishes });
      void queryClient.invalidateQueries({ queryKey: queryKeys.stats });
    },
  });
};

// --- Dishes ------------------------------------------------------------------

export const useDishes = () =>
  useQuery({
    queryKey: queryKeys.dishes,
    queryFn: () => apiFetch<Dish[]>('/dishes'),
  });

export interface DishPayload {
  name: string;
  price: number;
  isAvailable: boolean;
  /** `null` clears a field on update; every key is sent so blanks really clear. */
  categoryId: number | null;
  description: string | null;
  imageUrl: string | null;
  dietType: string | null;
  /** Which tax components apply. Defaults to ordinary food and drink. */
  taxGroup: TaxGroup;
  proteinGrams: number | null;
  calories: number | null;
  carbsGrams: number | null;
  fatGrams: number | null;
  preparationTimeMinutes: number | null;
  /** Omit to leave the recipe untouched; the server writes it with the dish in one transaction. */
  ingredients?: DishIngredientLine[];
}

export const useSaveDish = (options?: UseMutationOptions<Dish, Error, {
  id?: number;
  body: DishPayload;
}>) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, body }) =>
      apiFetch<Dish>(id ? `/dishes/${id}` : '/dishes', {
        method: id ? 'PATCH' : 'POST',
        body,
      }),
    ...options,
    onSuccess: (...args) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.dishes });
      void queryClient.invalidateQueries({ queryKey: queryKeys.stats });
      options?.onSuccess?.(...args);
    },
  });
};

export const useDeleteDish = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: number) => apiFetch<void>(`/dishes/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.dishes });
      void queryClient.invalidateQueries({ queryKey: queryKeys.stats });
    },
  });
};

/**
 * Availability toggle, updated optimistically.
 *
 * The switch flips the moment it is clicked instead of waiting for the save
 * and the list refetch (browser testing showed it sitting unchanged meanwhile,
 * reading as unresponsive). A failed save restores the cached list, so the
 * switch never shows a state the server did not accept.
 */
export const useToggleDishAvailability = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, isAvailable }: { id: number; isAvailable: boolean }) =>
      apiFetch<Dish>(`/dishes/${id}`, { method: 'PATCH', body: { isAvailable } }),
    onMutate: async ({ id, isAvailable }) => {
      // Stop an in-flight refetch from overwriting the optimistic value.
      await queryClient.cancelQueries({ queryKey: queryKeys.dishes, exact: true });
      const previous = queryClient.getQueryData<Dish[]>(queryKeys.dishes);

      queryClient.setQueryData<Dish[]>(queryKeys.dishes, (current) =>
        current?.map((dish) => (dish.id === id ? { ...dish, isAvailable } : dish)),
      );

      return { previous };
    },
    onError: (_error, _variables, context) => {
      if (context?.previous) {
        queryClient.setQueryData(queryKeys.dishes, context.previous);
      }
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.dishes });
      void queryClient.invalidateQueries({ queryKey: queryKeys.stats });
    },
  });
};

/**
 * Moves several dishes into a section at once.
 *
 * Filing fifteen dishes under "Chinese" one dialog at a time is the kind of chore
 * that stops a menu from ever being organised. The API takes a partial update, so
 * each request carries only the section - prices, photos and recipes are left
 * exactly as they are.
 */
export const useMoveDishesToSection = (
  options?: UseMutationOptions<Dish[], Error, { ids: number[]; categoryId: number | null }>,
) => {
  const queryClient = useQueryClient();

  return useMutation<Dish[], Error, { ids: number[]; categoryId: number | null }>({
    mutationFn: ({ ids, categoryId }) =>
      Promise.all(
        ids.map((id) => apiFetch<Dish>(`/dishes/${id}`, { method: 'PATCH', body: { categoryId } })),
      ),
    ...options,
    onSuccess: (...args) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.dishes });
      void queryClient.invalidateQueries({ queryKey: queryKeys.stats });
      options?.onSuccess?.(...args);
    },
  });
};

// --- Ingredients -------------------------------------------------------------

export const useIngredients = () =>
  useQuery({
    queryKey: queryKeys.ingredients,
    queryFn: () => apiFetch<Ingredient[]>('/ingredients'),
  });

export interface IngredientPayload {
  name: string;
  description?: string;
  allergenInfo?: string;
  category?: IngredientCategory;
  unit?: IngredientUnit;
  /** Whole paise. The form takes rupees and converts at the edge. */
  costPerUnitPaise?: number;
  minimumQuantity?: number;
  reorderQuantity?: number;
  /** Create only. An ingredient opens once, and editing never moves a figure. */
  openingQuantity?: number;
}

export const useSaveIngredient = (options?: UseMutationOptions<Ingredient, Error, {
  id?: number;
  body: IngredientPayload;
}>) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, body }) =>
      apiFetch<Ingredient>(id ? `/ingredients/${id}` : '/ingredients', {
        method: id ? 'PATCH' : 'POST',
        body,
      }),
    ...options,
    onSuccess: (...args) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.ingredients });
      void queryClient.invalidateQueries({ queryKey: queryKeys.stats });
      options?.onSuccess?.(...args);
    },
  });
};

export const useDeleteIngredient = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: number) => apiFetch<void>(`/ingredients/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.ingredients });
      void queryClient.invalidateQueries({ queryKey: queryKeys.stats });
    },
  });
};

// --- Dish <-> ingredient mapping --------------------------------------------

export const useDishIngredients = (dishId: number | null) =>
  useQuery({
    queryKey: queryKeys.dishIngredients(dishId ?? 0),
    queryFn: () => apiFetch<DishIngredient[]>(`/dishes/${dishId}/ingredients`),
    enabled: dishId !== null,
  });

export interface DishIngredientLine {
  ingredientId: number;
  quantity: number;
  unit: string;
}

// --- Tables & QR codes -------------------------------------------------------

/** Owner-only on the API (403 for other roles) - pass `enabled: false` for them. */
export const useTables = ({ enabled = true }: { enabled?: boolean } = {}) =>
  useQuery({
    queryKey: queryKeys.tables,
    queryFn: () => apiFetch<RestaurantTable[]>('/restaurants/me/tables'),
    enabled,
  });

export interface TablePayload {
  name?: string;
  isActive?: boolean;
}

/** Replaces one table in the cached list, so the list needs no refetch to look right. */
const replaceCachedTable = (tables: RestaurantTable[] | undefined, table: RestaurantTable) =>
  tables?.map((current) => (current.id === table.id ? table : current));

export const useSaveTable = (options?: UseMutationOptions<RestaurantTable, Error, {
  id?: number;
  body: TablePayload;
}>) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, body }) =>
      apiFetch<RestaurantTable>(id ? `/restaurants/me/tables/${id}` : '/restaurants/me/tables', {
        method: id ? 'PATCH' : 'POST',
        body,
      }),
    ...options,
    onSuccess: (...args) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.tables });
      options?.onSuccess?.(...args);
    },
  });
};

/** Activate/deactivate, updated optimistically like the dish availability switch. */
export const useToggleTable = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, isActive }: { id: number; isActive: boolean }) =>
      apiFetch<RestaurantTable>(`/restaurants/me/tables/${id}`, { method: 'PATCH', body: { isActive } }),
    onMutate: async ({ id, isActive }) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.tables, exact: true });
      const previous = queryClient.getQueryData<RestaurantTable[]>(queryKeys.tables);

      queryClient.setQueryData<RestaurantTable[]>(queryKeys.tables, (current) =>
        current?.map((table) => (table.id === id ? { ...table, isActive } : table)),
      );

      return { previous };
    },
    onError: (_error, _variables, context) => {
      if (context?.previous) {
        queryClient.setQueryData(queryKeys.tables, context.previous);
      }
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.tables });
    },
  });
};

export const useRegenerateTableQr = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: number) =>
      apiFetch<RestaurantTable>(`/restaurants/me/tables/${id}/regenerate-qr`, { method: 'POST' }),
    onSuccess: (table) => {
      // Swap the new URL in straight away: the old QR code is already dead.
      queryClient.setQueryData<RestaurantTable[]>(queryKeys.tables, (current) => replaceCachedTable(current, table));
      void queryClient.invalidateQueries({ queryKey: queryKeys.tables });
    },
  });
};

export const useDeleteTable = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: number) => apiFetch<void>(`/restaurants/me/tables/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.tables });
    },
  });
};

// --- Orders, kitchen and billing ---------------------------------------------

/**
 * Live views poll rather than hold a socket open: a restaurant's floor and its
 * kitchen both change from other people's devices, and a five-second refetch is
 * simpler to reason about - and to recover from a flaky mobile connection - than
 * a websocket that can die silently mid-service.
 */
const LIVE_REFETCH_MS = 5_000;

export const useFloor = ({ enabled = true }: { enabled?: boolean } = {}) =>
  useQuery({
    queryKey: queryKeys.floor,
    queryFn: () => apiFetch<TableOrderSummary[]>('/restaurants/me/floor'),
    enabled,
    refetchInterval: LIVE_REFETCH_MS,
  });

export const useOrders = ({ enabled = true }: { enabled?: boolean } = {}) =>
  useQuery({
    queryKey: queryKeys.orders,
    queryFn: () => apiFetch<Order[]>('/restaurants/me/orders'),
    enabled,
    refetchInterval: LIVE_REFETCH_MS,
  });

export const useOrder = (id: number | undefined) =>
  useQuery({
    queryKey: queryKeys.order(id ?? 0),
    queryFn: () => apiFetch<Order>(`/restaurants/me/orders/${id}`),
    enabled: id !== undefined,
    refetchInterval: LIVE_REFETCH_MS,
  });

/** The open bill at a table. The API answers with nothing at all for a free table. */
export const useTableOrder = (tableId: number | undefined) =>
  useQuery({
    queryKey: queryKeys.tableOrder(tableId ?? 0),
    queryFn: () => apiFetch<Order | null>(`/restaurants/me/floor/${tableId}/order`),
    enabled: tableId !== undefined,
    refetchInterval: LIVE_REFETCH_MS,
  });

export interface OrderItemInput {
  dishId: number;
  quantity: number;
  note?: string;
}

/**
 * Everything an order mutation touches: the order itself, the floor view, the
 * tables' bills, the kitchen queue and the order list. Invalidating them
 * together keeps every open screen honest - a waiter's phone and the till are
 * often looking at the same table.
 */
const useOrderMutation = <TResult, TVariables>(
  mutationFn: (variables: TVariables) => Promise<TResult>,
  orderIdOf: (variables: TVariables, result: TResult) => number | undefined,
  options?: UseMutationOptions<TResult, Error, TVariables>,
) => {
  const queryClient = useQueryClient();

  return useMutation<TResult, Error, TVariables>({
    mutationFn,
    ...options,
    onSuccess: (...args) => {
      const [result, variables] = args;
      const orderId = orderIdOf(variables, result);

      if (orderId !== undefined) {
        void queryClient.invalidateQueries({ queryKey: queryKeys.order(orderId) });
      }
      void queryClient.invalidateQueries({ queryKey: queryKeys.floor });
      void queryClient.invalidateQueries({ queryKey: queryKeys.orders });
      void queryClient.invalidateQueries({ queryKey: queryKeys.tableOrders });
      void queryClient.invalidateQueries({ queryKey: queryKeys.kitchenTickets });
      options?.onSuccess?.(...args);
    },
  });
};

export const useCreateOrder = (
  options?: UseMutationOptions<
    Order,
    Error,
    { tableId?: number | null; items: OrderItemInput[]; notes?: string }
  >,
) =>
  useOrderMutation(
    (body) => apiFetch<Order>('/restaurants/me/orders', { method: 'POST', body }),
    (_variables, order) => order.id,
    options,
  );

export const useAddOrderItems = (
  options?: UseMutationOptions<Order, Error, { orderId: number; items: OrderItemInput[] }>,
) =>
  useOrderMutation(
    ({ orderId, items }) =>
      apiFetch<Order>(`/restaurants/me/orders/${orderId}/items`, {
        method: 'POST',
        body: { items },
      }),
    ({ orderId }) => orderId,
    options,
  );

export const useUpdateOrderItem = (
  options?: UseMutationOptions<
    Order,
    Error,
    { orderId: number; itemId: number; quantity?: number; note?: string | null }
  >,
) =>
  useOrderMutation(
    ({ orderId, itemId, ...body }) =>
      apiFetch<Order>(`/restaurants/me/orders/${orderId}/items/${itemId}`, {
        method: 'PATCH',
        body,
      }),
    ({ orderId }) => orderId,
    options,
  );

export const useCancelOrderItem = (
  options?: UseMutationOptions<Order, Error, { orderId: number; itemId: number; reason?: string }>,
) =>
  useOrderMutation(
    ({ orderId, itemId, reason }) =>
      apiFetch<Order>(`/restaurants/me/orders/${orderId}/items/${itemId}/cancel`, {
        method: 'POST',
        body: { reason },
      }),
    ({ orderId }) => orderId,
    options,
  );

/**
 * Comping a line: cooked, served, not charged for.
 *
 * Not a discount. A discount is money taken off a sale; this was never a sale,
 * and keeping the two apart is what lets an owner ask what the house gave away.
 */
export const useCompOrderItem = (
  options?: UseMutationOptions<Order, Error, { orderId: number; itemId: number; reason: string }>,
) =>
  useOrderMutation(
    ({ orderId, itemId, reason }) =>
      apiFetch<Order>(`/restaurants/me/orders/${orderId}/items/${itemId}/nc`, {
        method: 'POST',
        body: { reason },
      }),
    ({ orderId }) => orderId,
    options,
  );

export const useUncompOrderItem = (
  options?: UseMutationOptions<Order, Error, { orderId: number; itemId: number }>,
) =>
  useOrderMutation(
    ({ orderId, itemId }) =>
      apiFetch<Order>(`/restaurants/me/orders/${orderId}/items/${itemId}/nc`, { method: 'DELETE' }),
    ({ orderId }) => orderId,
    options,
  );

/** The whole bill given away: the owner eating, a staff meal, a friend of the house. */
export const useMarkOrderNc = (
  options?: UseMutationOptions<Order, Error, { orderId: number; forWhom: string; reason: string }>,
) =>
  useOrderMutation(
    ({ orderId, forWhom, reason }) =>
      apiFetch<Order>(`/restaurants/me/orders/${orderId}/nc`, {
        method: 'POST',
        body: { forWhom, reason },
      }),
    ({ orderId }) => orderId,
    options,
  );

export const useClearOrderNc = (
  options?: UseMutationOptions<Order, Error, { orderId: number }>,
) =>
  useOrderMutation(
    ({ orderId }) => apiFetch<Order>(`/restaurants/me/orders/${orderId}/nc`, { method: 'DELETE' }),
    ({ orderId }) => orderId,
    options,
  );

/**
 * Erasing a no-charge bill. Owners only, and the API refuses anything that is
 * not already marked NC, so a sale cannot be deleted by a mistyped id.
 *
 * Invalidates the list rather than the bill: there is no bill left to refetch.
 */
export const useDeleteNcOrder = (
  options?: UseMutationOptions<void, Error, { orderId: number }>,
) => {
  const queryClient = useQueryClient();

  return useMutation({
    ...options,
    mutationFn: ({ orderId }) =>
      apiFetch<void>(`/restaurants/me/orders/${orderId}`, { method: 'DELETE' }),
    onSuccess: (data, variables, context, mutation) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.orders });
      // Every report figure the deleted bill fed into has to be asked again.
      void queryClient.invalidateQueries({ queryKey: ['reports'] });
      options?.onSuccess?.(data, variables, context, mutation);
    },
  });
};

/** With no ids, approves every diner request waiting at the table. */
export const useApproveOrderItems = (
  options?: UseMutationOptions<Order, Error, { orderId: number; itemIds?: number[] }>,
) =>
  useOrderMutation(
    ({ orderId, itemIds }) =>
      apiFetch<Order>(`/restaurants/me/orders/${orderId}/approve`, {
        method: 'POST',
        body: itemIds ? { itemIds } : {},
      }),
    ({ orderId }) => orderId,
    options,
  );

/** Returns the new ticket, ready to print. */
export const useSendToKitchen = (options?: UseMutationOptions<KotPrint, Error, number>) =>
  useOrderMutation(
    (orderId) => apiFetch<KotPrint>(`/restaurants/me/orders/${orderId}/kot`, { method: 'POST' }),
    (orderId) => orderId,
    options,
  );

export const useApplyDiscount = (
  options?: UseMutationOptions<
    Order,
    Error,
    { orderId: number; type: DiscountType; value: number; reason: string }
  >,
) =>
  useOrderMutation(
    ({ orderId, ...body }) =>
      apiFetch<Order>(`/restaurants/me/orders/${orderId}/discount`, { method: 'POST', body }),
    ({ orderId }) => orderId,
    options,
  );

export const useRemoveDiscount = (options?: UseMutationOptions<Order, Error, number>) =>
  useOrderMutation(
    (orderId) => apiFetch<Order>(`/restaurants/me/orders/${orderId}/discount`, { method: 'DELETE' }),
    (orderId) => orderId,
    options,
  );

/**
 * Records income tax a corporate payer withholds from this bill.
 *
 * Sending null clears it. This never changes the tax owed - it only moves money
 * between what is billed and what is collected.
 */
export const useSetTds = (
  options?: UseMutationOptions<Order, Error, { orderId: number; rate: number | null }>,
) =>
  useOrderMutation(
    ({ orderId, rate }) =>
      apiFetch<Order>(`/restaurants/me/orders/${orderId}/tds`, { method: 'POST', body: { rate } }),
    ({ orderId }) => orderId,
    options,
  );

export const useSettleOrder = (
  options?: UseMutationOptions<
    Order,
    Error,
    { orderId: number; paymentMethod: PaymentMethod; idempotencyKey?: string }
  >,
) =>
  useOrderMutation(
    ({ orderId, paymentMethod, idempotencyKey }) =>
      apiFetch<Order>(`/restaurants/me/orders/${orderId}/settle`, {
        method: 'POST',
        body: { paymentMethod },
        idempotencyKey,
      }),
    ({ orderId }) => orderId,
    options,
  );

export const useCancelOrder = (
  options?: UseMutationOptions<Order, Error, { orderId: number; reason: string }>,
) =>
  useOrderMutation(
    ({ orderId, reason }) =>
      apiFetch<Order>(`/restaurants/me/orders/${orderId}/cancel`, {
        method: 'POST',
        body: { reason },
      }),
    ({ orderId }) => orderId,
    options,
  );

/** Fetched on demand, when someone asks to print - a bill is never polled. */
export const fetchBill = (orderId: number) =>
  apiFetch<Bill>(`/restaurants/me/orders/${orderId}/bill`);

export const fetchKotTicket = (orderId: number, ticketId: number) =>
  apiFetch<KotPrint>(`/restaurants/me/orders/${orderId}/kot/${ticketId}`);

// --- Kitchen panel -----------------------------------------------------------

export const useKitchenTickets = ({ enabled = true }: { enabled?: boolean } = {}) =>
  useQuery({
    queryKey: queryKeys.kitchenTickets,
    queryFn: () => apiFetch<KitchenTicket[]>('/restaurants/me/kitchen/tickets'),
    enabled,
    refetchInterval: LIVE_REFETCH_MS,
  });

export const useUpdateTicketStatus = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, status }: { id: number; status: KotStatus }) =>
      apiFetch<KitchenTicket>(`/restaurants/me/kitchen/tickets/${id}`, {
        method: 'PATCH',
        body: { status },
      }),
    // Optimistic: a cook taps a button and expects the card to move at once,
    // often on a wall screen with a poor connection.
    onMutate: async ({ id, status }) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.kitchenTickets, exact: true });
      const previous = queryClient.getQueryData<KitchenTicket[]>(queryKeys.kitchenTickets);

      queryClient.setQueryData<KitchenTicket[]>(queryKeys.kitchenTickets, (current) =>
        current?.map((ticket) => (ticket.id === id ? { ...ticket, status } : ticket)),
      );

      return { previous };
    },
    onError: (_error, _variables, context) => {
      if (context?.previous) {
        queryClient.setQueryData(queryKeys.kitchenTickets, context.previous);
      }
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.kitchenTickets });
      void queryClient.invalidateQueries({ queryKey: queryKeys.orders });
      void queryClient.invalidateQueries({ queryKey: queryKeys.floor });
    },
  });
};

export const useMarkTicketPrinted = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: number) =>
      apiFetch<KitchenTicket>(`/restaurants/me/kitchen/tickets/${id}/printed`, { method: 'POST' }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.kitchenTickets });
    },
  });
};

// --- Reports -----------------------------------------------------------------

export interface ReportRange {
  from: string;
  to: string;
}

const rangeQuery = (range: ReportRange) =>
  `?from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}`;

/**
 * Reports are read on demand rather than polled: they cover a closed period, and
 * a number that shifts under the person reconciling a till is worse than a number
 * that needs a refresh. The range is part of the key, so switching to "last 7
 * days" and back is instant.
 */
const reportQuery = <T>(key: readonly unknown[], path: string, range: ReportRange, enabled: boolean) => ({
  queryKey: [...key, range.from, range.to] as const,
  queryFn: () => apiFetch<T>(`/restaurants/me/reports/${path}${rangeQuery(range)}`),
  enabled,
  staleTime: 60_000,
});

export const useSalesReport = (range: ReportRange, enabled = true) =>
  useQuery(reportQuery<SalesSummary>(queryKeys.reports.sales, 'sales', range, enabled));

export const useItemsReport = (range: ReportRange, enabled = true) =>
  useQuery(reportQuery<ItemSales[]>(queryKeys.reports.items, 'items', range, enabled));

export const useSectionsReport = (range: ReportRange, enabled = true) =>
  useQuery(reportQuery<SectionSales[]>(queryKeys.reports.sections, 'sections', range, enabled));

export const useOrdersReport = (range: ReportRange, enabled = true) =>
  useQuery(reportQuery<OrderRow[]>(queryKeys.reports.orders, 'orders', range, enabled));

export const useStaffReport = (range: ReportRange, enabled = true) =>
  useQuery(reportQuery<StaffSales[]>(queryKeys.reports.staff, 'staff', range, enabled));

export const useTablesReport = (range: ReportRange, enabled = true) =>
  useQuery(reportQuery<TableSales[]>(queryKeys.reports.tables, 'tables', range, enabled));

export const useAdjustmentsReport = (range: ReportRange, enabled = true) =>
  useQuery(reportQuery<AdjustmentsReport>(queryKeys.reports.adjustments, 'adjustments', range, enabled));

export const useDayEndReport = (range: ReportRange, enabled = true) =>
  useQuery(reportQuery<DayEndReport>(queryKeys.reports.dayEnd, 'day-end', range, enabled));

// --- Taxes -------------------------------------------------------------------

/**
 * The restaurant's tax profile.
 *
 * A change here changes every bill still open, so anything that mutates it
 * invalidates the orders and floor caches too - otherwise a till would keep
 * showing the old total until someone refreshed.
 */
export const useTaxProfile = (enabled = true) =>
  useQuery({
    queryKey: queryKeys.taxes,
    queryFn: () => apiFetch<TaxProfile>('/restaurants/me/taxes'),
    enabled,
  });

const useTaxMutation = <TData, TVariables>(
  mutationFn: (variables: TVariables) => Promise<TData>,
  options?: UseMutationOptions<TData, Error, TVariables>,
) => {
  const queryClient = useQueryClient();

  return useMutation<TData, Error, TVariables>({
    mutationFn,
    ...options,
    onSuccess: (...args) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.taxes });
      void queryClient.invalidateQueries({ queryKey: queryKeys.orders });
      void queryClient.invalidateQueries({ queryKey: queryKeys.tableOrders });
      void queryClient.invalidateQueries({ queryKey: queryKeys.floor });
      options?.onSuccess?.(...args);
    },
  });
};

export const useCreateTaxComponent = (
  options?: UseMutationOptions<TaxComponent, Error, Partial<TaxComponent>>,
) =>
  useTaxMutation(
    (body) => apiFetch<TaxComponent>('/restaurants/me/taxes', { method: 'POST', body }),
    options,
  );

export const useUpdateTaxComponent = (
  options?: UseMutationOptions<TaxComponent, Error, { id: number } & Partial<TaxComponent>>,
) =>
  useTaxMutation(
    ({ id, ...body }) =>
      apiFetch<TaxComponent>(`/restaurants/me/taxes/${id}`, { method: 'PATCH', body }),
    options,
  );

export const useDeleteTaxComponent = (options?: UseMutationOptions<void, Error, number>) =>
  useTaxMutation(
    (id) => apiFetch<void>(`/restaurants/me/taxes/${id}`, { method: 'DELETE' }),
    options,
  );

export const useApplyTaxProfile = (options?: UseMutationOptions<TaxProfile, Error, string>) =>
  useTaxMutation(
    (profileId) =>
      apiFetch<TaxProfile>('/restaurants/me/taxes/apply-profile', {
        method: 'POST',
        body: { profileId },
      }),
    options,
  );

// --- Audit log ---------------------------------------------------------------

export interface AuditLogQuery {
  from?: string;
  to?: string;
  action?: AuditAction;
  entityType?: AuditEntity;
  page?: number;
  pageSize?: number;
}

/**
 * Who changed what.
 *
 * Owner-only on the server, so this is simply not fetched for anyone else - the
 * screen explains the restriction rather than showing an empty table or a 403.
 */
export const useAuditLogs = (query: AuditLogQuery, enabled = true) => {
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== '') params.set(key, String(value));
  }

  const search = params.toString();

  return useQuery({
    queryKey: [...queryKeys.auditLogs, search] as const,
    queryFn: () => apiFetch<AuditLogPage>(`/restaurants/me/audit-logs${search ? `?${search}` : ''}`),
    enabled,
    staleTime: 15_000,
  });
};

// --- Payments ----------------------------------------------------------------

/**
 * Payments taken and attempted.
 *
 * Billing roles only on the server, so this is not fetched for anyone else - the
 * screen explains the restriction rather than showing an empty table.
 */
export const usePayments = (enabled = true) =>
  useQuery({
    queryKey: queryKeys.payments,
    queryFn: () => apiFetch<PaymentIntent[]>('/restaurants/me/payments'),
    enabled,
    staleTime: 15_000,
  });

export const usePaymentSettings = (enabled = true) =>
  useQuery({
    queryKey: [...queryKeys.payments, 'settings'] as const,
    queryFn: () => apiFetch<PaymentSettings>('/restaurants/me/payments/settings'),
    enabled,
  });

export const usePaymentExceptions = (enabled = true) =>
  useQuery({
    queryKey: [...queryKeys.payments, 'exceptions'] as const,
    queryFn: () => apiFetch<ReconciliationException[]>('/restaurants/me/payments/exceptions'),
    enabled,
    staleTime: 15_000,
  });

/** Looks for discrepancies now. Records what it finds; repairs nothing. */
export const useReconcilePayments = (
  options?: UseMutationOptions<{ checked: number; found: Array<{ issue: string; detail: string }> }, Error, void>,
) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () =>
      apiFetch<{ checked: number; found: Array<{ issue: string; detail: string }> }>(
        '/restaurants/me/payments/reconcile',
        { method: 'POST' },
      ),
    ...options,
    onSuccess: (...args) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.payments });
      options?.onSuccess?.(...args);
    },
  });
};

export const useResolvePaymentException = (
  options?: UseMutationOptions<{ resolved: true }, Error, { id: number; note: string }>,
) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, note }) =>
      apiFetch<{ resolved: true }>(`/restaurants/me/payments/exceptions/${id}/resolve`, {
        method: 'POST',
        body: { note },
      }),
    ...options,
    onSuccess: (...args) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.payments });
      options?.onSuccess?.(...args);
    },
  });
};

// --- Inventory ---------------------------------------------------------------

/**
 * Stock.
 *
 * Every mutation invalidates both the stock list and the movement history,
 * because the two are two views of the same change and showing one updated while
 * the other still says the old thing is worse than showing neither.
 */
export const useInventorySettings = (enabled = true) =>
  useQuery({
    queryKey: queryKeys.inventorySettings,
    queryFn: () => apiFetch<InventorySettings>('/restaurants/me/inventory/settings'),
    enabled,
  });

export const useSaveInventorySettings = (
  options?: UseMutationOptions<InventorySettings, Error, Partial<InventorySettings & {
    inventoryMode: InventoryMode;
  }>>,
) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body) =>
      apiFetch<InventorySettings>('/restaurants/me/inventory/settings', {
        method: 'PATCH',
        body,
      }),
    ...options,
    onSuccess: (...args) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.inventory });
      options?.onSuccess?.(...args);
    },
  });
};

export const useStock = (includeInactive = false) =>
  useQuery({
    queryKey: [...queryKeys.inventoryStock, includeInactive] as const,
    queryFn: () =>
      apiFetch<Ingredient[]>(
        `/restaurants/me/inventory/stock${includeInactive ? '?includeInactive=true' : ''}`,
      ),
    staleTime: 15_000,
  });

export const useStockMovements = (ingredientId?: number, limit = 100) =>
  useQuery({
    queryKey: [...queryKeys.inventoryMovements, ingredientId ?? 'all', limit] as const,
    queryFn: () => {
      const params = new URLSearchParams({ limit: String(limit) });
      if (ingredientId) params.set('ingredientId', String(ingredientId));

      return apiFetch<InventoryMovement[]>(`/restaurants/me/inventory/movements?${params}`);
    },
    staleTime: 15_000,
  });

export const useInventoryReport = (
  range?: { from?: string; to?: string },
  /** Off for a restaurant that does not track stock, so nothing is fetched. */
  enabled = true,
) =>
  useQuery({
    queryKey: [...queryKeys.inventoryReport, range?.from ?? '', range?.to ?? ''] as const,
    enabled,
    queryFn: () => {
      const params = new URLSearchParams();
      if (range?.from) params.set('from', range.from);
      if (range?.to) params.set('to', range.to);
      const query = params.toString();

      return apiFetch<InventoryReport>(
        `/restaurants/me/inventory/report${query ? `?${query}` : ''}`,
      );
    },
  });

export interface StockInPayload {
  quantity: number;
  costPerUnitPaise?: number;
  note?: string;
}

export interface StockAdjustmentPayload {
  quantity: number;
  increase: boolean;
  reason: StockAdjustmentReason;
  note?: string;
}

export interface WastagePayload {
  quantity: number;
  reason: StockAdjustmentReason;
  note?: string;
}

/** Shared invalidation: a stock change touches the shelf, the ledger and the report. */
function useStockMutation<TBody>(
  path: (ingredientId: number) => string,
  options?: UseMutationOptions<InventoryMovement, Error, { ingredientId: number; body: TBody }>,
) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ ingredientId, body }) =>
      apiFetch<InventoryMovement>(path(ingredientId), { method: 'POST', body }),
    ...options,
    onSuccess: (...args) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.inventory });
      // The menu shows what a dish costs to make, which moves with the
      // ingredient cost a delivery can change.
      void queryClient.invalidateQueries({ queryKey: queryKeys.ingredients });
      options?.onSuccess?.(...args);
    },
  });
}

export const useAddStock = (
  options?: UseMutationOptions<
    InventoryMovement,
    Error,
    { ingredientId: number; body: StockInPayload }
  >,
) =>
  useStockMutation<StockInPayload>(
    (id) => `/restaurants/me/inventory/ingredients/${id}/stock-in`,
    options,
  );

export const useAdjustStock = (
  options?: UseMutationOptions<
    InventoryMovement,
    Error,
    { ingredientId: number; body: StockAdjustmentPayload }
  >,
) =>
  useStockMutation<StockAdjustmentPayload>(
    (id) => `/restaurants/me/inventory/ingredients/${id}/adjust`,
    options,
  );

export const useRecordWastage = (
  options?: UseMutationOptions<
    InventoryMovement,
    Error,
    { ingredientId: number; body: WastagePayload }
  >,
) =>
  useStockMutation<WastagePayload>(
    (id) => `/restaurants/me/inventory/ingredients/${id}/wastage`,
    options,
  );

export const useRecordStockCount = (
  options?: UseMutationOptions<
    { lines: StockCountLine[]; countedAt: string },
    Error,
    { lines: Array<{ ingredientId: number; countedQuantity: number }>; note?: string }
  >,
) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body) =>
      apiFetch<{ lines: StockCountLine[]; countedAt: string }>(
        '/restaurants/me/inventory/stock-count',
        { method: 'POST', body },
      ),
    ...options,
    onSuccess: (...args) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.inventory });
      options?.onSuccess?.(...args);
    },
  });
};

// --- Table bookings ----------------------------------------------------------

/**
 * Bookings made through the guest app.
 *
 * Polled, like the floor is. A booking arrives while nobody is looking at the
 * screen, and a list that only changes on reload is a list somebody will miss a
 * guest from.
 */
export const useBookings = (enabled = true) =>
  useQuery({
    queryKey: queryKeys.bookings,
    queryFn: () => apiFetch<TableBooking[]>('/restaurants/me/bookings'),
    enabled,
    refetchInterval: LIVE_REFETCH_MS,
  });

export const useStaleBookings = (enabled = true) =>
  useQuery({
    queryKey: [...queryKeys.bookings, 'stale'] as const,
    queryFn: () => apiFetch<TableBooking[]>('/restaurants/me/bookings/stale'),
    enabled,
    staleTime: 60_000,
  });

export interface BookingActionPayload {
  id: number;
  /** `confirm` may name a table; everything else may carry a note. */
  tableId?: number;
  note?: string;
  /**
   * `confirm` only. Left out, the booking keeps whatever discount it arrived
   * with; `null` takes one back. The two cannot be collapsed, or staff could
   * never clear a discount the app promised.
   */
  discount?: BookingDiscount | null;
}

/**
 * Every booking action is the same shape - an id, maybe a note - so one hook
 * covers all of them and the page names the action rather than repeating the
 * plumbing six times.
 */
const useBookingAction = (
  action: 'confirm' | 'decline' | 'seat' | 'complete' | 'no-show' | 'cancel',
  options?: UseMutationOptions<TableBooking, Error, BookingActionPayload>,
) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, ...body }: BookingActionPayload) =>
      apiFetch<TableBooking>(`/restaurants/me/bookings/${id}/${action}`, {
        method: 'POST',
        body,
      }),
    ...options,
    onSuccess: (...args) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.bookings });
      options?.onSuccess?.(...args);
    },
  });
};

export const useConfirmBooking = (
  options?: UseMutationOptions<TableBooking, Error, BookingActionPayload>,
) => useBookingAction('confirm', options);

export const useDeclineBooking = (
  options?: UseMutationOptions<TableBooking, Error, BookingActionPayload>,
) => useBookingAction('decline', options);

export const useSeatBooking = (
  options?: UseMutationOptions<TableBooking, Error, BookingActionPayload>,
) => useBookingAction('seat', options);

export const useCompleteBooking = (
  options?: UseMutationOptions<TableBooking, Error, BookingActionPayload>,
) => useBookingAction('complete', options);

export const useNoShowBooking = (
  options?: UseMutationOptions<TableBooking, Error, BookingActionPayload>,
) => useBookingAction('no-show', options);

export const useCancelBooking = (
  options?: UseMutationOptions<TableBooking, Error, BookingActionPayload>,
) => useBookingAction('cancel', options);
