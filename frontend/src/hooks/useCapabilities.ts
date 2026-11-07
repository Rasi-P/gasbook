import { useCallback, useEffect, useState } from 'react';
import { api, extractApiError } from '../lib/api';
export type Capabilities = { accessories: boolean; image_uploads: boolean };
export function useCapabilities() {
  const [value, setValue] = useState<Capabilities | null>(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    api.get('/auth/me/').then(({ data }) => {
      if (typeof data.capabilities?.accessories !== 'boolean' || typeof data.capabilities?.image_uploads !== 'boolean') throw new Error('Capabilities unavailable');
      if (live) { setValue(data.capabilities); setError(''); }
    }).catch(e => { if (live) setError(extractApiError(e, [], 'Could not check feature availability.')); });
    return () => { live = false; };
  }, [attempt]);
  return { value, error, retry: useCallback(() => setAttempt(n => n + 1), []) };
}
