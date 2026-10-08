import { useCallback, useEffect, useState, type ReactNode } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  Boxes,
  IndianRupee,
  PackageCheck,
  RefreshCw,
  ShieldCheck,
  ShoppingBag,
  TrendingUp,
  Warehouse,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { api, extractApiError } from '../../lib/api';
import { ErrorState, InlineWarning } from '../../components/AsyncState';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { buttonClassName } from '../../components/ui/buttonClass';
import { Card, CardHeader } from '../../components/ui/Card';
import { EmptyState } from '../../components/ui/EmptyState';
import { Select } from '../../components/ui/Field';
import { PageHeader } from '../../components/ui/PageHeader';
import { SectionHeader } from '../../components/ui/SectionHeader';
import { SkeletonRows, SkeletonStatGrid, SkeletonText } from '../../components/ui/Skeleton';
import { StatCard } from '../../components/ui/StatCard';
import { FilledEmpty } from '../../components/FilledEmpty';
import { Table, TableWrap, Td, Th } from '../../components/ui/Table';

type DashboardData = {
  total_cylinders: number; filled_cylinders: number; empty_cylinders: number;
  shop_stock: number; kandam_stock: number;
  today_sales: number; today_collection: number; pending_payments: number;
  low_stock: { cylinder_type: string; location: string; status: string; quantity: number; threshold: number }[];
  stock_rows: { id: number; type: string; shop_filled: number; shop_empty: number; kandam_filled: number; kandam_empty: number; total: number; with_customers: number }[];
  recent_activity: { id: number; action: string; description: string; user_name: string }[];
};

function money(value: number | string) {
  return `Rs. ${Number(value || 0).toLocaleString('en-IN')}`;
}

function percent(value: number, total: number) {
  if (!total) return 0;
  return Math.min(100, Math.round((value / total) * 100));
}

