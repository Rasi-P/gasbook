import { useEffect, useId, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { cx } from './cx';
import { IconButton } from './IconButton';

export type ModalProps = {
  open: boolean;
  /** Wired to the header close button only. Overlay-click and Escape stay off unless explicitly enabled. */
  onClose?: () => void;
  title?: ReactNode;
  description?: ReactNode;
  size?: 'sm' | 'md' | 'lg';
  footer?: ReactNode;
  closeLabel?: string;
  closeOnEscape?: boolean;
  closeOnOverlay?: boolean;
  className?: string;
  children?: ReactNode;
};

/** Centred dialog rendered in a portal. Locks body scroll while open. */
export function Modal({
  open,
  onClose,
  title,
  description,
  size = 'md',
  footer,
  closeLabel = 'Close',
  closeOnEscape = false,
  closeOnOverlay = false,
  className,
  children,
}: ModalProps) {
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  useEffect(() => {
    if (!open || !closeOnEscape || !onClose) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, closeOnEscape, onClose]);

  if (!open) return null;

  return createPortal(
    <div
      className="ui-modal-overlay"
      onMouseDown={closeOnOverlay && onClose ? (event) => { if (event.target === event.currentTarget) onClose(); } : undefined}
    >
      <div
        className={cx('ui-modal', size !== 'md' && `ui-modal--${size}`, className)}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title != null ? titleId : undefined}
        aria-describedby={description != null ? descriptionId : undefined}
      >
        {(title != null || onClose) && (
          <div className="ui-modal__header">
            <div className="ui-modal__heading">
              {title != null && <h2 id={titleId} className="ui-modal__title">{title}</h2>}
              {description != null && <p id={descriptionId} className="ui-modal__description">{description}</p>}
            </div>
            {onClose && (
              <IconButton type="button" label={closeLabel} size="lg" onClick={onClose}>
                <X size={20} />
              </IconButton>
            )}
          </div>
        )}
        <div className="ui-modal__body">{children}</div>
        {footer != null && <div className="ui-modal__footer">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}
