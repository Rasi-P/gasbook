import { useState } from 'react';
import {
  ArrowLeft, Banknote, Boxes, Building2, CreditCard, IndianRupee, KeyRound, Package, Pencil, Plus, RefreshCw,
  ShoppingBag, Smartphone, Trash2, Truck, UserPlus,
} from 'lucide-react';
import { Alert } from '../components/ui/Alert';
import { AppSelect } from '../components/ui/AppSelect';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Card, CardBody, CardFooter, CardHeader } from '../components/ui/Card';
import { ChoiceChips } from '../components/ui/ChoiceChips';
import { EmptyState } from '../components/ui/EmptyState';
import { Field, Input, Select, Textarea } from '../components/ui/Field';
import { IconButton } from '../components/ui/IconButton';
import { Modal } from '../components/ui/Modal';
import { PageHeader } from '../components/ui/PageHeader';
import { SearchInput } from '../components/ui/SearchInput';
import { SectionHeader } from '../components/ui/SectionHeader';
import { Skeleton, SkeletonRows, SkeletonStatGrid, SkeletonText } from '../components/ui/Skeleton';
import { StatCard } from '../components/ui/StatCard';
import { Switch } from '../components/ui/Switch';
import { Table, TableWrap, Td, Th } from '../components/ui/Table';
import { Tabs } from '../components/ui/Tabs';
import { useToast } from '../components/ui/toast-context';
import { ErrorState, InlineWarning, LoadingState } from '../components/AsyncState';
import { Pager } from '../components/Pager';

type Tab = 'new' | 'history';

const PAYMENT_MODES = [
  { value: 'cash', label: 'Cash', icon: <Banknote /> },
  { value: 'gpay', label: 'GPay', icon: <Smartphone /> },
  { value: 'bank', label: 'Bank', icon: <Building2 /> },
  { value: 'credit', label: 'Credit', icon: <CreditCard /> },
  { value: 'split', label: 'Split', icon: <Plus /> },
];

const ROWS = [
  { customer: 'Reg customer 107876', cylinder: '1 × 12kg', status: 'delivered', staff: 'bbb', total: 'Rs. 855' },
  { customer: 'QA customer 015811', cylinder: '1 × 5kg', status: 'pending', staff: '-', total: 'Rs. 405' },
  { customer: 'aaa', cylinder: '2 × 5kg', status: 'rejected', staff: '-', total: 'Rs. 720' },
];

function statusTone(status: string) {
  if (status === 'delivered') return 'success' as const;
  if (status === 'pending') return 'warning' as const;
  if (status === 'rejected') return 'danger' as const;
  return 'neutral' as const;
}

