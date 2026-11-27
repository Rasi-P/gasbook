import type { ComponentPropsWithRef, ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, Info, XCircle } from 'lucide-react';
import { cx } from './cx';

export type AlertTone = 'info' | 'success' | 'warning' | 'danger';

const ICONS = { info: Info, success: CheckCircle2, warning: AlertTriangle, danger: XCircle };

export type AlertProps = Omit<ComponentPropsWithRef<'div'>, 'title'> & {
  tone?: AlertTone;
  title?: ReactNode;
  /** Custom icon, or `false` to hide it. */
  icon?: ReactNode | false;
  /** Right-hand slot for Retry / Dismiss / secondary actions. */
  actions?: ReactNode;
  compact?: boolean;
};

/** Inline message. `role` defaults to "alert" for danger and "status" otherwise; pass it explicitly to override. */
export function Alert({ tone = 'info', title, icon, actions, compact = false, className, children, role, ...rest }: AlertProps) {
  const Icon = ICONS[tone];
  return (
    <div
      {...rest}
      role={role ?? (tone === 'danger' ? 'alert' : 'status')}
      className={cx('ui-alert', `ui-alert--${tone}`, compact && 'ui-alert--compact', className)}
    >
      {icon !== false && <span className="ui-alert__icon" aria-hidden="true">{icon ?? <Icon size={16} />}</span>}
      <div className="ui-alert__content">
        {title != null && <span className="ui-alert__title">{title}</span>}
        {children}
      </div>
      {actions != null && <div className="ui-alert__actions">{actions}</div>}
    </div>
  );
}
