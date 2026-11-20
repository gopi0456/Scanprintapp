import ErrorBoundary from './components/ErrorBoundary.jsx';
import UpdatesEntry from './components/UpdatesEntry.jsx';
import { useState, useRef, useEffect, lazy, Suspense } from 'react';
import { ensureAdmin, login, registerUser, verifySession, logoutLocal, performLogout } from './services/authService.js';
import { getUnreadCount, markRead } from './services/messageService.js';
import './App.css';

// Lazy load heavy panels
const ScanPrintPanel = lazy(() => import('./components/ScanPrintPanel.jsx'));
const CompressSavePanel = lazy(() => import('./components/CompressSavePanel.jsx'));
const AdminPanel = lazy(() => import('./components/AdminPanel.jsx'));
const ProfilePanel = lazy(() => import('./components/ProfilePanel.jsx'));

const SEED_FLAG = 'scanprint_seeded';

function App() {
  const [view, setView] = useState('boot');
  /* __safeRestore__: load session from storage on cold start, no view changes */
  useEffect(() => {
    try {
      const keys = ['scanprint_session', 'session', 'gfs_session', 'scanprint_session_v1'];
      for (const k of keys) {
        const raw = localStorage.getItem(k);
        if (!raw) continue;
        const o = JSON.parse(raw);
        if (o && o.username) { setSession(o); break; }
      }
    } catch (e) { console.warn('session restore', e); }
  }, []);

  const [bootError, setBootError] = useState('');
  const [session, setSession] = useState(null);
  const [isExpiredSession, setIsExpiredSession] = useState(false);
  const [authMsg, setAuthMsg] = useState('');
  const [loginUser, setLoginUser] = useState('');
  const [loginPass, setLoginPass] = useState('');
  const [regUser, setRegUser] = useState('');
  const [regPass, setRegPass] = useState('');
  const [regFirst, setRegFirst] = useState('');
  const [regLast, setRegLast] = useState('');
  const [adminMsgs, setAdminMsgs] = useState([]);
  const [msgText, setMsgText] = useState('');
  const [unread, setUnread] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [loadProgress, setLoadProgress] = useState(0);
  const [loadMessage, setLoadMessage] = useState('');
  const [activeTab, setActiveTab] = useState(0);
  const stageRef = useRef(null);

  const isAdmin = session && session.role === 'admin';
  const panelCount = 2 + (isAdmin ? 1 : 0) + 1;

  useEffect(() => {
    (async () => {
      try {
        if (!localStorage.getItem(SEED_FLAG)) {
          await ensureAdmin();
          localStorage.setItem(SEED_FLAG, '1');
        }
        const res = await verifySession();
        if (res.status === 'ok') {
          setSession(res.user || res.session || null);
          setIsExpiredSession(!!res.expired);
          setView('main');
        } else if (res.status === 'other-device') setView('login');
        else setView('login');
      } catch (e) {
        console.error(e);
        setBootError('Supabase not connected. Set URL/key in src/supabaseClient.js');
        setView('login');
      }
    })();
  }, []);

  useEffect(() => {
    if (view !== 'main') return;
    const tick = async () => {
      if (document.hidden) return;              // never act while backgrounded / in print dialog
      try {
        const res = await verifySession();
        if (res.status === 'ok' || res.status === 'expired') {
          setSession(res.user || res.session || null);
          setIsExpiredSession(res.status === 'expired' || !!res.expired);
          try { setUnread(await getUnreadCount(session.username)); } catch (e) {}
        } else if (res.status === 'other-device') {
          await new Promise(r => setTimeout(r, 900));   // confirm before kicking
          const again = await verifySession();
          if (again.status === 'other-device') {
            alert('Logged in on another device.');
            performLogout(); setSession(null); setView('login');
          }
        }
        // 'none' / network error while running: stay logged in (cold boot handles login)
      } catch (e) {}
    };
    tick();
    const t = setInterval(tick, 20000);
    document.addEventListener('visibilitychange', tick);
    return () => {
      clearInterval(t);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [view, session]);

  useEffect(() => {
    if (!session) return;
    const onProfile = activeTab === panelCount - 1;
    const adminViewing = isAdmin && activeTab === 2;
    if (onProfile || adminViewing) {
      markRead(session.username);
      setUnread(0);
    }
  }, [activeTab, panelCount, session, isAdmin]);

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const onScroll = () => setActiveTab(Math.round(el.scrollLeft / el.clientWidth));
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [view, panelCount]);

  const scrollToTab = (idx) => {
    const el = stageRef.current;
    if (!el) return;
    el.scrollTo({ left: idx * el.clientWidth, behavior: 'smooth' });
    setActiveTab(idx);
  };

  const doLogin = async () => {
    setAuthMsg('');
    setIsLoading(true);
    try {
      const res = await login(loginUser, loginPass);
      if (res.ok) {
        setSession(res.user || res.session || null);
        setIsExpiredSession(!!res.expired);
        setView('main');
        setLoginPass('');
      } else setAuthMsg(res.msg);
    } catch (e) {
      setAuthMsg('Connection error: ' + e.message);
    } finally {
      setIsLoading(false);
    }
  };

  const doRegister = async () => {
    setAuthMsg('');
    if (!regUser.trim() || !regPass) return setAuthMsg('Username and password required');
    if (regPass.length < 4) return setAuthMsg('Password must be at least 4 characters');
    setIsLoading(true);
    try {
      const res = await registerUser({ usernameRaw: regUser, password: regPass, firstName: regFirst, lastName: regLast });
        setAuthMsg(res.msg || '');
      if (res.ok) {
        alert('Account created! Trial valid until ' + res.expiry);
        setSession(res.user || res.session || null);
        setIsExpiredSession(false);
        setView('main');
      } else if (res.deviceLocked) {
        setAuthMsg(res.msg);
        alert(res.msg);
      } else setAuthMsg(res.msg);
    } catch (e) {
      setAuthMsg('Connection error: ' + e.message);
    } finally {
      setIsLoading(false);
    }
  };

  if (view === 'boot') {
    return (
      <div className="loading-overlay">
        <div className="loading-spinner"></div>
      </div>
    );
  }

  if (view === 'register') {
    return (
      <div className="auth-wrap">
        {isLoading && (
          <div className="loading-overlay">
            <div className="loading-spinner"></div>
          </div>
        )}
        <div className="auth-frame">
          <div className="logo-chip">✨</div>
          <div className="auth-card">
            <div className="auth-brand">Good Friend Service</div>
            <div className="auth-sub">Create your account</div>
            <div className="login-note" style={{ marginBottom: '12px' }}>One registration per device</div>
            {bootError && <div className="auth-error">{bootError}</div>}
            {authMsg && <div className="auth-error">{authMsg}</div>}
            <input className="auth-input" placeholder="First name" value={regFirst} onChange={(e) => setRegFirst(e.target.value)} />
            <input className="auth-input" placeholder="Last name" value={regLast} onChange={(e) => setRegLast(e.target.value)} />
            <input className="auth-input" placeholder="Username (becomes name@scanprint.app)" value={regUser} onChange={(e) => setRegUser(e.target.value)} />
            <input className="auth-input" type="password" placeholder="Password (min 4 chars)" value={regPass} onChange={(e) => setRegPass(e.target.value)} />
            <button className="auth-btn" onClick={doRegister}>Register</button>
            <div className="auth-link" onClick={() => { setAuthMsg(''); setView('login'); }}>← Back to login</div>
          </div>
        </div>
      </div>
    );
  }

  if (view === 'login') {
    return (
      <div className="auth-wrap">
        {isLoading && (
          <div className="loading-overlay">
            <div className="loading-spinner"></div>
          </div>
        )}
        <div className="auth-frame">
          <div className="logo-chip">🔐</div>
          <div className="auth-card">
            <div className="auth-brand">Good Friend Service</div>
            <div className="auth-sub">Sign in to Scan & Print Pro</div>
            {bootError && <div className="auth-error">{bootError}</div>}
            {authMsg && <div className="auth-error">{authMsg}</div>}
            <input className="auth-input" placeholder="username@scanprint.app" value={loginUser} onChange={(e) => setLoginUser(e.target.value)} />
            <input className="auth-input" type="password" placeholder="Password" value={loginPass} onChange={(e) => setLoginPass(e.target.value)} />
            <button className="auth-btn" onClick={doLogin}>Login</button>
            <div className="auth-link" onClick={() => { setAuthMsg(''); setView('register'); }}>Create new account →</div>
          </div>
        </div>
      </div>
    );
  }

  const initials = ((session.first_name || 'U')[0] + (session.last_name || '')[0]).toUpperCase();

  return (
    <>
      <header className="app-header">
        <div className="header-brand">Good Friend Service</div>
        <div className="header-row2">
          <div className="header-greet">Hi, {session.first_name || ''} {session.last_name || ''} 👋</div>
          <UpdatesEntry isAdmin={isAdmin} />
      <div className="header-avatar">
            {initials}
            {unread > 0 && <span className="msg-badge">{unread}</span>}
          </div>
        </div>
        <div className="tab-dots">
          {Array.from({ length: panelCount }).map((_, i) => (
            <div
              key={i}
              className={`tab-dot ${activeTab === i ? 'active' : ''}`}
              onClick={() => scrollToTab(i)}
            ></div>
          ))}
        </div>
      </header>

      <div className="scroll-stage" ref={stageRef}>
        <div className="panels-track" style={{ width: `${panelCount * 100}vw` }}>
          <ErrorBoundary><Suspense fallback={<div className="loading-overlay"><div className="loading-spinner"></div></div>}>
            <ScanPrintPanel isExpiredSession={isExpiredSession} session={session}
              isLoading={isLoading}
              setIsLoading={setIsLoading}
              loadProgress={loadProgress}
              setLoadProgress={setLoadProgress}
              loadMessage={loadMessage}
              setLoadMessage={setLoadMessage}
            />
            <CompressSavePanel isExpiredSession={isExpiredSession} session={session}
              isLoading={isLoading}
              setIsLoading={setIsLoading}
              loadProgress={loadProgress}
              setLoadProgress={setLoadProgress}
              loadMessage={loadMessage}
              setLoadMessage={setLoadMessage}
            />
            {isAdmin && <AdminPanel />}
            <ProfilePanel
              session={session}
              isAdmin={isAdmin}
              setView={setView}
              adminMsgs={adminMsgs}
              setAdminMsgs={setAdminMsgs}
              isExpiredSession={isExpiredSession}
              msgText={msgText}
              setMsgText={setMsgText}
              scrollToTab={scrollToTab}
              panelCount={panelCount}
            />
          </Suspense></ErrorBoundary>
        </div>
      </div>
    </>
  );
}

export default App;
