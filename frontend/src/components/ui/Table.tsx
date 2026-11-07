import type { ComponentPropsWithRef } from 'react';
import { cx } from './cx';

type Align = 'left' | 'center' | 'right';

export type TableWrapProps = ComponentPropsWithRef<'div'> & {
  /** Right-edge fade hinting that the table scrolls horizontally. */
  fade?: boolean;
};

export function TableWrap({ fade = false, className, ...rest }: TableWrapProps) {
  return <div {...rest} className={cx('ui-table-wrap', fade && 'ui-table-wrap--fade', className)} />;
}

export type TableProps = ComponentPropsWithRef<'table'> & {
  compact?: boolean;
  /** Under 680px, rows render as stacked cards using each <Td label="…">. */
  cards?: boolean;
  stickyFirst?: boolean;
};

export function Table({ compact = false, cards = false, stickyFirst = false, className, ...rest }: TableProps) {
  return (
    <table
      {...rest}
      className={cx('ui-table', compact && 'ui-table--compact', cards && 'ui-table--cards', stickyFirst && 'ui-table--sticky-first', className)}
    />
  );
}

export type ThProps = Omit<ComponentPropsWithRef<'th'>, 'align'> & { align?: Align };

export function Th({ align = 'left', className, ...rest }: ThProps) {
  return <th {...rest} className={cx(align !== 'left' && `ui-table__${align}`, className)} />;
}

export type TdProps = Omit<ComponentPropsWithRef<'td'>, 'align'> & {
  align?: Align;
  /** Column label shown in card mode. */
  label?: string;
  /** Right-aligned tabular figures. */
  numeric?: boolean;
};

export function Td({ align = 'left', label, numeric = false, className, ...rest }: TdProps) {
  return (
    <td
      {...rest}
      data-label={label}
      className={cx(numeric ? 'ui-table__num' : align !== 'left' && `ui-table__${align}`, className)}
    />
  );
}
