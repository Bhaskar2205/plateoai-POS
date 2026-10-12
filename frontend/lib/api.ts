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

/** The API port to assume when the host is derived rather than configured. */
const DEV_API_PORT = process.env.NEXT_PUBLIC_API_PORT ?? '4000';

/**
 * Where the browser sends API calls.
 *
 * An explicit NEXT_PUBLIC_API_URL always wins, which is how production is
 * configured. Without one, the API is assumed to be on the same host the page
 * came from: open the app at localhost and it calls localhost, open it from a
 * phone at the machine's LAN address and it calls that address.
 *
 * That last part is the point. A hard-coded development IP goes stale every time
 * the machine joins a different network, and the only symptom is that signing in
 * fails with a fetch error that says nothing about why.
 */
function resolveApiBaseUrl(): string {
  const configured = process.env.NEXT_PUBLIC_API_URL?.trim();
  if (configured) return configured.replace(/\/$/, '');

  // On the server there is no page host to borrow, and the API is local anyway.
  if (typeof window === 'undefined') return `http://localhost:${DEV_API_PORT}`;

  return `${window.location.protocol}//${window.location.hostname}:${DEV_API_PORT}`;
}

export const API_BASE_URL = resolveApiBaseUrl();

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
  /** Skip the Authorization header (sign-in routes). */
  anonymous?: boolean;
  /**
   * Use this token instead of the restaurant one.
   *
   * The platform panel keeps its own, under its own storage key: an administrator
   * and a restaurant owner may both be signed in on the same browser, and one
   * overwriting the other would sign somebody out without saying so.
   */
  token?: string | null;
  signal?: AbortSignal;
  /**
   * Marks this request as a repeat of the same operation if it is sent again.
   *
   * Only for things that must not happen twice - settling a bill, opening one,
   * replacing a QR code. The API answers a repeat with the original response
   * rather than doing the work again.
   */
  idempotencyKey?: string;
}

/**
 * A key for one attempt at an irreversible operation.
 *
 * `crypto.randomUUID` needs a secure context, which a till on a plain-HTTP LAN
 * is not, so there is a fallback.
 */
export function newIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  return `k-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

export async function apiFetch<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const {
    method = 'GET',
    body,
    anonymous = false,
    signal,
    idempotencyKey,
    token: override,
  } = options;
  const token = anonymous ? null : (override ?? tokenStorage.get());

  const response = await fetch(`${API_BASE_URL}${path}`, {
    method,
    signal,
    headers: {
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
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

/**
 * The Plateo administrator's session.
 *
 * Its own storage key, deliberately. The two panels are different jobs on
 * different subdomains, and sharing one key would mean signing into one silently
 * signs you out of the other.
 */
const PLATFORM_TOKEN_KEY = 'plateo.platformAccessToken';

export const platformTokenStorage = {
  get(): string | null {
    if (typeof window === 'undefined') return null;
    try {
      return window.localStorage.getItem(PLATFORM_TOKEN_KEY);
    } catch {
      return null;
    }
  },
  set(token: string): void {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(PLATFORM_TOKEN_KEY, token);
    } catch {
      // A browser with storage blocked still works for one session.
    }
  },
  clear(): void {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.removeItem(PLATFORM_TOKEN_KEY);
    } catch {
      // Nothing to clean up.
    }
  },
};

/** `apiFetch` with the platform token rather than the restaurant one. */
export function platformFetch<T>(
  path: string,
  options: Omit<RequestOptions, 'token'> = {},
): Promise<T> {
  return apiFetch<T>(path, { ...options, token: platformTokenStorage.get() });
}
