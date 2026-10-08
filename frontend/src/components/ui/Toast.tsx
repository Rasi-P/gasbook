import { useCallback, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react';
import { cx } from './cx';
import { IconButton } from './IconButton';
import { ToastContext, type ToastApi, type ToastOptions, type ToastTone } from './toast-context';

type ToastRecord = { id: number; message: string; tone: ToastTone; title?: string };

const ICONS = { info: Info, success: CheckCircle2, warning: AlertTriangle, danger: XCircle };

/** Top-right (bottom on phones) transient notifications. Intended only for lightweight confirmations such as "copied". */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastRecord[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setToasts((previous) => previous.filter((toast) => toast.id !== id));
  }, []);

  const show = useCallback((message: string, options: ToastOptions = {}) => {
    const id = nextId.current;
    nextId.current += 1;
    setToasts((previous) => [...previous, { id, message, tone: options.tone ?? 'info', title: options.title }]);
    const duration = options.duration ?? 3500;
    if (duration > 0) window.setTimeout(() => dismiss(id), duration);
    return id;
  }, [dismiss]);

  const api = useMemo<ToastApi>(() => ({ show, dismiss }), [show, dismiss]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      {toasts.length > 0 &&
        createPortal(
          <div className="ui-toaster" role="region" aria-label="Notifications">
            {toasts.map((toast) => {
              const Icon = ICONS[toast.tone];
              return (
                <div key={toast.id} className={cx('ui-toast', `ui-toast--${toast.tone}`)} role="status">
                  <span className="ui-toast__icon" aria-hidden="true"><Icon size={16} /></span>
                  <div className="ui-toast__content">
                    {toast.title && <span className="ui-toast__title">{toast.title}</span>}
                    <span>{toast.message}</span>
                  </div>
                  <IconButton type="button" label="Dismiss" size="sm" onClick={() => dismiss(toast.id)}>
                    <X size={14} />
                  </IconButton>
                </div>
              );
            })}
          </div>,
          document.body,
        )}
    </ToastContext.Provider>
  );
}
