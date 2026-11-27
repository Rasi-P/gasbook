import { afterEach, beforeEach, expect, it, spyOn } from 'bun:test';
import { AxiosError } from 'axios';
import { api } from '../src/lib/api';
import { pendingTransaction, transactionRequest } from '../src/lib/transactionRequest';
const originalStorage = globalThis.localStorage;
let post: ReturnType<typeof spyOn>;
beforeEach(() => {
 const values = new Map<string,string>();
 Object.defineProperty(globalThis, 'localStorage', {configurable:true,value:{getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>values.set(key,value),removeItem:(key:string)=>values.delete(key)}});
 localStorage.setItem('gasbook_access',`header.${btoa(JSON.stringify({user_id:1}))}.signature`);
 post=spyOn(api,'post');
});
afterEach(() => {post.mockRestore();Object.defineProperty(globalThis,'localStorage',{configurable:true,value:originalStorage});});
it('keeps the exact request and reference across uncertain failures and reopening',async()=>{
 post.mockRejectedValueOnce(new Error('Connection lost'));
 const original={payments:[{mode:'cash',amount:'100'}]};
 await expect(transactionRequest('sale-1','/test/',original)).rejects.toThrow('Connection lost');
 const saved=pendingTransaction('sale-1');expect(saved?.client_ref).toBeString();expect(saved?.payments).toEqual(original.payments);
 post.mockResolvedValueOnce({data:{ok:true}});
 await transactionRequest('sale-1','/test/',{payments:[{mode:'cash',amount:'999'}]});
 expect(post.mock.calls[1][1]).toEqual(saved);expect(pendingTransaction('sale-1')).toBeNull();
});
it('clears definitive validation failures so corrected amounts can be entered',async()=>{
 const error=new AxiosError('Overpayment');error.response={status:400,data:{code:'exceeds_balance'}} as never;
 post.mockRejectedValueOnce(error);
 await expect(transactionRequest('sale-1','/test/',{payments:[]})).rejects.toThrow();
 expect(pendingTransaction('sale-1')).toBeNull();
});
it('never reuses another staff account’s pending request',async()=>{
 post.mockRejectedValueOnce(new Error('Offline'));
 await expect(transactionRequest('sale-1','/test/',{payments:[]})).rejects.toThrow();
 localStorage.setItem('gasbook_access',`header.${btoa(JSON.stringify({user_id:2}))}.signature`);
 expect(pendingTransaction('sale-1')).toBeNull();
});
it('does not submit when durable retry storage is unavailable',async()=>{
 localStorage.setItem=()=>{throw new Error('Storage unavailable');};
 await expect(transactionRequest('sale-1','/test/',{payments:[]})).rejects.toThrow('Storage unavailable');
 expect(post).not.toHaveBeenCalled();
});
