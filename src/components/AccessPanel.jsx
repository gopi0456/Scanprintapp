import { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import {
  listUsers, setRole, extendTrial, changePassword, listPasswordRequests, resolvePasswordRequest, daysLeft, TRIAL_DAYS, changeOwnPassword } from '../services/authService.js';

const fmt = d => { try { return new Date(d).toLocaleString([], { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }); } catch (e) { return '—'; } };

export default function AccessPanel() {
  const isAdmin = (() => { try { return localStorage.getItem('gfs_upd_admin') === '1'; } catch (e) { return false; } })();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState('people');
  const [users, setUsers] = useState([]);
  const [reqs, setReqs] = useState([]);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState(null);
  const [pwFor, setPwFor] = useState(null);
  const [newPw, setNewPw] = useState('');
  const [myCur, setMyCur] = useState('');
  const [myNew, setMyNew] = useState('');

  const load = useCallback(async () => {
    setBusy(true);
    try {
      const [u, r] = await Promise.all([listUsers(), listPasswordRequests().catch(() => [])]);
      setUsers(u); setReqs(r);
    } catch (e) { setFlash({ t: 'err', m: e.message }); }
    finally { setBusy(false); }
  }, []);

  useEffect(() => { if (open) load(); }, [open, load]);
  useEffect(() => { if (!flash) return; const t = setTimeout(() => setFlash(null), 3200); return () => clearTimeout(t); }, [flash]);
  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (!isAdmin) return null;
  const pending = reqs.filter(r => r.status === 'pending').length;

  const act = async (fn, okMsg) => {
    setBusy(true);
    const r = await fn();
    setFlash({ t: r.ok ? 'ok' : 'err', m: r.msg || okMsg });
    await load();
    setBusy(false);
  };

  const shown = users.filter(u => `${u.username} ${u.first_name} ${u.last_name} ${u.role}`.toLowerCase().includes(q.trim().toLowerCase()));
  const me = (() => { try { return JSON.parse(localStorage.getItem('scanprint_session') || 'null'); } catch (e) { return null; } })();

  return createPortal(
    <>
      {!open && (
        <button className="acc-fab" onClick={() => setOpen(true)} aria-label="Access control">
          🛡️{pending > 0 && <span className="acc-badge">{pending}</span>}
        </button>
      )}
      {open && (
        <div className="acc-scrim" role="dialog" aria-modal="true">
          <div className="acc-sheet">
            <header className="acc-head">
              <button className="acc-ghost" onClick={() => setOpen(false)}>← Back</button>
              <div className="acc-title"><span>🛡️</span><div><b>Access control</b><i>roles · trials · password requests</i></div></div>
              <button className="acc-ghost" onClick={load} disabled={busy}>{busy ? '⟳…' : '⟳'}</button>
            </header>

            <div className="acc-tabs">
              <button className={tab === 'people' ? 'on' : ''} onClick={() => setTab('people')}>👥 People <em>{users.length}</em></button>
              <button className={tab === 'requests' ? 'on' : ''} onClick={() => setTab('requests')}>🔑 Requests <em>{pending}</em></button>
              <button className={tab === 'me' ? 'on' : ''} onClick={() => setTab('me')}>🔐 My password</button>
            </div>

            <div className="acc-scroll">
              {tab === 'people' && (
                <>
                  <input className="acc-search" placeholder="Search name, username or role…" value={q} onChange={e => setQ(e.target.value)} />
                  {shown.length === 0 ? (
                    <div className="acc-empty">No people match that search.</div>
                  ) : shown.map(u => {
                    const left = daysLeft(u.expiry_date);
                    const over = left !== null && left <= 0;
                    return (
                      <article key={u.id} className={'acc-row' + (u.role === 'admin' ? ' admin' : '')}>
                        <div className="acc-row-top">
                          <span className="acc-avatar">{((u.first_name || 'U')[0] + (u.last_name || '')[0] || 'U').toUpperCase()}</span>
                          <div className="acc-who">
                            <b>{(u.first_name || '') + ' ' + (u.last_name || '')}</b>
                            <i>{u.username}</i>
                          </div>
                          <span className={'acc-role ' + (u.role === 'admin' ? 'a' : 'u')}>{u.role === 'admin' ? 'ADMIN' : 'USER'}</span>
                        </div>
                        <div className="acc-meta">
                          <span className={'acc-chip' + (over ? ' bad' : left === null ? ' none' : ' good')}>
                            {u.role === 'admin' ? 'Never expires' : left === null ? 'No expiry set' : over ? 'Trial ended' : left + ' day' + (left === 1 ? '' : 's') + ' left'}
                          </span>
                          <span className="acc-chip none">{u.expiry_date ? fmt(u.expiry_date) : '—'}</span>
                        </div>
                        <div className="acc-acts">
                          <button className="acc-mini" disabled={busy} onClick={() => act(() => setRole(u.id, u.role === 'admin' ? 'user' : 'admin'))}>
                            {u.role === 'admin' ? '↓ Make user' : '↑ Make admin'}
                          </button>
                          <button className="acc-mini green" disabled={busy} onClick={() => act(() => extendTrial(u.id, TRIAL_DAYS))}>+{TRIAL_DAYS} days</button>
                          <button className="acc-mini green" disabled={busy} onClick={() => act(() => extendTrial(u.id, 30))}>+30 days</button>
                          <button className="acc-mini blue" disabled={busy} onClick={() => { setPwFor(u); setNewPw(''); }}>Set password</button>
                        </div>
                        {pwFor && pwFor.id === u.id && (
                          <div className="acc-inline">
                            <input type="text" placeholder={'New password for ' + u.username} value={newPw} onChange={e => setNewPw(e.target.value)} />
                            <button disabled={busy || newPw.length < 4} onClick={async () => { await act(() => changePassword(u.id, newPw)); setPwFor(null); setNewPw(''); }}>Save</button>
                            <button className="ghost" onClick={() => { setPwFor(null); setNewPw(''); }}>Cancel</button>
                          </div>
                        )}
                      </article>
                    );
                  })}
                </>
              )}

              {tab === 'requests' && (
                reqs.length === 0 ? <div className="acc-empty">No password requests yet. Normal users can send one from their profile.</div>
                : reqs.map(r => (
                  <article key={r.id} className={'acc-row req ' + r.status}>
                    <div className="acc-row-top">
                      <span className="acc-avatar">🔑</span>
                      <div className="acc-who"><b>{r.username}</b><i>{fmt(r.created_at)}</i></div>
                      <span className={'acc-role ' + (r.status === 'pending' ? 'u' : 'a')}>{r.status.toUpperCase()}</span>
                    </div>
                    {r.note && <p className="acc-note">{r.note}</p>}
                    {r.status === 'pending' && (
                      <RequestResolver busy={busy} onDone={load} setFlash={setFlash} req={r} />
                    )}
                  </article>
                ))
              )}

              {tab === 'me' && (
                <section className="acc-card">
                  <label className="acc-lab">Signed in as</label>
                  <div className="acc-me">{me ? me.username : 'admin'}</div>
                  <label className="acc-lab">Current password</label>
                  <input className="acc-in" type="password" value={myCur} onChange={e => setMyCur(e.target.value)} placeholder="Current password" />
                  <label className="acc-lab">New password</label>
                  <input className="acc-in" type="password" value={myNew} onChange={e => setMyNew(e.target.value)} placeholder="At least 4 characters" />
                  <button className="acc-primary" disabled={busy || !myCur || myNew.length < 4}
                    onClick={async () => {
                      setBusy(true);
                      const r = await changeOwnPassword(me ? me.username : 'admin', myCur, myNew);
                      setFlash({ t: r.ok ? 'ok' : 'err', m: r.msg });
                      if (r.ok) { setMyCur(''); setMyNew(''); }
                      setBusy(false);
                    }}>🔐 Change my password</button>
                </section>
              )}
            </div>

            {flash && <div className={'acc-flash ' + flash.t}>{flash.m}</div>}
          </div>
        </div>
      )}
    </>,
    document.body
  );
}

function RequestResolver({ req, busy, onDone, setFlash }) {
  const [pw, setPw] = useState('');
  const [working, setWorking] = useState(false);
  return (
    <div className="acc-inline">
      <input type="text" placeholder="New password to assign" value={pw} onChange={e => setPw(e.target.value)} />
      <button disabled={busy || working || pw.length < 4} onClick={async () => {
        setWorking(true);
        const r = await resolvePasswordRequest(req.id, req.username, pw);
        setFlash({ t: r.ok ? 'ok' : 'err', m: r.msg });
        setWorking(false); setPw('');
        if (r.ok) onDone();
      }}>Approve</button>
      <button className="ghost" disabled={busy || working} onClick={async () => {
        setWorking(true);
        const r = await resolvePasswordRequest(req.id, req.username, null);
        setFlash({ t: r.ok ? 'ok' : 'err', m: r.msg });
        setWorking(false);
        if (r.ok) onDone();
      }}>Dismiss</button>
    </div>
  );
}
