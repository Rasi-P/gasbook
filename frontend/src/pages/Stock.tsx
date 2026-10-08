import { useState, useEffect, useCallback } from 'react';
import type { FormEvent } from 'react';
import { AlertTriangle, ArrowDownLeft, ArrowDownUp, ArrowRight, ArrowUpRight, Check, CheckCircle2, Factory, History, Package, Plus, Trash2, User } from 'lucide-react';
import { api, extractApiError, fetchAllPages } from '../lib/api';
import { AppSelect, type SelectOption } from '../components/ui/AppSelect';
import { ErrorState, LoadingState } from '../components/AsyncState';
import { Pager } from '../components/Pager';
import { usePager } from '../hooks/usePager';
import { Alert } from '../components/ui/Alert';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Card, CardFooter, CardHeader } from '../components/ui/Card';
import { EmptyState } from '../components/ui/EmptyState';
import { Field, Input, Select } from '../components/ui/Field';
import { IconButton } from '../components/ui/IconButton';
import { PageHeader } from '../components/ui/PageHeader';
import { SearchInput } from '../components/ui/SearchInput';
import { SkeletonRows } from '../components/ui/Skeleton';
import { Tabs } from '../components/ui/Tabs';

type Tab = 'movement' | 'new_load' | 'refuel' | 'history';
type Location = { id: number; name: string; code: string };
type CylinderType = { id: number; name: string };
type RefuelItem = { cylinder_type: number; quantity: string; status?: string };
type StockRow = { id: number; cylinder_type: number; location: number; status: string; quantity: number; cylinder_type_name: string; location_name: string };
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

