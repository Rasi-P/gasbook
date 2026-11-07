import type { ComponentPropsWithRef, ReactNode } from 'react';
import { cx } from './cx';

export type BadgeTone = 'neutral' | 'primary' | 'success' | 'warning' | 'danger' | 'info';

export type BadgeProps = ComponentPropsWithRef<'span'> & {
  tone?: BadgeTone;
  /** `soft` = tinted background (status); `outline` = bordered (roles, types). */
  variant?: 'soft' | 'outline';
  size?: 'sm' | 'md';
  icon?: ReactNode;
  /** Small radius instead of a pill, for tag-like labels. */
  square?: boolean;
};

export function Badge({ tone = 'neutral', variant = 'soft', size = 'md', icon, square = false, className, children, ...rest }: BadgeProps) {
  return (
    <span
      {...rest}
      className={cx(
        'ui-badge',
        `ui-badge--${tone}`,
        variant === 'outline' && 'ui-badge--outline',
        size === 'sm' && 'ui-badge--sm',
        square && 'ui-badge--square',
        className,
      )}
    >
      {icon && <span className="ui-badge__icon" aria-hidden="true">{icon}</span>}
      {children}
    </span>
  );
}
