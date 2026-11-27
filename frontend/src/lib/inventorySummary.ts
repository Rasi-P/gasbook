export type InventoryStock = { stock: number; reserved: number; is_active: boolean; low_stock_threshold: number };
export type InventoryFilter = 'all' | 'low' | 'unavailable';

export function stockState(product: InventoryStock): 'inactive' | 'out' | 'reserved' | 'low' | 'available' {
  if (!product.is_active) return 'inactive';
  if (product.stock === 0) return 'out';
  const available = product.stock - product.reserved;
  if (available === 0) return 'reserved';
  if (available > 0 && available <= product.low_stock_threshold) return 'low';
  return 'available';
}

export function matchesInventoryFilter(product: InventoryStock, filter: InventoryFilter) {
  const state = stockState(product);
  return filter === 'all' || (filter === 'low' ? state === 'low' : state === 'out' || state === 'reserved');
}

export function summarizeInventory(products: InventoryStock[]) {
  return products.reduce((summary, product) => {
    summary.total++;
    summary.active += Number(product.is_active);
    summary.inactive += Number(!product.is_active);
    summary.units += product.stock;
    summary.reserved += product.reserved;
    const state = stockState(product);
    summary.low += Number(state === 'low');
    summary.out += Number(state === 'out');
    summary.fullyReserved += Number(state === 'reserved');
    summary.unavailable += Number(state === 'out' || state === 'reserved');
    return summary;
  }, { total: 0, active: 0, inactive: 0, units: 0, reserved: 0, low: 0, out: 0, fullyReserved: 0, unavailable: 0 });
}
