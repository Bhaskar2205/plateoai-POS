/**
 * Thin fetch wrapper around the Plateo API.
 *
 * The access token lives in `localStorage` under a single key so logout is one
 * `removeItem` away. That choice is documented in the README: it is readable by
 * any script running on this origin, which is acceptable for an internal admin
 * tool and is the reason the backend keeps token lifetimes short. Moving to an
 * httpOnly cookie is on the Week 2 list.
 */

const TOKEN_KEY = 'plateo.accessToken';

export const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL?.replace(/\/$/, '') ?? 'http://localhost:4000';

/** The error envelope every failing Plateo endpoint returns. */
export interface ApiErrorBody {
  statusCode: number;
  error: string;
  message: string;
  details?: string[];
  path: string;
  timestamp: string;
}

export class ApiError extends Error {
  readonly status: number;
  readonly details?: string[];

  constructor(status: number, message: string, details?: string[]) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.details = details;
  }

  /** Field errors joined for display under a form. */
  get detailText(): string | undefined {
    return this.details?.join('\n');
  }
}

export const tokenStorage = {
  get(): string | null {
    if (typeof window === 'undefined') return null;
    try {
      return window.localStorage.getItem(TOKEN_KEY);
    } catch {
      return null;
    }
  },
  set(token: string): void {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(TOKEN_KEY, token);
    } catch {
      // Private browsing with storage disabled: the session simply won't persist.
    }
  },
  clear(): void {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.removeItem(TOKEN_KEY);
    } catch {
      // Nothing to clean up.
    }
  },
};

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  /** Skip the Authorization header (register / login). */
  anonymous?: boolean;
  signal?: AbortSignal;
}

export async function apiFetch<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, anonymous = false, signal } = options;
  const token = anonymous ? null : tokenStorage.get();

  const response = await fetch(`${API_BASE_URL}${path}`, {
    method,
    signal,
    headers: {
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (response.status === 204) {
    return undefined as T;
  }

  const text = await response.text();
  const payload = text ? (JSON.parse(text) as unknown) : null;

  if (!response.ok) {
    const error = payload as ApiErrorBody | null;

    // An expired or revoked token should not leave the UI in a half-signed-in
    // state - drop it so the next render bounces to the login page.
    if (response.status === 401 && !anonymous) {
      tokenStorage.clear();
    }

    throw new ApiError(
      response.status,
      error?.message ?? `Request failed with status ${response.status}`,
      error?.details,
    );
  }

  return payload as T;
}
