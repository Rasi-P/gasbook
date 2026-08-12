import { useState, useEffect } from 'react';
import type { FormEvent } from 'react';
import { login, api, getRoleHome } from '../lib/api';
import sabcoLogo from '../assets/sabco_logo.png';
import splashBg from '../assets/splash_bg.png';
import splashCylinder from '../assets/splash_cylinder.png';
function UserIcon() {
  return (
    <svg className="field-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg className="field-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}

function EyeIcon({ open }: { open: boolean }) {
  if (open) {
    return (
      <svg viewBox="0 0 24 24" aria-hidden="true" width="20" height="20">
        <path
          d="M3 3l18 18m-9.57-3C6.98 18 4 12 4 12a14.6 14.6 0 0 1 3.27-4.19M9.88 9.88A3 3 0 0 0 12 15a3 3 0 0 0 2.12-.88M14.12 14.12 9.88 9.88m4.45-4.1C18.44 7.1 20 12 20 12s-1.54 4.9-5.67 6.22M12 6c-1.05 0-2.04.2-2.95.56"
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="1.8"
        />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" width="20" height="20">
      <path
        d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
      />
      <circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}

export default function Login() {
  const [showSplash, setShowSplash] = useState(true);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [loginError, setLoginError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      setShowSplash(false);
    }, 2200);
    return () => clearTimeout(timer);
  }, []);

  async function handleLogin(e: FormEvent) {
    e.preventDefault();
    if (!username.trim() || !password) {
      setLoginError('Username and password are required.');
      return;
    }
    setLoginError('');
    setIsSubmitting(true);
    try {
      const tokenData = await login(username, password);
      if (tokenData.must_change_password) {
        localStorage.setItem('gasbook_force_password_change', '1');
        window.location.href = '/change-password';
        return;
      }
      const { data } = await api.get('/auth/me/');
      localStorage.setItem('gasbook_role', data.role);
      localStorage.setItem('gasbook_name', data.name);
      localStorage.setItem('gasbook_vehicle_location', data.vehicle_location_name || '');
      window.location.href = getRoleHome(data.role);
    } catch {
      setLoginError('Wrong username or password.');
    } finally {
      setIsSubmitting(false);
    }
  }

  if (showSplash) {
    return (
      <div className="app-container" onClick={() => setShowSplash(false)}>
        <div className="app-screen">
          <div className="splash-screen">
            <img src={splashBg} className="splash-bg-layer" alt="" />
            <div className="splash-screen-interactive-area" />
            <div className="splash-branding">
              <img src={sabcoLogo} className="brand-logo-img" alt="Sabco logo" />
            </div>
            <div className="splash-cylinder-layer">
              <img src={splashCylinder} className="cylinder-hero-img" alt="Gas Cylinder" />
            </div>
            <div className="splash-content-layer">
              <div className="splash-tagline">
                <h2>Safe. Reliable. Always.</h2>
                <p>Your trusted gas partner<br />for every home.</p>
              </div>
              <div className="dots-indicator">
                <span className="dot active" />
                <span className="dot" />
                <span className="dot" />
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="legacy-auth-shell">
      <div className="login-screen">
        <div className="login-header">
          <img src={sabcoLogo} className="login-brand-logo" alt="Sabco logo" />
        </div>

        <div className="login-card">
          <div className="login-card-header">
            <h2>Welcome Back 👋</h2>
            <p>Please login to continue</p>
          </div>

          <form className="login-form" onSubmit={handleLogin}>
            <div className="form-group">
              <label htmlFor="username">Username</label>
              <div className="input-wrapper">
                <UserIcon />
                <input
                  id="username"
                  type="text"
                  placeholder="Username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  autoComplete="username"
                  required
                />
              </div>
            </div>

            <div className="form-group">
              <label htmlFor="login-password">Password</label>
              <div className="input-wrapper">
                <LockIcon />
                <input
                  id="login-password"
                  type={showPassword ? 'text' : 'password'}
                  placeholder="Password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                  required
                />
                <button
                  type="button"
                  className="password-toggle"
                  onClick={() => setShowPassword(!showPassword)}
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  <EyeIcon open={!showPassword} />
                </button>
              </div>
            </div>

            <div className="form-actions">
              <label className="remember-me">
                <input
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(e) => setRememberMe(e.target.checked)}
                />
                <span>Remember me</span>
              </label>
              <button type="button" className="forgot-link">
                Forgot Password?
              </button>
            </div>

            {loginError ? <p className="form-feedback form-feedback--error">{loginError}</p> : null}

            <button type="submit" className="btn-primary" disabled={isSubmitting}>
              {isSubmitting ? 'SIGNING IN...' : 'LOGIN'}
            </button>
          </form>

          <div className="login-footer">
            <p>Need Help?</p>
            <button type="button" className="contact-link">
              Distributor Contact
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

