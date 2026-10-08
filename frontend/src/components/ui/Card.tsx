import type { ComponentPropsWithRef, ReactNode } from 'react';
import { cx } from './cx';

export type CardProps = ComponentPropsWithRef<'div'> & {
  /** `none` for cards whose content supplies its own padding (tables, lists). */
  padding?: 'none' | 'sm' | 'md';
  interactive?: boolean;
};

export function Card({ padding = 'md', interactive = false, className, ...rest }: CardProps) {
  return (
    <div
      {...rest}
      className={cx('ui-card', padding === 'none' ? 'ui-card--flush' : `ui-card--pad-${padding}`, interactive && 'ui-card--interactive', className)}
    />
  );
}

export type CardHeaderProps = {
  title?: ReactNode;
  description?: ReactNode;
  /** Right-hand slot: badges, counts, small actions. */
  meta?: ReactNode;
  as?: 'h2' | 'h3';
  className?: string;
  children?: ReactNode;
};

export function CardHeader({ title, description, meta, as = 'h2', className, children }: CardHeaderProps) {
  const Heading = as;
  return (
    <div className={cx('ui-card__header', className)}>
      <div className="ui-card__heading">
        {title != null && <Heading className="ui-card__title">{title}</Heading>}
        {description != null && <p className="ui-card__description">{description}</p>}
        {children}
      </div>
      {meta != null && <div className="ui-card__meta">{meta}</div>}
    </div>
  );
}

export function CardBody({ className, ...rest }: ComponentPropsWithRef<'div'>) {
  return <div {...rest} className={cx('ui-card__body', className)} />;
}

export function CardFooter({ className, ...rest }: ComponentPropsWithRef<'div'>) {
  return <div {...rest} className={cx('ui-card__footer', className)} />;
}
