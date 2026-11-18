import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { supabase } from '../supabaseClient.js';
import { APP_VERSION, APP_BUILD_LABEL } from '../buildInfo.js';
import {
  publishUpdate, listUpdates, deleteUpdates, restoreUpdates,
  supabaseConfigured, cmpVer, openDownload
} from '../utils/updateService.js';

const KINDS = [
  { key: 'all', label: 'Everything', icon: '🗂️' },
  { key: 'update', label: 'App updates', icon: '📦' },
  { key: 'news', label: 'News', icon: '📰' },
  { key: 'alert', label: 'With alert', icon: '🔔' }
];
const SORTS = [
  { key: 'new', label: 'Newest first' },
  { key: 'old', label: 'Oldest first' },
  { key: 'ver', label: 'Version high→low' }
];
const fmt = d => { try { return new Date(d).toLocaleString([], { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }); } catch (e) { return ''; } };
const mb = n => (n / 1048576).toFixed(1);

export default function AdminUpdatesPanel({ onClose }) {
  const [tab, setTab] = useState('update');
  const [version, setVersion] = useState('');
  const [file, setFile] = useState(null);
  const [link, setLink] = useState('');
  const [message, setMessage] = useState('');
  const [sendAlert, setSendAlert] = useState(true);
  const [dragOver, setDragOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pct, setPct] = useState(0);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState('');
  const [flash, setFlash] = useState(null);
  const [undo, setUndo] = useState(null);
  const [q, setQ] = useState('');
  const [kind, setKind] = useState('all');
  const [sort, setSort] = useState('new');
  const [sel, setSel] = useState(() => new Set());
  const [openRow, setOpenRow] = useState(null);
  const fileRef = useRef(null);
  const alive = useRef(true);

  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(null), 3600);
    return () => clearTimeout(t);
  }, [flash]);
  useEffect(() => {
    if (!undo) return;
    const t = setTimeout(() => setUndo(null), 9000);
    return () => clearTimeout(t);
  }, [undo]);
  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const reload = useCallback(async () => {
    setLoading(true); setLoadErr('');
    try {
      const data = await listUpdates();
      if (!alive.current) return;
      setRows(data); setSel(new Set());
    } catch (e) {
      if (!alive.current) return;
      setLoadErr(e.message); setRows([]);
    } finally { if (alive.current) setLoading(false); }
  }, []);
  useEffect(() => { reload(); }, [reload]);

  const view = useMemo(() => {
    const needle = q.trim().toLowerCase();
    let out = rows.filter(r => {
      if (kind === 'update' && r.kind !== 'update') return false;
      if (kind === 'news' && r.kind !== 'news') return false;
      if (kind === 'alert' && !r.send_alert) return false;
      if (!needle) return true;
      return `${r.version} ${r.message} ${r.apk_url}`.toLowerCase().includes(needle);
    });
    out = [...out];
    if (sort === 'new') out.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    if (sort === 'old') out.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
    if (sort === 'ver') out.sort((a, b) => cmpVer(a.version, b.version));
    return out;
  }, [rows, q, kind, sort]);

  const stats = useMemo(() => {
    const ups = rows.filter(r => r.kind === 'update');
    const latest = [...ups].sort((a, b) => cmpVer(a.version, b.version))[0];
    return { total: rows.length, updates: ups.length, news: rows.length - ups.length, latest: latest ? latest.version : '—' };
  }, [rows]);

  const pick = f => {
    if (!f) return;
    if (!/\.apk$/i.test(f.name)) { setFlash({ tone: 'warn', text: 'That is not an .apk file — pick the built APK.' }); return; }
    setFile(f); setFlash({ tone: 'ok', text: `${f.name} · ${mb(f.size)} MB ready` });
  };

  const publish = async () => {
    if (busy) return;
    if (tab === 'update' && !version.trim()) return setFlash({ tone: 'err', text: 'Enter the new version number, e.g. 1.1.0' });
    if (tab === 'update' && !file && !link.trim()) return setFlash({ tone: 'err', text: 'Choose an APK file or paste a download link.' });
    if (!message.trim()) return setFlash({ tone: 'err', text: 'Write the message that scrolls at the top.' });
    setBusy(true); setPct(0);
    try {
      const row = await publishUpdate({ kind: tab, version, file, link, message, sendAlert, onProgress: p => alive.current && setPct(p) });
      if (!alive.current) return;
      setRows(r => [row, ...r]);
      setFlash({ tone: 'ok', text: tab === 'update' ? `v${version.trim()} is live for every user.` : 'News is live for every user.' });
      setVersion(''); setFile(null); setLink(''); setMessage('');
      if (fileRef.current) fileRef.current.value = '';
    } catch (e) {
      if (alive.current) setFlash({ tone: 'err', text: e.message });
    } finally { if (alive.current) { setBusy(false); setPct(0); } }
  };

  const removeRows = async (targets) => {
    if (!targets.length) return;
    const backup = targets.map(t => ({ ...t }));
    setRows(r => r.filter(x => !targets.some(t => t.id === x.id)));
    setSel(new Set());
    setUndo({ rows: backup, label: backup.length === 1 ? (backup[0].kind === 'news' ? 'news' : 'v' + backup[0].version) : `${backup.length} items` });
    try { await deleteUpdates(backup.map(b => b.id)); }
    catch (e) {
      if (!alive.current) return;
      setRows(r => [...backup, ...r]);
      setUndo(null);
      setFlash({ tone: 'err', text: 'Delete failed: ' + e.message });
    }
  };

  const doUndo = async () => {
    if (!undo) return;
    const backup = undo.rows;
    setUndo(null);
    setRows(r => [...backup, ...r].sort((a, b) => new Date(b.created_at) - new Date(a.created_at)));
    try { await restoreUpdates(backup); setFlash({ tone: 'ok', text: 'Restored.' }); }
    catch (e) {
      setRows(r => r.filter(x => !backup.some(b => b.id === x.id)));
      setFlash({ tone: 'err', text: 'Undo failed: ' + e.message });
    }
  };

  const toggleSel = id => setSel(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const allShown = view.length > 0 && view.every(r => sel.has(r.id));
  const toggleAll = () => setSel(allShown ? new Set() : new Set(view.map(r => r.id)));
  const copy = async txt => {
    try { await navigator.clipboard.writeText(txt); setFlash({ tone: 'ok', text: 'Link copied' }); }
    catch (e) { setFlash({ tone: 'warn', text: 'Copy not available — long-press the link instead.' }); }
  };

  /* ═══ RE-ALERT: notify all users again ═══ */
  const reAlert = async () => {
    if (!rows.length) return setFlash({ tone: 'err', text: 'No published updates to re-alert.' });
    if (!confirm('This will notify ALL users about the latest update again, even if they dismissed it. Continue?')) return;
    setBusy(true);
    try {
      const latest = rows[0];
      const until = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
      const { error } = await supabase.from('scanprintupdates')
        .update({ send_alert: true, force_until: until, updated_at: new Date().toISOString() })
        .eq('id', latest.id);
      if (error) throw error;
      // Bump a timestamp so clients re-fetch
      localStorage.setItem('gfs_force_check', String(Date.now()));
      setFlash({ tone: 'ok', text: 'Re-alerted — banner forced on all devices for 7 days' });
      await reload();
    } catch (e) {
      setFlash({ tone: 'err', text: 'Re-alert failed: ' + e.message });
    } finally { setBusy(false); }
  };

  const body = (
    <div className="upx-scrim" role="dialog" aria-modal="true" aria-label="App updates">
      <div className="upx-sheet">
        <header className="upx-head">
          <button className="upx-ghost-btn" onClick={onClose}>← Back</button>
          <div className="upx-head-title">
            <span className="upx-head-ico">📢</span>
            <div>
              <b>App Updates</b>
              <i>publish once · every user is notified</i>
            </div>
          </div>
          <button className="upx-ghost-btn" onClick={reload} disabled={loading}>{loading ? '⟳…' : '⟳ Refresh'}</button>
        </header>

        <div className="upx-scroll">
          <div className="upx-stats">
            <div className="upx-stat v"><i>Published</i><b>{stats.total}</b></div>
            <div className="upx-stat b"><i>APK releases</i><b>{stats.updates}</b></div>
            <div className="upx-stat m"><i>News posts</i><b>{stats.news}</b></div>
            <div className="upx-stat g"><i>Latest version</i><b>{stats.latest}</b></div>
          </div>

          {!supabaseConfigured && (
            <div className="upx-note warn">Supabase is not reachable from <b>src/supabaseClient.js</b>. Restore the credentials and rebuild.</div>
          )}

          <div className="upx-tabs">
            <button className={tab === 'update' ? 'on' : ''} onClick={() => setTab('update')}>📦 New update</button>
            <button className={tab === 'news' ? 'on' : ''} onClick={() => setTab('news')}>📰 News for everyone</button>
          </div>

          <section className="upx-card">
            {tab === 'update' && (
              <>
                <div className="upx-note warn" style={{ margin: 0 }}>
                Your current build is <b>v{APP_VERSION}</b>. Publish a <b>higher</b> version so installed apps detect it.
                Publishing the same or an older version will NOT alert users (unless you press Re-alert).
              </div>
              <label className="upx-lab">New version number</label>
                <input className="upx-in" placeholder="e.g. 1.1.0" value={version} onChange={e => setVersion(e.target.value)} inputMode="decimal" />

                <label className="upx-lab">The new app (APK file)</label>
                <div
                  className={'upx-drop' + (dragOver ? ' over' : '') + (file ? ' has' : '')}
                  onClick={() => fileRef.current?.click()}
                  onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={e => { e.preventDefault(); setDragOver(false); pick(e.dataTransfer.files?.[0]); }}
                >
                  <span className="upx-drop-ico">{file ? '📦' : '⬆️'}</span>
                  <div className="upx-drop-txt">
                    <b>{file ? file.name : 'Choose or drop the APK file'}</b>
                    <i>{file ? `${mb(file.size)} MB · stored in Supabase, users download from there` : 'Stored in your Supabase bucket — users download it from there'}</i>
                  </div>
                  {file && <button className="upx-mini" onClick={e => { e.stopPropagation(); setFile(null); if (fileRef.current) fileRef.current.value = ''; }}>Clear</button>}
                </div>
                <input ref={fileRef} type="file" accept=".apk,application/vnd.android.package-archive" hidden onChange={e => pick(e.target.files?.[0])} />

                <label className="upx-lab">…or paste a download link instead</label>
                <input className="upx-in" placeholder="https://…" value={link} onChange={e => setLink(e.target.value)} inputMode="url" />
              </>
            )}

            <label className="upx-lab">Message that scrolls at the top</label>
            <textarea className="upx-in upx-area" rows={3} maxLength={220}
              placeholder="e.g. Faster printing, passport 6-up and new colours are here. Please update."
              value={message} onChange={e => setMessage(e.target.value)} />
            <div className="upx-counter">{message.length}/220</div>

            <button className={'upx-switch' + (sendAlert ? ' on' : '')} onClick={() => setSendAlert(v => !v)}>
              <span className="upx-switch-ico">{sendAlert ? '🔔' : '🔕'}</span>
              <span className="upx-switch-txt"><b>Also send an alert to every user</b><i>{sendAlert ? 'Bottom alert appears with the banner' : 'Only the scrolling banner shows'}</i></span>
              <span className="upx-track"><span /></span>
            </button>

            {busy && (
              <div className="upx-prog">
                <div className="upx-prog-bar"><span style={{ width: (pct || 6) + '%' }} /></div>
                <i>{pct > 0 ? 'Uploading APK… ' + pct + '%' : 'Publishing…'}</i>
              </div>
            )}

            <button className="upx-publish" onClick={publish} disabled={busy || !supabaseConfigured}>
              {busy ? 'Uploading…' : '📢 Upload and publish'}
            </button>

            {rows.length > 0 && (
              <button className="upx-publish" style={{ background: 'linear-gradient(112deg,#f59e0b,#ef4444)', marginTop: '8px' }}
                onClick={reAlert} disabled={busy}>
                🔄 Re-alert all users about latest update
              </button>
            )}
          </section>

          <div className="upx-list-head">
            <span>Published</span>
            <span className="upx-pill">{view.length} shown</span>
          </div>

          <div className="upx-toolbar">
            <input className="upx-search" placeholder="Search version or message…" value={q} onChange={e => setQ(e.target.value)} />
            <select className="upx-sel" value={sort} onChange={e => setSort(e.target.value)}>
              {SORTS.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
          </div>
          <div className="upx-chips">
            {KINDS.map(k => (
              <button key={k.key} className={'upx-chip' + (kind === k.key ? ' on' : '')} onClick={() => setKind(k.key)}>
                <span>{k.icon}</span>{k.label}
              </button>
            ))}
          </div>

          {view.length > 0 && (
            <div className="upx-bulk">
              <label className="upx-check">
                <input type="checkbox" checked={allShown} onChange={toggleAll} />
                <span>{allShown ? 'Clear selection' : 'Select all shown'}</span>
              </label>
              {sel.size > 0 && (
                <button className="upx-danger" onClick={() => removeRows(rows.filter(r => sel.has(r.id)))}>🗑 Delete {sel.size}</button>
              )}
            </div>
          )}

          {loading ? (
            <div className="upx-empty"><span className="upx-spin" /> Loading published items…</div>
          ) : loadErr ? (
            <div className="upx-note err">
              {loadErr}
              <button className="upx-mini" onClick={reload}>Try again</button>
            </div>
          ) : view.length === 0 ? (
            <div className="upx-empty">
              <span className="upx-empty-ico">📭</span>
              <b>{rows.length ? 'Nothing matches this filter' : 'Nothing published yet'}</b>
              <i>{rows.length ? 'Clear the search or pick another chip.' : 'Publish your first APK or news post above — it appears here instantly.'}</i>
            </div>
          ) : (
            <div className="upx-list">
              {view.map(r => {
                const isOpen = openRow === r.id;
                return (
                  <article key={r.id} className={'upx-item' + (sel.has(r.id) ? ' picked' : '')}>
                    <div className="upx-item-top">
                      <input type="checkbox" className="upx-row-check" checked={sel.has(r.id)} onChange={() => toggleSel(r.id)} />
                      <span className={'upx-badge ' + (r.kind === 'news' ? 'news' : 'apk')}>
                        {r.kind === 'news' ? '📰 NEWS' : '📦 v' + (r.version || '—')}
                      </span>
                      <span className="upx-date">{fmt(r.created_at)}</span>
                      <span className={'upx-alert-dot' + (r.send_alert ? ' on' : '')} title={r.send_alert ? 'Alert on' : 'Alert off'}>{r.send_alert ? '🔔' : '🔕'}</span>
                    </div>
                    <p className="upx-msg">{r.message}</p>
                    <div className="upx-item-acts">
                      <button className="upx-mini" onClick={() => setOpenRow(isOpen ? null : r.id)}>{isOpen ? 'Hide details' : 'Details'}</button>
                      {r.apk_url && <button className="upx-mini blue" onClick={() => openDownload(r.apk_url)}>Open APK ↗</button>}
                      {r.apk_url && <button className="upx-mini" onClick={() => copy(r.apk_url)}>Copy link</button>}
                      <button className="upx-mini red" onClick={() => removeRows([r])}>Delete</button>
                    </div>
                    {isOpen && (
                      <div className="upx-detail">
                        <div><i>Type</i><b>{r.kind === 'news' ? 'News broadcast' : 'APK release'}</b></div>
                        <div><i>Version</i><b>{r.version || '—'}</b></div>
                        <div><i>Alert</i><b>{r.send_alert ? 'Banner + bottom alert' : 'Banner only'}</b></div>
                        <div><i>Published on</i><b>{new Date(r.created_at).toLocaleString()}</b></div>
                        <div><i>Your build date</i><b>{APP_BUILD_LABEL}</b></div>
                        <div className="upx-detail-url"><i>Download URL</i><b>{r.apk_url || 'none (news post)'}</b></div>
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          )}

          <div className="upx-foot">Every publish is stored in Supabase · users see it on next launch</div>
        </div>

        {flash && <div className={'upx-flash ' + flash.tone}>{flash.text}</div>}
        {undo && (
          <div className="upx-undo">
            <span>Deleted {undo.label}</span>
            <button onClick={doUndo}>Undo</button>
            <button className="upx-undo-x" onClick={() => setUndo(null)} aria-label="Dismiss">×</button>
          </div>
        )}
      </div>
    </div>
  );

  return createPortal(body, document.body);
}
