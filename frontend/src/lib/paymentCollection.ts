export type ReceiptMode = 'cash' | 'gpay' | 'bank';
export type CollectionForm = {
    mode: ReceiptMode | 'split' | 'credit';
    cash: string;
    gpay: string;
    bank: string;
};
export const emptyCollection = (): CollectionForm => ({ mode: 'cash', cash: '', gpay: '', bank: '' });
export const receiptLabels = { cash: 'Cash', gpay: 'UPI / GPay', bank: 'Bank Transfer' };
export function receiptParts(value: CollectionForm) {
    const modes: ReceiptMode[] = value.mode === 'credit' ? [] : value.mode === 'split' ? ['cash', 'gpay', 'bank'] : [value.mode];
    return modes.filter(mode => Number(value[mode]) > 0).map(mode => ({ mode, amount: Number(value[mode]).toFixed(2) }));
}
export function collectionError(value: CollectionForm, total: number) {
    const modes: ReceiptMode[] = value.mode === 'split' ? ['cash', 'gpay', 'bank'] : value.mode === 'credit' ? [] : [value.mode];
    if (modes.some(m => value[m] !== '' && (!/^\d+(\.\d{1,2})?$/.test(value[m]) || !Number.isFinite(Number(value[m])))))
        return 'Enter valid amounts with at most two decimal places.';
    const paid = receiptParts(value).reduce((sum, p) => sum + Math.round(Number(p.amount) * 100), 0);
    if (paid > Math.round(total * 100))
        return 'Collected amount cannot exceed the amount due.';
    if (value.mode !== 'credit' && paid === 0 && total > 0)
        return 'Enter the amount received, or choose Credit / Pay later.';
    return '';
}
