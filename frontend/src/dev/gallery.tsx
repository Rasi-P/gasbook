import React from 'react';
import ReactDOM from 'react-dom/client';
import '../index.css';
import { ToastProvider } from '../components/ui/Toast';
import { UiGallery } from './UiGallery';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ToastProvider>
      <UiGallery />
    </ToastProvider>
  </React.StrictMode>,
);
