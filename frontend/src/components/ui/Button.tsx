import type { ComponentPropsWithRef, ReactNode } from 'react';
import { cx } from './cx';
import { buttonClassName, type ButtonSize, type ButtonVariant } from './buttonClass';

export type ButtonProps = ComponentPropsWithRef<'button'> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Full width (use for primary submits on phones). */
  block?: boolean;
  /** Shows a spinner in the icon slot. Does not change `disabled`; pass that explicitly as today. */
  loading?: boolean;
  icon?: ReactNode;
  iconRight?: ReactNode;
};

/**
 * Button. `type` is passed through untouched (the browser default inside a <form> is "submit"),
 * so existing submit/button semantics are preserved exactly.
 */
export function Button({
  variant = 'primary',
  size = 'md',
  block = false,
  loading = false,
  icon,
  iconRight,
  className,
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      aria-busy={loading ? true : rest['aria-busy']}
      className={cx(buttonClassName({ variant, size, block }), loading && 'ui-btn--loading', className)}
    >
      {loading ? (
        <span className="ui-btn__icon" aria-hidden="true"><span className="ui-spinner" /></span>
      ) : icon ? (
        <span className="ui-btn__icon" aria-hidden="true">{icon}</span>
      ) : null}
      {children != null && children !== false ? <span className="ui-btn__label">{children}</span> : null}
      {iconRight ? <span className="ui-btn__icon" aria-hidden="true">{iconRight}</span> : null}
    </button>
  );
}
