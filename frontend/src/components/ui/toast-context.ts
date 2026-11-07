import { createContext, useContext } from 'react';

export type ToastTone = 'info' | 'success' | 'warning' | 'danger';

export type ToastOptions = {
  tone?: ToastTone;
  title?: string;
  /** Milliseconds before auto-dismiss; 0 keeps the toast until dismissed. */
  duration?: number;
};

export type ToastApi = {
  show: (message: string, options?: ToastOptions) => number;
  dismiss: (id: number) => void;
};

export const ToastContext = createContext<ToastApi | null>(null);

/** Access the toast API. Requires a <ToastProvider> above (mounted in the app shell in Phase 4). */
export function useToast(): ToastApi {
  const api = useContext(ToastContext);
  if (!api) throw new Error('useToast must be used inside <ToastProvider>');
  return api;
}
