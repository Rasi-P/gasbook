import type { ComponentPropsWithRef, ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { cx } from './cx';

export type FieldProps = {
  label?: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  /** Adds a visual asterisk only; put `required` on the control itself for validation. */
  required?: boolean;
  /** `label` (default) wraps the control so clicking the text focuses it, matching the existing markup pattern. */
  as?: 'label' | 'div';
  htmlFor?: string;
  className?: string;
  children: ReactNode;
};

export function Field({ label, hint, error, required = false, as = 'label', htmlFor, className, children }: FieldProps) {
  const classes = cx('ui-field', error ? 'ui-field--invalid' : false, className);
  const body = (
    <>
      {label != null && (
        <span className="ui-field__label">
          {label}
          {required && <span className="ui-field__required" aria-hidden="true">*</span>}
        </span>
      )}
      {children}
      {error ? (
        <span className="ui-field__error" role="alert">{error}</span>
      ) : hint ? (
        <span className="ui-field__hint">{hint}</span>
      ) : null}
    </>
  );
  if (as === 'div') return <div className={classes}>{body}</div>;
  return <label className={classes} htmlFor={htmlFor}>{body}</label>;
}

export type InputProps = ComponentPropsWithRef<'input'> & {
  invalid?: boolean;
  /** Control height; `size` is the native (character-count) attribute and is left untouched. */
  inputSize?: 'sm' | 'md';
  leadingIcon?: ReactNode;
  trailing?: ReactNode;
};

/** Native <input> with the shared styling. All native props (required, maxLength, pattern, inputMode, autoFocus…) pass through. */
export function Input({ invalid = false, inputSize = 'md', leadingIcon, trailing, className, ...rest }: InputProps) {
  const control = (
    <input
      {...rest}
      aria-invalid={invalid ? true : rest['aria-invalid']}
      className={cx('ui-input', inputSize === 'sm' && 'ui-input--sm', invalid && 'ui-input--invalid', className)}
    />
  );
  if (!leadingIcon && !trailing) return control;
  return (
    <span className={cx('ui-input-wrap', leadingIcon ? 'ui-input-wrap--icon' : false, trailing ? 'ui-input-wrap--trailing' : false)}>
      {leadingIcon && <span className="ui-input-wrap__icon" aria-hidden="true">{leadingIcon}</span>}
      {control}
      {trailing && <span className="ui-input-wrap__trailing">{trailing}</span>}
    </span>
  );
}

export type SelectProps = ComponentPropsWithRef<'select'> & {
  invalid?: boolean;
  selectSize?: 'sm' | 'md';
};

/** Native <select> with the shared styling and a custom chevron. Native props (required, value, onChange…) pass through. */
export function Select({ invalid = false, selectSize = 'md', className, children, ...rest }: SelectProps) {
  return (
    <span className="ui-select-wrap">
      <select
        {...rest}
        aria-invalid={invalid ? true : rest['aria-invalid']}
        className={cx('ui-input', 'ui-select', selectSize === 'sm' && 'ui-input--sm', invalid && 'ui-input--invalid', className)}
      >
        {children}
      </select>
      <span className="ui-select-wrap__chevron" aria-hidden="true"><ChevronDown size={16} /></span>
    </span>
  );
}

export type TextareaProps = ComponentPropsWithRef<'textarea'> & { invalid?: boolean };

export function Textarea({ invalid = false, className, ...rest }: TextareaProps) {
  return (
    <textarea
      {...rest}
      aria-invalid={invalid ? true : rest['aria-invalid']}
      className={cx('ui-input', 'ui-textarea', invalid && 'ui-input--invalid', className)}
    />
  );
}
