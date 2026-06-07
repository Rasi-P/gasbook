import React, { useState, useEffect, useCallback } from 'react';
import type { FormEvent } from 'react';
import { ArrowDownUp, ArrowRight, Check, ChevronDown, Factory, Flame, Plus, Search, Trash2 } from 'lucide-react';
import { api } from '../lib/api';

type Tab = 'movement' | 'new_load' | 'refuel' | 'history';
type Location = { id: number; name: string; code: string };
type CylinderType = { id: number; name: string };
type RefuelItem = { cylinder_type: number; quantity: string };
type StockRow = { id: number; cylinder_type: number; location: number; status: string; quantity: number; cylinder_type_name: string; location_name: string };
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
  const [openUp, setOpenUp] = useState(false);
  const triggerRef = React.useRef<HTMLButtonElement>(null);
  const selected = options.find((option) => option.value === value) ?? options[0];

  const handleOpen = () => {
    setOpen((current) => {
      if (!current && triggerRef.current) {
        const rect = triggerRef.current.getBoundingClientRect();
        const spaceBelow = window.innerHeight - rect.bottom;
        setOpenUp(spaceBelow < 220);
      }
      return !current;
    });
  };

  return (
    <div className="app-select" onBlur={() => setOpen(false)}>
      <button
        ref={triggerRef}
        aria-expanded={open}
        aria-label={ariaLabel}
        className="app-select-trigger"
        onClick={handleOpen}
        type="button"
      >
        <span>{selected?.label ?? 'Select'}</span>
        <ChevronDown size={18} />
      </button>
      {open && (
        <div className={`app-select-menu ${openUp ? 'open-up' : ''}`} role="listbox">
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
  const [moveItems, setMoveItems] = useState<RefuelItem[]>([{ cylinder_type: 0, quantity: '' }]);
  const [moveStatus, setMoveStatus] = useState('filled');
  const [moveMsg, setMoveMsg] = useState('');
  const [moveErr, setMoveErr] = useState('');
  const [moveSaving, setMoveSaving] = useState(false);

  // ── New Load form ────────────────────────────────────────────────────────
  const [loadItems, setLoadItems] = useState<RefuelItem[]>([{ cylinder_type: 0, quantity: '' }]);
  const [loadTo, setLoadTo] = useState(0);
  const [loadMsg, setLoadMsg] = useState('');
  const [loadErr, setLoadErr] = useState('');
  const [loadSaving, setLoadSaving] = useState(false);

  // ── Refuel form ──────────────────────────────────────────────────────────
  const [refuelItems, setRefuelItems] = useState<RefuelItem[]>([{ cylinder_type: 0, quantity: '' }]);
  const [refuelFromLoc, setRefuelFromLoc] = useState(0);  // where empties currently are
  const [refuelReceiveLoc, setRefuelReceiveLoc] = useState(0); // where to receive filled
  const [refuelStep, setRefuelStep] = useState<'idle' | 'sent' | 'done'>('idle');
  const [refuelMsg, setRefuelMsg] = useState('');
  const [refuelErr, setRefuelErr] = useState('');
  const [refuelSaving, setRefuelSaving] = useState(false);
  const [refuelSentItems, setRefuelSentItems] = useState<RefuelItem[]>([]); // remember what was sent for step 2

  // ── Stock data (for showing available empties) ──────────────────────────
  const [stockData, setStockData] = useState<StockRow[]>([]);

  const fetchStock = useCallback(() => {
    api.get('/stock/')
      .then((r) => {
        const data = r.data.results ?? r.data;
        setStockData(Array.isArray(data) ? data : []);
      })
      .catch(() => undefined);
  }, []);

  // Fetch stock data on mount and whenever tab/selections change
  useEffect(() => {
    fetchStock();
  }, [fetchStock]);

  useEffect(() => {
    if (activeTab === 'refuel' || activeTab === 'movement' || activeTab === 'new_load') fetchStock();
  }, [activeTab, refuelFromLoc, fromLocation, fetchStock]);

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
    if (cylinderTypes.length > 0) {
      const defaultId = cylinderTypes[0].id;
      setMoveItems(prev => prev.map(item => item.cylinder_type === 0 ? { ...item, cylinder_type: defaultId } : item));
      setLoadItems(prev => prev.map(item => item.cylinder_type === 0 ? { ...item, cylinder_type: defaultId } : item));
      setRefuelItems(prev => prev.map(item => item.cylinder_type === 0 ? { ...item, cylinder_type: defaultId } : item));
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
    setMoveMsg(''); setMoveErr(''); setMoveSaving(true);
    try {
      const validItems = moveItems.filter(item => item.cylinder_type > 0 && Number(item.quantity) > 0);
      if (validItems.length === 0) { setMoveErr('Add at least one cylinder type with quantity.'); return; }

      for (const item of validItems) {
        await api.post('/movements/', {
          cylinder_type: item.cylinder_type,
          from_location: fromLocation,
          to_location: toLocation,
          status: moveStatus,
          quantity: Number(item.quantity),
        });
      }

      const summary = validItems.map(item => {
        const name = cylinderTypes.find(c => c.id === item.cylinder_type)?.name ?? '';
        return `${item.quantity}× ${name}`;
      }).join(', ');

      setMoveMsg(`✓ Moved ${summary} ${moveStatus} cylinders successfully.`);
      setMoveItems([{ cylinder_type: cylinderTypes[0]?.id ?? 0, quantity: '' }]);
      fetchStock();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: unknown } })?.response?.data;
      setMoveErr(msg ? JSON.stringify(msg) : 'Movement failed. Check stock levels.');
    } finally {
      setMoveSaving(false);
    }
  }

  async function handleNewLoad(e: FormEvent) {
    e.preventDefault();
    setLoadMsg(''); setLoadErr('');
    setLoadSaving(true);
    try {
      const supplier = locations.find((l) => l.code === 'supplier');
      if (!supplier) { setLoadErr('Supplier location not found.'); return; }

      const validItems = loadItems.filter(item => item.cylinder_type > 0 && Number(item.quantity) > 0);
      if (validItems.length === 0) { setLoadErr('Add at least one cylinder type with quantity.'); return; }

      for (const item of validItems) {
        await api.post('/movements/', {
          cylinder_type: item.cylinder_type,
          from_location: supplier.id,
          to_location: loadTo,
          status: 'filled',
          quantity: Number(item.quantity),
          note: 'New supplier load',
        });
      }

      const locName = locations.find((l) => l.id === loadTo)?.name ?? '';
      const summary = validItems.map(item => {
        const name = cylinderTypes.find(c => c.id === item.cylinder_type)?.name ?? '';
        return `${item.quantity}× ${name}`;
      }).join(', ');

      setLoadMsg(`✓ Added ${summary} filled cylinders to ${locName}.`);
      setLoadItems([{ cylinder_type: cylinderTypes[0]?.id ?? 0, quantity: '' }]);
      fetchStock();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: unknown } })?.response?.data;
      setLoadErr(msg ? JSON.stringify(msg) : 'Failed to save load. Check backend connection.');
    } finally {
      setLoadSaving(false);
    }
  }

  // Step 1 of Refuel: send empties to supplier (multiple types)
  async function handleRefuelSend(e: FormEvent) {
    e.preventDefault();
    setRefuelMsg(''); setRefuelErr(''); setRefuelSaving(true);
    try {
      const supplier = locations.find((l) => l.code === 'supplier');
      if (!supplier) { setRefuelErr('Supplier location not found.'); return; }
      const fromName = locations.find((l) => l.id === refuelFromLoc)?.name ?? '';

      const validItems = refuelItems.filter(item => item.cylinder_type > 0 && Number(item.quantity) > 0);
      if (validItems.length === 0) { setRefuelErr('Add at least one cylinder type with quantity.'); return; }

      // Send all items sequentially
      for (const item of validItems) {
        await api.post('/movements/', {
          cylinder_type: item.cylinder_type,
          from_location: refuelFromLoc,
          to_location: supplier.id,
          status: 'empty',
          quantity: Number(item.quantity),
          note: 'Sent for refilling',
        });
      }

      const summary = validItems.map(item => {
        const name = cylinderTypes.find(c => c.id === item.cylinder_type)?.name ?? '';
        return `${item.quantity}× ${name}`;
      }).join(', ');

      setRefuelMsg(`✓ Sent ${summary} empty cylinders from ${fromName} to supplier for refilling.`);
      setRefuelSentItems(validItems);
      setRefuelStep('sent');
      fetchStock();
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: unknown } })?.response?.data;
      setRefuelErr(msg ? JSON.stringify(msg) : 'Failed. Check stock levels.');
    } finally {
      setRefuelSaving(false);
    }
  }

  // Step 2 of Refuel: receive filled cylinders back (multiple types)
  async function handleRefuelReceive(e: FormEvent) {
    e.preventDefault();
    setRefuelErr(''); setRefuelSaving(true);
    try {
      const supplier = locations.find((l) => l.code === 'supplier');
      if (!supplier) { setRefuelErr('Supplier location not found.'); return; }
      const toLoc = locations.find((l) => l.id === refuelReceiveLoc)?.name ?? '';

      const validItems = refuelSentItems.filter(item => item.cylinder_type > 0 && Number(item.quantity) > 0);

      for (const item of validItems) {
        await api.post('/movements/', {
          cylinder_type: item.cylinder_type,
          from_location: supplier.id,
          to_location: refuelReceiveLoc,
          status: 'filled',
          quantity: Number(item.quantity),
          note: 'Received refilled cylinders',
        });
      }

      const summary = validItems.map(item => {
        const name = cylinderTypes.find(c => c.id === item.cylinder_type)?.name ?? '';
        return `${item.quantity}× ${name}`;
      }).join(', ');

      setRefuelMsg(`✓ All done! ${summary} filled cylinders received at ${toLoc}.`);
      setRefuelStep('done');
      fetchStock();
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
    setRefuelItems([{ cylinder_type: cylinderTypes[0]?.id ?? 0, quantity: '' }]);
    setRefuelSentItems([]);
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
          <h2 style={{ marginBottom: '4px' }}>Move Cylinders</h2>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.88rem', marginBottom: '16px' }}>
            Transfer cylinders between your locations.
          </p>
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

            <label>
              <span>Status</span>
              <AppSelect ariaLabel="Cylinder status" value={moveStatus} options={statusOptions} onChange={setMoveStatus} />
            </label>

            {/* Multi-row items */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {moveItems.map((item, idx) => {
                const srcStock = stockData.find(
                  (s) => s.cylinder_type === item.cylinder_type && s.location === fromLocation && s.status === moveStatus
                );
                const available = srcStock?.quantity ?? 0;
                return (
                  <div key={idx} style={{
                    display: 'flex', gap: '10px', alignItems: 'flex-end',
                    padding: '14px', borderRadius: '10px',
                    background: 'var(--surface-muted)', border: '1px solid var(--border)',
                  }}>
                    <label style={{ flex: 1, minWidth: 0 }}>
                      {idx === 0 && <span style={{ fontSize: '0.82rem', fontWeight: 600 }}>Cylinder</span>}
                      <AppSelect
                        ariaLabel="Cylinder type"
                        value={item.cylinder_type}
                        options={cylinderOptions}
                        onChange={(v) => setMoveItems(prev => prev.map((it, i) => i === idx ? { ...it, cylinder_type: v } : it))}
                      />
                    </label>
                    <label style={{ flex: 0.6, minWidth: '90px' }}>
                      {idx === 0 && <span style={{ fontSize: '0.82rem', fontWeight: 600 }}>Qty</span>}
                      <input
                        type="number" min="1" placeholder="0"
                        value={item.quantity}
                        onChange={(e) => setMoveItems(prev => prev.map((it, i) => i === idx ? { ...it, quantity: e.target.value } : it))}
                        style={{ textAlign: 'center' }}
                      />
                    </label>
                    <div style={{
                      flex: '0 0 auto', minWidth: '80px',
                      padding: '8px 10px', borderRadius: '8px', textAlign: 'center',
                      fontSize: '0.8rem', fontWeight: 700, marginBottom: '2px',
                      background: available > 0 ? 'var(--success-soft, #d1fae5)' : 'var(--danger-soft, #fee2e2)',
                      color: available > 0 ? 'var(--success)' : 'var(--danger, #ef4444)',
                    }}>
                      {available > 0 ? `📦 ${available}` : '⚠️ 0'}
                    </div>
                    {moveItems.length > 1 && (
                      <button
                        type="button"
                        onClick={() => setMoveItems(prev => prev.filter((_, i) => i !== idx))}
                        style={{
                          background: 'none', border: 'none', color: 'var(--danger, #ef4444)',
                          cursor: 'pointer', padding: '6px', marginBottom: '2px',
                        }}
                        title="Remove"
                      >
                        <Trash2 size={16} />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>

            <button
              type="button"
              onClick={() => setMoveItems(prev => [...prev, { cylinder_type: cylinderTypes[0]?.id ?? 0, quantity: '' }])}
              className="btn btn-secondary"
              style={{ width: 'auto', alignSelf: 'flex-start', padding: '6px 16px', fontSize: '0.85rem' }}
            >
              <Plus size={16} /> Add Cylinder Type
            </button>

            {moveErr && <p className="form-error">{moveErr}</p>}
            {moveMsg && <p className="form-note">{moveMsg}</p>}

            <button type="submit" className="btn btn-primary" disabled={moveSaving}>
              <ArrowDownUp size={18} /> {moveSaving ? 'Moving…' : `Move ${moveItems.filter(i => Number(i.quantity) > 0).length} type(s)`}
            </button>
          </form>
        </div>
      )}

      {/* ── New Load ── */}
      {activeTab === 'new_load' && (
        <div className="card form-card">
          <h2 style={{ marginBottom: '4px' }}>Record New Load</h2>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.88rem', marginBottom: '16px' }}>
            Record filled cylinders arriving from the supplier.
          </p>
          <form onSubmit={handleNewLoad} className="form-stack">
            <label>
              <span>Load Into Location</span>
              <AppSelect ariaLabel="Load destination" value={loadTo} options={loadLocationOptions} onChange={setLoadTo} />
            </label>

            {/* Multi-row items */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {loadItems.map((item, idx) => (
                <div key={idx} style={{
                  display: 'flex', gap: '10px', alignItems: 'flex-end',
                  padding: '14px', borderRadius: '10px',
                  background: 'var(--surface-muted)', border: '1px solid var(--border)',
                }}>
                  <label style={{ flex: 1, minWidth: 0 }}>
                    {idx === 0 && <span style={{ fontSize: '0.82rem', fontWeight: 600 }}>Cylinder Type</span>}
                    <AppSelect
                      ariaLabel="Cylinder size"
                      value={item.cylinder_type}
                      options={cylinderOptions}
                      onChange={(v) => setLoadItems(prev => prev.map((it, i) => i === idx ? { ...it, cylinder_type: v } : it))}
                    />
                  </label>
                  <label style={{ flex: 0.6, minWidth: '90px' }}>
                    {idx === 0 && <span style={{ fontSize: '0.82rem', fontWeight: 600 }}>Qty</span>}
                    <input
                      type="number" min="1" placeholder="0"
                      value={item.quantity}
                      onChange={(e) => setLoadItems(prev => prev.map((it, i) => i === idx ? { ...it, quantity: e.target.value } : it))}
                      style={{ textAlign: 'center' }}
                    />
                  </label>
                  {loadItems.length > 1 && (
                    <button
                      type="button"
                      onClick={() => setLoadItems(prev => prev.filter((_, i) => i !== idx))}
                      style={{
                        background: 'none', border: 'none', color: 'var(--danger, #ef4444)',
                        cursor: 'pointer', padding: '6px', marginBottom: '2px',
                      }}
                      title="Remove"
                    >
                      <Trash2 size={16} />
                    </button>
                  )}
                </div>
              ))}
            </div>

            <button
              type="button"
              onClick={() => setLoadItems(prev => [...prev, { cylinder_type: cylinderTypes[0]?.id ?? 0, quantity: '' }])}
              className="btn btn-secondary"
              style={{ width: 'auto', alignSelf: 'flex-start', padding: '6px 16px', fontSize: '0.85rem' }}
            >
              <Plus size={16} /> Add Cylinder Type
            </button>

            {loadErr && <p className="form-error">{loadErr}</p>}
            {loadMsg && <p className="form-note">{loadMsg}</p>}

            <button type="submit" className="btn btn-primary" style={{ background: 'var(--success)' }} disabled={loadSaving}>
              <Factory size={20} /> {loadSaving ? 'Saving…' : `Save ${loadItems.filter(i => Number(i.quantity) > 0).length} type(s)`}
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

          {/* Step 1 — Send empties (multi-row) */}
          {refuelStep === 'idle' && (
            <div className="card">
              <h2 style={{ marginBottom: '4px' }}>Step 1 — Send Empty Cylinders</h2>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.88rem', marginBottom: '16px' }}>
                Record the empty cylinders leaving your location to the supplier for refilling.
              </p>
              <form onSubmit={handleRefuelSend} className="form-stack">
                <label>
                  <span>From Location</span>
                  <AppSelect ariaLabel="From location" value={refuelFromLoc} options={moveLocationOptions} onChange={setRefuelFromLoc} />
                </label>

                {/* Multi-row items */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  {refuelItems.map((item, idx) => {
                    const emptyStock = stockData.find(
                      (s) => s.cylinder_type === item.cylinder_type && s.location === refuelFromLoc && s.status === 'empty'
                    );
                    const available = emptyStock?.quantity ?? 0;
                    return (
                      <div key={idx} style={{
                        display: 'flex', gap: '10px', alignItems: 'flex-end',
                        padding: '14px', borderRadius: '10px',
                        background: 'var(--surface-muted)', border: '1px solid var(--border)',
                      }}>
                        <label style={{ flex: 1, minWidth: 0 }}>
                          {idx === 0 && <span style={{ fontSize: '0.82rem', fontWeight: 600 }}>Cylinder Type</span>}
                          <AppSelect
                            ariaLabel="Cylinder type"
                            value={item.cylinder_type}
                            options={cylinderOptions}
                            onChange={(v) => setRefuelItems(prev => prev.map((it, i) => i === idx ? { ...it, cylinder_type: v } : it))}
                          />
                        </label>
                        <label style={{ flex: 0.6, minWidth: '90px' }}>
                          {idx === 0 && <span style={{ fontSize: '0.82rem', fontWeight: 600 }}>Qty</span>}
                          <input
                            type="number" min="1" placeholder="0"
                            value={item.quantity}
                            onChange={(e) => setRefuelItems(prev => prev.map((it, i) => i === idx ? { ...it, quantity: e.target.value } : it))}
                            style={{ textAlign: 'center' }}
                          />
                        </label>
                        <div style={{
                          flex: '0 0 auto', minWidth: '80px',
                          padding: '8px 10px', borderRadius: '8px', textAlign: 'center',
                          fontSize: '0.8rem', fontWeight: 700, marginBottom: '2px',
                          background: available > 0 ? 'var(--success-soft, #d1fae5)' : 'var(--danger-soft, #fee2e2)',
                          color: available > 0 ? 'var(--success)' : 'var(--danger, #ef4444)',
                        }}>
                          {available > 0 ? `📦 ${available} avail` : '⚠️ 0'}
                        </div>
                        {refuelItems.length > 1 && (
                          <button
                            type="button"
                            onClick={() => setRefuelItems(prev => prev.filter((_, i) => i !== idx))}
                            style={{
                              background: 'none', border: 'none', color: 'var(--danger, #ef4444)',
                              cursor: 'pointer', padding: '6px', marginBottom: '2px',
                            }}
                            title="Remove"
                          >
                            <Trash2 size={16} />
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>

                <button
                  type="button"
                  onClick={() => setRefuelItems(prev => [...prev, { cylinder_type: cylinderTypes[0]?.id ?? 0, quantity: '' }])}
                  className="btn btn-secondary"
                  style={{ width: 'auto', alignSelf: 'flex-start', padding: '6px 16px', fontSize: '0.85rem' }}
                >
                  <Plus size={16} /> Add Cylinder Type
                </button>

                {refuelErr && <p className="form-error">{refuelErr}</p>}
                <button type="submit" className="btn btn-primary" disabled={refuelSaving}>
                  <ArrowRight size={18} /> {refuelSaving ? 'Sending…' : `Send ${refuelItems.filter(i => Number(i.quantity) > 0).length} type(s) to Supplier →`}
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
                  When the supplier returns the refilled cylinders, record them arriving. You can do this now or later.
                </p>

                {/* Show what was sent as a summary */}
                <div style={{
                  display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '16px',
                }}>
                  {refuelSentItems.map((item, idx) => {
                    const name = cylinderTypes.find(c => c.id === item.cylinder_type)?.name ?? '';
                    return (
                      <div key={idx} style={{
                        padding: '8px 14px', borderRadius: '8px',
                        background: 'var(--primary-soft, #e0e7ff)',
                        color: 'var(--primary)', fontWeight: 700, fontSize: '0.88rem',
                      }}>
                        {item.quantity}× {name}
                      </div>
                    );
                  })}
                </div>

                <form onSubmit={handleRefuelReceive} className="form-stack">
                  <label>
                    <span>Receive Into Location</span>
                    <AppSelect ariaLabel="Receive location" value={refuelReceiveLoc} options={moveLocationOptions} onChange={setRefuelReceiveLoc} />
                  </label>
                  {refuelErr && <p className="form-error">{refuelErr}</p>}
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <button type="submit" className="btn btn-primary" style={{ background: 'var(--success)' }} disabled={refuelSaving}>
                      <Check size={18} /> {refuelSaving ? 'Recording…' : 'Mark All Received ✓'}
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