export default function Stock() {
  const [activeTab, setActiveTab] = useState<Tab>('refuel');
  const [locations, setLocations] = useState<Location[]>([]);
  const [cylinderTypes, setCylinderTypes] = useState<CylinderType[]>([]);
  const [refStatus, setRefStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [refError, setRefError] = useState('');

  const loadReferenceData = useCallback(() => {
    Promise.all([fetchAllPages<Location>('/locations/'), fetchAllPages<CylinderType>('/cylinder-types/')])
      .then(([locs, types]) => {
        setLocations(locs);
        setCylinderTypes(types);
        setRefError('');
        setRefStatus('ready');
      })
      .catch((err) => {
        setRefError(extractApiError(err, [], 'Could not load locations and cylinder types.'));
        setRefStatus('error');
      });
  }, []);

  useEffect(() => { loadReferenceData(); }, [loadReferenceData]);

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
  const [stockError, setStockError] = useState('');
  const [supplierPendingError, setSupplierPendingError] = useState('');

  const fetchStock = useCallback(() => {
    fetchAllPages<StockRow>('/stock/')
      .then((rows) => {
        setStockData(rows);
        setStockError('');
      })
      .catch((err) => setStockError(extractApiError(err, [], 'Stock levels unavailable.')));
  }, []);

  const fetchSupplierPending = useCallback(() => {
    api.get('/movements/supplier_pending/')
      .then((r) => {
        setSupplierPending(Array.isArray(r.data) ? r.data : []);
        setSupplierPendingError('');
      })
      .catch((err) => setSupplierPendingError(extractApiError(err, [], 'Pending refuels unavailable.')));
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
  const [historyStatus, setHistoryStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [historyError, setHistoryError] = useState('');
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
    fetchAllPages<Movement>('/movements/')
      .then((rows) => {
        setMovements(rows);
        setHistoryError('');
        setHistoryStatus('ready');
      })
      .catch((err) => {
        setHistoryError(extractApiError(err, [], 'Could not load movement history.'));
        setHistoryStatus('error');
      });
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
      setMoveErr(extractApiError(err, ['quantity', 'cylinder_type', 'from_location', 'to_location', 'status', 'non_field_errors'], 'Movement failed. Check stock levels.'));
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
      setLoadErr(extractApiError(err, ['quantity', 'cylinder_type', 'from_location', 'to_location', 'status', 'non_field_errors'], 'Failed to save load. Check backend connection.'));
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
    } catch (err: unknown) {
      setRefuelSendErr(extractApiError(err, ['quantity', 'cylinder_type', 'from_location', 'to_location', 'non_field_errors'], 'Failed. Check stock levels.'));
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
    } catch (err: unknown) {
      setRefuelRecvErr(extractApiError(err, ['quantity', 'cylinder_type', 'from_location', 'to_location', 'non_field_errors'], 'Failed to record received stock.'));
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
    } catch (err: unknown) {
      setRefuelRecvErr(extractApiError(err, ['quantity', 'cylinder_type', 'from_location', 'to_location', 'non_field_errors'], 'Failed to record received stock.'));
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

  const historyPager = usePager(filtered, 10, `${searchQuery}|${historyFilter}`);

  return (
    <div>
      <PageHeader title="Stock &amp; Load" description="Move cylinders, enter new loads, or record refuel cycles." />

      <Tabs
        ariaLabel="Stock sections"
        variant="tabs"
        className="page-tabs"
        value={activeTab}
        onChange={setActiveTab}
        items={[
          { value: 'refuel', label: 'Refuel' },
          { value: 'movement', label: 'Movement' },
          { value: 'new_load', label: 'New Load' },
          { value: 'history', label: 'History' },
        ]}
      />

      {refStatus === 'error' && activeTab !== 'history' && (
        <ErrorState message={refError} onRetry={() => { setRefStatus('loading'); loadReferenceData(); }} />
      )}
      {refStatus === 'loading' && activeTab !== 'history' && <LoadingState label="Loading stock setup…" />}
      {stockError && refStatus === 'ready' && activeTab !== 'history' && (
        <Alert
          tone="danger"
          role="alert"
          className="ui-alert--block-sm"
          actions={<Button type="button" variant="link" size="sm" onClick={fetchStock}>Retry</Button>}
        >
          {stockError}
        </Alert>
      )}

      {/* ── Movement ── */}
      {activeTab === 'movement' && refStatus === 'ready' && (
        <Card className="stock-card">
          <CardHeader title="Move Cylinders" description="Transfer cylinders between your locations." />
          <form onSubmit={handleMovement} className="form-stack">
            <div className="move-grid">
              <Field label="From">
                <AppSelect ariaLabel="From location" value={fromLocation} options={moveLocationOptions} onChange={setFromLocation} />
              </Field>
              <IconButton type="button" variant="outline" label="Swap locations" className="swap-button" onClick={swapLocations}>
                <ArrowDownUp size={20} />
              </IconButton>
              <Field label="To">
                <AppSelect ariaLabel="To location" value={toLocation} options={moveLocationOptions} onChange={setToLocation} />
              </Field>
            </div>

            {/* Multi-row items */}
            <div className="stock-rows">
              {moveItems.map((item, idx) => {
                const srcStock = stockData.find(
                  (s) => s.cylinder_type === item.cylinder_type && s.location === fromLocation && s.status === (item.status || 'filled')
                );
                const available = srcStock?.quantity ?? 0;
                return (
                  <div key={idx} className="stock-item-row">
                    <Field label={idx === 0 ? 'Cylinder' : undefined}>
                      <AppSelect
                        ariaLabel="Cylinder type"
                        value={item.cylinder_type}
                        options={getMoveAvailableOptions(moveItems, idx)}
                        onChange={(v) => setMoveItems(prev => prev.map((it, i) => i === idx ? { ...it, cylinder_type: v } : it))}
                      />
                    </Field>
                    <Field label={idx === 0 ? 'Status' : undefined}>
                      <AppSelect
                        ariaLabel="Status"
                        value={item.status || 'filled'}
                        options={getMoveStatusOptions(moveItems, idx)}
                        onChange={(v) => setMoveItems(prev => prev.map((it, i) => i === idx ? { ...it, status: String(v) } : it))}
                      />
                    </Field>
                    <Field label={idx === 0 ? 'Qty' : undefined}>
                      <Input
                        type="number" min="1" placeholder="0"
                        className="stock-num"
                        value={item.quantity}
                        onChange={(e) => setMoveItems(prev => prev.map((it, i) => i === idx ? { ...it, quantity: e.target.value } : it))}
                      />
                    </Field>
                    <StockAvailability error={Boolean(stockError)} available={available} warnWhenZero />
                    {moveItems.length > 1 && (
                      <IconButton type="button" label="Remove" tone="danger" className="stock-item-row__remove" onClick={() => setMoveItems(prev => prev.filter((_, i) => i !== idx))}>
                        <Trash2 size={16} />
                      </IconButton>
                    )}
                  </div>
                );
              })}
            </div>

            {moveItems.length < cylinderTypes.length * 2 && (
              <div>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  icon={<Plus />}
                  onClick={() => setMoveItems(prev => {
                    const nextItem = getNextMoveAvailableItem(prev);
                    return [...prev, { cylinder_type: nextItem.cylinder_type, quantity: '', status: nextItem.status }];
                  })}
                >
                  Add Cylinder Type
                </Button>
              </div>
            )}

            {moveErr && <Alert tone="danger">{moveErr}</Alert>}
            {moveMsg && <Alert tone="success">{moveMsg}</Alert>}

            <div className="stock-submit">
              <Button type="submit" size="lg" icon={<ArrowDownUp />} disabled={moveSaving}>
                {moveSaving ? 'Moving…' : `Move ${moveItems.filter(i => Number(i.quantity) > 0).length} type(s)`}
              </Button>
            </div>
          </form>
        </Card>
      )}

      {/* ── New Load ── */}
      {activeTab === 'new_load' && refStatus === 'ready' && (
        <Card className="stock-card">
          <CardHeader title="Record New Load" description="Record filled cylinders arriving from the supplier." />
          <form onSubmit={handleNewLoad} className="form-stack">
            <Field label="Load Into Location">
              <AppSelect ariaLabel="Load destination" value={loadTo} options={loadLocationOptions} onChange={setLoadTo} />
            </Field>

            {/* Multi-row items */}
            <div className="stock-rows">
              {loadItems.map((item, idx) => (
                <div key={idx} className="stock-item-row">
                  <Field label={idx === 0 ? 'Cylinder Type' : undefined}>
                    <AppSelect
                      ariaLabel="Cylinder size"
                      value={item.cylinder_type}
                      options={getAvailableOptions(loadItems, idx)}
                      onChange={(v) => setLoadItems(prev => prev.map((it, i) => i === idx ? { ...it, cylinder_type: v } : it))}
                    />
                  </Field>
                  <Field label={idx === 0 ? 'Qty' : undefined}>
                    <Input
                      type="number" min="1" placeholder="0"
                      className="stock-num"
                      value={item.quantity}
                      onChange={(e) => setLoadItems(prev => prev.map((it, i) => i === idx ? { ...it, quantity: e.target.value } : it))}
                    />
                  </Field>
                  {loadItems.length > 1 && (
                    <IconButton type="button" label="Remove" tone="danger" className="stock-item-row__remove" onClick={() => setLoadItems(prev => prev.filter((_, i) => i !== idx))}>
                      <Trash2 size={16} />
                    </IconButton>
                  )}
                </div>
              ))}
            </div>

            {loadItems.length < cylinderTypes.length && (
              <div>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  icon={<Plus />}
                  onClick={() => setLoadItems(prev => [...prev, { cylinder_type: getNextAvailableId(prev), quantity: '' }])}
                >
                  Add Cylinder Type
                </Button>
              </div>
            )}

            {loadErr && <Alert tone="danger">{loadErr}</Alert>}
            {loadMsg && <Alert tone="success">{loadMsg}</Alert>}

            <div className="stock-submit">
              <Button type="submit" size="lg" icon={<Factory />} disabled={loadSaving}>
                {loadSaving ? 'Saving…' : `Save ${loadItems.filter(i => Number(i.quantity) > 0).length} type(s)`}
              </Button>
            </div>
          </form>
        </Card>
      )}

      {/* ── Refuel ── */}
      {activeTab === 'refuel' && refStatus === 'ready' && (
        <div className="refuel-grid">

          {/* Send Empties */}
          <Card className="stock-card">
            <CardHeader
              title={<span className="stock-card__title"><ArrowUpRight size={18} aria-hidden="true" />Send Empties</span>}
              description="Send empty cylinders to the supplier for refilling."
            />

            {(() => {
              const emptiesAtLoc = stockData.filter(s => s.location === refuelSendLoc && s.status === 'empty' && s.quantity > 0);
              if (emptiesAtLoc.length > 0) {
                return (
                  <div className="stock-chips">
                    <span className="stock-chips__label">Available Empties at Location:</span>
                    {emptiesAtLoc.map((e, i) => {
                      const cName = cylinderTypes.find(c => c.id === e.cylinder_type)?.name || 'Unknown';
                      return (
                        <Badge key={i} tone="primary">{e.quantity}× {cName}</Badge>
                      );
                    })}
                  </div>
                );
              }
              if (stockError) return null;
              return (
                <p className="stock-ok"><CheckCircle2 size={14} aria-hidden="true" /> No empty cylinders at this location.</p>
              );
            })()}

            <form onSubmit={handleRefuelSend} className="form-stack">
              <Field label="From Location">
                <AppSelect ariaLabel="From location" value={refuelSendLoc} options={moveLocationOptions} onChange={setRefuelSendLoc} />
              </Field>

              <div className="stock-rows">
                {refuelSendItems.map((item, idx) => {
                  const emptyStock = stockData.find(
                    (s) => s.cylinder_type === item.cylinder_type && s.location === refuelSendLoc && s.status === 'empty'
                  );
                  const available = emptyStock?.quantity ?? 0;
                  return (
                    <div key={idx} className="stock-item-row">
                      <Field label={idx === 0 ? 'Cylinder Type' : undefined}>
                        <AppSelect
                          ariaLabel="Cylinder type"
                          value={item.cylinder_type}
                          options={getAvailableOptions(refuelSendItems, idx)}
                          onChange={(v) => setRefuelSendItems(prev => prev.map((it, i) => i === idx ? { ...it, cylinder_type: v } : it))}
                        />
                      </Field>
                      <Field label={idx === 0 ? 'Qty' : undefined}>
                        <Input
                          type="number" min="1" placeholder="0"
                          className="stock-num"
                          value={item.quantity}
                          onChange={(e) => setRefuelSendItems(prev => prev.map((it, i) => i === idx ? { ...it, quantity: e.target.value } : it))}
                        />
                      </Field>
                      <StockAvailability error={Boolean(stockError)} available={available} />
                      {refuelSendItems.length > 1 && (
                        <IconButton type="button" label="Remove" tone="danger" className="stock-item-row__remove" onClick={() => setRefuelSendItems(prev => prev.filter((_, i) => i !== idx))}>
                          <Trash2 size={16} />
                        </IconButton>
                      )}
                    </div>
                  );
                })}
              </div>

              {refuelSendItems.length < cylinderTypes.length && (
                <div>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    icon={<Plus />}
                    onClick={() => setRefuelSendItems(prev => [...prev, { cylinder_type: getNextAvailableId(prev), quantity: '' }])}
                  >
                    Add
                  </Button>
                </div>
              )}

              <Field label="Reference Note (Optional)">
                <Input
                  type="text"
                  value={refuelSendNote}
                  onChange={e => setRefuelSendNote(e.target.value)}
                  placeholder="e.g. Sent via Driver John"
                />
              </Field>

              {refuelSendErr && <Alert tone="danger">{refuelSendErr}</Alert>}
              {refuelSendMsg && <Alert tone="success">{refuelSendMsg}</Alert>}
              <Button type="submit" block icon={<ArrowRight />} disabled={refuelSendSaving}>
                {refuelSendSaving ? 'Sending…' : `Send to Supplier`}
              </Button>
            </form>
          </Card>

          {/* Receive Refilled */}
          <Card className="stock-card">
            <CardHeader
              title={<span className="stock-card__title"><ArrowDownLeft size={18} aria-hidden="true" />Receive Refilled</span>}
              description="Record refilled cylinders arriving from the supplier."
            />

            {supplierPending.length > 0 && (
              <div className="stock-chips">
                <span className="stock-chips__label">Pending from Supplier:</span>
                {supplierPending.map((p, i) => (
                  <Badge key={i} tone="warning">{p.pending}× {p.cylinder_type_name}</Badge>
                ))}
              </div>
            )}
            {supplierPendingError && (
              <Alert
                tone="danger"
                role="alert"
                compact
                className="ui-alert--block-sm"
                actions={<Button type="button" variant="link" size="sm" onClick={fetchSupplierPending}>Retry</Button>}
              >
                {supplierPendingError}
              </Alert>
            )}
            {!supplierPendingError && supplierPending.length === 0 && (
              <p className="stock-ok"><CheckCircle2 size={14} aria-hidden="true" /> No pending refuels from supplier.</p>
            )}

            {justSentItems && (
              <Alert
                tone="info"
                title="Receive them back immediately?"
                className="ui-alert--block-sm stock-quick"
                actions={(
                  <>
                    <Button type="button" size="sm" icon={<Check />} onClick={() => handleQuickReceive(justSentItems)} disabled={refuelRecvSaving}>
                      Yes, Receive All Now
                    </Button>
                    <Button type="button" variant="secondary" size="sm" onClick={() => setJustSentItems(null)}>
                      Record Later
                    </Button>
                  </>
                )}
              >
                You just sent {justSentItems.map(i => `${i.quantity}× ${cylinderTypes.find(c => c.id === i.cylinder_type)?.name}`).join(', ')}.
              </Alert>
            )}

            <form onSubmit={handleRefuelReceive} className="form-stack">
              <Field label="Receive Into Location">
                <AppSelect ariaLabel="Receive location" value={refuelRecvLoc} options={moveLocationOptions} onChange={setRefuelRecvLoc} />
              </Field>

              <div className="stock-rows">
                {refuelRecvItems.map((item, idx) => (
                  <div key={idx} className="stock-item-row">
                    <Field label={idx === 0 ? 'Cylinder Type' : undefined}>
                      <AppSelect
                        ariaLabel="Cylinder size"
                        value={item.cylinder_type}
                        options={getAvailableOptions(refuelRecvItems, idx)}
                        onChange={(v) => setRefuelRecvItems(prev => prev.map((it, i) => i === idx ? { ...it, cylinder_type: v } : it))}
                      />
                    </Field>
                    <Field label={idx === 0 ? 'Qty' : undefined}>
                      <Input
                        type="number" min="1" placeholder="0"
                        className="stock-num"
                        value={item.quantity}
                        onChange={(e) => setRefuelRecvItems(prev => prev.map((it, i) => i === idx ? { ...it, quantity: e.target.value } : it))}
                      />
                    </Field>
                    {refuelRecvItems.length > 1 && (
                      <IconButton type="button" label="Remove" tone="danger" className="stock-item-row__remove" onClick={() => setRefuelRecvItems(prev => prev.filter((_, i) => i !== idx))}>
                        <Trash2 size={16} />
                      </IconButton>
                    )}
                  </div>
                ))}
              </div>

              {refuelRecvItems.length < cylinderTypes.length && (
                <div>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    icon={<Plus />}
                    onClick={() => setRefuelRecvItems(prev => [...prev, { cylinder_type: getNextAvailableId(prev), quantity: '' }])}
                  >
                    Add
                  </Button>
                </div>
              )}

              <Field label="Reference Note (Optional)">
                <Input
                  type="text"
                  value={refuelRecvNote}
                  onChange={e => setRefuelRecvNote(e.target.value)}
                  placeholder="e.g. Received partial from Monday's batch"
                />
              </Field>

              {refuelRecvErr && <Alert tone="danger">{refuelRecvErr}</Alert>}
              {refuelRecvMsg && <Alert tone="success">{refuelRecvMsg}</Alert>}
              <Button type="submit" block icon={<Check />} disabled={refuelRecvSaving}>
                {refuelRecvSaving ? 'Recording…' : `Receive from Supplier`}
              </Button>
            </form>
          </Card>
        </div>
      )}

      {/* ── History ── */}
      {activeTab === 'history' && (
        <div>
          <div className="ui-toolbar">
            <div className="ui-toolbar__grow">
              <SearchInput
                aria-label="Search movements"
                placeholder="Search cylinder, location, staff…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
            <Select
              aria-label="Movement type"
              value={historyFilter}
              onChange={(e) => setHistoryFilter(e.target.value as any)}
            >
              <option value="all">All Movements</option>
              <option value="new_load">New Loads</option>
              <option value="refuel_sent">Refuel Sent</option>
              <option value="refuel_received">Refuel Received</option>
            </Select>
          </div>
          <Card padding="none" className="ui-list">
          {historyStatus === 'loading' && (
            <div className="ui-card__skeleton"><SkeletonRows rows={6} columns={3} label="Loading movements…" /></div>
          )}
          {historyStatus === 'error' && (
            <div className="ui-card__skeleton stock-history__error">
              <ErrorState message={historyError} onRetry={() => { setHistoryStatus('loading'); fetchHistory(); }} compact />
            </div>
          )}
          {historyStatus === 'ready' && filtered.length === 0 && (
            <EmptyState icon={<History size={24} />} title="No movements found." />
          )}
          {historyStatus === 'ready' && historyPager.pageItems.map((m) => (
            <div className="ui-list-row" key={m.id}>
              <div className="ui-list-row__main">
                <div className="ui-list-row__title">
                  <span className="ui-list-row__name">{m.quantity} × {m.cylinder_type_name}</span>
                  <Badge size="sm" square variant={m.status === 'filled' ? 'soft' : 'outline'} tone={m.status === 'filled' ? 'success' : 'neutral'} className="stock-status">
                    {m.status}
                  </Badge>
                  {m.note === 'New supplier load' && <Badge tone="success">New Load</Badge>}
                  {m.note.startsWith('Sent for refilling') && <Badge tone="warning" icon={<ArrowUpRight />}>Refuel Sent</Badge>}
                  {m.note.startsWith('Received refilled cylinders') && <Badge tone="info" icon={<ArrowDownLeft />}>Refuel Received</Badge>}
                  {m.supplier_pending_after !== undefined && m.supplier_pending_after !== null && (
                    <Badge variant="outline" tone={m.supplier_pending_after > 0 ? 'warning' : 'success'}>
                      {m.supplier_pending_after} owed
                    </Badge>
                  )}
                </div>
                <div className="ui-list-row__meta">
                  <span className="stock-route">
                    {m.from_location_name} <ArrowRight size={12} aria-hidden="true" /> {m.to_location_name}
                  </span>
                  {m.note ? <span>{m.note}</span> : null}
                  <span>{new Date(m.created_at).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</span>
                </div>
              </div>
              <div className="ui-list-row__actions">
                <Badge variant="outline" icon={<User />}>{m.moved_by_name}</Badge>
              </div>
            </div>
          ))}
          {historyStatus === 'ready' && historyPager.pageCount > 1 && (
            <CardFooter>
              <Pager page={historyPager.page} pageCount={historyPager.pageCount} onChange={historyPager.setPage} total={historyPager.total} />
            </CardFooter>
          )}
          </Card>
        </div>
      )}
    </div>
  );
}

/** Stock-available chip beside a quantity input (presentation only). */
function StockAvailability({ error, available, warnWhenZero = false }: { error: boolean; available: number; warnWhenZero?: boolean }) {
  if (error) {
    return <Badge variant="outline" className="stock-avail" title="Stock levels unavailable">Stock unavailable</Badge>;
  }
  return (
    <Badge
      tone={available > 0 ? 'success' : 'danger'}
      className="stock-avail"
      icon={available > 0 || !warnWhenZero ? <Package /> : <AlertTriangle />}
      title="Available"
    >
      {available}
    </Badge>
  );
}
