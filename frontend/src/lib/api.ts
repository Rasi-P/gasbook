import axios from 'axios';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8001/api';

export const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 8000,
});

/** Input limits mirroring the backend columns (User.first/last_name 150, username 150, phone 20, email 254,
 *  Booking.rejection_reason 250, Delivery.rejection_reason 200). */
export const LIMITS = {
  name: 150,
  username: 150,
  phone: 20,
  email: 254,
  adminReason: 250,
  staffReason: 200,
} as const;

export const FORCE_PASSWORD_CHANGE_KEY = 'gasbook_force_password_change';

// Endpoints whose own 401 must never be treated as an expired session.
const AUTH_FREE_PATHS = ['/auth/token/', '/auth/token/refresh/'];
const isAuthFree = (url = '') => AUTH_FREE_PATHS.some((p) => url.includes(p));

export function goLogin() {
  logout();
  if (window.location.pathname !== '/login') window.location.href = '/login';
}

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('gasbook_access');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// Serialize token refresh — prevent race condition when multiple requests fail 401 simultaneously
let refreshPromise: Promise<string> | null = null;

api.interceptors.response.use(
  (res) => res,
  async (error) => {
    const original = error.config ?? {};
    const status = error.response?.status;
    const code = (error.response?.data as { code?: string } | undefined)?.code;

    if (status === 403 && code === 'password_change_required') {
      localStorage.setItem(FORCE_PASSWORD_CHANGE_KEY, '1');
      if (window.location.pathname !== '/change-password') window.location.href = '/change-password';
      return Promise.reject(error);
    }

    if (status === 401 && !original._retry && !isAuthFree(original.url)) {
      original._retry = true;
      const refresh = localStorage.getItem('gasbook_refresh');
      if (!refresh) {
        goLogin();
        return Promise.reject(error);
      }
      try {
        if (!refreshPromise) {
          refreshPromise = axios
            .post(`${API_BASE_URL}/auth/token/refresh/`, { refresh })
            .then((r) => {
              localStorage.setItem('gasbook_access', r.data.access);
              return r.data.access;
            })
            .finally(() => { refreshPromise = null; });
        }
        const newToken = await refreshPromise;
        original.headers.Authorization = `Bearer ${newToken}`;
        return api(original);
      } catch {
        goLogin();
      }
    }
    return Promise.reject(error);
  },
);

export async function login(username: string, password: string) {
  const { data } = await api.post('/auth/token/', { username, password, client: 'management' });
  localStorage.setItem('gasbook_access', data.access);
  localStorage.setItem('gasbook_refresh', data.refresh);
  if (data.role) localStorage.setItem('gasbook_role', data.role);
  return data;
}

export async function changePassword(currentPassword: string, newPassword: string, confirmPassword: string) {
  const { data } = await api.post('/auth/change-password/', {
    current_password: currentPassword,
    new_password: newPassword,
    confirm_new_password: confirmPassword,
  });
  return data;
}

export function getRole() {
  return localStorage.getItem('gasbook_role') || '';
}

export function getRoleHome(role = getRole()) {
  if (role === 'staff') return '/staff-dashboard';
  if (role === 'customer') return '/login';
  return '/admin-dashboard';
}

export function logout() {
  localStorage.removeItem('gasbook_access');
  localStorage.removeItem('gasbook_refresh');
  localStorage.removeItem('gasbook_role');
  localStorage.removeItem('gasbook_redirect');
  localStorage.removeItem(FORCE_PASSWORD_CHANGE_KEY);
}

export function isAuthenticated() {
  return Boolean(localStorage.getItem('gasbook_access'));
}

/* ---------- Error extraction ---------- */

type ErrorLike = {
  code?: string;
  message?: string;
  response?: { status?: number; data?: unknown };
};

function stringify(value: unknown): string {
  if (Array.isArray(value)) return value.map(stringify).filter(Boolean).join(' ');
  if (value && typeof value === 'object') {
    return Object.values(value as Record<string, unknown>).map(stringify).filter(Boolean).join(' ');
  }
  if (value === null || value === undefined) return '';
  return String(value);
}

