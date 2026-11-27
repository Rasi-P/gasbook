import type { ReactNode } from 'react';
import { cx } from './cx';

export type StatCardProps = {
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
  /** 18px lucide icon; rendered in a primary-light square. */
  icon?: ReactNode;
  /** A small Badge shown next to the hint when the number needs attention. */
  attention?: ReactNode;
  /** Optional block under the value (e.g. a "Receive Payment" button). */
  footer?: ReactNode;
  className?: string;
};

/** Neutral KPI card: overline label, tabular value, hint. Colour is reserved for the `attention` badge. */
export function StatCard({ label, value, hint, icon, attention, footer, className }: StatCardProps) {
  return (
    <div className={cx('ui-card ui-card--pad-md ui-stat', className)}>
      {icon && <span className="ui-stat__icon" aria-hidden="true">{icon}</span>}
      <span className="ui-stat__label">{label}</span>
      <strong className="ui-stat__value">{value}</strong>
      {(hint != null || attention != null) && (
        <span className="ui-stat__hint">
          {hint}
          {attention}
        </span>
      )}
      {footer != null && <div className="ui-stat__footer">{footer}</div>}
    </div>
  );
}
