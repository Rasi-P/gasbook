import type { CSSProperties, ReactNode } from 'react';
import { cx } from './cx';

export type ChoiceOption<T extends string | number> = {
  value: T;
  label: ReactNode;
  icon?: ReactNode;
  disabled?: boolean;
};

export type ChoiceChipsProps<T extends string | number> = {
  options: ChoiceOption<T>[];
  value: T | null;
  onChange: (value: T) => void;
  size?: 'sm' | 'md';
  /** `inline` wraps; `grid` and `icon` use equal columns (`columns`, default 3). */
  layout?: 'inline' | 'grid' | 'icon';
  columns?: number;
  disabled?: boolean;
  ariaLabel?: string;
  className?: string;
};

/** Single-select chip group (quick quantities, payment modes, discount type, report ranges). */
export function ChoiceChips<T extends string | number>({
  options,
  value,
  onChange,
  size = 'md',
  layout = 'inline',
  columns,
  disabled = false,
  ariaLabel,
  className,
}: ChoiceChipsProps<T>) {
  const style = columns ? ({ '--chips-cols': String(columns) } as CSSProperties) : undefined;
  return (
    <div role="radiogroup" aria-label={ariaLabel} className={cx('ui-chips', layout !== 'inline' && `ui-chips--${layout}`, className)} style={style}>
      {options.map((option) => {
        const checked = option.value === value;
        return (
          <button
            key={String(option.value)}
            type="button"
            role="radio"
            aria-checked={checked}
            disabled={disabled || option.disabled}
            className={cx('ui-chip', size === 'sm' && 'ui-chip--sm')}
            onClick={() => onChange(option.value)}
          >
            {option.icon && <span className="ui-chip__icon" aria-hidden="true">{option.icon}</span>}
            <span>{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}