/** Returns the backend's `code` for an axios error, if any. */
export function getApiErrorCode(err: unknown): string | undefined {
  const data = (err as ErrorLike)?.response?.data;
  if (data && typeof data === 'object') return (data as { code?: string }).code;
  return undefined;
}

/** Returns the HTTP status for an axios error, if any. */
export function getApiStatus(err: unknown): number | undefined {
  return (err as ErrorLike)?.response?.status;
}

/**
 * Human-readable message from an API error. Handles `{detail}`, field-keyed lists
 * (`{phone: ["..."]}`), an `errors` map, `non_field_errors`, and falls back for HTML / unknown bodies.
 */
export function extractApiError(err: unknown, fields: string[] = [], fallback = 'Request failed.'): string {
  const e = err as ErrorLike | undefined;
  const response = e?.response;
  if (!response) {
    if (e?.code === 'ECONNABORTED') return 'Server took too long to respond. Please try again.';
    if (e?.message === 'Network Error' || e?.code === 'ERR_NETWORK') {
      return 'Cannot reach the server. Check your connection and try again.';
    }
    return fallback;
  }
  const data = response.data;
  if (!data) return fallback;
  if (typeof data === 'string') return fallback; // Django debug HTML / non-JSON body
  if (typeof data !== 'object') return fallback;
  const body = data as Record<string, unknown>;

  for (const f of fields) {
    const v = body[f];
    if (v) {
      const text = stringify(v);
      if (text) return text;
    }
  }
  if (body.detail) {
    const text = stringify(body.detail);
    if (text) return text;
  }
  if (body.errors && typeof body.errors === 'object') {
    const errors = body.errors as Record<string, unknown>;
    for (const f of fields) {
      if (errors[f]) {
        const text = stringify(errors[f]);
        if (text) return text;
      }
    }
    const first = stringify(errors);
    if (first) return first;
  }
  if (body.non_field_errors) {
    const text = stringify(body.non_field_errors);
    if (text) return text;
  }
  // Any remaining field-keyed list (DRF validation error without `detail`).
  for (const [key, v] of Object.entries(body)) {
    if (key === 'code' || key === 'field') continue;
    if (Array.isArray(v) && v.length) {
      const text = stringify(v);
      if (text) return text;
    }
  }
  return fallback;
}

/** Per-field error map from a DRF-style error body (`{field: [...]}` or `{errors: {field: [...]}}`). */
export function extractFieldErrors(err: unknown, fields: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  const data = (err as ErrorLike)?.response?.data;
  if (!data || typeof data !== 'object') return out;
  const body = data as Record<string, unknown>;
  const errors = (body.errors && typeof body.errors === 'object') ? body.errors as Record<string, unknown> : {};
  for (const f of fields) {
    const v = body[f] ?? errors[f];
    if (v) {
      const text = stringify(v);
      if (text) out[f] = text;
    }
  }
  if (typeof body.field === 'string' && !out[body.field] && typeof body.detail === 'string') {
    out[body.field] = body.detail;
  }
  return out;
}

/* ---------- Lists / pagination ---------- */

export type Paginated<T> = { count: number; next: string | null; previous: string | null; results: T[] };

export function unwrapList<T>(data: Paginated<T> | T[] | null | undefined): T[] {
  if (Array.isArray(data)) return data;
  return data?.results ?? [];
}

const ALL_PAGES_SIZE = 200;

/**
 * Loads every page of a DRF-paginated endpoint by iterating `page` (never following the absolute `next` URL).
 * Plain array responses are returned as-is. A 404 on page > 1 is treated as the end of the list.
 */
export async function fetchAllPages<T>(url: string, params: Record<string, unknown> = {}, maxPages = 50): Promise<T[]> {
  const out: T[] = [];
  for (let page = 1; page <= maxPages; page++) {
    let data: Paginated<T> | T[];
    try {
      const res = await api.get(url, { params: { ...params, page, page_size: ALL_PAGES_SIZE } });
      data = res.data;
    } catch (err) {
      if (page > 1 && getApiStatus(err) === 404) break;
      throw err;
    }
    if (Array.isArray(data)) return page === 1 ? data : [...out, ...data];
    out.push(...(data?.results ?? []));
    if (!data?.next) break;
  }
  return out;
}
