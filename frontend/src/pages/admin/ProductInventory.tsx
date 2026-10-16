import { InventorySummary, InventoryStockBadge } from '../../components/InventorySummary';
import { matchesInventoryFilter, type InventoryFilter } from '../../lib/inventorySummary';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api, extractApiError } from '../../lib/api';
import { formatDateTime } from '../../lib/dateTime';
import '../../styles/products.css';

type Product = { id: number; name: string; description: string; category: string; selling_price: string; stock: number; reserved: number; low_stock_threshold: number; image?: string; is_active: boolean };
type Movement = { id: number; created_at: string; actor: string; reason: string; stock_before: number; stock_after: number; reserved_change: number };
const empty = { name: '', description: '', category: 'Accessory', selling_price: '', stock: '0', is_active: true };

async function fetchProducts() {
  const rows: Product[] = []; let url: string | null = '/products/';
  while (url) {
    const { data }: { data: { results: Product[]; next: string | null } } = await api.get(url);
    rows.push(...data.results); url = data.next;
  }
  return rows;
}

export default function ProductInventory() {
  const [products, setProducts] = useState<Product[]>([]);
  const [form, setForm] = useState(empty);
  const [editing, setEditing] = useState<Product | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [ready, setReady] = useState(false);
  const [filter, setFilter] = useState<InventoryFilter>('all');
  const visibleProducts = products.filter(product => matchesInventoryFilter(product, filter));
  const [busy, setBusy] = useState<number | 'form' | null>(null);
  const inFlight = useRef(false);
  const retry = useRef<{ fingerprint: string; key: string } | null>(null);
  const [history, setHistory] = useState<{ name: string; rows: Movement[]; next: string | null } | null>(null);
  const load = useCallback(() => fetchProducts()
    .then(rows => { setProducts(rows); setReady(true); setError(''); })
    .catch(e => setError(extractApiError(e, [], 'Could not load products.')))
    .finally(() => setLoading(false)), []);
  useEffect(() => { void load(); }, [load]);
  async function adjust(product: Product, change: { delta: number } | { quantity: number }) {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(product.id); setError('');
    const fingerprint = JSON.stringify([product.id, change]);
    if (retry.current?.fingerprint !== fingerprint) retry.current = { fingerprint, key: crypto.randomUUID() };
    try {
      const { data } = await api.post(`/products/${product.id}/stock/`, { ...change, client_ref: retry.current.key, reason: 'Admin stock adjustment' });
      setProducts(rows => rows.map(p => p.id === data.id ? data : p)); retry.current = null;
    } catch (e) { setError(extractApiError(e, [], 'Stock update failed. Retry the same adjustment safely.')); }
    finally { inFlight.current = false; setBusy(null); }
  }
  async function save(e: React.FormEvent) {
    e.preventDefault(); if (inFlight.current) return;
    inFlight.current = true; setBusy('form'); setError('');
    try {
      const data = new FormData();
      for (const key of ['name', 'description', 'category', 'selling_price', 'is_active'] as const) data.append(key, String(form[key]));
      if (file) data.append('image', file);
      if (!editing) data.append('initial_stock', form.stock);
      await (editing ? api.patch(`/products/${editing.id}/`, data) : api.post('/products/', data));
      setShowForm(false); setLoading(true); await load();
    } catch (e) { setError(extractApiError(e, [], 'Could not save product.')); }
    finally { inFlight.current = false; setBusy(null); }
  }
  async function showHistory(product: Product, next?: string) {
    try {
      const { data } = await api.get(next || `/products/${product.id}/movements/`);
      setHistory({ name: product.name, rows: data.results, next: data.next });
    } catch (e) { setError(extractApiError(e)); }
  }
  return <div className="inventory-page">
    <div className="inventory-heading"><h1>Products &amp; Inventory</h1><button className="btn btn-primary" onClick={() => { setEditing(null); setForm(empty); setFile(null); setShowForm(true); }}>Add product</button></div>
    <p className="inventory-intro">Accessories for cylinder bookings. Manage cylinder quantities in <a href="/stock">Stock</a> and cylinder prices in Gas Rates.</p>
    <InventorySummary products={products} loading={loading} ready={ready} filter={filter} onFilter={setFilter} />
    {error && <p role="alert">{error} <button onClick={() => { setLoading(true); void load(); }}>Reload products</button></p>}
    {showForm && <form onSubmit={save} className="inventory-form" aria-labelledby="inventory-form-title">
      <div className="inventory-form-heading"><div><h2 id="inventory-form-title">{editing ? 'Edit product' : 'Add product'}</h2><p>Enter the product details and availability.</p></div><button type="button" aria-label="Close product form" disabled={busy === 'form'} onClick={() => setShowForm(false)}>×</button></div>
      <label className="inventory-name">Product name<input autoFocus required maxLength={150} placeholder="e.g. LPG gas regulator" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} /></label>
      <label>Type/category<input required maxLength={80} value={form.category} onChange={e => setForm({ ...form, category: e.target.value })} /></label>
      <label className="inventory-wide">Description<textarea aria-label="Description" rows={2} maxLength={3000} placeholder="A short description of the product" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} /></label>
      <label>Rate (Rs.)<input required type="number" min="0" step="0.01" placeholder="0.00" value={form.selling_price} onChange={e => setForm({ ...form, selling_price: e.target.value })} /></label>
      {!editing && <label>Initial stock<input required type="number" min="0" step="1" value={form.stock} onChange={e => setForm({ ...form, stock: e.target.value })} /></label>}
      <label className="inventory-active"><input type="checkbox" checked={form.is_active} onChange={e => setForm({ ...form, is_active: e.target.checked })} /><span>Active<small>Available in the customer catalog when in stock</small></span></label>
      <label className="inventory-wide">Product image<input type="file" accept="image/png,image/jpeg,image/webp" onChange={e => setFile(e.target.files?.[0] || null)} /><small>JPG, PNG or WebP · Up to 5 MB</small></label>
      <div className="inventory-form-actions"><button type="button" disabled={busy === 'form'} onClick={() => setShowForm(false)}>Cancel</button><button disabled={busy !== null} className="btn btn-primary">{busy === 'form' ? 'Saving…' : 'Save product'}</button></div>
    </form>}
    {loading ? <p>Loading products…</p> : !ready ? null : <div className="inventory-table-wrap"><div className="inventory-list-heading"><div><h2>Product list</h2>{filter !== 'all' && <span className="inventory-filter-label">{filter === 'low' ? 'Low stock' : 'Unavailable'} products</span>}</div><div className="inventory-list-meta"><span role="status">{filter === 'all' ? `${products.length} products` : `${visibleProducts.length} of ${products.length} products`}</span>{filter !== 'all' && <button type="button" onClick={() => setFilter('all')}>Clear filter</button>}</div></div><table className="inventory-table"><thead><tr><th>Product</th><th>Type</th><th>Rate</th><th>Stock left</th><th>Actions</th></tr></thead><tbody>
      {visibleProducts.map(p => <tr key={p.id}><td data-label="Product"><div className="inventory-product">{p.image && <img src={p.image} alt="" />}<span>{p.name}{!p.is_active && <small className="inventory-status">Inactive</small>}</span></div></td><td data-label="Type"><span className="inventory-category">{p.category}</span></td><td data-label="Rate" className="inventory-price">₹{Number(p.selling_price).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
        <td data-label="Stock left"><div className="inventory-stock-controls"><InventoryStockBadge product={p} /><div className="inventory-stepper"><button aria-label={`Decrease ${p.name} stock`} disabled={busy !== null || p.stock <= p.reserved} onClick={() => void adjust(p, { delta: -1 })}>−</button><strong>{p.stock}</strong><button aria-label={`Increase ${p.name} stock`} disabled={busy !== null} onClick={() => void adjust(p, { delta: 1 })}>+</button></div>
          {p.reserved > 0 && <small>{p.reserved} reserved · {p.stock - p.reserved} available</small>}
          <form className="inventory-set" onSubmit={e => { e.preventDefault(); const quantity = Number(new FormData(e.currentTarget).get('quantity')); void adjust(p, { quantity }); }}><input aria-label={`Set ${p.name} stock`} name="quantity" type="number" min={p.reserved} max="100000" required placeholder="Set qty" /><button disabled={busy !== null}>Set</button></form></div>
        </td><td data-label="Actions"><div className="inventory-row-actions"><button onClick={() => { setEditing(p); setForm({ ...p, stock: String(p.stock) }); setFile(null); setShowForm(true); }}>Edit</button> <button onClick={() => void showHistory(p)}>Movements</button></div></td></tr>)}
      {!visibleProducts.length && <tr><td colSpan={5}>{filter === 'all' ? 'No accessories yet. Add your first product.' : filter === 'low' ? 'No active products have low stock.' : 'No active products are unavailable.'}</td></tr>}
    </tbody></table></div>}
    {history && <section className="inventory-history"><h2>{history.name} — stock movements</h2><button onClick={() => setHistory(null)}>Close</button>{history.rows.map(r => <p key={r.id}>{formatDateTime(r.created_at)} · {r.actor} · {r.reason} · {r.stock_before} → {r.stock_after}{r.reserved_change !== 0 && ` · reserved ${r.reserved_change > 0 ? '+' : ''}${r.reserved_change}`}</p>)}{history.next && <button onClick={() => void showHistory({ name: history.name } as Product, history.next!)}>Next</button>}</section>}
  </div>;
}
