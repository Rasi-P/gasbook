import React, { useState, useEffect, useCallback } from 'react';
import type { FormEvent } from 'react';
import { ArrowDownUp, ArrowRight, Check, ChevronDown, Factory, Plus, Search, Trash2 } from 'lucide-react';
import { api } from '../lib/api';

type Tab = 'movement' | 'new_load' | 'refuel' | 'history';
type Location = { id: number; name: string; code: string };
type CylinderType = { id: number; name: string };
type RefuelItem = { cylinder_type: number; quantity: string; status?: string };
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
  supplier_pending_after?: number | null;
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
  const [activeTab, setActiveTab] = useState<Tab>('refuel');
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
  const [moveItems, setMoveItems] = useState<RefuelItem[]>([{ cylinder_type: 0, quantity: '', status: 'filled' }]);
  const [moveMsg, setMoveMsg] = useState('');
  const [moveErr, setMoveErr] = useState('');
  const [moveSaving, setMoveSaving] = useState(false);

  // ── New Load form ────────────────────────────────────────────────────────
  const [loadItems, setLoadItems] = useState<RefuelItem[]>([{ cylinder_type: 0, quantity: '' }]);
  const [loadTo, setLoadTo] = useState(0);
  const [loadMsg, setLoadMsg] = useState('');
  const [loadErr, setLoadErr] = useState('');
  const [loadSaving, setLoadSaving] = useState(false);

  // ── Refuel forms ──────────────────────────────────────────────────────────
  const [refuelSendItems, setRefuelSendItems] = useState<RefuelItem[]>([{ cylinder_type: 0, quantity: '' }]);
  const [refuelSendLoc, setRefuelSendLoc] = useState(0);
  const [refuelSendNote, setRefuelSendNote] = useState('');
  const [refuelSendMsg, setRefuelSendMsg] = useState('');
  const [refuelSendErr, setRefuelSendErr] = useState('');
  const [refuelSendSaving, setRefuelSendSaving] = useState(false);

  const [refuelRecvItems, setRefuelRecvItems] = useState<RefuelItem[]>([{ cylinder_type: 0, quantity: '' }]);
  const [refuelRecvLoc, setRefuelRecvLoc] = useState(0);
  const [refuelRecvNote, setRefuelRecvNote] = useState('');
  const [refuelRecvMsg, setRefuelRecvMsg] = useState('');
  const [refuelRecvErr, setRefuelRecvErr] = useState('');
  const [refuelRecvSaving, setRefuelRecvSaving] = useState(false);

  const [justSentItems, setJustSentItems] = useState<RefuelItem[] | null>(null);
  const [supplierPending, setSupplierPending] = useState<{cylinder_type_id: number, cylinder_type_name: string, pending: number}[]>([]);

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

  const fetchSupplierPending = useCallback(() => {
    api.get('/movements/supplier_pending/')
      .then(r => setSupplierPending(r.data))
      .catch(() => undefined);
  }, []);

  // Fetch stock data on mount and whenever tab/selections change
  useEffect(() => {
    fetchStock();
  }, [fetchStock]);

  useEffect(() => {
    if (activeTab === 'refuel' || activeTab === 'movement' || activeTab === 'new_load') fetchStock();
    if (activeTab === 'refuel') fetchSupplierPending();
  }, [activeTab, refuelSendLoc, fromLocation, fetchStock, fetchSupplierPending]);

  // ── History ──────────────────────────────────────────────────────────────
  const [movements, setMovements] = useState<Movement[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [historyFilter, setHistoryFilter] = useState<'all' | 'new_load' | 'refuel_sent' | 'refuel_received'>('all');

  // Derived lists
  const moveLocations = locations.filter((l) => l.code !== 'supplier');
  const moveLocationOptions = moveLocations.map((l) => ({ value: l.id, label: l.name }));
  const loadLocationOptions = moveLocations.map((l) => ({ value: l.id, label: l.name }));
  const cylinderOptions = cylinderTypes.map((t) => ({ value: t.id, label: t.name }));
  const statusOptions: SelectOption<string>[] = [
    { value: 'filled', label: 'Filled' },
    { value: 'empty', label: 'Empty' },
  ];

  const getAvailableOptions = (items: RefuelItem[], currentIndex: number) => {
    const selectedIds = new Set(items.filter((_, i) => i !== currentIndex).map(it => it.cylinder_type));
    return cylinderOptions.filter(opt => !selectedIds.has(opt.value));
  };

  const getNextAvailableId = (items: RefuelItem[]) => {
    const selectedIds = new Set(items.map(it => it.cylinder_type));
    return cylinderTypes.find(t => !selectedIds.has(t.id))?.id ?? 0;
  };

  const getMoveAvailableOptions = (items: RefuelItem[], currentIndex: number) => {
    const currentItem = items[currentIndex];
    const currentStatus = currentItem.status || 'filled';
    const selectedIds = new Set(items.filter((it, i) => i !== currentIndex && (it.status || 'filled') === currentStatus).map(it => it.cylinder_type));
    return cylinderOptions.filter(opt => !selectedIds.has(opt.value));
  };

  const getNextMoveAvailableItem = (items: RefuelItem[]) => {
    for (const t of cylinderTypes) {
      const hasFilled = items.some(it => it.cylinder_type === t.id && (it.status || 'filled') === 'filled');
      const hasEmpty = items.some(it => it.cylinder_type === t.id && it.status === 'empty');
      if (!hasFilled) return { cylinder_type: t.id, status: 'filled' };
      if (!hasEmpty) return { cylinder_type: t.id, status: 'empty' };
    }
    return { cylinder_type: cylinderTypes[0]?.id ?? 0, status: 'filled' };
  };

  const getMoveStatusOptions = (items: RefuelItem[], currentIndex: number) => {
    const currentItem = items[currentIndex];
    const otherStatusesForSameType = new Set(
      items.filter((it, i) => i !== currentIndex && it.cylinder_type === currentItem.cylinder_type).map(it => it.status || 'filled')
    );
    return statusOptions.filter(opt => !otherStatusesForSameType.has(opt.value));
  };

  // Set defaults once data loads
  useEffect(() => {
    const nonSupplier = locations.filter((l) => l.code !== 'supplier');
    if (nonSupplier.length >= 1 && fromLocation === 0) {
      const getInitialLoc = (key: string, fallback: number) => {
        const savedStr = localStorage.getItem(key);
        if (savedStr && nonSupplier.find(l => l.id === Number(savedStr))) {
          return Number(savedStr);
        }
        return fallback;
      };

      const fallbackPrimary = nonSupplier[0].id;
      const fallbackSecondary = nonSupplier.find(l => l.id !== fallbackPrimary)?.id ?? fallbackPrimary;

      setFromLocation(getInitialLoc('lastStockFromLoc', fallbackPrimary));
      setToLocation(getInitialLoc('lastStockToLoc', fallbackSecondary));
      setLoadTo(getInitialLoc('lastStockLoadTo', fallbackPrimary));
      setRefuelSendLoc(getInitialLoc('lastStockRefuelSendLoc', fallbackPrimary));
      setRefuelRecvLoc(getInitialLoc('lastStockRefuelRecvLoc', fallbackPrimary));
    }
    if (cylinderTypes.length > 0) {
      const defaultId = cylinderTypes[0].id;
      setMoveItems(prev => prev.map(item => item.cylinder_type === 0 ? { ...item, cylinder_type: defaultId } : item));
      setLoadItems(prev => prev.map(item => item.cylinder_type === 0 ? { ...item, cylinder_type: defaultId } : item));
      setRefuelSendItems(prev => prev.map(item => item.cylinder_type === 0 ? { ...item, cylinder_type: defaultId } : item));
      setRefuelRecvItems(prev => prev.map(item => item.cylinder_type === 0 ? { ...item, cylinder_type: defaultId } : item));
    }
  }, [locations, cylinderTypes, fromLocation]);

  // Persist location selections
  useEffect(() => { if (fromLocation) localStorage.setItem('lastStockFromLoc', String(fromLocation)); }, [fromLocation]);
  useEffect(() => { if (toLocation) localStorage.setItem('lastStockToLoc', String(toLocation)); }, [toLocation]);
  useEffect(() => { if (loadTo) localStorage.setItem('lastStockLoadTo', String(loadTo)); }, [loadTo]);
  useEffect(() => { if (refuelSendLoc) localStorage.setItem('lastStockRefuelSendLoc', String(refuelSendLoc)); }, [refuelSendLoc]);
  useEffect(() => { if (refuelRecvLoc) localStorage.setItem('lastStockRefuelRecvLoc', String(refuelRecvLoc)); }, [refuelRecvLoc]);

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
          status: item.status || 'filled',
          quantity: Number(item.quantity),
        });
      }

      const summary = validItems.map(item => {
        const name = cylinderTypes.find(c => c.id === item.cylinder_type)?.name ?? '';
        return `${item.quantity}× ${name}`;
      }).join(', ');

      setMoveMsg(`✓ Moved ${summary} cylinders successfully.`);
      setMoveItems([{ cylinder_type: cylinderTypes[0]?.id ?? 0, quantity: '', status: 'filled' }]);
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

  // Refuel: Send Empties
  async function handleRefuelSend(e: FormEvent) {
    e.preventDefault();
    setRefuelSendMsg(''); setRefuelSendErr(''); setRefuelSendSaving(true);
    try {
      const supplier = locations.find((l) => l.code === 'supplier');
      if (!supplier) { setRefuelSendErr('Supplier location not found.'); return; }
      const fromName = locations.find((l) => l.id === refuelSendLoc)?.name ?? '';

      const validItems = refuelSendItems.filter(item => item.cylinder_type > 0 && Number(item.quantity) > 0);
      if (validItems.length === 0) { setRefuelSendErr('Add at least one cylinder type with quantity.'); return; }

      for (const item of validItems) {
        await api.post('/movements/', {
          cylinder_type: item.cylinder_type,
          from_location: refuelSendLoc,
          to_location: supplier.id,
          status: 'empty',
          quantity: parseInt(item.quantity, 10),
          note: 'Sent for refilling' + (refuelSendNote ? ` - ${refuelSendNote}` : '')
        });
      }

      const summary = validItems.map(item => {
        const name = cylinderTypes.find(c => c.id === item.cylinder_type)?.name ?? '';
        return `${item.quantity}× ${name}`;
      }).join(', ');

      setRefuelSendMsg(`✓ Sent ${summary} empty cylinders from ${fromName} to supplier.`);
      setRefuelSendItems([{ cylinder_type: cylinderTypes[0]?.id ?? 0, quantity: '' }]);
      setRefuelSendNote('');
      setJustSentItems(validItems);
      fetchStock();
      fetchSupplierPending();
    } catch (err: any) {
      const detail = err.response?.data?.detail;
      setRefuelSendErr(detail || 'Failed. Check stock levels.');
    } finally {
      setRefuelSendSaving(false);
    }
  }

  async function handleQuickReceive(items: RefuelItem[]) {
    setRefuelRecvMsg(''); setRefuelRecvErr(''); setRefuelRecvSaving(true);
    try {
      const supplier = locations.find((l) => l.code === 'supplier');
      if (!supplier) { setRefuelRecvErr('Supplier location not found.'); return; }
      const toName = locations.find((l) => l.id === refuelRecvLoc)?.name ?? '';

      for (const item of items) {
        await api.post('/movements/', {
          cylinder_type: item.cylinder_type,
          from_location: supplier.id,
          to_location: refuelRecvLoc,
          status: 'filled',
          quantity: Number(item.quantity),
          note: 'Received refilled cylinders',
        });
      }

      setRefuelRecvMsg(`✓ Quick received refilled cylinders at ${toName}.`);
      setJustSentItems(null);
      fetchStock();
      fetchSupplierPending();
    } catch (err: any) {
      const detail = err.response?.data?.detail;
      setRefuelRecvErr(detail || 'Failed to record received stock.');
    } finally {
      setRefuelRecvSaving(false);
    }
  }

  // Refuel: Receive Filled
  async function handleRefuelReceive(e: FormEvent) {
    e.preventDefault();
    setRefuelRecvMsg(''); setRefuelRecvErr(''); setRefuelRecvSaving(true);
    try {
      const supplier = locations.find((l) => l.code === 'supplier');
      if (!supplier) { setRefuelRecvErr('Supplier location not found.'); return; }
      const toName = locations.find((l) => l.id === refuelRecvLoc)?.name ?? '';

      const validItems = refuelRecvItems.filter(item => item.cylinder_type > 0 && Number(item.quantity) > 0);
      if (validItems.length === 0) { setRefuelRecvErr('Add at least one cylinder type with quantity.'); return; }

      for (const item of validItems) {
        await api.post('/movements/', {
          cylinder_type: item.cylinder_type,
          from_location: supplier.id,
          to_location: refuelRecvLoc,
          status: 'filled',
          quantity: parseInt(item.quantity, 10),
          note: 'Received refilled cylinders' + (refuelRecvNote ? ` - ${refuelRecvNote}` : '')
        });
      }

      const summary = validItems.map(item => {
        const name = cylinderTypes.find(c => c.id === item.cylinder_type)?.name ?? '';
        return `${item.quantity}× ${name}`;
      }).join(', ');

      setRefuelRecvMsg(`✓ Received ${summary} refilled cylinders at ${toName}.`);
      setRefuelRecvItems([{ cylinder_type: cylinderTypes[0]?.id ?? 0, quantity: '' }]);
      setRefuelRecvNote('');
      setJustSentItems(null);
      fetchStock();
      fetchSupplierPending();
    } catch (err: any) {
      const detail = err.response?.data?.detail;
      setRefuelRecvErr(detail || 'Failed to record received stock.');
    } finally {
      setRefuelRecvSaving(false);
    }
  }

  const filtered = movements.filter((m) => {
    if (historyFilter === 'new_load' && m.note !== 'New supplier load') return false;
    if (historyFilter === 'refuel_sent' && !m.note.startsWith('Sent for refilling')) return false;
    if (historyFilter === 'refuel_received' && !m.note.startsWith('Received refilled cylinders')) return false;

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
        {tabBtn('refuel', '🔥 Refuel')}
        {tabBtn('movement', 'Movement')}
        {tabBtn('new_load', 'New Load')}
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

            {/* Multi-row items */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {moveItems.map((item, idx) => {
                const srcStock = stockData.find(
                  (s) => s.cylinder_type === item.cylinder_type && s.location === fromLocation && s.status === (item.status || 'filled')
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
                        options={getMoveAvailableOptions(moveItems, idx)}
                        onChange={(v) => setMoveItems(prev => prev.map((it, i) => i === idx ? { ...it, cylinder_type: v } : it))}
                      />
                    </label>
                    <label style={{ flex: 0.8, minWidth: '90px' }}>
                      {idx === 0 && <span style={{ fontSize: '0.82rem', fontWeight: 600 }}>Status</span>}
                      <AppSelect
                        ariaLabel="Status"
                        value={item.status || 'filled'}
                        options={getMoveStatusOptions(moveItems, idx)}
                        onChange={(v) => setMoveItems(prev => prev.map((it, i) => i === idx ? { ...it, status: String(v) } : it))}
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

            {moveItems.length < cylinderTypes.length * 2 && (
              <button
                type="button"
                onClick={() => setMoveItems(prev => {
                  const nextItem = getNextMoveAvailableItem(prev);
                  return [...prev, { cylinder_type: nextItem.cylinder_type, quantity: '', status: nextItem.status }];
                })}
                className="btn btn-secondary"
                style={{ width: 'auto', alignSelf: 'flex-start', padding: '6px 16px', fontSize: '0.85rem' }}
              >
                <Plus size={16} /> Add Cylinder Type
              </button>
            )}

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
                      options={getAvailableOptions(loadItems, idx)}
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

            {loadItems.length < cylinderTypes.length && (
              <button
                type="button"
                onClick={() => setLoadItems(prev => [...prev, { cylinder_type: getNextAvailableId(prev), quantity: '' }])}
                className="btn btn-secondary"
                style={{ width: 'auto', alignSelf: 'flex-start', padding: '6px 16px', fontSize: '0.85rem' }}
              >
                <Plus size={16} /> Add Cylinder Type
              </button>
            )}

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
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
          
          {/* Send Empties */}
          <div className="card form-card">
            <h2 style={{ marginBottom: '4px' }}>Send Empties</h2>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.88rem', marginBottom: '16px' }}>
              Send empty cylinders to the supplier for refilling.
            </p>

            {(() => {
              const emptiesAtLoc = stockData.filter(s => s.location === refuelSendLoc && s.status === 'empty' && s.quantity > 0);
              if (emptiesAtLoc.length > 0) {
                return (
                  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '16px' }}>
                    <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center' }}>Available Empties at Location:</span>
                    {emptiesAtLoc.map((e, i) => {
                      const cName = cylinderTypes.find(c => c.id === e.cylinder_type)?.name || 'Unknown';
                      return (
                        <span key={i} className="badge" style={{ background: 'var(--primary-soft, #e0e7ff)', color: 'var(--primary, #4f46e5)', border: '1px solid var(--primary)' }}>
                          {e.quantity}× {cName}
                        </span>
                      );
                    })}
                  </div>
                );
              }
              return (
                <div style={{ marginBottom: '16px', fontSize: '0.85rem', color: 'var(--success)' }}>
                  ✓ No empty cylinders at this location.
                </div>
              );
            })()}

            <form onSubmit={handleRefuelSend} className="form-stack">
              <label>
                <span>From Location</span>
                <AppSelect ariaLabel="From location" value={refuelSendLoc} options={moveLocationOptions} onChange={setRefuelSendLoc} />
              </label>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {refuelSendItems.map((item, idx) => {
                  const emptyStock = stockData.find(
                    (s) => s.cylinder_type === item.cylinder_type && s.location === refuelSendLoc && s.status === 'empty'
                  );
                  const available = emptyStock?.quantity ?? 0;
                  return (
                    <div key={idx} style={{
                      display: 'flex', gap: '10px', alignItems: 'flex-end',
                      padding: '10px', borderRadius: '10px',
                      background: 'var(--surface-muted)', border: '1px solid var(--border)',
                    }}>
                      <label style={{ flex: 1, minWidth: 0 }}>
                        {idx === 0 && <span style={{ fontSize: '0.82rem', fontWeight: 600 }}>Cylinder Type</span>}
                        <AppSelect
                          ariaLabel="Cylinder type"
                          value={item.cylinder_type}
                          options={getAvailableOptions(refuelSendItems, idx)}
                          onChange={(v) => setRefuelSendItems(prev => prev.map((it, i) => i === idx ? { ...it, cylinder_type: v } : it))}
                        />
                      </label>
                      <label style={{ flex: 0.6, minWidth: '70px' }}>
                        {idx === 0 && <span style={{ fontSize: '0.82rem', fontWeight: 600 }}>Qty</span>}
                        <input
                          type="number" min="1" placeholder="0"
                          value={item.quantity}
                          onChange={(e) => setRefuelSendItems(prev => prev.map((it, i) => i === idx ? { ...it, quantity: e.target.value } : it))}
                          style={{ textAlign: 'center' }}
                        />
                      </label>
                      <div style={{
                        flex: '0 0 auto', minWidth: '60px',
                        padding: '8px', borderRadius: '8px', textAlign: 'center',
                        fontSize: '0.75rem', fontWeight: 700, marginBottom: '2px',
                        background: available > 0 ? 'var(--success-soft, #d1fae5)' : 'var(--danger-soft, #fee2e2)',
                        color: available > 0 ? 'var(--success)' : 'var(--danger, #ef4444)',
                      }}>
                        📦 {available}
                      </div>
                      {refuelSendItems.length > 1 && (
                        <button
                          type="button"
                          onClick={() => setRefuelSendItems(prev => prev.filter((_, i) => i !== idx))}
                          style={{ background: 'none', border: 'none', color: 'var(--danger, #ef4444)', cursor: 'pointer', padding: '6px', marginBottom: '2px' }}
                        >
                          <Trash2 size={16} />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>

              {refuelSendItems.length < cylinderTypes.length && (
                <button
                  type="button"
                  onClick={() => setRefuelSendItems(prev => [...prev, { cylinder_type: getNextAvailableId(prev), quantity: '' }])}
                  className="btn btn-secondary"
                  style={{ width: 'auto', alignSelf: 'flex-start', padding: '6px 16px', fontSize: '0.85rem' }}
                >
                  <Plus size={16} /> Add
                </button>
              )}

              <div style={{ marginTop: '16px' }}>
                <label>Reference Note (Optional)</label>
                <input 
                  type="text" 
                  value={refuelSendNote} 
                  onChange={e => setRefuelSendNote(e.target.value)} 
                  placeholder="e.g. Sent via Driver John" 
                />
              </div>

              {refuelSendErr && <div className="error-text" style={{ marginTop: '16px' }}>{refuelSendErr}</div>}
              {refuelSendMsg && <p className="form-note">{refuelSendMsg}</p>}
              <button type="submit" className="btn btn-primary" style={{ background: 'var(--warning)', color: 'black' }} disabled={refuelSendSaving}>
                <ArrowRight size={18} /> {refuelSendSaving ? 'Sending…' : `Send to Supplier`}
              </button>
            </form>
          </div>

          {/* Receive Refilled */}
          <div className="card form-card">
            <h2 style={{ marginBottom: '4px' }}>Receive Refilled</h2>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.88rem', marginBottom: '16px' }}>
              Record refilled cylinders arriving from the supplier.
            </p>

            {supplierPending.length > 0 && (
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '16px' }}>
                <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center' }}>Pending from Supplier:</span>
                {supplierPending.map((p, i) => (
                  <span key={i} className="badge" style={{ background: 'var(--warning-soft, #fef3c7)', color: 'var(--warning, #d97706)', border: '1px solid var(--warning)' }}>
                    {p.pending}× {p.cylinder_type_name}
                  </span>
                ))}
              </div>
            )}
            {supplierPending.length === 0 && (
              <div style={{ marginBottom: '16px', fontSize: '0.85rem', color: 'var(--success)' }}>
                ✓ No pending refuels from supplier.
              </div>
            )}

            {justSentItems && (
              <div style={{ background: 'var(--primary-soft, #e0e7ff)', padding: '16px', borderRadius: '10px', marginBottom: '16px', border: '1px solid var(--primary)' }}>
                <h3 style={{ margin: '0 0 8px 0', color: 'var(--primary)', fontSize: '0.95rem' }}>Receive them back immediately?</h3>
                <p style={{ margin: '0 0 12px 0', fontSize: '0.85rem' }}>
                  You just sent {justSentItems.map(i => `${i.quantity}× ${cylinderTypes.find(c => c.id === i.cylinder_type)?.name}`).join(', ')}.
                </p>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button type="button" className="btn btn-primary" style={{ padding: '6px 12px', fontSize: '0.85rem', background: '#0284c7' }} onClick={() => handleQuickReceive(justSentItems)} disabled={refuelRecvSaving}>
                    <Check size={16} /> Yes, Receive All Now
                  </button>
                  <button type="button" className="btn btn-secondary" style={{ padding: '6px 12px', fontSize: '0.85rem' }} onClick={() => setJustSentItems(null)}>
                    Record Later
                  </button>
                </div>
              </div>
            )}

            <form onSubmit={handleRefuelReceive} className="form-stack">
              <label>
                <span>Receive Into Location</span>
                <AppSelect ariaLabel="Receive location" value={refuelRecvLoc} options={moveLocationOptions} onChange={setRefuelRecvLoc} />
              </label>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {refuelRecvItems.map((item, idx) => (
                  <div key={idx} style={{
                    display: 'flex', gap: '10px', alignItems: 'flex-end',
                    padding: '10px', borderRadius: '10px',
                    background: 'var(--surface-muted)', border: '1px solid var(--border)',
                  }}>
                    <label style={{ flex: 1, minWidth: 0 }}>
                      {idx === 0 && <span style={{ fontSize: '0.82rem', fontWeight: 600 }}>Cylinder Type</span>}
                      <AppSelect
                        ariaLabel="Cylinder size"
                        value={item.cylinder_type}
                        options={getAvailableOptions(refuelRecvItems, idx)}
                        onChange={(v) => setRefuelRecvItems(prev => prev.map((it, i) => i === idx ? { ...it, cylinder_type: v } : it))}
                      />
                    </label>
                    <label style={{ flex: 0.6, minWidth: '70px' }}>
                      {idx === 0 && <span style={{ fontSize: '0.82rem', fontWeight: 600 }}>Qty</span>}
                      <input
                        type="number" min="1" placeholder="0"
                        value={item.quantity}
                        onChange={(e) => setRefuelRecvItems(prev => prev.map((it, i) => i === idx ? { ...it, quantity: e.target.value } : it))}
                        style={{ textAlign: 'center' }}
                      />
                    </label>
                    {refuelRecvItems.length > 1 && (
                      <button
                        type="button"
                        onClick={() => setRefuelRecvItems(prev => prev.filter((_, i) => i !== idx))}
                        style={{ background: 'none', border: 'none', color: 'var(--danger, #ef4444)', cursor: 'pointer', padding: '6px', marginBottom: '2px' }}
                      >
                        <Trash2 size={16} />
                      </button>
                    )}
                  </div>
                ))}
              </div>

              {refuelRecvItems.length < cylinderTypes.length && (
                <button
                  type="button"
                  onClick={() => setRefuelRecvItems(prev => [...prev, { cylinder_type: getNextAvailableId(prev), quantity: '' }])}
                  className="btn btn-secondary"
                  style={{ width: 'auto', alignSelf: 'flex-start', padding: '6px 16px', fontSize: '0.85rem' }}
                >
                  <Plus size={16} /> Add
                </button>
              )}

              <div style={{ marginTop: '16px' }}>
                <label>Reference Note (Optional)</label>
                <input 
                  type="text" 
                  value={refuelRecvNote} 
                  onChange={e => setRefuelRecvNote(e.target.value)} 
                  placeholder="e.g. Received partial from Monday's batch" 
                />
              </div>

              {refuelRecvErr && <div className="error-text" style={{ marginTop: '16px' }}>{refuelRecvErr}</div>}
              {refuelRecvMsg && <p className="form-note">{refuelRecvMsg}</p>}
              <button type="submit" className="btn btn-primary" style={{ background: '#0284c7' }} disabled={refuelRecvSaving}>
                <Check size={18} /> {refuelRecvSaving ? 'Recording…' : `Receive from Supplier`}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* ── History ── */}
      {activeTab === 'history' && (
        <div className="card">
          <div style={{ display: 'flex', gap: '10px', marginBottom: '16px' }}>
            <div style={{ position: 'relative', flex: 1 }}>
              <Search size={16} style={{ position: 'absolute', left: '10px', top: '14px', color: 'var(--text-muted)' }} />
              <input
                placeholder="Search cylinder, location, staff…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                style={{ paddingLeft: '36px' }}
              />
            </div>
            <select
              value={historyFilter}
              onChange={(e) => setHistoryFilter(e.target.value as any)}
              style={{ width: '200px', padding: '10px', borderRadius: '6px', border: '1px solid var(--border)', background: 'var(--surface)', cursor: 'pointer' }}
            >
              <option value="all">All Movements</option>
              <option value="new_load">New Loads</option>
              <option value="refuel_sent">Refuel Sent</option>
              <option value="refuel_received">Refuel Received</option>
            </select>
          </div>
          <div className="ledger-list">
            {filtered.length === 0 && (
              <p style={{ textAlign: 'center', padding: '24px' }}>No movements found.</p>
            )}
            {filtered.map((m) => (
              <div className="ledger-row" key={m.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div style={{ flex: 1 }}>
                  <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '8px' }}>
                    <strong>{m.quantity} × {m.cylinder_type_name}</strong>
                    
                    {/* Beautiful Status Badge */}
                    <span style={{ 
                      padding: '2px 8px', 
                      borderRadius: '12px', 
                      fontSize: '0.7rem', 
                      fontWeight: 600, 
                      textTransform: 'uppercase',
                      letterSpacing: '0.5px',
                      background: m.status === 'filled' ? 'var(--success-soft)' : 'var(--surface)',
                      color: m.status === 'filled' ? 'var(--success)' : 'var(--text-muted)',
                      border: `1px solid ${m.status === 'filled' ? 'var(--success)' : 'var(--border)'}`
                    }}>
                      {m.status}
                    </span>
                    
                    {m.note === 'New supplier load' && <span className="badge" style={{ fontSize: '0.75rem', background: 'var(--success-soft)', color: 'var(--success)' }}>New Load</span>}
                    {m.note.startsWith('Sent for refilling') && <span className="badge" style={{ fontSize: '0.75rem', background: 'var(--warning-soft, #fff7ed)', color: 'var(--warning, #c2410c)', border: '1px solid var(--warning)' }}>🔥 Refuel Sent</span>}
                    {m.note.startsWith('Received refilled cylinders') && <span className="badge" style={{ fontSize: '0.75rem', background: 'var(--info-soft, #eff6ff)', color: 'var(--info, #1d4ed8)', border: '1px solid var(--info)' }}>🔥 Refuel Received</span>}
                    
                    {m.supplier_pending_after !== undefined && m.supplier_pending_after !== null && (
                      <span className="badge" style={{ fontSize: '0.75rem', background: 'var(--surface)', color: 'var(--text-muted)', border: '1px solid var(--border)' }}>
                        <strong style={{ marginRight: '4px', color: m.supplier_pending_after > 0 ? 'var(--warning, #d97706)' : 'var(--success)' }}>{m.supplier_pending_after}</strong>owed
                      </span>
                    )}
                  </div>
                  <p style={{ marginTop: '8px', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
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
