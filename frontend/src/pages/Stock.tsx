import { useState, useEffect, useCallback } from 'react';
import type { FormEvent } from 'react';
import { ArrowDownUp, ArrowRight, Check, ChevronDown, Factory, Flame, Search } from 'lucide-react';
import { api } from '../lib/api';

type Tab = 'movement' | 'new_load' | 'refuel' | 'history';
type Location = { id: number; name: string; code: string };
type CylinderType = { id: number; name: string };
type SelectOption<T extends string | number> = { value: T; label: string };
type Movement = {
  id: number;
  cylinder_type_name: string;
  quantity: number;
  status: string;
  from_location_name: string;
  to_location_name: string;
  moved_by_name: string;
  created_at: string;
  note: string;
};

function AppSelect<T extends string | number>({
  value,
  options,
  onChange,
  ariaLabel,
}: {
  value: T;
  options: SelectOption<T>[];
  onChange: (value: T) => void;
  ariaLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const selected = options.find((option) => option.value === value) ?? options[0];

  return (
    <div className="app-select" onBlur={() => setOpen(false)}>
      <button
        aria-expanded={open}
        aria-label={ariaLabel}
        className="app-select-trigger"
        onClick={() => setOpen((current) => !current)}
        type="button"
      >
        <span>{selected?.label ?? 'Select'}</span>
        <ChevronDown size={18} />
      </button>
      {open && (
        <div className="app-select-menu" role="listbox">
          {options.map((option) => {
            const isSelected = option.value === value;
            return (
              <button
                aria-selected={isSelected}
                className={isSelected ? 'selected' : ''}
                key={option.value}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  onChange(option.value);
                  setOpen(false);
                }}
                role="option"
                type="button"
              >
                <span>{option.label}</span>
                {isSelected && <Check size={16} />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default function Stock() {
  const [activeTab, setActiveTab] = useState<Tab>('movement');
  const [locations, setLocations] = useState<Location[]>([]);
  const [cylinderTypes, setCylinderTypes] = useState<CylinderType[]>([]);

  useEffect(() => {
    Promise.all([api.get('/locations/'), api.get('/cylinder-types/')])
      .then(([lr, tr]) => {
        setLocations(lr.data.results ?? lr.data);
        setCylinderTypes(tr.data.results ?? tr.data);
      })
      .catch(() => undefined);
  }, []);

  // ── Movement form ────────────────────────────────────────────────────────
  const [fromLocation, setFromLocation] = useState(0);
  const [toLocation, setToLocation] = useState(0);
  const [moveCyl, setMoveCyl] = useState(0);
  const [moveStatus, setMoveStatus] = useState('filled');
  const [moveQty, setMoveQty] = useState('');
  const [moveMsg, setMoveMsg] = useState('');
  const [moveErr, setMoveErr] = useState('');

  // ── New Load form ────────────────────────────────────────────────────────
  const [loadCyl, setLoadCyl] = useState(0);
  const [loadQty, setLoadQty] = useState('');
  const [loadTo, setLoadTo] = useState(0);
  const [loadMsg, setLoadMsg] = useState('');
  const [loadErr, setLoadErr] = useState('');
  const [loadSaving, setLoadSaving] = useState(false);

  // ── Refuel form ──────────────────────────────────────────────────────────
  const [refuelCyl, setRefuelCyl] = useState(0);
  const [refuelFromLoc, setRefuelFromLoc] = useState(0);  // where empties currently are
  const [refuelQty, setRefuelQty] = useState('');
  const [refuelReceiveLoc, setRefuelReceiveLoc] = useState(0); // where to receive filled
  const [refuelStep, setRefuelStep] = useState<'idle' | 'sent' | 'done'>('idle');
  const [refuelMsg, setRefuelMsg] = useState('');
  const [refuelErr, setRefuelErr] = useState('');
  const [refuelSaving, setRefuelSaving] = useState(false);

  // ── History ──────────────────────────────────────────────────────────────
  const [movements, setMovements] = useState<Movement[]>([]);
  const [searchQuery, setSearchQuery] = useState('');

  // Derived lists
  const moveLocations = locations.filter((l) => l.code !== 'supplier');
  const moveLocationOptions = moveLocations.map((l) => ({ value: l.id, label: l.name }));
  const loadLocationOptions = moveLocations.map((l) => ({ value: l.id, label: l.name }));
  const cylinderOptions = cylinderTypes.map((t) => ({ value: t.id, label: t.name }));
  const statusOptions: SelectOption<string>[] = [
    { value: 'filled', label: 'Filled' },
    { value: 'empty', label: 'Empty' },
  ];

  // Set defaults once data loads
  useEffect(() => {
    const nonSupplier = locations.filter((l) => l.code !== 'supplier');
    if (nonSupplier.length >= 1 && fromLocation === 0) {
      setFromLocation(nonSupplier[1]?.id ?? nonSupplier[0].id);
      setToLocation(nonSupplier[0].id);
      setLoadTo(nonSupplier[1]?.id ?? nonSupplier[0].id);
      setRefuelFromLoc(nonSupplier[0].id);
      setRefuelReceiveLoc(nonSupplier[0].id);
    }
    if (cylinderTypes.length > 0 && moveCyl === 0) {
      setMoveCyl(cylinderTypes[0].id);
      setLoadCyl(cylinderTypes[0].id);
      setRefuelCyl(cylinderTypes[0].id);
    }
  }, [locations, cylinderTypes]);

  const fetchHistory = useCallback(() => {
    api.get('/movements/')
      .then((r) => setMovements(r.data.results ?? r.data))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (activeTab === 'history') fetchHistory();
  }, [activeTab, fetchHistory]);

  function swapLocations() {
    setFromLocation(toLocation);
    setToLocation(fromLocation);
  }

  async function handleMovement(e: FormEvent) {
    e.preventDefault();
    setMoveMsg(''); setMoveErr('');
    try {
      await api.post('/movements/', {
        cylinder_type: moveCyl,
        from_location: fromLocation,
        to_location: toLocation,
        status: moveStatus,
        quantity: Number(moveQty),
      });
      setMoveMsg(`Moved ${moveQty} ${moveStatus} cylinders successfully.`);
      setMoveQty('');
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: unknown } })?.response?.data;
      setMoveErr(msg ? JSON.stringify(msg) : 'Movement failed. Check stock levels.');
    }
  }

  async function handleNewLoad(e: FormEvent) {
    e.preventDefault();
    setLoadMsg(''); setLoadErr('');
    setLoadSaving(true);
    try {
      const supplier = locations.find((l) => l.code === 'supplier');
      if (!supplier) { setLoadErr('Supplier location not found.'); return; }
      await api.post('/movements/', {
        cylinder_type: loadCyl,
        from_location: supplier.id,
        to_location: loadTo,
        status: 'filled',
        quantity: Number(loadQty),
        note: 'New supplier load',
      });
      const locName = locations.find((l) => l.id === loadTo)?.name ?? '';
      const cylName = cylinderTypes.find((c) => c.id === loadCyl)?.name ?? '';
      setLoadMsg(`Added ${loadQty} × ${cylName} filled cylinders to ${locName}.`);
      setLoadQty('');
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: unknown } })?.response?.data;
      setLoadErr(msg ? JSON.stringify(msg) : 'Failed to save load. Check backend connection.');
    } finally {
      setLoadSaving(false);
    }
  }

  // Step 1 of Refuel: send empties to supplier
  async function handleRefuelSend(e: FormEvent) {
    e.preventDefault();
    setRefuelMsg(''); setRefuelErr(''); setRefuelSaving(true);
    try {
      const supplier = locations.find((l) => l.code === 'supplier');
      if (!supplier) { setRefuelErr('Supplier location not found.'); return; }
      const cylName = cylinderTypes.find((c) => c.id === refuelCyl)?.name ?? '';
      const fromName = locations.find((l) => l.id === refuelFromLoc)?.name ?? '';
      await api.post('/movements/', {
        cylinder_type: refuelCyl,
        from_location: refuelFromLoc,
        to_location: supplier.id,
        status: 'empty',
        quantity: Number(refuelQty),
        note: 'Sent for refilling',
      });
      setRefuelMsg(`✓ Sent ${refuelQty} empty ${cylName} cylinders from ${fromName} to supplier for refilling.`);
      setRefuelStep('sent');
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: unknown } })?.response?.data;
      setRefuelErr(msg ? JSON.stringify(msg) : 'Failed. Check stock levels.');
    } finally {
      setRefuelSaving(false);
    }
  }

  // Step 2 of Refuel: receive filled cylinders back
  async function handleRefuelReceive(e: FormEvent) {
    e.preventDefault();
    setRefuelErr(''); setRefuelSaving(true);
    try {
      const supplier = locations.find((l) => l.code === 'supplier');
      if (!supplier) { setRefuelErr('Supplier location not found.'); return; }
      const cylName = cylinderTypes.find((c) => c.id === refuelCyl)?.name ?? '';
      const toLoc = locations.find((l) => l.id === refuelReceiveLoc)?.name ?? '';
      await api.post('/movements/', {
        cylinder_type: refuelCyl,
        from_location: supplier.id,
        to_location: refuelReceiveLoc,
        status: 'filled',
        quantity: Number(refuelQty),
        note: 'Received refilled cylinders',
      });
      setRefuelMsg(`✓ All done! ${refuelQty} filled ${cylName} cylinders received at ${toLoc}.`);
      setRefuelStep('done');
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: unknown } })?.response?.data;
      setRefuelErr(msg ? JSON.stringify(msg) : 'Failed to record received stock.');
    } finally {
      setRefuelSaving(false);
    }
  }

  function resetRefuel() {
    setRefuelStep('idle');
    setRefuelMsg(''); setRefuelErr('');
    setRefuelQty('');
  }

  const filtered = movements.filter((m) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      m.cylinder_type_name.toLowerCase().includes(q) ||
      m.from_location_name.toLowerCase().includes(q) ||
      m.to_location_name.toLowerCase().includes(q) ||
      m.moved_by_name.toLowerCase().includes(q)
    );
  });

  const tabBtn = (tab: Tab, label: string) => (
    <button
      onClick={() => setActiveTab(tab)}
      style={{
        flex: 1, padding: '10px', border: 'none', borderRadius: '6px', fontWeight: 600,
        background: activeTab === tab ? 'var(--surface)' : 'transparent',
        color: activeTab === tab ? 'var(--text)' : 'var(--text-muted)',
        cursor: 'pointer',
      }}
    >
      {label}
    </button>
  );

  return (
    <div>
      <div className="page-title" style={{ marginBottom: '16px' }}>
        <div>
          <h1>Stock &amp; Load</h1>
          <p>Move cylinders, enter new loads, or record refuel cycles.</p>
        </div>
      </div>

      <div style={{ display: 'flex', background: 'var(--border)', borderRadius: '8px', padding: '4px', marginBottom: '16px' }}>
        {tabBtn('movement', 'Movement')}
        {tabBtn('new_load', 'New Load')}
        {tabBtn('refuel', '🔥 Refuel')}
        {tabBtn('history', 'History')}
      </div>

      {/* ── Movement ── */}
      {activeTab === 'movement' && (
        <div className="card form-card">
          <form onSubmit={handleMovement} className="form-stack">
            <div className="move-grid">
              <label>
                <span>From</span>
                <AppSelect ariaLabel="From location" value={fromLocation} options={moveLocationOptions} onChange={setFromLocation} />
              </label>
              <button className="swap-button" type="button" onClick={swapLocations}>
                <ArrowDownUp size={22} />
              </button>
              <label>
                <span>To</span>
                <AppSelect ariaLabel="To location" value={toLocation} options={moveLocationOptions} onChange={setToLocation} />
              </label>
            </div>

            <div className="grid-2">
              <label>
                <span>Cylinder</span>
                <AppSelect ariaLabel="Cylinder type" value={moveCyl} options={cylinderOptions} onChange={setMoveCyl} />
              </label>
              <label>
                <span>Status</span>
                <AppSelect ariaLabel="Cylinder status" value={moveStatus} options={statusOptions} onChange={setMoveStatus} />
              </label>
            </div>

            <label>
              <span>Quantity</span>
              <input min="1" type="number" value={moveQty} onChange={(e) => setMoveQty(e.target.value)} required />
            </label>

            {moveErr && <p className="form-error">{moveErr}</p>}
            {moveMsg && <p className="form-note">{moveMsg}</p>}

            <button type="submit" className="btn btn-primary">Confirm Movement</button>
          </form>
        </div>
      )}

      {/* ── New Load ── */}
      {activeTab === 'new_load' && (
        <div className="card form-card">
          <form onSubmit={handleNewLoad} className="form-stack">
            <div className="grid-2">
              <label>
                <span>Load To</span>
                <AppSelect ariaLabel="Load destination" value={loadTo} options={loadLocationOptions} onChange={setLoadTo} />
              </label>
              <label>
                <span>Cylinder Size</span>
                <AppSelect ariaLabel="Cylinder size" value={loadCyl} options={cylinderOptions} onChange={setLoadCyl} />
              </label>
            </div>

            <label>
              <span>Quantity Arrived</span>
              <input min="1" type="number" value={loadQty} onChange={(e) => setLoadQty(e.target.value)} required placeholder="e.g. 50" />
            </label>

            {loadErr && <p className="form-error">{loadErr}</p>}
            {loadMsg && <p className="form-note">{loadMsg}</p>}

            <button type="submit" className="btn btn-primary" style={{ background: 'var(--success)' }} disabled={loadSaving}>
              <Factory size={20} /> {loadSaving ? 'Saving…' : 'Save New Load'}
            </button>
          </form>
        </div>
      )}

      {/* ── Refuel ── */}
      {activeTab === 'refuel' && (
        <div className="form-stack">

          {/* Progress indicator */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '0', marginBottom: '8px' }}>
            {[
              { step: 'idle', label: '1. Send Empties', done: refuelStep !== 'idle' },
              { step: 'sent', label: '2. Receive Filled', done: refuelStep === 'done' },
            ].map((s, i) => (
              <div key={s.step} style={{ display: 'flex', alignItems: 'center', flex: 1 }}>
                <div style={{
                  flex: 1,
                  padding: '10px 14px',
                  borderRadius: i === 0 ? '8px 0 0 8px' : '0 8px 8px 0',
                  background: s.done ? 'var(--success)' : (refuelStep === s.step || (s.step === 'idle' && refuelStep === 'idle')) ? 'var(--primary)' : 'var(--border)',
                  color: s.done || refuelStep === s.step || (s.step === 'idle' && refuelStep === 'idle') ? 'white' : 'var(--text-muted)',
                  fontWeight: 700, fontSize: '0.88rem', textAlign: 'center' as const,
                  transition: 'all 0.2s',
                }}>
                  {s.done ? '✓ ' : ''}{s.label}
                </div>
                {i === 0 && <ArrowRight size={18} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />}
              </div>
            ))}
          </div>

          {/* Step 1 — Send empties */}
          {refuelStep === 'idle' && (
            <div className="card">
              <h2 style={{ marginBottom: '4px' }}>Step 1 — Send Empty Cylinders</h2>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.88rem', marginBottom: '16px' }}>
                Record the empty cylinders leaving your location to the supplier for refilling.
              </p>
              <form onSubmit={handleRefuelSend} className="form-stack">
                <div className="grid-2">
                  <label>
                    <span>Cylinder Type</span>
                    <AppSelect ariaLabel="Cylinder type" value={refuelCyl} options={cylinderOptions} onChange={setRefuelCyl} />
                  </label>
                  <label>
                    <span>From Location</span>
                    <AppSelect ariaLabel="From location" value={refuelFromLoc} options={moveLocationOptions} onChange={setRefuelFromLoc} />
                  </label>
                </div>
                <label>
                  <span>Number of Empties Sending</span>
                  <input type="number" min="1" value={refuelQty} onChange={(e) => setRefuelQty(e.target.value)} required placeholder="e.g. 20" />
                </label>
                {refuelErr && <p className="form-error">{refuelErr}</p>}
                <button type="submit" className="btn btn-primary" disabled={refuelSaving}>
                  <ArrowRight size={18} /> {refuelSaving ? 'Recording…' : 'Send to Supplier →'}
                </button>
              </form>
            </div>
          )}

          {/* Step 1 done — success banner + Step 2 */}
          {refuelStep === 'sent' && (
            <>
              <div style={{
                background: 'var(--success-soft, #d1fae5)', border: '1px solid var(--success)',
                borderRadius: '8px', padding: '14px 18px', color: 'var(--success)', fontWeight: 600,
              }}>
                {refuelMsg}
              </div>

              <div className="card">
                <h2 style={{ marginBottom: '4px' }}>Step 2 — Receive Refilled Cylinders</h2>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.88rem', marginBottom: '16px' }}>
                  When the supplier returns the refilled cylinders, record them arriving. You can do this now or later — come back to this tab anytime.
                </p>
                <form onSubmit={handleRefuelReceive} className="form-stack">
                  <div className="grid-2">
                    <label>
                      <span>Cylinder Type</span>
                      <AppSelect ariaLabel="Cylinder type" value={refuelCyl} options={cylinderOptions} onChange={setRefuelCyl} />
                    </label>
                    <label>
                      <span>Receive Into Location</span>
                      <AppSelect ariaLabel="Receive location" value={refuelReceiveLoc} options={moveLocationOptions} onChange={setRefuelReceiveLoc} />
                    </label>
                  </div>
                  <label>
                    <span>Number of Filled Cylinders Received</span>
                    <input type="number" min="1" value={refuelQty} onChange={(e) => setRefuelQty(e.target.value)} required placeholder="e.g. 20" />
                  </label>
                  {refuelErr && <p className="form-error">{refuelErr}</p>}
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button type="submit" className="btn btn-primary" style={{ background: 'var(--success)' }} disabled={refuelSaving}>
                      <Check size={18} /> {refuelSaving ? 'Recording…' : 'Mark Refill Received ✓'}
                    </button>
                    <button type="button" className="btn btn-secondary" onClick={resetRefuel}>
                      Record Later
                    </button>
                  </div>
                </form>
              </div>
            </>
          )}

          {/* Done */}
          {refuelStep === 'done' && (
            <div className="card" style={{ textAlign: 'center', padding: '40px 24px' }}>
              <div style={{ fontSize: '3rem', marginBottom: '12px' }}>🔥</div>
              <h2 style={{ marginBottom: '8px' }}>Refuel Cycle Complete!</h2>
              <p style={{ color: 'var(--text-muted)', marginBottom: '20px' }}>{refuelMsg}</p>
              <button className="btn btn-primary" style={{ width: 'auto', margin: '0 auto', padding: '0 24px' }} onClick={resetRefuel}>
                <Flame size={18} /> Start Another Refuel
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── History ── */}
      {activeTab === 'history' && (
        <div className="card">
          <div style={{ position: 'relative', marginBottom: '16px' }}>
            <Search size={16} style={{ position: 'absolute', left: '10px', top: '14px', color: 'var(--text-muted)' }} />
            <input
              placeholder="Search cylinder, location, staff…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{ paddingLeft: '36px' }}
            />
          </div>
          <div className="ledger-list">
            {filtered.length === 0 && (
              <p style={{ textAlign: 'center', padding: '24px' }}>No movements found.</p>
            )}
            {filtered.map((m) => (
              <div className="ledger-row" key={m.id}>
                <div>
                  <strong>{m.quantity} × {m.cylinder_type_name}
                    <span className="badge" style={{ marginLeft: '8px', fontSize: '0.75rem', verticalAlign: 'middle' }}>
                      {m.status}
                    </span>
                  </strong>
                  <p>
                    {m.from_location_name} → {m.to_location_name}
                    {m.note ? ` · ${m.note}` : ''}
                    {' · '}{new Date(m.created_at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}
                  </p>
                </div>
                <span className="badge">{m.moved_by_name}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
