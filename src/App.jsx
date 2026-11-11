import { useState, useRef, useEffect } from 'react';
import {
  PRINT_SIZES, fitImageToSize, createIdCardLayout, createCardGridLayout,
  createNUpLayout, createFrontBackNUpSheets, createPassportLayout,
  compressToTarget, convertToPng, convertToJpg, dataUrlToBlob,
  renderPdfToImages, buildPdfBlob, printImage
} from './printUtils';
import {
  ensureAdmin, login, registerUser, verifySession, logoutLocal,
  listUsers, addUser, deleteUser, changePassword, setExpiry,
  changeOwnPassword, updateUserDetails,
  sendMessage, getConversation, listAdminConversations
} from './authService';
import './App.css';

const SEED_FLAG = 'scanprint_seeded';

function parseRange(str, max) {
  if (!str || !str.trim()) return Array.from({ length: max }, (_, i) => i);
  const set = new Set();
  str.split(',').forEach((part) => {
    const t = part.trim(); if (!t) return;
    if (t.includes('-')) { const [a,b]=t.split('-').map(x=>parseInt(x.trim(),10)); if (!isNaN(a)&&!isNaN(b)){const s=Math.min(a,b),e=Math.max(a,b); for(let i=s;i<=e;i++) if(i>=1&&i<=max) set.add(i-1);} }
    else { const n=parseInt(t,10); if(!isNaN(n)&&n>=1&&n<=max) set.add(n-1); }
  });
  return [...set].sort((a,b)=>a-b);
}

