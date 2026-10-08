import type { ComponentPropsWithRef, ReactNode } from 'react';
import { cx } from './cx';

export type SwitchProps = Omit<ComponentPropsWithRef<'input'>, 'type' | 'onChange' | 'size' | 'checked'> & {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: ReactNode;
  compact?: boolean;
};

/** Checkbox-backed toggle (same semantics as the discount-manager switch; the input stays keyboard-focusable). */
export function Switch({ checked, onChange, label, compact = false, disabled, className, ...rest }: SwitchProps) {
  return (
    <label className={cx('ui-switch', compact && 'ui-switch--compact', disabled && 'ui-switch--disabled', className)}>
      <input
        {...rest}
        type="checkbox"
        className="ui-switch__input"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="ui-switch__track" aria-hidden="true"><span className="ui-switch__thumb" /></span>
      {label != null && <span className="ui-switch__label">{label}</span>}
    </label>
  );
}
