import type { ReactNode } from 'react';
import { Inbox } from 'lucide-react';
import { cx } from './cx';

export type EmptyStateProps = {
  icon?: ReactNode;
  title: ReactNode;
  hint?: ReactNode;
  action?: ReactNode;
  compact?: boolean;
  className?: string;
};

export function EmptyState({ icon, title, hint, action, compact = false, className }: EmptyStateProps) {
  return (
    <div className={cx('ui-empty', compact && 'ui-empty--compact', className)}>
      <span className="ui-empty__icon" aria-hidden="true">{icon ?? <Inbox size={24} />}</span>
      <span className="ui-empty__title">{title}</span>
      {hint != null && <span className="ui-empty__hint">{hint}</span>}
      {action != null && <div className="ui-empty__action">{action}</div>}
    </div>
  );
}
