import type { TabItem } from '../components/ui/Tabs';

export type InventoryTab = 'products' | 'cylinders' | 'locations';

/** Long labels on desktop; short ones keep three tabs on one row at phone width (see catalog.css). */
export const INVENTORY_TABS: TabItem<InventoryTab>[] = [
  { value: 'products', label: <><span className="catalog-tab-long">Products &amp; Inventory</span><span className="catalog-tab-short">Products</span></> },
  { value: 'cylinders', label: <><span className="catalog-tab-long">Cylinder Types</span><span className="catalog-tab-short">Cylinders</span></> },
  { value: 'locations', label: 'Locations' },
];

export const isInventoryTab = (value: string | null): value is InventoryTab =>
  value === 'products' || value === 'cylinders' || value === 'locations';

export const PANEL_LABELS: Record<InventoryTab, string> = {
  products: 'Products and inventory',
  cylinders: 'Cylinder types',
  locations: 'Locations',
};
