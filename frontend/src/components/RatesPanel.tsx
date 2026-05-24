import { useEffect, useState } from 'react';
import { X, IndianRupee, Pencil, Check } from 'lucide-react';
import { api } from '../lib/api';

type CylinderType = {
  id: number;
  name: string;
  selling_price: string;
  refill_rate: string;
};

type EditRow = { selling_price: string; refill_rate: string };

export default function RatesPanel() {
  const [open, setOpen] = useState(false);
  const [types, setTypes] = useState<CylinderType[]>([]);
  const [editing, setEditing] = useState<Record<number, EditRow>>({});
  const [saving, setSaving] = useState<number | null>(null);
  const [saved, setSaved] = useState<number | null>(null);

  useEffect(() => {
    if (open && types.length === 0) {
      api.get('/cylinder-types/')
        .then((r) => setTypes(r.data.results ?? r.data))
        .catch(() => undefined);
    }
  }, [open, types.length]);

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
    try {
      const { data } = await api.patch(`/cylinder-types/${t.id}/`, {
        selling_price: row.selling_price,
        refill_rate: row.refill_rate,
      });
      setTypes((prev) => prev.map((x) => (x.id === t.id ? { ...x, ...data } : x)));
      setEditing((prev) => { const n = { ...prev }; delete n[t.id]; return n; });
      setSaved(t.id);
      setTimeout(() => setSaved(null), 1500);
    } catch {
      // keep editing open on error
    } finally {
      setSaving(null);
    }
  }

  function patch(id: number, field: keyof EditRow, value: string) {
    setEditing((prev) => ({ ...prev, [id]: { ...prev[id], [field]: value } }));
  }

  return (
    <>
      {/* Floating button */}
      <button
        onClick={() => setOpen((v) => !v)}
        title="Today's Gas Rates"
        className="rates-fab"
        style={{
          position: 'fixed', bottom: '80px', right: '18px', zIndex: 50,
          background: 'var(--primary)', color: 'white',
          border: 'none', borderRadius: '50%',
          width: '52px', height: '52px',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: '0 4px 16px rgb(249 115 22 / 0.45)',
          cursor: 'pointer',
        }}
      >
        <IndianRupee size={22} />
      </button>

      {/* Panel */}
      {open && (
        <div
          className="rates-panel"
          style={{
          position: 'fixed', bottom: '144px', right: '18px', zIndex: 50,
          width: '320px', background: 'var(--surface)',
          border: '1px solid var(--border)', borderRadius: '12px',
          boxShadow: '0 8px 32px rgb(15 23 42 / 0.15)',
          overflow: 'hidden',
        }}>
          {/* Header */}
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '14px 16px', background: 'var(--primary)', color: 'white',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 700 }}>
              <IndianRupee size={18} />
              Today's Gas Rates
            </div>
            <button onClick={() => setOpen(false)}
              style={{ background: 'none', border: 'none', color: 'white', cursor: 'pointer', padding: '2px' }}>
              <X size={18} />
            </button>
          </div>

          {/* Column headers */}
          <div style={{
            display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 30px',
            padding: '8px 16px', background: 'var(--surface-muted)',
            fontSize: '0.75rem', fontWeight: 700, color: 'var(--text-muted)', gap: '8px',
          }}>
            <span>Size</span><span>Sale (Rs.)</span><span>Refill (Rs.)</span><span />
          </div>

          {/* Rows */}
          <div style={{ maxHeight: '340px', overflowY: 'auto' }}>
            {types.length === 0 && (
              <p style={{ textAlign: 'center', padding: '20px', color: 'var(--text-muted)', fontSize: '0.88rem' }}>
                Loading…
              </p>
            )}
            {types.map((t) => {
              const row = editing[t.id];
              const isSaved = saved === t.id;
              return (
                <div key={t.id} style={{
                  display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 30px',
                  alignItems: 'center', gap: '8px',
                  padding: '10px 16px', borderBottom: '1px solid var(--border)',
                }}>
                  <strong style={{ fontSize: '0.95rem' }}>{t.name}</strong>

                  {row ? (
                    <>
                      <input type="number" min="0" value={row.selling_price}
                        onChange={(e) => patch(t.id, 'selling_price', e.target.value)}
                        style={{ minHeight: '34px', padding: '0 6px', fontSize: '0.85rem' }} />
                      <input type="number" min="0" value={row.refill_rate}
                        onChange={(e) => patch(t.id, 'refill_rate', e.target.value)}
                        style={{ minHeight: '34px', padding: '0 6px', fontSize: '0.85rem' }} />
                      <button onClick={() => saveEdit(t)} disabled={saving === t.id}
                        style={{
                          background: 'var(--success)', border: 'none', borderRadius: '6px',
                          color: 'white', width: '30px', height: '30px',
                          display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
                        }}>
                        <Check size={15} />
                      </button>
                    </>
                  ) : (
                    <>
                      <span style={{ fontSize: '0.9rem', fontWeight: 600, color: isSaved ? 'var(--success)' : 'var(--text)' }}>
                        {Number(t.selling_price).toLocaleString('en-IN')}
                      </span>
                      <span style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>
                        {Number(t.refill_rate).toLocaleString('en-IN')}
                      </span>
                      <button onClick={() => startEdit(t)}
                        style={{
                          background: 'var(--surface-muted)', border: 'none', borderRadius: '6px',
                          color: 'var(--text-muted)', width: '30px', height: '30px',
                          display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
                        }}>
                        <Pencil size={13} />
                      </button>
                    </>
                  )}
                </div>
              );
            })}
          </div>

          <div style={{ padding: '10px 16px', fontSize: '0.75rem', color: 'var(--text-muted)', background: 'var(--surface-muted)' }}>
            Tap ✏️ to edit · Changes apply to all new sales
          </div>
        </div>
      )}
    </>
  );
}
