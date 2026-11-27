import type { ReactNode } from 'react';
import { cx } from './cx';

export type TabItem<T extends string> = {
  value: T;
  label: ReactNode;
  icon?: ReactNode;
  count?: ReactNode;
  disabled?: boolean;
};

export type TabsProps<T extends string> = {
  items: TabItem<T>[];
  value: T;
  onChange: (value: T) => void;
  /** `segmented` (pill group inside cards, default) or `tabs` (underline, page level). */
  variant?: 'segmented' | 'tabs';
  block?: boolean;
  size?: 'sm' | 'md';
  ariaLabel?: string;
  className?: string;
};

/** Single-select tab control. Replaces the inline-styled tab bars in Sales, Stock, Reports and the discount manager. */
export function Tabs<T extends string>({ items, value, onChange, variant = 'segmented', block = false, size = 'md', ariaLabel, className }: TabsProps<T>) {
  return (
    <div role="tablist" aria-label={ariaLabel} className={cx('ui-tabs', `ui-tabs--${variant}`, block && 'ui-tabs--block', size === 'sm' && 'ui-tabs--sm', className)}>
      {items.map((item) => {
        const selected = item.value === value;
        return (
          <button
            key={item.value}
            type="button"
            role="tab"
            aria-selected={selected}
            disabled={item.disabled}
            className="ui-tab"
            onClick={() => onChange(item.value)}
          >
            {item.icon && <span className="ui-tab__icon" aria-hidden="true">{item.icon}</span>}
            <span>{item.label}</span>
            {item.count != null && <span className="ui-tab__count">{item.count}</span>}
          </button>
        );
      })}
    </div>
  );
}
