import { useState, useEffect, useCallback } from 'react';
import type { FormEvent } from 'react';
import { ArrowDownUp, Check, ChevronDown, Factory, Search } from 'lucide-react';
import { api } from '../lib/api';

type Tab = 'movement' | 'new_load' | 'history';
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

  // Movement form
  const [fromLocation, setFromLocation] = useState(0);
  const [toLocation, setToLocation] = useState(0);
  const [moveCyl, setMoveCyl] = useState(0);
  const [moveStatus, setMoveStatus] = useState('filled');
  const [moveQty, setMoveQty] = useState('');
  const [moveMsg, setMoveMsg] = useState('');
  const [moveErr, setMoveErr] = useState('');

  // New Load form
  const [loadCyl, setLoadCyl] = useState(0);
  const [loadQty, setLoadQty] = useState('');
  const [loadTo, setLoadTo] = useState(0);
  const [loadMsg, setLoadMsg] = useState('');
  const [loadErr, setLoadErr] = useState('');
  const [loadSaving, setLoadSaving] = useState(false);

  // History
  const [movements, setMovements] = useState<Movement[]>([]);
  const [searchQuery, setSearchQuery] = useState('');

  // Locations without Supplier for movement dropdowns
  const moveLocations = locations.filter((l) => l.code !== 'supplier');
  // Locations without Supplier for load destination
  const loadLocations = locations.filter((l) => l.code !== 'supplier');
  const moveLocationOptions = moveLocations.map((l) => ({ value: l.id, label: l.name }));
  const loadLocationOptions = loadLocations.map((l) => ({ value: l.id, label: l.name }));
  const cylinderOptions = cylinderTypes.map((t) => ({ value: t.id, label: t.name }));
  const statusOptions: SelectOption<string>[] = [
    { value: 'filled', label: 'Filled' },
    { value: 'empty', label: 'Empty' },
  ];

  // Set defaults once locations/types load
  useEffect(() => {
    const nonSupplier = locations.filter((l) => l.code !== 'supplier');
    if (nonSupplier.length >= 2 && fromLocation === 0) {
      setFromLocation(nonSupplier[1]?.id ?? nonSupplier[0].id);
      setToLocation(nonSupplier[0].id);
      setLoadTo(nonSupplier[1]?.id ?? nonSupplier[0].id);
    }
    if (cylinderTypes.length > 0 && moveCyl === 0) {
      setMoveCyl(cylinderTypes[0].id);
      setLoadCyl(cylinderTypes[0].id);
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
      const stockRes = await api.get('/stock/');
      const rows: { id: number; quantity: number; location: number; cylinder_type: number; status: string }[] =
        stockRes.data.results ?? stockRes.data;

      // Locate empty stock row matching the type at the destination
      const emptyStock = rows.find(
        (r) => r.cylinder_type === loadCyl && r.location === loadTo && r.status === 'empty',
      );
      const emptyQty = emptyStock ? emptyStock.quantity : 0;

      // Prevent Over-Refill: Block if refilling more than available empty cylinders
      if (emptyQty < Number(loadQty)) {
        setLoadErr(`Cannot refill more cylinders than available empty stock. Available empty stock at this location: ${emptyQty}.`);
        setLoadSaving(false);
        return;
      }

      // Deduct empty cylinders at destination
      if (emptyStock) {
        await api.patch(`/stock/${emptyStock.id}/`, { quantity: emptyStock.quantity - Number(loadQty) });
      }

      // Update destination filled stock
      const existing = rows.find(
        (r) => r.cylinder_type === loadCyl && r.location === loadTo && r.status === 'filled',
      );
      if (existing) {
        await api.patch(`/stock/${existing.id}/`, { quantity: existing.quantity + Number(loadQty) });
      } else {
        await api.post('/stock/', {
          cylinder_type: loadCyl, location: loadTo, status: 'filled', quantity: Number(loadQty),
        });
      }

      // Record movement from Supplier (backend skips stock deduction for supplier)
      const supplier = locations.find((l) => l.code === 'supplier');
      if (supplier) {
        await api.post('/movements/', {
          cylinder_type: loadCyl,
          from_location: supplier.id,
          to_location: loadTo,
          status: 'filled',
          quantity: Number(loadQty),
          note: 'New supplier load',
        });
      }

      const locName = locations.find((l) => l.id === loadTo)?.name ?? '';
      const cylName = cylinderTypes.find((c) => c.id === loadCyl)?.name ?? '';
      setLoadMsg(`Added ${loadQty} × ${cylName} (filled) and deducted ${loadQty} (empty) at ${locName}.`);
      setLoadQty('');
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: unknown } })?.response?.data;
      setLoadErr(msg ? JSON.stringify(msg) : 'Failed to save load. Check backend connection.');
    } finally {
      setLoadSaving(false);
    }
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
      style={{ flex: 1, padding: '10px', border: 'none', borderRadius: '6px', fontWeight: 600,
        background: activeTab === tab ? 'var(--surface)' : 'transparent',
        color: activeTab === tab ? 'var(--text)' : 'var(--text-muted)' }}
    >
      {label}
    </button>
  );

  return (
    <div>
      <div className="page-title" style={{ marginBottom: '16px' }}>
        <div>
          <h1>Stock & Load</h1>
          <p>Move cylinders or enter new supplier load.</p>
        </div>
      </div>

      <div style={{ display: 'flex', background: 'var(--border)', borderRadius: '8px', padding: '4px', marginBottom: '16px' }}>
        {tabBtn('movement', 'Movement')}
        {tabBtn('new_load', 'New Load')}
        {tabBtn('history', 'History')}
      </div>

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
                  <strong>{m.quantity} × {m.cylinder_type_name} ({m.status})</strong>
                  <p>{m.from_location_name} → {m.to_location_name} · {new Date(m.created_at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</p>
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
