export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'link';
export type ButtonSize = 'sm' | 'md' | 'lg';

export type ButtonStyleOptions = {
  variant?: ButtonVariant;
  size?: ButtonSize;
  block?: boolean;
};

/** Class list for a button-styled element. Use it for <Link> / <a> elements that must look like a Button. */
export function buttonClassName({ variant = 'primary', size = 'md', block = false }: ButtonStyleOptions = {}): string {
  return ['ui-btn', `ui-btn--${variant}`, size !== 'md' ? `ui-btn--${size}` : '', block ? 'ui-btn--block' : '']
    .filter(Boolean)
    .join(' ');
}
