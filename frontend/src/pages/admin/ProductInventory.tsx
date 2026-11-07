import { useSearchParams } from 'react-router-dom';
import { InventoryTabs } from '../../components/catalog/InventoryTabs';
import { isInventoryTab, type InventoryTab } from '../../lib/inventoryTabs';
import '../../styles/products.css';
import '../../styles/catalog.css';

/** Products & Inventory, Cylinder Types and Locations. The tab is kept in the URL (?tab=cylinders) so a refresh or shared link lands on the same tab. */
export default function ProductInventory() {
  const [params, setParams] = useSearchParams();
  const requested = params.get('tab');
  const tab: InventoryTab = isInventoryTab(requested) ? requested : 'products';
  return (
    <InventoryTabs
      tab={tab}
      onChange={(next) => setParams(next === 'products' ? {} : { tab: next }, { replace: true })}
    />
  );
}
