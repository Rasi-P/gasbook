import type { ReactNode } from 'react';
import { TriangleAlert } from 'lucide-react';
import { Alert } from '../ui/Alert';
import { Badge } from '../ui/Badge';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';

/** Confirms a permanent delete. When something depends on the record the server would refuse, so the reasons are shown
 *  instead and there is no delete button; an active record can be deactivated from here instead. */
export function DeleteDialog({
  open, name, kind, blockers, busy, onConfirm, onCancel, onDeactivateInstead,
}: {
  open: boolean;
  name: string;
  kind: string;
  blockers: { code: string; detail: string }[];
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  onDeactivateInstead?: () => void;
}) {
  const blocked = blockers.length > 0;
  return (
    <Modal
      open={open}
      onClose={busy ? undefined : onCancel}
      closeOnEscape={!busy}
      title={blocked ? `${name} can't be deleted` : `Delete ${name}?`}
      size="sm"
      footer={(
        <>
          <Button type="button" variant="secondary" onClick={onCancel} disabled={busy}>{blocked ? 'Close' : 'Cancel'}</Button>
          {blocked && onDeactivateInstead && (
            <Button type="button" variant="secondary" onClick={onDeactivateInstead} disabled={busy}>Deactivate instead</Button>
          )}
          {!blocked && (
            <Button type="button" variant="danger" onClick={onConfirm} loading={busy} disabled={busy}>Delete {kind}</Button>
          )}
        </>
      )}
    >
      <div className="catalog-dialog">
        {blocked ? (
          <Alert tone="danger" icon={<TriangleAlert size={16} />} title="Something still depends on it">
            <ul className="catalog-dialog__list">{blockers.map((b) => <li key={b.code}>{b.detail}</li>)}</ul>
          </Alert>
        ) : (
          <Alert tone="warning" title="This cannot be undone">
            Nothing uses this {kind}, so it will be removed permanently.
          </Alert>
        )}
        {blocked && <p className="catalog-dialog__hint">Deactivating keeps all history and hides it from new bookings, sales and stock operations.</p>}
      </div>
    </Modal>
  );
}

export function ActiveBadge({ active }: { active: boolean }) {
  return <Badge tone={active ? 'success' : 'neutral'}>{active ? 'Active' : 'Inactive'}</Badge>;
}

/** Asks before a risky deactivation. `blocked` means the server will refuse it, so there is no confirm button. */
export function DeactivateDialog({
  open, title, intro, warnings, blockedMessage, confirmLabel, busy, onConfirm, onCancel,
}: {
  open: boolean;
  title: string;
  intro: ReactNode;
  warnings: string[];
  blockedMessage?: string;
  confirmLabel: string;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal
      open={open}
      onClose={busy ? undefined : onCancel}
      closeOnEscape={!busy}
      title={title}
      size="sm"
      footer={(
        <>
          <Button type="button" variant="secondary" onClick={onCancel} disabled={busy}>{blockedMessage ? 'Close' : 'Keep active'}</Button>
          {!blockedMessage && (
            <Button type="button" variant="danger" onClick={onConfirm} loading={busy} disabled={busy}>{confirmLabel}</Button>
          )}
        </>
      )}
    >
      <div className="catalog-dialog">
        <p>{intro}</p>
        {blockedMessage ? (
          <Alert tone="danger" icon={<TriangleAlert size={16} />}>{blockedMessage}</Alert>
        ) : warnings.length > 0 ? (
          <Alert tone="warning" title="Before you continue">
            <ul className="catalog-dialog__list">{warnings.map((w) => <li key={w}>{w}</li>)}</ul>
          </Alert>
        ) : (
          <p className="catalog-dialog__hint">Nothing else depends on it right now.</p>
        )}
      </div>
    </Modal>
  );
}
