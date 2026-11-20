import './utils/cacheBust.js';
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { createRoot as __bannerRoot } from 'react-dom/client';
import UpdateBanner from './components/UpdateBanner.jsx';
import AccessPanel from './components/AccessPanel.jsx';




createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)




// ── banner-host: user update notification, always mounted globally ──
try {
  const host = document.createElement('div');
  host.id = 'banner-host';
  document.body.appendChild(host);
  __bannerRoot(host).render(<UpdateBanner />);
} catch (e) { console.warn('banner mount', e); }

// ── access-host: admin roles, trials and password requests ──
try {
  const h = document.createElement('div');
  h.id = 'access-host';
  document.body.appendChild(h);
  __bannerRoot(h).render(<AccessPanel />);
} catch (e) { console.warn('access mount', e); }
