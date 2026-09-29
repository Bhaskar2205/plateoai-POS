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
  Bill,
  Category,
  DiscountType,
  Dish,
  DishIngredient,
  Ingredient,
  KitchenTicket,
  KotPrint,
  KotStatus,
  ItemSales,
  Order,
  OrderRow,
  PaymentMethod,
  Restaurant,
  RestaurantMember,
  RestaurantStats,
  RestaurantTable,
  SalesSummary,
  SectionSales,
  StaffSales,
  TableOrderSummary,
  TableSales,
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
  },
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

export const useSettleOrder = (
  options?: UseMutationOptions<Order, Error, { orderId: number; paymentMethod: PaymentMethod }>,
) =>
  useOrderMutation(
    ({ orderId, paymentMethod }) =>
      apiFetch<Order>(`/restaurants/me/orders/${orderId}/settle`, {
        method: 'POST',
        body: { paymentMethod },
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