function App() {
  const [view, setView] = useState('boot');
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
  const [pwCurrent, setPwCurrent] = useState('');
  const [pwNew, setPwNew] = useState('');
  const [users, setUsers] = useState([]);
  const [newUser, setNewUser] = useState({ u: '', p: '', f: '', l: '', exp: '', role: 'user' });

  // Messaging
  const [msgText, setMsgText] = useState('');
  const [adminMsgs, setAdminMsgs] = useState([]);
  const [conversations, setConversations] = useState([]);
  const [activeConv, setActiveConv] = useState(null);
  const [convMessages, setConvMessages] = useState([]);
  const [adminReplyText, setAdminReplyText] = useState('');

  const [printImages, setPrintImages] = useState([]);
  const [selectedSize, setSelectedSize] = useState('ID Card (CR80)');
  const [sideMode, setSideMode] = useState('single');
  const [idPaperSize, setIdPaperSize] = useState('A4');
  const [passportPaperSize, setPassportPaperSize] = useState('A4');
  const [pagesPerSheet, setPagesPerSheet] = useState(1);
  const [copies, setCopies] = useState(1);
  const [rangeInput, setRangeInput] = useState('');
  const [saveImages, setSaveImages] = useState([]);
  const [saveFormat, setSaveFormat] = useState('pdf');
  const [saveSize, setSaveSize] = useState('original');
  const [saveKBInput, setSaveKBInput] = useState('');

  const [isLoading, setIsLoading] = useState(false);
  const [loadProgress, setLoadProgress] = useState(0);
  const [loadMessage, setLoadMessage] = useState('');
  const [activeTab, setActiveTab] = useState(0);
  const stageRef = useRef(null);

  const isAdmin = session && session.role === 'admin';
  // print, save, [admin], profile/messages
  const panelCount = 2 + (isAdmin ? 1 : 0) + 1;

  useEffect(() => {
    (async () => {
      try {
        if (!localStorage.getItem(SEED_FLAG)) { await ensureAdmin(); localStorage.setItem(SEED_FLAG, '1'); }
        const res = await verifySession();
        if (res.status === 'ok') { setSession(res.user); setIsExpiredSession(!!res.expired); setView('main'); }
        else if (res.status === 'other-device') setView('login');
        else setView('login');
      } catch (e) { console.error(e); setBootError('Supabase not connected. Set URL/key in src/supabaseClient.js'); setView('login'); }
    })();
  }, []);

  // Periodic session check (kick if logged in elsewhere) + refresh messages
  useEffect(() => {
    if (view !== 'main') return;
    const tick = async () => {
      try {
        const res = await verifySession();
        if (res.status === 'other-device') { alert('Logged in on another device.'); logoutLocal(); setSession(null); setView('login'); }
        else if (res.status === 'none') { logoutLocal(); setSession(null); setView('login'); }
        else if (res.status === 'ok') { setSession(res.user); setIsExpiredSession(!!res.expired); }
        // expired status = stay logged in, show overlay (don't logout)
        else if (res.status === 'expired') { setSession(res.user); setIsExpiredSession(true); }
        // network errors or other statuses: do nothing, stay logged in
        // refresh own messages (user → admin thread)
        if (session && !isAdmin) {
          const conv = await getConversation(session.username, 'admin@scanprint.app');
          setAdminMsgs(conv);
        }
        if (isAdmin && activeConv) {
          const conv = await getConversation('admin@scanprint.app', activeConv);
          setConvMessages(conv);
        }
      } catch (e) {}
    };
    tick();
    const t = setInterval(tick, 300000);
    document.addEventListener('visibilitychange', tick);
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', tick); };
  }, [view, session, isAdmin, activeConv]);

  // Admin: load users + conversations list
  useEffect(() => {
    if (!isAdmin) return;
    listUsers().then(setUsers).catch((e)=>console.error(e));
    listAdminConversations('admin@scanprint.app').then(setConversations).catch(()=>{});
  }, [isAdmin, view]);

  useEffect(() => {
    const el = stageRef.current; if (!el) return;
    const onScroll = () => setActiveTab(Math.round(el.scrollLeft / el.clientWidth));
    el.addEventListener('scroll', onScroll, { passive: true });
    return () => el.removeEventListener('scroll', onScroll);
  }, [view, panelCount]);

  const scrollToTab = (idx) => { const el=stageRef.current; if (!el) return; el.scrollTo({ left: idx*el.clientWidth, behavior: 'smooth' }); setActiveTab(idx); };

  const doLogin = async () => {
    setAuthMsg(''); setIsLoading(true);
    try {
      const res = await login(loginUser, loginPass);
      if (res.ok) { setSession(res.user); setIsExpiredSession(!!res.expired); setView('main'); setLoginPass(''); }
      else setAuthMsg(res.msg);
    } catch (e) { setAuthMsg('Connection error: ' + e.message); }
    finally { setIsLoading(false); }
  };

  const doRegister = async () => {
    setAuthMsg('');
    if (!regUser.trim() || !regPass) return setAuthMsg('Username and password required');
    if (regPass.length < 4) return setAuthMsg('Password must be at least 4 characters');
    setIsLoading(true);
    try {
      const res = await registerUser({ usernameRaw: regUser, password: regPass, firstName: regFirst, lastName: regLast });
      if (res.ok) { alert('Account created! Trial valid until ' + res.expiry); setSession(res.user); setIsExpiredSession(false); setView('main'); }
      else if (res.deviceLocked) { setAuthMsg(res.msg); alert(res.msg); }
      else setAuthMsg(res.msg);
    } catch (e) { setAuthMsg('Connection error: ' + e.message); }
    finally { setIsLoading(false); }
  };

  const doLogout = () => { logoutLocal(); setSession(null); setIsExpiredSession(false); setView('login'); };

  const doChangePw = async () => {
    if (!pwCurrent || !pwNew) return alert('Please fill both password fields');
    if (pwNew.length < 4) return alert('New password must be at least 4 characters');
    setIsLoading(true);
    const r = await changeOwnPassword(session.username, pwCurrent, pwNew);
    setIsLoading(false);
    if (r.ok) { alert('Password changed successfully'); setPwCurrent(''); setPwNew(''); }
    else alert(r.msg);
  };

  const refreshUsers = () => listUsers().then(setUsers).catch(()=>{});
  const adminAdd = async () => {
    if (!newUser.u || !newUser.p) return alert('Username and password required');
    const r = await addUser({ usernameRaw: newUser.u, password: newUser.p, firstName: newUser.f, lastName: newUser.l, role: newUser.role || 'user', expiry: newUser.exp || null });
    if (!r.ok) alert(r.msg); else { setNewUser({ u:'', p:'', f:'', l:'', exp:'', role:'user' }); refreshUsers(); }
  };
  const adminPw = async (u) => { const pw = prompt('New password for ' + u.username + ':'); if (!pw) return; const r = await changePassword(u.id, pw); alert(r.ok ? 'Password changed.' : r.msg); };
  const adminDetails = async (u) => {
    const f = prompt('First name:', u.first_name || ''); if (f === null) return;
    const l = prompt('Last name:', u.last_name || ''); if (l === null) return;
    const r = await updateUserDetails(u.id, f.trim(), l.trim());
    if (r.ok) refreshUsers(); else alert(r.msg);
  };
  const adminExp = async (u) => {
    const d = prompt('Expiry (YYYY-MM-DD, empty = never):', u.expiry_date || '');
    if (d === null) return;
    const r = await setExpiry(u.id, d.trim() || null);
    if (r.ok) refreshUsers(); else alert(r.msg);
  };
  const adminDel = async (u) => {
    if (u.role === 'admin') return alert('Admin accounts are protected');
    if (!confirm('Delete ' + u.username + ' ?')) return;
    const r = await deleteUser(u.id);
    if (r.ok) refreshUsers(); else alert(r.msg);
  };
  const openConv = async (username) => {
    setActiveConv(username);
    const msgs = await getConversation('admin@scanprint.app', username);
    setConvMessages(msgs);
  };
  const sendAdminReply = async () => {
    if (!adminReplyText.trim() || !activeConv) return;
    const r = await sendMessage('admin@scanprint.app', activeConv, adminReplyText);
    if (r.ok) { setAdminReplyText(''); const m = await getConversation('admin@scanprint.app', activeConv); setConvMessages(m); listAdminConversations('admin@scanprint.app').then(setConversations); }
    else alert(r.msg);
  };
  const sendUserMsg = async () => {
    if (!msgText.trim()) return;
    const r = await sendMessage(session.username, 'admin@scanprint.app', msgText);
    if (r.ok) { setMsgText(''); const m = await getConversation(session.username, 'admin@scanprint.app'); setAdminMsgs(m); }
    else alert(r.msg);
  };

  // ===== MOBILE PRINT/SAVE via Capacitor Share =====
  const shareOrDownload = async (blob, filename) => {
    try {
      const { Share } = await import('@capacitor/share');
      const { Filesystem, Directory } = await import('@capacitor/filesystem');

      // Convert blob to base64 for Filesystem
      const reader = new FileReader();
      const b64Promise = new Promise((res) => {
        reader.onload = () => res(String(reader.result).split(',')[1]);
        reader.readAsDataURL(blob);
      });
      const b64 = await b64Promise;

      // Write to cache dir
      const path = await Filesystem.writeFile({
        path: filename, data: b64,
        directory: Directory.Cache, recursive: true
      });

      // Share — opens native sheet with Print / Save / Email / etc.
      await Share.share({
        title: 'ScanPrint Pro',
        text: filename,
        url: path.uri,
        dialogTitle: 'Share or Print'
      });
    } catch (e) {
      // Fallback: regular blob download (desktop / unsupported browsers)
      console.warn('Share fallback to blob download', e);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = filename; a.style.display='none';
      document.body.appendChild(a); a.click();
      setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 500);
    }
  };

  const buildPages = async (images, sizeKey) => {
    const idxs = parseRange(rangeInput, images.length);
    if (idxs.length === 0) throw new Error('Invalid range');
    const selected = idxs.map(i => images[i]);
    const c = Math.max(1, copies);
    const cfg = PRINT_SIZES[sizeKey];
    let final = [], cssW = cfg.cssWidth, cssH = cfg.cssHeight;

    if (cfg.isIdCard) {
      if (sideMode === 'double') {
        if (selected.length % 2 !== 0) throw new Error('Double side needs even number of pages');
        for (let i = 0; i < selected.length; i += 2) {
          const sheet = await createIdCardLayout(selected[i], selected[i+1]);
          for (let k = 0; k < c; k++) final.push(sheet);
        }
        cssW = PRINT_SIZES['A4'].cssWidth; cssH = PRINT_SIZES['A4'].cssHeight;
      } else {
        const list = []; selected.forEach(img => { for (let k = 0; k < c; k++) list.push(img); });
        final = await createCardGridLayout(list, idPaperSize);
        cssW = PRINT_SIZES[idPaperSize].cssWidth; cssH = PRINT_SIZES[idPaperSize].cssHeight;
      }
    } else if (cfg.isPassport) {
      final = await createPassportLayout(selected[0], c, passportPaperSize);
      cssW = PRINT_SIZES[passportPaperSize].cssWidth; cssH = PRINT_SIZES[passportPaperSize].cssHeight;
    } else if (sizeKey === 'A4' && sideMode === 'double') {
      const n = Math.max(2, 2 * Math.round(pagesPerSheet / 2));
      const sheets = await createFrontBackNUpSheets(selected, n, 'A4');
      for (let k = 0; k < c; k++) final.push(...sheets);
    } else if ((sizeKey === 'A4' || sizeKey === '4x6 Photo') && pagesPerSheet > 1) {
      const sheets = await createNUpLayout(selected, pagesPerSheet, sizeKey);
      for (let k = 0; k < c; k++) final.push(...sheets);
    } else {
      for (const img of selected) {
        const fitted = await fitImageToSize(img, cfg.width, cfg.height);
        for (let k = 0; k < c; k++) final.push(fitted);
      }
    }
    return { pages: final, cssW, cssH };
  };

  const handlePrint = async () => {
    if (printImages.length === 0) return alert('Please add at least one image or PDF.');
    setIsLoading(true); setLoadProgress(0); setLoadMessage('Preparing print...');
    try {
      const { pages, cssW, cssH } = await buildPages(printImages, selectedSize);
      setLoadProgress(90); setLoadMessage('Opening printer...');
      await printImage(pages, cssW, cssH);
      setLoadProgress(100);
    } catch (e) {
      console.error('Print error:', e);
      alert('Print failed: ' + e.message);
    } finally {
      setIsLoading(false); setLoadProgress(0); setLoadMessage('');
    }
  };

  const handleSave = async () => {
    if (saveImages.length === 0) return alert('Please add at least one image or PDF.');
    setIsLoading(true); setLoadProgress(0); setLoadMessage('Compressing...');
    try {
      let processed = saveImages;
      const kb = parseInt(saveKBInput, 10);
      if (kb && kb > 0) {
        const totalImages = saveImages.length;
        processed = await Promise.all(saveImages.map(async (u, idx) => {
          setLoadMessage(`Compressing image ${idx + 1}/${totalImages}...`);
          const startProgress = Math.round((idx / totalImages) * 90);
          const endProgress = Math.round(((idx + 1) / totalImages) * 90);
          return await compressToTarget(u, kb, (p) => {
            const overallProgress = startProgress + Math.round((p / 100) * (endProgress - startProgress));
            setLoadProgress(overallProgress);
          });
        }));
      }
      setLoadMessage('Preparing download...');
      setLoadProgress(95);
      if (saveFormat === 'pdf') {
        const blob = await buildPdfBlob(processed, '8.27in', '11.69in');
        setLoadProgress(100);
        await shareOrDownload(blob, `scanprint-save-${Date.now()}.pdf`);
      } else {
        for (let i = 0; i < processed.length; i++) {
          let url = processed[i];
          if (saveFormat === 'png' && saveSize === 'original' && !url.startsWith('data:image/png')) url = await convertToPng(url);
          if (saveFormat === 'jpg' && !url.startsWith('data:image/jpeg')) url = await convertToJpg(url, 0.92);
          const ext = (saveFormat === 'png' && saveSize === 'original') ? 'png' : 'jpg';
          const blob = await dataUrlToBlob(url, `scanprint-${i+1}.${ext}`);
          await shareOrDownload(blob, blob.name);
        }
      }
    } catch (e) { alert('Save failed: ' + e.message); }
    finally { setIsLoading(false); setLoadProgress(0); setLoadMessage(''); }
  };

  const takePhoto = async (addFn) => {
    try { const { Camera, CameraResultType } = await import('@capacitor/camera'); const image = await Camera.getPhoto({ quality: 100, allowEditing: false, resultType: CameraResultType.DataUrl }); addFn(image.dataUrl); }
    catch (e) { alert('Camera requires a physical device.'); }
  };
  const uploadFile = async (event, addFn, addMultiFn) => {
    const file = event.target.files?.[0]; if (!file) return;
    setIsLoading(true); setLoadProgress(0); setLoadMessage('Processing file...');
    try {
      if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
        setLoadMessage('Converting PDF pages...');
        const urls = await renderPdfToImages(file, (p) => setLoadProgress(p));
        if (urls.length) { setLoadMessage('Loading images...'); addMultiFn(urls); }
        else alert('Empty or corrupted PDF');
      } else if (file.type.startsWith('image/')) {
        setLoadMessage('Reading image...');
        const r = new FileReader();
        r.onloadend = () => { setLoadProgress(100); addFn(r.result); };
        r.onerror = () => alert('Read failed');
        r.readAsDataURL(file);
      } else alert('Unsupported file');
    } catch (err) { alert('Failed: ' + err.message); }
    finally { setIsLoading(false); setLoadProgress(0); setLoadMessage(''); }
    event.target.value = null;
  };
  const scanDocument = async (addFn) => {
    try { const { DocumentScanner } = await import('@capgo/capacitor-document-scanner'); const r = await DocumentScanner.scanDocument({ responseType: 'base64' }); if (r.scannedImages?.length) addFn(`data:image/jpeg;base64,${r.scannedImages[0]}`); }
    catch (e) { alert('Scanning requires a mobile device.'); }
  };

  const inputButtons = (addFn, addMultiFn) => (
    <div className="workflow-cards">
      <div className="workflow-card" onClick={() => takePhoto(addFn)}><div className="card-content"><span className="icon">📷</span><span className="label">Take Photo</span></div><div className="check-icon">✓</div></div>
      <div className="workflow-card" onClick={() => scanDocument(addFn)}><div className="card-content"><span className="icon">✨</span><span className="label">Scan Document</span></div><div className="check-icon">✓</div></div>
      <label className="workflow-card"><div className="card-content"><span className="icon">📁</span><span className="label">Upload Photo or PDF</span></div><div className="check-icon">✓</div><input type="file" accept="image/*,.pdf,application/pdf" style={{display:'none'}} onChange={(e)=>uploadFile(e, addFn, addMultiFn)} /></label>
    </div>
  );

  if (view === 'boot') return <div className="loading-overlay"><div className="loading-spinner"></div></div>;

  if (view === 'register') {
    return (
      <div className="auth-wrap">
        {isLoading && (
      <div className="loading-overlay">
        <div className="progress-card">
          <div className="rabbit-track">
            <div className="running-rabbit" style={{ left: `calc(${Math.min(100, Math.max(0, loadProgress))}% - 24px)` }}>🐇</div>
          </div>
          <div className="progress-bar-container">
            <div className="progress-bar" style={{ width: loadProgress + '%' }}></div>
          </div>
          <div className="progress-text">{loadMessage || 'Loading...'}</div>
          <div className="progress-percent">{loadProgress}%</div>
        </div>
      </div>
    )}
        <div className="auth-frame"><div className="logo-chip">✨</div>
          <div className="auth-card">
            <div className="auth-brand">Good Friend Service</div>
            <div className="auth-sub">Create your account</div>
            <div className="login-note" style={{marginBottom:'12px'}}>One registration per device</div>
            {bootError && <div className="auth-error">{bootError}</div>}
            {authMsg && <div className="auth-error">{authMsg}</div>}
            <input className="auth-input" placeholder="First name" value={regFirst} onChange={(e)=>setRegFirst(e.target.value)} />
            <input className="auth-input" placeholder="Last name" value={regLast} onChange={(e)=>setRegLast(e.target.value)} />
            <input className="auth-input" placeholder="Username (becomes name@scanprint.app)" value={regUser} onChange={(e)=>setRegUser(e.target.value)} />
            <input className="auth-input" type="password" placeholder="Password (min 4 chars)" value={regPass} onChange={(e)=>setRegPass(e.target.value)} />
            <button className="auth-btn" onClick={doRegister}>Register</button>
            <div className="auth-link" onClick={()=>{setAuthMsg('');setView('login');}}>← Back to login</div>
          </div></div></div>);
  }

  if (view === 'login') {
    return (
      <div className="auth-wrap">
        {isLoading && (
      <div className="loading-overlay">
        <div className="progress-card">
          <div className="rabbit-track">
            <div className="running-rabbit" style={{ left: `calc(${Math.min(100, Math.max(0, loadProgress))}% - 24px)` }}>🐇</div>
          </div>
          <div className="progress-bar-container">
            <div className="progress-bar" style={{ width: loadProgress + '%' }}></div>
          </div>
          <div className="progress-text">{loadMessage || 'Loading...'}</div>
          <div className="progress-percent">{loadProgress}%</div>
        </div>
      </div>
    )}
        <div className="auth-frame"><div className="logo-chip">🔐</div>
          <div className="auth-card">
            <div className="auth-brand">Good Friend Service</div>
            <div className="auth-sub">Sign in to Scan & Print Pro</div>
            {bootError && <div className="auth-error">{bootError}</div>}
            {authMsg && <div className="auth-error">{authMsg}</div>}
            <input className="auth-input" placeholder="username@scanprint.app" value={loginUser} onChange={(e)=>setLoginUser(e.target.value)} />
            <input className="auth-input" type="password" placeholder="Password" value={loginPass} onChange={(e)=>setLoginPass(e.target.value)} />
            <button className="auth-btn" onClick={doLogin}>Login</button>
            <div className="auth-link" onClick={()=>{setAuthMsg('');setView('register');}}>Create new account →</div>
          </div></div></div>);
  }

  // ===== MAIN APP =====
  const initials = ((session.first_name || 'U')[0] + (session.last_name || '')[0]).toUpperCase();

  // Disabled overlay when expired (admin bypasses)
  const disabledOverlay = (isExpiredSession && !isAdmin) ? (
    <div className="disabled-overlay">
      <div className="disabled-card">
        <div className="disabled-icon">🔒</div>
        <div className="disabled-title">Account Expired</div>
        <div className="disabled-text">
          Your trial ended on <b>{session.expiry_date || '—'}</b>.<br />
          All features are locked until renewed.<br />
          Send a message to your admin below.
        </div>
        <button className="auth-btn" onClick={()=>scrollToTab(panelCount - 1)}>💬 Contact Admin</button>
      </div>
    </div>
  ) : null;

  return (
    <>
      <header className="app-header">
        <div className="header-brand">Good Friend Service</div>
        <div className="header-row2">
          <div className="header-greet">Hi, {session.first_name || ''} {session.last_name || ''} 👋</div>
          <div className="header-avatar">{initials}</div>
        </div>
        <div className="tab-dots">{Array.from({ length: panelCount }).map((_, i) => (<div key={i} className={`tab-dot ${activeTab === i ? 'active' : ''}`} onClick={() => scrollToTab(i)}></div>))}</div>
      </header>

      <div className="scroll-stage" ref={stageRef}>
        <div className="panels-track" style={{ width: `${panelCount * 100}vw` }}>

          {/* PANEL 1: SCAN & PRINT */}
          <div className="panel">
            {isLoading && (
      <div className="loading-overlay">
        <div className="progress-card">
          <div className="rabbit-track">
            <div className="running-rabbit" style={{ left: `calc(${Math.min(100, Math.max(0, loadProgress))}% - 24px)` }}>🐇</div>
          </div>
          <div className="progress-bar-container">
            <div className="progress-bar" style={{ width: loadProgress + '%' }}></div>
          </div>
          <div className="progress-text">{loadMessage || 'Loading...'}</div>
          <div className="progress-percent">{loadProgress}%</div>
        </div>
      </div>
    )}
            <div className="glass-frame"><div className="logo-chip">🖨️</div><div className="main-card">
              <div className="header"><h2>Scan & Print</h2></div>
              {inputButtons((u)=>setPrintImages(p=>[...p,u]), (urls)=>setPrintImages(p=>[...p,...urls]))}
              {printImages.length > 0 && <div className="count-bar"><span className="count-chip">📄 {printImages.length} page{printImages.length>1?'s':''} loaded</span><button className="clear-btn" onClick={()=>{setPrintImages([]);setRangeInput('');}}>Clear All</button></div>}
              {printImages.length > 1 && <div className="passport-settings" style={{marginTop:0,marginBottom:'16px'}}><div className="workflow-card settings-card"><div className="card-content" style={{flexDirection:'column',alignItems:'stretch',gap:'4px'}}><div style={{display:'flex',alignItems:'center',gap:'12px'}}><span className="icon">🔖</span><input className="neon-input wide" placeholder="All pages (e.g. 1-3, 5, 7-9)" value={rangeInput} onChange={(e)=>setRangeInput(e.target.value)} /></div><span className="range-hint">Leave empty = all pages. Supports ranges like 1-3, 5, 7-9</span></div><div className="check-icon">✓</div></div></div>}
              <div className="workflow-cards" style={{marginBottom:0}}><div className="workflow-card settings-card"><div className="card-content"><span className="icon">📄</span><select value={selectedSize} onChange={(e)=>setSelectedSize(e.target.value)} className="neon-select">{Object.keys(PRINT_SIZES).map(s=>(<option key={s} value={s}>{s}</option>))}</select></div><div className="check-icon">✓</div></div></div>
              {(selectedSize==='ID Card (CR80)' || selectedSize==='A4') && <div className="passport-settings"><div className="workflow-card settings-card"><div className="card-content"><span className="icon">🔄</span><select value={sideMode} onChange={(e)=>setSideMode(e.target.value)} className="neon-select"><option value="single">Single Side</option><option value="double">Double Side (Front + Back)</option></select></div><div className="check-icon">✓</div></div>{selectedSize==='ID Card (CR80)' && sideMode==='single' && <div className="workflow-card settings-card"><div className="card-content"><span className="icon">📐</span><select value={idPaperSize} onChange={(e)=>setIdPaperSize(e.target.value)} className="neon-select"><option value="A4">A4 Paper (10 cards per sheet)</option><option value="4x6 Photo">4x6 Photo (2 cards per sheet)</option></select></div><div className="check-icon">✓</div></div>}</div>}
              {selectedSize==='Passport (2x2)' && <div className="passport-settings"><div className="workflow-card settings-card"><div className="card-content"><span className="icon">📐</span><select value={passportPaperSize} onChange={(e)=>setPassportPaperSize(e.target.value)} className="neon-select"><option value="A4">A4 Paper (4 per row)</option><option value="4x6 Photo">4x6 Photo (2 per row)</option></select></div><div className="check-icon">✓</div></div></div>}
              {(selectedSize==='A4' || selectedSize==='4x6 Photo') && <div className="passport-settings"><div className="workflow-card settings-card"><div className="card-content" style={{flexDirection:'column',alignItems:'stretch',gap:'4px'}}><div style={{display:'flex',alignItems:'center',gap:'12px'}}><span className="icon">🗂️</span><select value={pagesPerSheet} onChange={(e)=>setPagesPerSheet(parseInt(e.target.value,10))} className="neon-select">{(selectedSize==='A4' && sideMode==='double') ? (<><option value={2}>2 pages per sheet (1 pair)</option><option value={4}>4 pages per sheet (2 pairs)</option><option value={6}>6 pages per sheet (3 pairs)</option><option value={8}>8 pages per sheet (4 pairs)</option></>) : (<><option value={1}>1 page per sheet</option><option value={2}>2 pages per sheet</option><option value={4}>4 pages per sheet</option><option value={6}>6 pages per sheet</option><option value={8}>8 pages per sheet</option><option value={9}>9 pages per sheet</option><option value={16}>16 pages per sheet</option></>)}</select></div></div><div className="check-icon">✓</div></div></div>}
              <div className="passport-settings"><div className="workflow-card settings-card"><div className="card-content"><span className="icon">🔢</span><input type="number" min="1" max="500" value={copies} onChange={(e)=>setCopies(parseInt(e.target.value)||1)} className="neon-input" /><span style={{fontSize:'12px',color:'#6b7280',marginLeft:'10px'}}>{selectedSize==='Passport (2x2)'?'Number of photos': selectedSize==='ID Card (CR80)'?(sideMode==='double'?'Copies of front+back sheet':'Copies of each photo'):(selectedSize==='A4' && sideMode==='double')?'Copies of each sheet':'Copies of full job'}</span></div><div className="check-icon">✓</div></div></div>
              <button className={'print-btn' + (printImages.length>0 ? ' active' : '')} onClick={handlePrint} disabled={printImages.length===0}>🖨️ Print / Share ({selectedSize})</button>
              <div className="swipe-hint">← Swipe to change section →</div>
            </div></div>
          </div>

          {/* PANEL 2: COMPRESS & SAVE */}
          <div className="panel">
            <div className="glass-frame"><div className="logo-chip">💾</div><div className="main-card">
              <div className="header"><h2>Compress & Save</h2></div>
              {inputButtons((u)=>setSaveImages(p=>[...p,u]), (urls)=>setSaveImages(p=>[...p,...urls]))}
              {saveImages.length > 0 && <div className="count-bar"><span className="count-chip">📄 {saveImages.length} file{saveImages.length>1?'s':''} loaded</span><button className="clear-btn" onClick={()=>setSaveImages([])}>Clear All</button></div>}
              <div className="passport-settings" style={{marginTop:0}}>
                <div className="workflow-card settings-card"><div className="card-content"><span className="icon">💾</span><select value={saveFormat} onChange={(e)=>setSaveFormat(e.target.value)} className="neon-select"><option value="pdf">Save as PDF (all in one file)</option><option value="jpg">Save as JPG images</option><option value="png">Save as PNG images</option></select></div><div className="check-icon">✓</div></div>
                <div className="workflow-card settings-card"><div className="card-content" style={{flexDirection:'column',alignItems:'stretch',gap:'4px'}}><div style={{display:'flex',alignItems:'center',gap:'12px'}}><span className="icon">🗜️</span><input
                          type="number"
                          min="5"
                          max="50000"
                          placeholder="Enter target KB (e.g. 100)"
                          value={saveKBInput}
                          onChange={(e) => setSaveKBInput(e.target.value)}
                          className="admin-input"
                          style={{ marginTop: '6px', flex: 1 }}
                        /></div><span className="range-hint">Enter the exact KB size you want (e.g. 100). Leave empty for original quality.</span></div><div className="check-icon">✓</div></div>
              </div>
              <button className={'print-btn save' + (saveImages.length>0 ? ' active' : '')} onClick={handleSave} disabled={saveImages.length===0}>💾 Compress & Save / Share</button>
              <div className="swipe-hint">← Swipe to change section →</div>
            </div></div>
          </div>

          {/* PANEL 3: ADMIN */}
          {isAdmin && (
            <div className="panel">
              <div className="glass-frame"><div className="logo-chip">🛡️</div><div className="main-card">
                <div className="header"><h2>Admin Panel</h2></div>
                <div className="admin-form">
                  <input className="admin-input" placeholder="New username" value={newUser.u} onChange={(e)=>setNewUser({...newUser,u:e.target.value})} />
                  <input className="admin-input" placeholder="Password" value={newUser.p} onChange={(e)=>setNewUser({...newUser,p:e.target.value})} />
                  <input className="admin-input" placeholder="First name" value={newUser.f} onChange={(e)=>setNewUser({...newUser,f:e.target.value})} />
                  <input className="admin-input" placeholder="Last name" value={newUser.l} onChange={(e)=>setNewUser({...newUser,l:e.target.value})} />
                  <input className="admin-input" type="date" value={newUser.exp} onChange={(e)=>setNewUser({...newUser,exp:e.target.value})} />
                  <select className="admin-input" value={newUser.role} onChange={(e)=>setNewUser({...newUser,role:e.target.value})}><option value="user">Role: User</option><option value="admin">Role: Admin</option></select>
                  <button className="admin-btn add" onClick={adminAdd}>➕ Add User</button>
                </div>
                <h3 style={{fontSize:'13px',color:'#6b7280',margin:'6px 0 10px',textTransform:'uppercase',letterSpacing:'1px'}}>Users ({users.filter(u=>u.role!=='admin').length})</h3>
                {users.filter(u=>u.role!=='admin').map((u)=>(
                  <div key={u.id} className="admin-user">
                    <div className="admin-user-top"><span className="admin-user-name">{u.username}</span><span className={`role-badge ${u.role==='admin'?'':'user'}`}>{u.role}</span></div>
                    <div className="admin-user-meta">{u.first_name} {u.last_name} • Expiry: {u.expiry_date || 'Never'}</div>
                    <div className="admin-actions">
                      <button className="admin-btn pw" onClick={()=>adminPw(u)}>🔑 Password</button>
                      <button className="admin-btn expiry" onClick={()=>adminDetails(u)}>✏️ Details</button>
                      <button className="admin-btn expiry" onClick={()=>adminExp(u)}>📅 Expiry</button>
                      <button className="admin-btn del" onClick={()=>adminDel(u)}>🗑 Delete</button>
                      <button className="admin-btn msg" onClick={()=>openConv(u.username)}>💬 Msg</button>
                    </div>
                  </div>
                ))}

                {activeConv && (
                  <div className="msg-conv">
                    <div className="msg-conv-head">
                      <button className="msg-back" onClick={()=>{setActiveConv(null);setConvMessages([]);}}>← Back</button>
                      <span>{activeConv}</span>
                    </div>
                    <div className="msg-thread">
                      {convMessages.length === 0 && <div className="msg-empty">No messages yet</div>}
                      {convMessages.map((m)=>(
                        <div key={m.id} className={`msg-bubble ${m.from_user==='admin@scanprint.app' ? 'mine' : 'theirs'}`}>
                          <div className="msg-text">{m.message}</div>
                          <div className="msg-time">{new Date(m.created_at).toLocaleString()}</div>
                        </div>
                      ))}
                    </div>
                    <div className="msg-compose">
                      <input className="msg-input" placeholder="Reply..." value={adminReplyText} onChange={(e)=>setAdminReplyText(e.target.value)} />
                      <button className="msg-send" onClick={sendAdminReply}>➤</button>
                    </div>
                  </div>
                )}

                <div className="swipe-hint">← Swipe to change section →</div>
              </div></div>
            </div>
          )}

          {/* PROFILE + MESSAGES (everyone) */}
          <div className="panel">
            <div className="glass-frame"><div className="logo-chip">👤</div><div className="main-card">
              <div className="header"><h2>My Profile</h2></div>
              <div className="profile-card">
                <div className="profile-avatar">{initials}</div>
                <div className="profile-name">{session.first_name || ''} {session.last_name || ''}</div>
                <div className="profile-user">{session.username}</div>
                {session.expiry_date && <div className="profile-expiry">Access until: {session.expiry_date}</div>}
              </div>

              <div className="profile-fields">
                <input className="admin-input" type="password" placeholder="Current password" value={pwCurrent} onChange={(e)=>setPwCurrent(e.target.value)} />
                <input className="admin-input" type="password" placeholder="New password" value={pwNew} onChange={(e)=>setPwNew(e.target.value)} />
              </div>
              <button className="print-btn active" onClick={doChangePw}>🔑 Change Password</button>
              <button className="print-btn" style={{marginTop:'12px',color:'#dc2626',background:'rgba(239,68,68,0.08)',borderColor:'rgba(239,68,68,0.3)',cursor:'pointer'}} onClick={doLogout}>🚪 Logout</button>

              <div style={{marginTop:'22px'}} className="header"><h2>Message to Admin</h2></div>
              <div className="msg-thread">
                {adminMsgs.length === 0 && <div className="msg-empty">No messages yet. Send your first message below.</div>}
                {adminMsgs.map((m)=>(
                  <div key={m.id} className={`msg-bubble ${m.from_user===session.username ? 'mine' : 'theirs'}`}>
                    <div className="msg-label">{m.from_user === session.username ? 'You' : 'Admin'}</div>
                    <div className="msg-text">{m.message}</div>
                    <div className="msg-time">{new Date(m.created_at).toLocaleString()}</div>
                  </div>
                ))}
              </div>
              <div className="msg-compose">
                <input className="msg-input" placeholder={isExpiredSession ? 'Ask admin to restore your account...' : 'Message admin...'} value={msgText} onChange={(e)=>setMsgText(e.target.value)} />
                <button className="msg-send" onClick={sendUserMsg}>➤</button>
              </div>

              <div className="swipe-hint">← Swipe to change section →</div>
            </div></div>
          </div>

        </div>
      </div>

      {disabledOverlay}
    </>
  );
}

export default App;
