import { useEffect, useRef, useState } from 'react';
import { X, IndianRupee, Pencil, Check } from 'lucide-react';
import { api, extractApiError, fetchAllPages } from '../lib/api';
import { Alert } from './ui/Alert';
import { Button } from './ui/Button';
import { EmptyState } from './ui/EmptyState';
import { Input } from './ui/Field';
import { IconButton } from './ui/IconButton';
import { LoadingState } from './AsyncState';

type CylinderType = {
  id: number;
  name: string;
  selling_price: string;
  refill_rate: string;
};

type EditRow = { selling_price: string; refill_rate: string };

/**
 * Today's gas rates editor. Fetch, edit and PATCH logic is unchanged; the open/closed state now
 * lives in the AppShell so the trigger can sit in the header on phones and float on desktop.
 * Renders as a bottom sheet below 980px and as a popover above the floating button on desktop.
 */
export default function RatesPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [types, setTypes] = useState<CylinderType[]>([]);
  const [editing, setEditing] = useState<Record<number, EditRow>>({});
  const [saving, setSaving] = useState<number | null>(null);
  const [saved, setSaved] = useState<number | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [loadError, setLoadError] = useState('');
  const [saveError, setSaveError] = useState('');
  const requestedRef = useRef(false);

  function loadTypes() {
    return fetchAllPages<CylinderType>('/cylinder-types/')
      .then((rows) => { setTypes(rows); setLoadError(''); setStatus('ready'); })
      .catch((err) => { setLoadError(extractApiError(err, [], 'Could not load cylinder rates.')); setStatus('error'); });
  }

  function retryLoad() {
    setStatus('loading');
    setLoadError('');
    void loadTypes();
  }

  useEffect(() => {
    if (open && !requestedRef.current) {
      requestedRef.current = true;
      void loadTypes();
    }
  }, [open]);

  function startEdit(t: CylinderType) {
    setEditing((prev) => ({
      ...prev,
      [t.id]: { selling_price: t.selling_price, refill_rate: t.refill_rate },
    }));
  }

  async function saveEdit(t: CylinderType) {
    const row = editing[t.id];
    if (!row) return;
    setSaving(t.id);
    setSaveError('');
    try {
      const { data } = await api.patch(`/cylinder-types/${t.id}/`, {
        selling_price: row.selling_price,
        refill_rate: row.refill_rate,
      });
      setTypes((prev) => prev.map((x) => (x.id === t.id ? { ...x, ...data } : x)));
      setEditing((prev) => { const n = { ...prev }; delete n[t.id]; return n; });
      setSaved(t.id);
      setTimeout(() => setSaved(null), 1500);
    } catch (err) {
      // keep editing open on error
      setSaveError(extractApiError(err, ['selling_price', 'refill_rate'], 'Failed to save rates.'));
    } finally {
      setSaving(null);
    }
  }

  function patch(id: number, field: keyof EditRow, value: string) {
    setEditing((prev) => ({ ...prev, [id]: { ...prev[id], [field]: value } }));
  }

  if (!open) return null;

  return (
    <>
      <div className="rates-scrim" onClick={onClose} aria-hidden="true" />
      <div className="rates-panel" role="dialog" aria-label="Today's Gas Rates">
        <div className="rates-panel__header">
          <div className="rates-panel__title">
            <IndianRupee size={18} />
            Today's Gas Rates
          </div>
          <IconButton type="button" label="Close" size="sm" onClick={onClose}>
            <X size={16} />
          </IconButton>
        </div>

        <div className="rates-panel__columns" aria-hidden="true">
          <span>Size</span><span>Sale (Rs.)</span><span>Refill (Rs.)</span><span />
        </div>

        <div className="rates-panel__rows">
          {status === 'loading' && <LoadingState label="Loading…" />}
          {status === 'error' && (
            <div className="rates-panel__status">
              <Alert
                tone="danger"
                compact
                actions={<Button type="button" variant="secondary" size="sm" onClick={retryLoad}>Retry</Button>}
              >
                {loadError}
              </Alert>
            </div>
          )}
          {status === 'ready' && types.length === 0 && (
            <EmptyState compact title="No cylinder types yet." />
          )}
          {saveError && (
            <div className="rates-panel__status">
              <Alert tone="danger" compact role="alert">{saveError}</Alert>
            </div>
          )}
          {types.map((t) => {
            const row = editing[t.id];
            const isSaved = saved === t.id;
            return (
              <div key={t.id} className="rates-row">
                <strong className="rates-row__name">{t.name}</strong>

                {row ? (
                  <>
                    <Input
                      type="number"
                      min="0"
                      inputSize="sm"
                      aria-label={`${t.name} sale price`}
                      value={row.selling_price}
                      onChange={(e) => patch(t.id, 'selling_price', e.target.value)}
                    />
                    <Input
                      type="number"
                      min="0"
                      inputSize="sm"
                      aria-label={`${t.name} refill rate`}
                      value={row.refill_rate}
                      onChange={(e) => patch(t.id, 'refill_rate', e.target.value)}
                    />
                    <IconButton
                      label="Save"
                      size="sm"
                      variant="outline"
                      tone="primary"
                      onClick={() => saveEdit(t)}
                      disabled={saving === t.id}
                    >
                      <Check size={14} />
                    </IconButton>
                  </>
                ) : (
                  <>
                    <span className={`rates-row__value${isSaved ? ' rates-row__value--saved' : ''}`}>
                      {Number(t.selling_price).toLocaleString('en-IN')}
                    </span>
                    <span className="rates-row__value rates-row__value--muted">
                      {Number(t.refill_rate).toLocaleString('en-IN')}
                    </span>
                    <IconButton label="Edit" size="sm" onClick={() => startEdit(t)}>
                      <Pencil size={14} />
                    </IconButton>
                  </>
                )}
              </div>
            );
          })}
        </div>

        <div className="rates-panel__footer">
          Tap the pencil to edit · Changes apply to all new sales
        </div>
      </div>
    </>
  );
}
