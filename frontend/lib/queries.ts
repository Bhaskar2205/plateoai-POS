'use client';

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationOptions,
} from '@tanstack/react-query';
import { apiFetch } from './api';
import type {
  Category,
  Dish,
  DishIngredient,
  Ingredient,
  Restaurant,
  RestaurantMember,
  RestaurantStats,
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
