import { useEffect, useRef, useState, type InputHTMLAttributes } from 'react';
import { useCapabilities } from '../hooks/useCapabilities';

export function ImageUpload(props: InputHTMLAttributes<HTMLInputElement>) {
  const { value, error, retry } = useCapabilities();
  const previewUrl = useRef('');
  const [url, setUrl] = useState('');
  const [validation, setValidation] = useState('');
  useEffect(() => () => { if (previewUrl.current) URL.revokeObjectURL(previewUrl.current); }, []);
  const enabled = value?.image_uploads === true;
  return <span>
    <input {...props} type="file" accept="image/png,image/jpeg,image/webp" disabled={props.disabled || !enabled} onChange={event => {
      const file = event.target.files?.[0];
      if (previewUrl.current) URL.revokeObjectURL(previewUrl.current);
      previewUrl.current = ''; setUrl('');
      if (file && (file.size > 5 * 1024 * 1024 || !['image/png', 'image/jpeg', 'image/webp'].includes(file.type))) {
        event.target.value = ''; setValidation('Choose JPEG, PNG or WebP up to 5 MiB.'); props.onChange?.(event); return;
      }
      setValidation('');
      if (file) { previewUrl.current = URL.createObjectURL(file); setUrl(previewUrl.current); }
      props.onChange?.(event);
    }} />
    {!value && !error && <small>Checking image availability…</small>}
    {value && !enabled && <small>Image uploads are disabled. You can save without a photo.</small>}
    {error && <span role="alert">{error} <button type="button" onClick={retry}>Retry</button></span>}
    {validation && <span role="alert">{validation}</span>}
    {url && <img src={url} alt="Selected image preview" style={{ maxWidth: 100, maxHeight: 100 }} />}
  </span>;
}
