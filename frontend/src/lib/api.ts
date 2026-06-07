import axios from 'axios';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:8001/api';

export const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 8000,
});

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
    const original = error.config;
    if (error.response?.status === 401 && !original._retry) {
      original._retry = true;
      const refresh = localStorage.getItem('gasbook_refresh');
      if (!refresh) {
        logout();
        window.location.href = '/login';
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
        logout();
        window.location.href = '/login';
      }
    }
    return Promise.reject(error);
  },
);

export async function login(username: string, password: string) {
  const { data } = await api.post('/auth/token/', { username, password });
  localStorage.setItem('gasbook_access', data.access);
  localStorage.setItem('gasbook_refresh', data.refresh);
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

export async function getCurrentUser() {
  const { data } = await api.get('/auth/me/');
  localStorage.setItem('gasbook_role', data.role);
  localStorage.setItem('gasbook_redirect', data.redirect);
  return data;
}

export function getRole() {
  return localStorage.getItem('gasbook_role') || '';
}

export function getRoleHome(role = getRole()) {
  if (role === 'staff') return '/staff-dashboard';
  if (role === 'customer') return '/customer-dashboard';
  return '/admin-dashboard';
}

export function logout() {
  localStorage.removeItem('gasbook_access');
  localStorage.removeItem('gasbook_refresh');
  localStorage.removeItem('gasbook_role');
  localStorage.removeItem('gasbook_redirect');
}

export function isAuthenticated() {
  return Boolean(localStorage.getItem('gasbook_access'));
}
