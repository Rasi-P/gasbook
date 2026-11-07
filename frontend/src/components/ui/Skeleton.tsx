import type { CSSProperties } from 'react';
import { cx } from './cx';

export type SkeletonProps = {
  width?: number | string;
  height?: number | string;
  radius?: number | string;
  className?: string;
  style?: CSSProperties;
};

export function Skeleton({ width = '100%', height = 14, radius, className, style }: SkeletonProps) {
  return <span aria-hidden="true" className={cx('ui-skeleton', className)} style={{ width, height, borderRadius: radius, ...style }} />;
}

export function SkeletonText({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <span aria-hidden="true" className={cx('ui-skeleton-stack', className)}>
      {Array.from({ length: lines }, (_, index) => (
        <Skeleton key={index} width={index === lines - 1 ? '60%' : '100%'} />
      ))}
    </span>
  );
}

/** Placeholder for a row of StatCards. */
export function SkeletonStatGrid({ count = 4, label = 'Loading' }: { count?: number; label?: string }) {
  return (
    <div className="ui-skeleton-grid" role="status" aria-live="polite" aria-label={label}>
      {Array.from({ length: count }, (_, index) => (
        <div key={index} className="ui-card ui-card--pad-md ui-skeleton-stat">
          <Skeleton width={36} height={36} radius={8} />
          <Skeleton width="45%" height={12} />
          <Skeleton width="60%" height={24} />
          <Skeleton width="70%" height={12} />
        </div>
      ))}
    </div>
  );
}

/** Placeholder for table rows or a list of rows. */
export function SkeletonRows({ rows = 5, columns = 4, label = 'Loading' }: { rows?: number; columns?: number; label?: string }) {
  const template = Array.from({ length: columns }, (_, index) => (index === 0 ? '2fr' : '1fr')).join(' ');
  return (
    <div className="ui-skeleton-rows" role="status" aria-live="polite" aria-label={label}>
      {Array.from({ length: rows }, (_, row) => (
        <div key={row} className="ui-skeleton-row" style={{ gridTemplateColumns: template }}>
          {Array.from({ length: columns }, (_, column) => (
            <Skeleton key={column} height={12} width={column === 0 ? '80%' : '60%'} />
          ))}
        </div>
      ))}
    </div>
  );
}
