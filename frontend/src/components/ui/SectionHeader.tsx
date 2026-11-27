import type { ReactNode } from 'react';
import { cx } from './cx';

export type SectionHeaderProps = {
  title: ReactNode;
  description?: ReactNode;
  /** Kicker icon in a primary-light square (dashboard section groups). */
  icon?: ReactNode;
  /** Right-hand slot: badge, count, small action. */
  meta?: ReactNode;
  as?: 'h2' | 'h3';
  className?: string;
};

export function SectionHeader({ title, description, icon, meta, as = 'h2', className }: SectionHeaderProps) {
  const Heading = as;
  return (
    <div className={cx('ui-section-header', className)}>
      <div className="ui-section-header__main">
        {icon != null && <span className="ui-section-header__icon" aria-hidden="true">{icon}</span>}
        <div className="ui-section-header__text">
          <Heading>{title}</Heading>
          {description != null && <p className="ui-section-header__description">{description}</p>}
        </div>
      </div>
      {meta != null && <div className="ui-section-header__meta">{meta}</div>}
    </div>
  );
}
