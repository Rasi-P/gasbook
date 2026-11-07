import { Search } from 'lucide-react';
import { cx } from './cx';
import { Input, type InputProps } from './Field';

export type SearchInputProps = Omit<InputProps, 'leadingIcon'>;

/** 44px text input with a leading search icon. Keeps `type="text"` unless overridden, so key handling is unchanged. */
export function SearchInput({ className, ...rest }: SearchInputProps) {
  return <Input type="text" {...rest} leadingIcon={<Search size={16} />} className={cx('ui-input--search', className)} />;
}
