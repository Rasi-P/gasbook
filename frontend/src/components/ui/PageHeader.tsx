import type { ReactNode } from 'react';
import { cx } from './cx';

export type PageHeaderProps = {
  title: ReactNode;
  description?: ReactNode;
  /** Chips under the title (phone, email, address…). */
  meta?: ReactNode;
  /** Slot before the title, e.g. a back IconButton. */
  leading?: ReactNode;
  actions?: ReactNode;
  className?: string;
};

export function PageHeader({ title, description, meta, leading, actions, className }: PageHeaderProps) {
  return (
    <div className={cx('ui-page-header', className)}>
      <div className="ui-page-header__main">
        {leading != null && <div className="ui-page-header__leading">{leading}</div>}
        <div className="ui-page-header__text">
          <h1>{title}</h1>
          {description != null && <p className="ui-page-header__description">{description}</p>}
          {meta != null && <div className="ui-page-header__meta">{meta}</div>}
        </div>
      </div>
      {actions != null && <div className="ui-page-header__actions">{actions}</div>}
    </div>
  );
}