export function UiGallery() {
  const toast = useToast();
  const [tab, setTab] = useState<Tab>('new');
  const [tab2, setTab2] = useState<'summary' | 'stock' | 'sales' | 'pending'>('summary');
  const [qty, setQty] = useState<number>(1);
  const [mode, setMode] = useState<string>('cash');
  const [range, setRange] = useState<string>('today');
  const [on, setOn] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [location, setLocation] = useState<number>(1);

  return (
    <main className="page-container" style={{ margin: '0 auto', maxWidth: 1240 }}>
      <PageHeader
        title="UI Gallery"
        description="Dev-only reference for the shared primitives in src/components/ui. Not part of the production build."
        actions={<>
          <Button variant="secondary" icon={<RefreshCw />}>Refresh</Button>
          <Button icon={<UserPlus />}>Add</Button>
        </>}
      />

      <SectionHeader title="Buttons" description="Variants, sizes, states" icon={<ShoppingBag />} />
      <Card>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
          <Button>Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="danger" icon={<Trash2 />}>Delete</Button>
          <Button variant="link">Link</Button>
          <Button size="sm" variant="secondary">Small</Button>
          <Button size="lg" icon={<Plus />}>Large</Button>
          <Button loading>Saving…</Button>
          <Button disabled>Disabled</Button>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginTop: 16 }}>
          <IconButton label="Edit"><Pencil /></IconButton>
          <IconButton label="Rates" tone="primary"><IndianRupee /></IconButton>
          <IconButton label="Credentials" variant="outline"><KeyRound /></IconButton>
          <IconButton label="Delete" tone="danger"><Trash2 /></IconButton>
          <IconButton label="Active panel" active><Pencil /></IconButton>
          <IconButton label="Small" size="sm"><Pencil /></IconButton>
          <IconButton label="Back" size="lg" variant="outline"><ArrowLeft /></IconButton>
          <IconButton label="Disabled" disabled><Trash2 /></IconButton>
        </div>
      </Card>

      <SectionHeader title="Badges" />
      <Card>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
          <Badge>neutral</Badge>
          <Badge tone="primary">10% global</Badge>
          <Badge tone="success">delivered</Badge>
          <Badge tone="warning">Rs. 20 due</Badge>
          <Badge tone="danger" icon={<RefreshCw />}>2 empty</Badge>
          <Badge tone="info">approved</Badge>
          <Badge variant="outline">STAFF</Badge>
          <Badge variant="outline" tone="primary">ADMIN</Badge>
          <Badge variant="outline" tone="danger">cancelled</Badge>
          <Badge size="sm" square tone="success">FILLED</Badge>
          <Badge size="sm" square>EMPTY</Badge>
        </div>
      </Card>

      <SectionHeader title="Fields" description="Native controls with pass-through props" />
      <Card>
        <div className="grid-2">
          <Field label="Name" required hint="As it appears on the invoice">
            <Input placeholder="e.g. Ravi Kumar" maxLength={150} required />
          </Field>
          <Field label="Phone" required error="Only digits allowed">
            <Input inputMode="numeric" pattern="[0-9]*" defaultValue="98765abc" invalid />
          </Field>
          <Field label="Location">
            <Select defaultValue="kandam">
              <option value="shop">Main Shop</option>
              <option value="kandam">Kandam</option>
            </Select>
          </Field>
          <Field label="Custom dropdown (AppSelect)">
            <AppSelect ariaLabel="Location" value={location} onChange={setLocation} options={[{ value: 1, label: 'Main Shop' }, { value: 2, label: 'Kandam' }]} />
          </Field>
          <Field label="Search">
            <SearchInput placeholder="Search by name or phone…" />
          </Field>
          <Field label="Small input">
            <Input inputSize="sm" placeholder="0" type="number" />
          </Field>
          <Field label="Disabled">
            <Input value="Auto-generated on create" disabled readOnly />
          </Field>
          <Field label="Address">
            <Textarea placeholder="Street, area" rows={3} />
          </Field>
        </div>
        <div style={{ marginTop: 16, display: 'flex', gap: 24, flexWrap: 'wrap' }}>
          <Switch checked={on} onChange={setOn} label={on ? 'Discount active' : 'Discount off'} />
          <Switch checked={false} onChange={() => undefined} label="Disabled" disabled compact />
        </div>
      </Card>

      <SectionHeader title="Tabs and chips" />
      <Card>
        <Tabs ariaLabel="Sales" value={tab} onChange={setTab} block items={[{ value: 'new', label: 'New Sale' }, { value: 'history', label: 'History', count: 25 }]} />
        <div style={{ marginTop: 16 }}>
          <Tabs ariaLabel="Reports" variant="tabs" value={tab2} onChange={setTab2} items={[{ value: 'summary', label: 'Summary' }, { value: 'stock', label: 'Stock' }, { value: 'sales', label: 'Sales' }, { value: 'pending', label: 'Pending', count: 3 }]} />
        </div>
        <div style={{ marginTop: 16, display: 'grid', gap: 16 }}>
          <ChoiceChips ariaLabel="Quick quantity" size="sm" value={qty} onChange={setQty} options={[1, 2, 5, 10].map((n) => ({ value: n, label: String(n) }))} />
          <ChoiceChips ariaLabel="Range" value={range} onChange={setRange} options={[{ value: 'today', label: 'Today' }, { value: 'yesterday', label: 'Yesterday' }, { value: 'month', label: 'This Month' }]} />
          <ChoiceChips ariaLabel="Payment mode" layout="icon" columns={5} value={mode} onChange={setMode} options={PAYMENT_MODES} />
        </div>
      </Card>

      <SectionHeader title="Stat cards" meta={<Badge tone="success">60 total</Badge>} />
      <div className="stat-grid">
        <StatCard label="Today sales" value="Rs. 4,995" hint="Rs. 4,995 collected" icon={<IndianRupee />} />
        <StatCard label="Filled" value="10" hint="17% of total cylinders" icon={<Package />} />
        <StatCard label="Empty" value="10" hint="17% ready to refill" icon={<Boxes />} />
        <StatCard label="Pending payments" value="Rs. 20" hint="across 3 customers" attention={<Badge tone="warning" size="sm">5 alerts</Badge>} icon={<IndianRupee />} footer={<Button size="sm" block>Receive Payment</Button>} />
      </div>

      <SectionHeader title="Cards" />
      <div className="grid-2">
        <Card>
          <CardHeader title="Padded card" description="Default padding, header with meta slot" meta={<Badge>meta</Badge>} />
          <p>Body content inherits the page typography.</p>
          <CardFooter><Button variant="secondary" size="sm">Cancel</Button><Button size="sm">Save</Button></CardFooter>
        </Card>
        <Card padding="none">
          <CardHeader title="Flush card" description="For tables and lists" meta={<IconButton label="Edit" size="sm"><Pencil /></IconButton>} />
          <CardBody>Body with its own padding.</CardBody>
          <CardFooter><Pager page={page} pageCount={4} onChange={setPage} total={39} /></CardFooter>
        </Card>
      </div>

      <SectionHeader title="Table" description="Resize under 680px to see card mode" />
      <Card padding="none">
        <CardHeader title="Requests" meta={<Badge tone="warning">1 pending</Badge>} />
        <TableWrap>
          <Table cards>
            <thead>
              <tr>
                <Th>Customer</Th>
                <Th>Cylinder</Th>
                <Th>Status</Th>
                <Th>Staff</Th>
                <Th align="right">Total</Th>
                <Th align="right">Actions</Th>
              </tr>
            </thead>
            <tbody>
              {ROWS.map((row) => (
                <tr key={row.customer}>
                  <Td label="Customer"><strong>{row.customer}</strong><p>9000001581 · QA Lane 1</p></Td>
                  <Td label="Cylinder">{row.cylinder}</Td>
                  <Td label="Status"><Badge tone={statusTone(row.status)}>{row.status}</Badge></Td>
                  <Td label="Staff">{row.staff}</Td>
                  <Td label="Total" numeric>{row.total}</Td>
                  <Td label="Actions" align="right">
                    <span style={{ display: 'inline-flex', gap: 4 }}>
                      <IconButton label="Approve" size="sm" tone="primary"><Truck /></IconButton>
                      <IconButton label="Reject" size="sm" tone="danger"><Trash2 /></IconButton>
                    </span>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </TableWrap>
        <CardFooter><Pager page={1} pageCount={4} onChange={() => undefined} total={39} /></CardFooter>
      </Card>

      <SectionHeader title="Alerts, states" />
      <div style={{ display: 'grid', gap: 12 }}>
        <Alert tone="info" title="Important">Admin should send only a temporary password on WhatsApp.</Alert>
        <Alert tone="success">Booking approved and assigned.</Alert>
        <Alert tone="warning" compact actions={<Button variant="link" size="sm">Retry</Button>}>Showing the last loaded data. Refresh failed.</Alert>
        <Alert tone="danger" actions={<Button variant="secondary" size="sm" icon={<RefreshCw />}>Retry</Button>}>Could not load bookings.</Alert>
        <ErrorState message="Could not load the customer ledger." onRetry={() => undefined} />
        <InlineWarning message="Stock levels unavailable." onRetry={() => undefined} />
        <Card padding="none"><LoadingState label="Loading customers…" /></Card>
        <Card padding="none"><EmptyState title="No bookings yet" hint="Customer requests will appear here as soon as they are placed." action={<Button size="sm" variant="secondary">Refresh</Button>} /></Card>
      </div>

      <SectionHeader title="Skeletons" />
      <div style={{ display: 'grid', gap: 16 }}>
        <SkeletonStatGrid />
        <Card><SkeletonText /></Card>
        <Card padding="none"><div style={{ padding: '0 20px' }}><SkeletonRows rows={4} columns={5} /></div></Card>
        <Skeleton height={40} radius={8} />
      </div>

      <SectionHeader title="Overlays" />
      <Card>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Button variant="secondary" onClick={() => setModalOpen(true)}>Open modal</Button>
          <Button variant="secondary" onClick={() => toast.show('Credentials copied to clipboard.', { tone: 'success' })}>Show toast</Button>
          <Button variant="secondary" onClick={() => toast.show('Stock levels unavailable.', { tone: 'danger', title: 'Refresh failed' })}>Show error toast</Button>
        </div>
      </Card>
      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title="Reject booking"
        description="Please provide a reason for rejecting this order."
        footer={<>
          <Button variant="secondary" onClick={() => setModalOpen(false)}>Cancel</Button>
          <Button variant="danger" onClick={() => setModalOpen(false)}>Reject order</Button>
        </>}
      >
        <Field label="Reason" hint="0/250">
          <Input placeholder="e.g. Out of stock, outside delivery zone" maxLength={250} autoFocus />
        </Field>
      </Modal>
    </main>
  );
}
