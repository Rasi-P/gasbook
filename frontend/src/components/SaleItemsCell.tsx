import { AlertTriangle, RotateCcw } from 'lucide-react';
import { Badge } from './ui/Badge';

type SaleItemLike = {
  cylinder_type_name: string;
  quantity: number;
  rate: number;
  empty_returned?: number;
};

function money(v: number | string) {
  return `Rs. ${Number(v || 0).toLocaleString('en-IN')}`;
}

/**
 * Item lines of a sale (shared by Sales history and Reports → Sales). The conditions that flag
 * missing empties are the same as before; only the markers changed from emoji spans to badges.
 */
export function SaleItemsCell({ customerName, items }: { customerName: string; items: SaleItemLike[] }) {
  return (
    <div className="sale-items">
      {items.map((item, i) => {
        const returned = item.empty_returned ?? 0;
        const short = !customerName && item.quantity > 0 && returned < item.quantity;
        return (
          <div key={i} className="sale-items__line">
            {item.quantity > 0 && <span>{item.quantity}×{item.cylinder_type_name} @ {money(item.rate)}</span>}
            {returned > 0 ? (
              <Badge size="sm" square tone={short ? 'danger' : 'neutral'} icon={<RotateCcw />} className="ui-badge--wrap">
                Returned {returned} × {item.cylinder_type_name} empties
              </Badge>
            ) : (
              !customerName && item.quantity > 0 && (
                <Badge size="sm" square tone="danger" icon={<AlertTriangle />}>0 empties returned</Badge>
              )
            )}
          </div>
        );
      })}
    </div>
  );
}
