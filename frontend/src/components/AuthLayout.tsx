import type { ReactNode } from 'react';
import sabcoLogo from '../assets/sabco_logo.png';
import splashCylinder from '../assets/splash_cylinder.png';

/**
 * Shared frame for Login, Forgot Password and Change Password.
 * Phones: brand band above the form. Tablets: centred card. Desktop (980px+): split card with a brand panel.
 * Inside the admin shell (Change Password from the app) the brand panel is hidden and the card sits in the content area.
 */
export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-brand">
          <img src={sabcoLogo} className="auth-brand__logo" alt="Sabco logo" />
          <img src={splashCylinder} className="auth-brand__art" alt="" />
        </div>
        <div className="auth-panel">{children}</div>
      </div>
    </div>
  );
}

export function AuthHeader({ title, subtitle }: { title: ReactNode; subtitle: ReactNode }) {
  return (
    <div className="auth-panel__header">
      <h2>{title}</h2>
      <p>{subtitle}</p>
    </div>
  );
}
