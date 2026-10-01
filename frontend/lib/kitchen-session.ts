'use client';

import { API_BASE_URL, ApiError } from './api';
import type { KitchenTicket, KotStatus } from './types';

/**
 * The kitchen screen's own session.
 *
 * Deliberately separate from `lib/api.ts`: that client carries the admin's
 * account token, and the two must never be mixed up. A kitchen runs on a shared
 * tablet that an owner might also use to check a bill, so the two sessions live
 * under different storage keys and neither logs the other out.
 *
 * The token is kept in `localStorage` because a kitchen screen is signed in once
 * and then left alone for weeks - being asked for the code at every shift change
 * would guarantee the code ends up written on the wall.
 */

const TOKEN_KEY = 'plateo.kitchenToken';
const NAME_KEY = 'plateo.kitchenRestaurant';

export interface KitchenSession {
  token: string;
  restaurantName: string;
}

export const kitchenSession = {
  read(): KitchenSession | null {
    if (typeof window === 'undefined') return null;

    try {
      const token = window.localStorage.getItem(TOKEN_KEY);
      const restaurantName = window.localStorage.getItem(NAME_KEY);

      return token ? { token, restaurantName: restaurantName ?? 'Kitchen' } : null;
    } catch {
      return null;
    }
  },
  write(session: KitchenSession): void {
    try {
      window.localStorage.setItem(TOKEN_KEY, session.token);
      window.localStorage.setItem(NAME_KEY, session.restaurantName);
    } catch {
      // Private browsing with storage disabled: the screen works until reloaded.
    }
  },
  clear(): void {
    try {
      window.localStorage.removeItem(TOKEN_KEY);
      window.localStorage.removeItem(NAME_KEY);
    } catch {
      // Nothing to clean up.
    }
  },
};

/** Exchanges a kitchen code for a session. */
export async function signInWithCode(code: string): Promise<KitchenSession> {
  const response = await fetch(`${API_BASE_URL}/auth/kitchen`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
  });

  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;

  if (!response.ok) {
    throw new ApiError(
      response.status,
      payload?.message ??
        (response.status === 429
          ? 'Too many attempts. Wait a minute and try again.'
          : 'That code was not recognised.'),
    );
  }

  return { token: payload.accessToken, restaurantName: payload.restaurantName };
}

/**
 * A request from the kitchen screen.
 *
 * A 401 or 403 means the code was regenerated, the restaurant was suspended, or
 * the token expired: the screen signs itself out and asks for the code again,
 * which is the only recovery a cook could perform anyway.
 */
async function kitchenFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const session = kitchenSession.read();

  if (!session) throw new ApiError(401, 'This screen is signed out.');

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      Authorization: `Bearer ${session.token}`,
      ...init.headers,
    },
  });

  if (response.status === 401 || response.status === 403) {
    kitchenSession.clear();
    throw new ApiError(response.status, 'This screen was signed out. Enter the kitchen code again.');
  }

  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;

  if (!response.ok) {
    throw new ApiError(response.status, payload?.message ?? 'Something went wrong.');
  }

  return payload as T;
}

export const fetchKitchenTickets = () =>
  kitchenFetch<KitchenTicket[]>('/restaurants/me/kitchen/tickets');

export const setTicketStatus = (id: number, status: KotStatus) =>
  kitchenFetch<KitchenTicket>(`/restaurants/me/kitchen/tickets/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  });

export const markTicketPrinted = (id: number) =>
  kitchenFetch<KitchenTicket>(`/restaurants/me/kitchen/tickets/${id}/printed`, { method: 'POST' });
