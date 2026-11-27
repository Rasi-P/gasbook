import { useEffect, useState } from 'react';
import { Banknote, Landmark, Smartphone, Wallet } from 'lucide-react';
import { api, extractApiError } from '../lib/api';
import { Card } from './ui/Card';
import { ErrorState } from './AsyncState';
import { receiptLabels } from '../lib/paymentCollection';
type Summary = {
    date: string;
    total: string;
    methods: Record<string, string>;
    refunds: string;
};
const methodIcons = { cash: Banknote, gpay: Smartphone, bank: Landmark };
const money = (value: string) => `₹${Number(value).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export function TodayCollections({ refreshKey }: { refreshKey: number }) {
    const [result, setResult] = useState<{ key: string; data?: Summary; error?: string } | null>(null);
    const [retry, setRetry] = useState(0);
    const key = `${refreshKey}:${retry}`;
    useEffect(() => {
        const refresh = () => setRetry(value => value + 1);
        const timer = window.setInterval(refresh, 60_000);
        window.addEventListener('focus', refresh);
        return () => { window.clearInterval(timer); window.removeEventListener('focus', refresh); };
    }, []);
    useEffect(() => {
        let cancelled = false;
        api.get<Summary>('/staff-sales/collections-today/').then(r => {
            if (!cancelled) setResult({ key, data: r.data });
        }).catch(e => {
            if (!cancelled) setResult({ key, error: extractApiError(e, [], 'Could not load collections.') });
        });
        return () => { cancelled = true; };
    }, [key]);
    const current = result?.key === key ? result : null;
    return <Card className="sa-collections" padding="sm" aria-label="Today's Collection" aria-busy={!current}>
        <div className="sa-collections__heading"><h2>Today's Collection</h2><span>IST</span></div>
        {current?.error ? <ErrorState message={current.error} onRetry={() => setRetry(v => v + 1)} /> : <>
            {!current && <span className="sr-only" role="status">Loading collections…</span>}
            <div className="sa-collections__total"><span className="sa-collections__icon"><Wallet size={21} aria-hidden="true" /></span><div><span>Total Collected</span>
                {current?.data ? <strong>{money(current.data.total)}</strong> : <span className="sa-collections__skeleton" />}
            </div></div>
            <div className="sa-collections__methods">
                {(Object.keys(receiptLabels) as (keyof typeof receiptLabels)[]).map(mode => {
                    const Icon = methodIcons[mode];
                    return <div className="sa-collections__method" key={mode}><Icon size={17} aria-hidden="true" /><span>{receiptLabels[mode]}</span>
                        {current?.data ? <strong>{money(current.data.methods[mode])}</strong> : <span className="sa-collections__skeleton" />}
                    </div>;
                })}
            </div>
            {current?.data && Number(current.data.total) === 0 && <p className="sa-collections__note">No payments collected today yet.</p>}
            {current?.data && Number(current.data.refunds) > 0 && <p className="sa-collections__note">Refunds paid separately: {money(current.data.refunds)}</p>}
        </>}
    </Card>;
}
