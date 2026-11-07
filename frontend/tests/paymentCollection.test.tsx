import { expect, it } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { PaymentCollectionForm } from '../src/components/PaymentCollectionForm';
import { collectionError, emptyCollection, receiptParts } from '../src/lib/paymentCollection';
import { PaymentSummary } from '../src/components/PaymentSummary';
it('requires actual receipts or explicit credit and never defaults to full payment',()=>{
 const initial=emptyCollection();expect(receiptParts(initial)).toEqual([]);expect(collectionError(initial,1000)).not.toBe('');
 expect(collectionError({...initial,mode:'credit'},1000)).toBe('');
});
it('splits cash/UPI/bank and allows partial payment without counting unpaid credit',()=>{
 const value={...emptyCollection(),mode:'split' as const,cash:'400',gpay:'600'};
 expect(receiptParts(value)).toEqual([{mode:'cash',amount:'400.00'},{mode:'gpay',amount:'600.00'}]);
 expect(collectionError(value,1000)).toBe('');expect(collectionError(value,999)).not.toBe('');
 const html=renderToStaticMarkup(<PaymentCollectionForm value={{...value,gpay:''}} total={1000} onChange={()=>{}} />);
 expect(html).toContain('₹400');expect(html).toContain('₹600');expect(html).toContain('Outstanding credit');
});
it('rejects negatives, non-finite and excess precision without silently rounding',()=>{
 for(const cash of ['-1','NaN','Infinity','0.001','1e3']) expect(collectionError({...emptyCollection(),cash},1000)).not.toBe('');
 expect(receiptParts({...emptyCollection(),cash:'100',gpay:'999'})).toEqual([{mode:'cash',amount:'100.00'}]);
});
it('shows saved payments and balances with their actual IST timestamp',()=>{
 const html=renderToStaticMarkup(<PaymentSummary value={{sale_id:1,total_amount:'1000',paid_amount:'400',balance_due:'600',status:'PARTIAL',payments:[{id:1,amount:'400',mode:'cash',created_at:'2026-10-15T18:30:00Z',kind:'payment'}]}} allowCollection />);
 for(const text of ['Amount paid','₹400','₹600','Cash','16 Oct 2026','Collect outstanding balance']) expect(html).toContain(text);
 expect(renderToStaticMarkup(<PaymentSummary />)).toBe('');
});