export default function Dashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState('');

  const loadDashboard = useCallback(() => {
    api.get('/dashboard/')
      .then((response) => {
        setData(response.data as DashboardData);
        setError('');
      })
      .catch((err) => setError(extractApiError(err, [], 'Could not load the dashboard.')));
  }, []);

  useEffect(() => {
    loadDashboard();

    const interval = setInterval(loadDashboard, 30000);
    return () => clearInterval(interval);
  }, [loadDashboard]);

  const header = (
    <PageHeader
      title="Overview"
      description="Gas stock, sales, collections, and movement warnings in one place."
      actions={(
        <>
          <Select aria-label="Branch filter" selectSize="sm">
            <option>All Branches</option>
            <option>Main Shop</option>
            <option>Kandam</option>
          </Select>
          <Button type="button" variant="secondary" size="sm" icon={<RefreshCw />} onClick={loadDashboard}>
            Refresh
          </Button>
        </>
      )}
    />
  );

  if (!data) {
    if (error) {
      return (
        <div>
          {header}
          <ErrorState message={error} onRetry={loadDashboard} />
        </div>
      );
    }
    return (
      <div>
        {header}
        <DashboardSkeleton />
      </div>
    );
  }

  const filledPercent = percent(data.filled_cylinders, data.total_cylinders);
  const emptyPercent = percent(data.empty_cylinders, data.total_cylinders);
  const customerTotal = data.stock_rows.reduce((sum, item) => sum + item.with_customers, 0);
  const lowStockCount = data.low_stock.length;

  return (
    <div>
      {header}

      {error && (
        <InlineWarning message={`Showing the last loaded data. Refresh failed: ${error}`} onRetry={loadDashboard} />
      )}

      <section className="dash-stats" aria-label="Key figures">
        <StatCard
          label="Today sales"
          value={money(data.today_sales)}
          hint={`${money(data.today_collection)} collected`}
          icon={<IndianRupee />}
        />
        <StatCard
          label="Filled"
          value={data.filled_cylinders}
          hint={`${filledPercent}% of total cylinders`}
          icon={<PackageCheck />}
        />
        <StatCard
          label="Empty"
          value={data.empty_cylinders}
          hint={`${emptyPercent}% ready to refill`}
          icon={<Boxes />}
        />
        <StatCard
          label="Pending payments"
          value={money(data.pending_payments)}
          hint={lowStockCount === 0 ? 'No stock warnings' : undefined}
          attention={lowStockCount > 0 ? (
            <Badge tone="warning" size="sm">{lowStockCount} stock warning{lowStockCount === 1 ? '' : 's'}</Badge>
          ) : undefined}
          icon={<AlertTriangle />}
        />
      </section>

      <section className="dash-section">
        <SectionHeader icon={<ShoppingBag />} title="Stock overview" description="Status mix and cylinder location breakdown" />

        <div className="dash-grid-3">
          <Card>
            <CardHeader title="Status breakdown" meta={<Badge>{data.total_cylinders} total</Badge>} />
            <div className="ui-tiles">
              <Tile label="Filled" value={data.filled_cylinders} />
              <Tile label="Empty" value={data.empty_cylinders} />
              <Tile label="At shop" value={data.shop_stock} />
              <Tile label="With customers" value={customerTotal} />
            </div>
          </Card>

          <Card>
            <CardHeader title="Locations" meta={<Warehouse size={18} className="ui-card-icon" aria-hidden="true" />} />
            <div className="dash-bars">
              <Bar label="Main shop" value={data.shop_stock} total={data.total_cylinders} />
              <Bar label="Kandam" value={data.kandam_stock} total={data.total_cylinders} />
              <Bar label="With customers" value={customerTotal} total={data.total_cylinders} />
            </div>
          </Card>

          <Card>
            <CardHeader title="Top cylinder types" meta={<TrendingUp size={18} className="ui-card-icon" aria-hidden="true" />} />
            {data.stock_rows.length === 0 ? (
              <EmptyState compact title="No cylinder types yet" />
            ) : (
              <div className="dash-bars">
                {data.stock_rows.slice(0, 4).map((item) => (
                  <Bar key={item.id} label={item.type} value={item.total} total={data.total_cylinders} />
                ))}
              </div>
            )}
          </Card>
        </div>
      </section>

      <section className="dash-section">
        <SectionHeader icon={<ShieldCheck />} title="Operations overview" description="Sales readiness, pending payments, and quick actions" />

        <div className="dash-grid-2">
          <Card>
            <CardHeader title="Readiness" meta={<Badge tone="primary">{filledPercent}% filled</Badge>} />
            <Bar label="Filled cylinders" value={data.filled_cylinders} total={data.total_cylinders} />
            <div className="ui-tiles dash-tiles--spaced">
              <Tile label="Collected today" value={money(data.today_collection)} />
              <Tile label="Low stock alerts" value={lowStockCount} tone={lowStockCount > 0 ? 'warning' : undefined} />
            </div>
          </Card>

          <Card>
            <CardHeader title="Quick actions" />
            <div className="dash-actions">
              <Link className={buttonClassName({ variant: 'primary' })} to="/sales">
                <span className="ui-btn__label">Add Sale</span>
                <span className="ui-btn__icon" aria-hidden="true"><ArrowRight size={16} /></span>
              </Link>
              <Link className={buttonClassName({ variant: 'secondary' })} to="/stock">
                <span className="ui-btn__label">Move Stock</span>
                <span className="ui-btn__icon" aria-hidden="true"><ArrowRight size={16} /></span>
              </Link>
            </div>
          </Card>
        </div>
      </section>

      <Card padding="none">
        <CardHeader title="Live stock" meta={<Badge>{data.total_cylinders} cylinders</Badge>} />
        {data.stock_rows.length === 0 ? (
          <EmptyState title="No stock recorded yet" hint="Stock levels appear here once cylinders are loaded." />
        ) : (
          <TableWrap fade>
            <Table compact stickyFirst>
              <thead>
                <tr>
                  <Th>Type</Th>
                  <Th align="center">Shop (F/E)</Th>
                  <Th align="center">Kandam (F/E)</Th>
                  <Th align="right">With customers</Th>
                  <Th align="right">Total</Th>
                </tr>
              </thead>
              <tbody>
                {data.stock_rows.map((item) => (
                  <tr key={item.id}>
                    <Td><strong>{item.type}</strong></Td>
                    <Td align="center"><FilledEmpty filled={item.shop_filled} empty={item.shop_empty} /></Td>
                    <Td align="center"><FilledEmpty filled={item.kandam_filled} empty={item.kandam_empty} /></Td>
                    <Td numeric>
                      {item.with_customers > 0
                        ? <span className="ui-num-warning">{item.with_customers}</span>
                        : <span className="ui-num-placeholder">-</span>}
                    </Td>
                    <Td numeric><strong>{item.total}</strong></Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </TableWrap>
        )}
      </Card>
    </div>
  );
}

function Tile({ label, value, tone }: { label: string; value: ReactNode; tone?: 'warning' }) {
  return (
    <div className={`ui-tile${tone ? ` ui-tile--${tone}` : ''}`}>
      <span className="ui-tile__label">{label}</span>
      <strong className="ui-tile__value">{value}</strong>
    </div>
  );
}

function Bar({ label, value, total }: { label: string; value: number; total: number }) {
  const width = percent(value, total);

  return (
    <div className="dash-bar">
      <div className="dash-bar__row">
        <span className="dash-bar__label">{label}</span>
        <span className="dash-bar__value">{value} <small>/ {total}</small></span>
      </div>
      <div className="dash-bar__track" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={width}>
        <span className="dash-bar__fill" style={{ width: `${width}%` }} />
      </div>
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div aria-busy="true">
      <div className="dash-section">
        <SkeletonStatGrid label="Loading dashboard" />
      </div>
      <div className="dash-grid-3 dash-section" aria-hidden="true">
        <Card><SkeletonText lines={4} /></Card>
        <Card><SkeletonText lines={4} /></Card>
        <Card><SkeletonText lines={4} /></Card>
      </div>
      <Card padding="none" aria-hidden="true">
        <div className="ui-card__skeleton">
          <SkeletonRows rows={5} columns={5} />
        </div>
      </Card>
    </div>
  );
}
