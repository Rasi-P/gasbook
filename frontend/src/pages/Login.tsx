import { useState, useEffect } from 'react';
import type { FormEvent } from 'react';
import { Eye, EyeOff, Lock, User } from 'lucide-react';
import { login, api, getRoleHome, logout, extractApiError, getApiStatus, getApiErrorCode, FORCE_PASSWORD_CHANGE_KEY } from '../lib/api';
import { AuthHeader, AuthLayout } from '../components/AuthLayout';
import { Alert } from '../components/ui/Alert';
import { Button } from '../components/ui/Button';
import { Field, Input } from '../components/ui/Field';
import { IconButton } from '../components/ui/IconButton';
import sabcoLogo from '../assets/sabco_logo.png';
import splashBg from '../assets/splash_bg.png';
import splashCylinder from '../assets/splash_cylinder.png';

const SUPPORT_CONTACT_NAME = (import.meta.env.VITE_SUPPORT_CONTACT_NAME || 'Admin').trim() || 'Admin';
const SUPPORT_WHATSAPP_NUMBER = (import.meta.env.VITE_SUPPORT_WHATSAPP_NUMBER || '').trim();

function sanitizePhoneNumber(value: string) {
  return value.replace(/[^\d]/g, '');
}

function buildSupportWhatsappLink(username: string) {
  const phone = sanitizePhoneNumber(SUPPORT_WHATSAPP_NUMBER);
  const cleanUsername = username.trim();

  if (!phone || !cleanUsername) {
    return null;
  }

  const message =
    `Hello ${SUPPORT_CONTACT_NAME}, I forgot my GasBook staff password.` +
    ` Please send a temporary password for username: ${cleanUsername}.` +
    ` I will change it immediately after login.`;

  return `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
}

export default function Login() {
  const [showSplash, setShowSplash] = useState(true);
  const [view, setView] = useState<'login' | 'forgot-password'>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [loginError, setLoginError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const supportWhatsappAvailable = Boolean(sanitizePhoneNumber(SUPPORT_WHATSAPP_NUMBER));
  const supportWhatsappLink = buildSupportWhatsappLink(username);

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
      const { data } = await api.get('/auth/me/');
      if (data.role === 'customer') {
        logout();
        setLoginError('This account is for the customer app, not the management portal.');
        return;
      }
      localStorage.setItem('gasbook_role', data.role);
      localStorage.setItem('gasbook_name', data.name);
      localStorage.setItem('gasbook_vehicle_location', data.vehicle_location_name || '');
      if (tokenData.must_change_password || data.must_change_password) {
        localStorage.setItem(FORCE_PASSWORD_CHANGE_KEY, '1');
        window.location.href = '/change-password';
        return;
      }
      localStorage.removeItem(FORCE_PASSWORD_CHANGE_KEY);
      window.location.href = getRoleHome(data.role);
    } catch (err) {
      const status = getApiStatus(err);
      const code = getApiErrorCode(err);
      if (status === 403 && code === 'password_change_required') {
        // Token issued but every other call is gated: go straight to the change-password screen.
        localStorage.setItem(FORCE_PASSWORD_CHANGE_KEY, '1');
        window.location.href = '/change-password';
        return;
      }
      if (status === 401) {
        logout();
        setLoginError('Wrong username or password.');
      } else if (status === 403) {
        logout();
        setLoginError(extractApiError(err, [], 'This account cannot sign in here.'));
      } else if (!status) {
        setLoginError(extractApiError(err, [], 'Cannot reach the server. Check your connection and try again.'));
      } else {
        setLoginError(extractApiError(err, [], 'Login failed. Please try again.'));
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  function handleOpenForgotPassword() {
    setLoginError('');
    setView('forgot-password');
  }

  function handleOpenSupportWhatsapp() {
    if (!supportWhatsappLink) {
      return;
    }

    window.location.assign(supportWhatsappLink);
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

  if (view === 'forgot-password') {
    return (
      <AuthLayout>
        <AuthHeader title="Request Password Reset" subtitle="Only admin can send a temporary password for your account." />

        <div className="auth-form">
          <Field label="Username" htmlFor="forgot-username">
            <Input
              id="forgot-username"
              type="text"
              placeholder="Enter your username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              required
            />
          </Field>

          <Alert tone="info" title="Important">
            <p>
              Admin should send only a temporary password on WhatsApp. After you log in with that password, you must
              change it immediately.
            </p>
          </Alert>

          <div className="auth-steps">
            <p>1. Confirm your username.</p>
            <p>2. Tap the WhatsApp button to request a temporary password from {SUPPORT_CONTACT_NAME}.</p>
            <p>3. Log in with the temporary password.</p>
            <p>4. Change your password on the next screen.</p>
          </div>

          {!supportWhatsappAvailable ? (
            <Alert tone="danger" compact>
              Admin WhatsApp contact is not available right now. Please contact the distributor directly.
            </Alert>
          ) : null}

          <div className="auth-actions">
            <Button type="button" size="lg" block disabled={!supportWhatsappLink} onClick={handleOpenSupportWhatsapp}>
              REQUEST ON WHATSAPP
            </Button>

            <Button type="button" variant="secondary" size="lg" block onClick={() => setView('login')}>
              BACK TO LOGIN
            </Button>
          </div>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout>
      <AuthHeader title="Welcome Back 👋" subtitle="Please login to continue" />

      <form className="auth-form" onSubmit={handleLogin}>
        <Field label="Username" htmlFor="username">
          <Input
            id="username"
            type="text"
            placeholder="Username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            required
            leadingIcon={<User size={18} />}
          />
        </Field>

        <Field label="Password" htmlFor="login-password">
          <Input
            id="login-password"
            type={showPassword ? 'text' : 'password'}
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
            leadingIcon={<Lock size={18} />}
            trailing={
              <IconButton
                type="button"
                size="sm"
                label={showPassword ? 'Hide password' : 'Show password'}
                onClick={() => setShowPassword(!showPassword)}
              >
                {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
              </IconButton>
            }
          />
        </Field>

        <div className="auth-row">
          <label className="auth-check">
            <input
              type="checkbox"
              checked={rememberMe}
              onChange={(e) => setRememberMe(e.target.checked)}
            />
            <span>Remember me</span>
          </label>
          <Button type="button" variant="link" onClick={handleOpenForgotPassword}>
            Forgot Password?
          </Button>
        </div>

        {loginError ? <Alert tone="danger" compact>{loginError}</Alert> : null}

        <Button type="submit" size="lg" block disabled={isSubmitting} loading={isSubmitting}>
          {isSubmitting ? 'SIGNING IN...' : 'LOGIN'}
        </Button>
      </form>

      <div className="auth-help">
        <p>Need Help?</p>
        <Button type="button" variant="link" onClick={handleOpenForgotPassword}>
          Distributor Contact
        </Button>
      </div>
    </AuthLayout>
  );
}
