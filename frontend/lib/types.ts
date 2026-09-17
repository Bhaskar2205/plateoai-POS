/** Mirrors the backend DTOs. Kept in one place so pages stay type-safe. */

export type UserRole =
  | 'SUPER_ADMIN'
  | 'RESTAURANT_OWNER'
  | 'RESTAURANT_MANAGER'
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
  slug: string;
  description: string | null;
  address: string | null;
  phone: string | null;
  logoUrl: string | null;
  status: RestaurantStatus;
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
