import { INVENTORY_TABS, PANEL_LABELS, type InventoryTab } from '../../lib/inventoryTabs';
import ProductsPanel from '../../pages/admin/ProductsPanel';
import { Tabs } from '../ui/Tabs';
import CylinderTypesPanel from './CylinderTypesPanel';
import LocationsPanel from './LocationsPanel';

/** Page title, tab strip and the active panel. */
export function InventoryTabs({ tab, onChange }: { tab: InventoryTab; onChange: (tab: InventoryTab) => void }) {
  return (
    <div className="catalog-page">
      <h1 className="catalog-title">Products &amp; Inventory</h1>
      <Tabs variant="tabs" block ariaLabel="Products and inventory sections" items={INVENTORY_TABS} value={tab} onChange={onChange} className="catalog-tabs" />
      <div role="tabpanel" aria-label={PANEL_LABELS[tab]} className="catalog-tabpanel">
        {tab === 'products' && <ProductsPanel />}
        {tab === 'cylinders' && <CylinderTypesPanel />}
        {tab === 'locations' && <LocationsPanel />}
      </div>
    </div>
  );
}
