import { RefreshCw } from 'lucide-react';

export function LoadingState({ label = 'Loading…' }: { label?: string }) {
  return (
    <p className="async-loading" role="status" aria-live="polite">
      {label}
    </p>
  );
}

export function ErrorState({
  message,
  onRetry,
  retryLabel = 'Retry',
  compact = false,
}: {
  message: string;
  onRetry?: () => void;
  retryLabel?: string;
  compact?: boolean;
}) {
  return (
    <div className={`card async-error${compact ? ' async-error--compact' : ''}`} role="alert">
      <p className="async-error-message">{message}</p>
      {onRetry && (
        <button type="button" className="btn btn-outline async-error-retry" onClick={onRetry}>
          <RefreshCw size={16} />
          {retryLabel}
        </button>
      )}
    </div>
  );
}

/** Small inline warning (e.g. stale data kept after a refresh failure). */
export function InlineWarning({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <p className="async-inline-warning" role="alert">
      <span>{message}</span>
      {onRetry && (
        <button type="button" className="async-inline-retry" onClick={onRetry}>
          Retry
        </button>
      )}
    </p>
  );
}
