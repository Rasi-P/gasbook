import { Boxes, Package, PackageX, TriangleAlert } from 'lucide-react';
import { summarizeInventory, stockState, type InventoryFilter, type InventoryStock } from '../lib/inventorySummary';
import { Badge } from './ui/Badge';
import { SkeletonStatGrid } from './ui/Skeleton';
import { StatCard } from './ui/StatCard';

export function InventoryStockBadge({ product }: { product: InventoryStock }) {
  const state = stockState(product);
  if (state === 'low') return <Badge tone="warning" title={`${product.stock - product.reserved} available; low-stock threshold ${product.low_stock_threshold}`}>Low stock</Badge>;
  if (state === 'out') return <Badge tone="danger">Out of stock</Badge>;
  if (state === 'reserved') return <Badge tone="info">Fully reserved</Badge>;
  return null;
}

export function InventorySummary({ products, loading, ready, filter, onFilter }: {
  products: InventoryStock[]; loading: boolean; ready: boolean; filter: InventoryFilter; onFilter: (filter: InventoryFilter) => void;
}) {
  if (loading) return <section className="inventory-summary-loading"><SkeletonStatGrid count={4} label="Loading inventory summary" /></section>;
  const summary = summarizeInventory(products);
  const number = (value: number) => ready ? value.toLocaleString('en-IN') : '—';
  return <section className="inventory-summary" aria-label="Inventory summary">
    <StatCard label="Total Products" value={number(summary.total)} icon={<Package />} hint={ready ? `${number(summary.active)} active · ${number(summary.inactive)} inactive` : 'Inventory unavailable'} />
    <StatCard label="Total Units" value={number(summary.units)} icon={<Boxes />} hint={ready ? `${number(summary.reserved)} reserved · included in total` : 'Inventory unavailable'} />
    <div className="inventory-summary-tile" data-selected={filter === 'low'}>
      <StatCard label="Low Stock" value={number(summary.low)} icon={<TriangleAlert />} hint="Active products at or below their threshold" attention={ready && summary.low > 0 ? <Badge tone="warning">Low stock</Badge> : undefined} />
      <button type="button" className="inventory-summary-trigger" aria-label="Filter low-stock products" aria-pressed={filter === 'low'} disabled={!ready} onClick={() => onFilter(filter === 'low' ? 'all' : 'low')} />
    </div>
    <div className="inventory-summary-tile" data-selected={filter === 'unavailable'}>
      <StatCard label="Unavailable" value={number(summary.unavailable)} icon={<PackageX />} hint="Active products with 0 available" attention={ready ? <>
        {summary.out > 0 && <Badge tone="danger">{number(summary.out)} out of stock</Badge>}
        {summary.fullyReserved > 0 && <Badge tone="info">{number(summary.fullyReserved)} fully reserved</Badge>}
      </> : undefined} />
      <button type="button" className="inventory-summary-trigger" aria-label="Filter unavailable products" aria-pressed={filter === 'unavailable'} disabled={!ready} onClick={() => onFilter(filter === 'unavailable' ? 'all' : 'unavailable')} />
    </div>
  </section>;
}
