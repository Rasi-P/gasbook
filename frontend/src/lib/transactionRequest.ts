import axios from 'axios';
import { api, newClientRef } from './api';

// Persist uncertain requests across closing a dialog or reloading the page. No names,
// phone numbers, or credentials are stored with these transaction payloads.
function storageKey(scope: string) {
  const token = localStorage.getItem('gasbook_access');
  if (!token) throw new Error('Sign in before recording a payment.');
  const claims = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
  if (!claims.user_id) throw new Error('Cannot identify the signed-in collector.');
  return `gasbook-pending:${claims.user_id}:${scope}`;
}
export function pendingTransaction(scope: string): Record<string, unknown> | null {
  const raw = localStorage.getItem(storageKey(scope));
  return raw ? JSON.parse(raw) : null;
}
export async function transactionRequest<T>(scope: string, endpoint: string, payload?: Record<string, unknown>): Promise<T> {
  const key = storageKey(scope);
  const saved = localStorage.getItem(key);
  const body = saved ? JSON.parse(saved) : { ...payload, client_ref: newClientRef() };
  if (!saved && !payload) throw new Error('No pending transaction to retry.');
  // If storage fails, do not send an unprotected request.
  localStorage.setItem(key, JSON.stringify(body));
  try {
    const { data } = await api.post<T>(endpoint, body);
    localStorage.removeItem(key);
    return data;
  } catch (error) {
    if (axios.isAxiosError(error)) {
      const status = error.response?.status;
      const code = error.response?.data?.code;
      // Validation/permission failures have no writes. Network and server failures
      // remain pending: their commit outcome is unknown.
      if (status && status >= 400 && status < 500 && ![408, 429].includes(status) && code !== 'client_ref_reused') localStorage.removeItem(key);
    }
    throw error;
  }
}
