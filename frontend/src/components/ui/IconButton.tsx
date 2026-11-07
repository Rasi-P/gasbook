import type { ComponentPropsWithRef, ReactNode } from 'react';
import { cx } from './cx';

export type IconButtonProps = Omit<ComponentPropsWithRef<'button'>, 'children'> & {
  /** Accessible name; also used as the tooltip unless `title` is given. */
  label: string;
  size?: 'sm' | 'md' | 'lg';
  variant?: 'ghost' | 'outline';
  /** `danger` and `primary` only colour the hover state, so rows of actions stay neutral at rest. */
  tone?: 'neutral' | 'primary' | 'danger';
  /** Highlighted state, e.g. the row whose inline panel is open. */
  active?: boolean;
  children: ReactNode;
};

/** Square icon-only button. `type` is passed through untouched. */
export function IconButton({
  label,
  size = 'md',
  variant = 'ghost',
  tone = 'neutral',
  active = false,
  className,
  children,
  ...rest
}: IconButtonProps) {
  return (
    <button
      {...rest}
      aria-label={rest['aria-label'] ?? label}
      title={rest.title ?? label}
      className={cx(
        'ui-iconbtn',
        `ui-iconbtn--${variant}`,
        size !== 'md' && `ui-iconbtn--${size}`,
        tone !== 'neutral' && `ui-iconbtn--${tone}`,
        active && 'ui-iconbtn--active',
        className,
      )}
    >
      {children}
    </button>
  );
}
