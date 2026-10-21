import { useCapabilities } from '../../hooks/useCapabilities';
import { pendingTransaction, transactionRequest } from '../../lib/transactionRequest';
import { useEffect, useState } from 'react';
import { api, extractApiError, fetchCatalogPages, fetchAllPages } from '../../lib/api';
import { ArrowLeft, ArrowRight, CheckCircle2, Minus, Plus, Search, ShoppingBag, Trash2, UserRound } from 'lucide-react';
import { IconButton } from '../../components/ui/IconButton';
import { Card, CardHeader } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Field, Input, Select } from '../../components/ui/Field';
import { Alert } from '../../components/ui/Alert';
import { DirectSaleRates } from '../../components/DirectSaleRates';
import { PaymentCollectionForm } from '../../components/PaymentCollectionForm';
import { collectionError, emptyCollection, receiptParts } from '../../lib/paymentCollection';
import { PricingBreakdown, type PricingSnapshot } from '../../components/PricingBreakdown';
import { PaymentSummary, type PaymentFacts } from '../../components/PaymentSummary';
import { fetchActiveCylinderTypes, fetchActiveLocations } from '../../lib/catalog';
type Customer = {
    id: number;
    name: string;
    full_name?: string;
    phone: string;
    address: string;
    pending_amount: string;
    custom_rates?: { cylinder_type: number; custom_price: string }[];
};
type Cylinder = {
    id: number;
    name: string;
    is_active: boolean;
    refill_rate: string;
    deposit_amount: string;
};
type Product = {
    id: number;
    name: string;
    selling_price: string;
};
type Location = {
    id: number;
    name: string;
    code: string;
    is_active: boolean;
};
type CylinderLine = {
    cylinder_type: number;
    quantity: number;
    rate_type: 'refill' | 'new';
    empty_returned: number;
    refill_charge?: string;
    deposit?: string;
};
type ProductLine = {
    product: number;
    quantity: number;
};
type Quote = {
    total_amount: string;
    items: (PricingSnapshot & {
        cylinder_type_name: string;
        rate: string;
        discount_amount: string;
        final_amount: string;
    })[];
    accessory_items: {
        name: string;
        quantity: number;
        rate: string;
        total_amount: string;
    }[];
};
const money = (value: string | number) => `₹${Number(value).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
function QuantityControl({ label, value, onChange, disabled, min = 1 }: {
    label: string; value: number; onChange: (value: number) => void; disabled: boolean; min?: number;
}) {
    return <div className="sa-sale__quantity"><IconButton type="button" label={`Decrease ${label.toLowerCase()}`} variant="outline" disabled={disabled || value <= min} onClick={() => onChange(value - 1)}><Minus size={16} /></IconButton>
        <Input aria-label={label} type="number" inputMode="numeric" min={min} disabled={disabled} value={value} onChange={e => onChange(Number(e.target.value))} />
        <IconButton type="button" label={`Increase ${label.toLowerCase()}`} variant="outline" disabled={disabled} onClick={() => onChange(value + 1)}><Plus size={16} /></IconButton></div>;
}
export default function StaffDirectSale({ onBack, onDone, onBusyChange }: {
    onBack: () => void;
    onDone: () => void;
    onBusyChange?: (busy: boolean) => void;
}) {
    const accessoryCapability = useCapabilities();
    const [step, setStep] = useState(0);
    function goStep(next: number) { setStep(next); window.scrollTo({ top: 0, behavior: 'smooth' }); }
    const [customers, setCustomers] = useState<Customer[]>([]);
    const [search, setSearch] = useState('');
    const [searching, setSearching] = useState(false);
    const [searchError, setSearchError] = useState('');
    const [catalogLoading, setCatalogLoading] = useState(true);
    const [customer, setCustomer] = useState<Customer | null>(null);
    const [cylinders, setCylinders] = useState<Cylinder[]>([]);
    const [products, setProducts] = useState<Product[]>([]);
    const [locations, setLocations] = useState<Location[]>([]);
    const [location, setLocation] = useState('');
    const [stock, setStock] = useState<{
        location: number;
        cylinder_type: number;
        quantity: number;
    }[]>([]);
    const [lines, setLines] = useState<CylinderLine[]>([]);
    const [accessories, setAccessories] = useState<ProductLine[]>([]);
    const [form, setForm] = useState(emptyCollection);
    const [quote, setQuote] = useState<{
        key: string;
        data: Quote;
    } | null>(null);
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);
    const [result, setResult] = useState<{
        id: number;
        total_amount: string;
        paid_amount: string;
        balance_due: string;
        payment_summary: PaymentFacts;
    } | null>(null);
    const [pending, setPending] = useState(() => pendingTransaction('staff-sale'));
    type SaleResult = {
        id: number;
        total_amount: string;
        paid_amount: string;
        balance_due: string;
        payment_summary: PaymentFacts;
    };
    const key = JSON.stringify({ customer: customer?.id, sale_items: lines.map(({ deposit, ...line }) => ({ ...line, ...(line.rate_type === 'new' ? { deposit } : {}) })), accessory_lines: accessories });
    function updateLine(index: number, patch: Partial<CylinderLine>) {
        setLines(previous => previous.map((line, i) => i === index
            ? { ...line, ...(patch.cylinder_type !== undefined ? { refill_charge: undefined, deposit: undefined } : {}), ...patch }
            : line));
    }
    function lineRates(line: CylinderLine) {
        const cylinder = cylinders.find(c => c.id === line.cylinder_type);
        const agreed = customer?.custom_rates?.find(rate => rate.cylinder_type === line.cylinder_type);
        return {
            refill: line.refill_charge ?? agreed?.custom_price ?? cylinder?.refill_rate ?? '',
            deposit: line.deposit ?? cylinder?.deposit_amount ?? '',
        };
    }
    const current = quote?.key === key ? quote.data : null;
    const availableCylinders = cylinders.filter(c => stock.some(s => s.location === Number(location) && s.cylinder_type === c.id && s.quantity > 0));
    useEffect(() => { let cancelled = false; Promise.all([fetchActiveCylinderTypes() as unknown as Promise<Cylinder[]>, fetchCatalogPages<Product>('/products/'), fetchActiveLocations('stock') as unknown as Promise<Location[]>, fetchAllPages<{
            location: number;
            cylinder_type: number;
            quantity: number;
        }>('/stock/?status=filled')]).then(([c, p, l, stockRows]) => { if (cancelled)
        return; setCylinders(c.filter(c => c.is_active)); setStock(stockRows); setProducts(p); const allowed = l.filter(v => v.is_active !== false); setLocations(allowed); setLocation(String(allowed[0]?.id || '')); }).catch(e => { if (!cancelled)
        setError(extractApiError(e)); }).finally(() => { if (!cancelled) setCatalogLoading(false); }); return () => { cancelled = true; }; }, []);
    useEffect(() => {
        let cancelled = false;
        const timer = setTimeout(() => {
            if (search.trim().length < 2) return;
            api.get('/customers/', { params: { search, active: 1, page_size: 10 } }).then(r => {
                if (!cancelled) setCustomers(r.data.results || r.data);
            }).catch(e => {
                if (!cancelled) setSearchError(extractApiError(e));
            }).finally(() => { if (!cancelled) setSearching(false); });
        }, 250);
        return () => { cancelled = true; clearTimeout(timer); };
    }, [search]);
    useEffect(() => { if (!customer || (!lines.length && !accessories.length))
        return; let cancelled = false; const t = setTimeout(() => { api.post('/staff-sales/preview/', JSON.parse(key)).then(r => { if (!cancelled) {
        setQuote({ key, data: r.data });
        setError('');
    } }).catch(e => { if (!cancelled)
        setError(extractApiError(e)); }); }, 250); return () => { cancelled = true; clearTimeout(t); }; }, [key, customer, lines.length, accessories.length]);
    async function submit() {
        if (busy)
            return;
        if (!pending && (!current || !customer))
            return;
        const problem = !pending && current ? collectionError(form, Number(current.total_amount)) : '';
        if (problem) {
            setError(problem);
            return;
        }
        const parts = receiptParts(form);
        const paid = parts.reduce((sum, p) => sum + Number(p.amount), 0);
        const payment = parts.length > 1 ? { payment_mode: 'split', split_payments: parts } :
            parts.length === 1 ? { payment_mode: paid === Number(current?.total_amount) ? parts[0].mode : 'credit', paid_amount: parts[0].amount, paid_payment_mode: parts[0].mode } : { payment_mode: 'credit', paid_amount: '0' };
        setBusy(true);
        onBusyChange?.(true);
        try {
            const data = await transactionRequest<SaleResult>('staff-sale', '/staff-sales/', pending ? undefined : { ...JSON.parse(key), location: Number(location), quoted_total: current!.total_amount, ...payment });
            setResult(data);
            onDone();
        }
        catch (e) {
            setError(extractApiError(e));
        }
        finally {
            setBusy(false);
            onBusyChange?.(false);
            setPending(pendingTransaction('staff-sale'));
        }
    }
    const header = <header className="sa-sale__header"><IconButton label="Back to Home" variant="outline" disabled={busy} onClick={onBack}><ArrowLeft size={20} /></IconButton><div><h1>New Direct Sale</h1><p>Choose a customer, add items and collect payment.</p></div></header>;
    if (result) return <div className="sa-sale">{header}<Card className="sa-sale__success" role="status"><CheckCircle2 size={30} aria-hidden="true" /><CardHeader title={`Direct Sale #${result.id} completed`} /><PaymentSummary value={result.payment_summary} /><Button onClick={onBack}>Return to Home</Button></Card></div>;
    if (pending) return <div className="sa-sale">{header}<Card><CardHeader title="Confirm previous sale" /><p>A previous sale has not been confirmed. Retry that saved request before starting another sale.</p>{error && <Alert tone="danger">{error}</Alert>}<Button block disabled={busy} loading={busy} onClick={submit}>Retry saved sale</Button></Card></div>;
    const locked = busy || catalogLoading;
    const orderSummary = <Card padding="sm" className="sa-sale__summary">
        <CardHeader title="Sale summary" meta={<ShoppingBag size={18} aria-hidden="true" />} />
        {customer && <div className="sa-sale__summary-customer"><span>Customer</span><strong>{customer.name || customer.full_name}</strong><span>{customer.phone} · {locations.find(l => l.id === Number(location))?.name}</span></div>}
        {current ? <>
                <div className="sa-sale__review" aria-label="Order summary">{current.items.map((line, i) => <div key={i} className="sa-sale__review-item"><div className="sa-sale__subtotal"><div><strong>{line.cylinder_type_name}</strong><span>{line.quantity} × {money(line.rate)} · {line.rate_type === 'new' ? 'New Cylinder' : 'Refill'}</span>{Number(line.discount_amount) > 0 && <span className="sa-sale__discount">{money(line.discount_amount)} refill discount</span>}</div><strong>{money(line.final_amount)}</strong></div><details className="sa-sale__details"><summary>Pricing breakdown</summary><PricingBreakdown value={line} /></details></div>)}
                    {current.accessory_items.map((p, i) => <div key={i} className="sa-sale__subtotal"><div><strong>{p.name}</strong><span>{p.quantity} × {money(p.rate)}</span></div><strong>{money(p.total_amount)}</strong></div>)}
                    <div className="sa-sale__total"><strong>Order total</strong><strong>{money(current.total_amount)}</strong></div>
                </div>
        </> : <div className="sa-sale__summary-empty"><ShoppingBag size={28} aria-hidden="true" /><strong>{lines.length + accessories.length ? 'Checking prices' : 'Your sale starts here'}</strong><p>{error ? 'Check the highlighted details to continue.' : lines.length + accessories.length ? 'Fetching the current customer prices…' : 'Selected items and their total will appear here.'}</p></div>}
    </Card>;
    return <div className={`sa-sale sa-sale--step-${step}`}>{header}
        <nav className="sa-sale__steps" aria-label="Sale steps">{['Customer', 'Items', 'Payment'].map((label, index) => <button type="button" key={label} disabled={busy || (index > 0 && (!customer || !location)) || (index === 2 && !current)} aria-current={index === step ? 'step' : undefined} onClick={() => goStep(index)}><span>{index < step ? <CheckCircle2 size={16} /> : index + 1}</span>{label}</button>)}</nav>
        {error && <Alert tone="danger">{error}</Alert>}
        <div className="sa-sale__workspace"><div className="sa-sale__main">
        {step === 0 && <Card padding="sm" className="sa-sale__section">
            <CardHeader title="Who is this sale for?" as="h2" />
            {customer ? <div className="sa-sale__customer"><UserRound size={20} aria-hidden="true" /><div><strong>{customer.name || customer.full_name}</strong><span>{customer.phone}</span></div><Button size="sm" variant="ghost" disabled={locked} onClick={() => { setCustomer(null); setSearch(''); setCustomers([]); }}>Change</Button></div> : <>
                <Field label="Search by name or phone"><Input leadingIcon={<Search size={17} />} placeholder="Name or phone number" autoComplete="off" value={search} disabled={locked} onChange={e => { setSearch(e.target.value); setSearching(e.target.value.trim().length >= 2); setSearchError(''); setCustomers([]); }} /></Field>
                {searching && <p className="sa-muted" role="status">Searching customers…</p>}
                {searchError && <Alert tone="danger" compact>{searchError}</Alert>}
                {!searching && !searchError && search.trim().length >= 2 && !customers.length && <p className="sa-muted" role="status">No customers found. Try another name or phone number.</p>}
                {!!customers.length && <div className="sa-sale__matches" aria-label="Matching customers">{customers.map(c => <button type="button" disabled={locked} key={c.id} onClick={() => { setCustomer(c); setCustomers([]); }}><strong>{c.name || c.full_name}</strong><span>{c.phone}</span></button>)}</div>}
            </>}
            {customer && <details className="sa-sale__details"><summary>Customer details</summary>{customer.address && <p>{customer.address}</p>}<p>Existing balance: {money(customer.pending_amount)}</p></details>}
            <Field label="Stock location"><Select value={location} disabled={locked} onChange={e => { setLocation(e.target.value); setLines([]); }}>{catalogLoading && <option>Loading locations…</option>}{locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}</Select></Field>
            <div className="sa-sale__next"><Button block iconRight={<ArrowRight size={17} />} disabled={locked || !customer || !location} onClick={() => goStep(1)}>Continue to items</Button></div>
        </Card>}
        {step === 1 && <Card padding="sm" className="sa-sale__section">
            <CardHeader title="What are you selling?" as="h2" meta={<span className="sa-muted">{lines.length + accessories.length} selected</span>} />
            {catalogLoading && <p className="sa-muted" role="status">Loading available products…</p>}
            <section className="sa-sale__group" aria-label="Cylinders">
                <div className="sa-sale__group-heading"><h3>Cylinders</h3><Button size="sm" variant="secondary" icon={<Plus size={15} />} disabled={locked || !availableCylinders.length} onClick={() => setLines([...lines, { cylinder_type: availableCylinders[0].id, quantity: 1, rate_type: 'refill', empty_returned: 0 }])}>Add cylinder</Button></div>
                {!lines.length && <p className="sa-muted">{!catalogLoading && !availableCylinders.length ? 'No cylinders available at this location.' : 'Add a refill or a new cylinder.'}</p>}
                {lines.map((line, index) => <div key={index} className="sa-sale__item">
                    <div className="sa-sale__picker"><Field label="Cylinder"><Select disabled={locked} value={line.cylinder_type} onChange={e => updateLine(index, { cylinder_type: Number(e.target.value) })}>{availableCylinders.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</Select></Field><IconButton label="Remove cylinder" tone="danger" disabled={locked} onClick={() => setLines(lines.filter((_, i) => i !== index))}><Trash2 size={17} /></IconButton></div>
                    <div className="sa-sale__item-grid">
                        <Field label="Rate type"><Select disabled={locked} value={line.rate_type} onChange={e => setLines(lines.map((l, i) => i === index ? { ...l, rate_type: e.target.value as 'new' | 'refill' } : l))}><option value="refill">Refill</option><option value="new">New Cylinder</option></Select></Field>
                        <Field as="div" label="Quantity"><QuantityControl label="Quantity" disabled={locked} value={line.quantity} onChange={quantity => setLines(lines.map((l, i) => i === index ? { ...l, quantity } : l))} /></Field>
                        <Field label="Empty returned"><Input type="number" inputMode="numeric" min="0" disabled={locked} value={line.empty_returned} onChange={e => setLines(lines.map((l, i) => i === index ? { ...l, empty_returned: Number(e.target.value) } : l))} /></Field>
                    </div>
                    <div className="sa-sale__rates">
                        <DirectSaleRates rateType={line.rate_type} rateLabel="Refill Rate (Rs.)" disabled={locked}
                            rate={lineRates(line).refill} deposit={lineRates(line).deposit}
                            onRateChange={refill_charge => updateLine(index, { refill_charge })}
                            onDepositChange={deposit => updateLine(index, { deposit })} />
                    </div>
                </div>)}
            </section>
            <section className="sa-sale__group" aria-label="Accessories">
                {accessoryCapability.value?.accessories === false && <p role="status">Accessories are disabled; cylinder sales remain available.</p>}
                {accessoryCapability.error && <p role="alert">{accessoryCapability.error} <button type="button" onClick={accessoryCapability.retry}>Retry feature check</button></p>}
                <div className="sa-sale__group-heading"><h3>Accessories</h3><Button size="sm" variant="secondary" icon={<Plus size={15} />} disabled={accessoryCapability.value?.accessories !== true || locked || !products.length} onClick={() => setAccessories([...accessories, { product: products[0].id, quantity: 1 }])}>Add accessory</Button></div>
                {!accessories.length && <p className="sa-muted">{!catalogLoading && !products.length ? 'No accessories available.' : 'Add accessories if needed.'}</p>}
                {accessories.map((line, index) => <div key={index} className="sa-sale__item">
                    <div className="sa-sale__picker"><Field label="Accessory"><Select disabled={locked} value={line.product} onChange={e => setAccessories(accessories.map((l, i) => i === index ? { ...l, product: Number(e.target.value) } : l))}>{products.map(p => <option key={p.id} value={p.id}>{p.name} · {money(p.selling_price)}</option>)}</Select></Field><IconButton label="Remove accessory" tone="danger" disabled={locked} onClick={() => setAccessories(accessories.filter((_, i) => i !== index))}><Trash2 size={17} /></IconButton></div>
                    <Field as="div" label="Quantity"><QuantityControl label="Accessory quantity" disabled={locked} value={line.quantity} onChange={quantity => setAccessories(accessories.map((l, i) => i === index ? { ...l, quantity } : l))} /></Field>
                </div>)}
            </section>
            <div className="sa-sale__next"><div className="sa-sale__next-total"><span>Order total</span><strong>{current ? money(current.total_amount) : '—'}</strong></div><Button block iconRight={<ArrowRight size={17} />} disabled={locked || !current} onClick={() => goStep(2)}>Continue to payment</Button></div>
        </Card>}
        {step === 2 && <Card padding="sm" className="sa-sale__section">
            <CardHeader title="Collect payment" description="Record the amount actually received." as="h2" />
            {current ? <>
                <div className="sa-sale__payment"><PaymentCollectionForm value={form} onChange={setForm} total={Number(current.total_amount)} disabled={locked} presentation="tiles" /></div>
                <Button block disabled={busy || !location || !!collectionError(form, Number(current.total_amount))} loading={busy} icon={<CheckCircle2 size={18} />} onClick={submit}>Complete sale</Button>
            </> : <p className="sa-muted" role="status">{customer && (lines.length || accessories.length) ? error ? 'Check the items above to continue.' : 'Updating prices…' : 'Select a customer and add items to review current prices.'}</p>}
        </Card>}
        </div><aside className="sa-sale__aside">{orderSummary}</aside></div>
    </div>;
}
