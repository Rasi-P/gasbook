import { RefreshCw } from 'lucide-react';
import { Alert } from './ui/Alert';
import { Button } from './ui/Button';

export function LoadingState({ label = 'Loading…' }: { label?: string }) {
  return (
    <p className="ui-loading" role="status" aria-live="polite">
      <span className="ui-spinner" aria-hidden="true" />
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
    <Alert
      tone="danger"
      role="alert"
      compact={compact}
      className="ui-alert--block"
      actions={onRetry && (
        <Button type="button" variant="secondary" size="sm" icon={<RefreshCw size={14} />} onClick={onRetry}>
          {retryLabel}
        </Button>
      )}
    >
      {message}
    </Alert>
  );
}

/** Small inline warning (e.g. stale data kept after a refresh failure). */
export function InlineWarning({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <Alert
      tone="warning"
      role="alert"
      compact
      className="ui-alert--block-sm"
      actions={onRetry && (
        <Button type="button" variant="link" size="sm" onClick={onRetry}>
          Retry
        </Button>
      )}
    >
      {message}
    </Alert>
  );
}
