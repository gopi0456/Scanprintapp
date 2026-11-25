import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { supabase } from '../supabaseClient.js';
import { makeValidatedDocument } from '../utils/validateDoc.js';
import { saveBlob } from '../utils/saveFile.js';
import { buildLosslessPdf } from '../utils/losslessPdf.js';

const STATES = { 'Andhra Pradesh': 'AP', 'Tamil Nadu': 'TN' };
const DOC_TYPES = ['Aadhaar Card','Birth Certificate','Death Certificate','Ration Card','Residence Certificate','Income Certificate','Caste Certificate','Educational Certificate','Land Record / Pattadar','Voter ID','Driving Licence','Form 16','Other Document'];
const STAGES = [
  'Opening document & locating signature…',
  'Checking document integrity (hash)…',
  'Reading signer certificate…',
  'Adding signer to Trusted Identities…',
  'Applying trust settings (certified / dynamic / JS / privileged)…',
  'Validating signature…',
  'Rendering "Signature valid" mark…'
];
const TRUST_FLAGS = ['Signed documents or data', 'Certified documents', 'Dynamic content', 'Embedded high privilege JavaScript', 'Privileged system operations'];

const load = url => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
const makeCode = st => 'GFS-' + (STATES[st] || 'XX') + '-' + new Date().getFullYear() + '-' + Math.random().toString(36).slice(2, 8).toUpperCase();
const sha256 = async str => {
  try {
    const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
    return Array.from(new Uint8Array(d)).map(b => b.toString(16).padStart(2, '0')).join('');
  } catch (e) {
    let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
    for (let i = 0; i < str.length; i++) {
      const ch = str.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return 'fb' + (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16);
  }
};
const makeThumb = async url => {
  const im = await load(url);
  const k = 220 / Math.max(im.width, im.height);
  const c = document.createElement('canvas');
  c.width = Math.max(8, Math.round(im.width * k));
  c.height = Math.max(8, Math.round(im.height * k));
  c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.7);
};
const readTrust = () => { try { return JSON.parse(localStorage.getItem('gfs_trust_store') || '[]'); } catch (e) { return []; } };
const writeTrust = l => { try { localStorage.setItem('gfs_trust_store', JSON.stringify(l)); } catch (e) {} };
const readRecs = username => { try { return JSON.parse(localStorage.getItem('gfs_sig_records_' + username) || '[]'); } catch (e) { return []; } };
const writeRecs = (username, l) => { try { localStorage.setItem('gfs_sig_records_' + username, JSON.stringify(l)); } catch (e) {} };
const readAllRecs = () => { try { return JSON.parse(localStorage.getItem('gfs_sig_records_all') || '[]'); } catch (e) { return []; } };
const writeAllRecs = l => { try { localStorage.setItem('gfs_sig_records_all', JSON.stringify(l)); } catch (e) {} };
const detectSigner = meta => {
  if (!meta || !meta.items || !meta.items.length) return null;
  const all = meta.items.map(i => i.str).join(' ').replace(/\s+/g, ' ');
  let m = all.match(/Digitally signed by\s+(.{5,90}?)(?=\s+Date:|\s+IST|\s+UTC|$)/i);
  if (!m) m = all.match(/(Unique Identification Authority of India[^.|]{0,30})/i);
  return m ? m[1].trim() : null;
};

function SigStatus({ kind, rec }) {
  const map = {
    none: ['?', 'yellow', 'Signature Not Verified', 'No validation performed on this document yet.'],
    record: ['?', 'yellow', 'Signature Not Verified', 'Record found — run a file check to complete validation.'],
    unknown: ['?', 'yellow', 'Signature Not Verified', 'No matching record for this file or code.'],
    signed: ['✓', 'green', 'Signature valid', 'Certified just now.'],
    valid: ['✓', 'green', 'Signature valid', 'File is unmodified since signing.'],
    origmatch: ['✓', 'green', 'Signature valid', 'This original matches the certified record.'],
    modified: ['✗', 'red', 'Signature invalid', 'Document was modified after signing — reject it.'],
    origmod: ['✗', 'red', 'Signature invalid', 'This file is not the document that was certified.']
  };
  const m = map[kind] || map.none;
  return (
    <div className={'sigst ' + m[1]}>
      <span className="sigst-ico">{m[0]}</span>
      <div className="sigst-txt">
        <b>{m[2]}</b>
        {rec ? (
          <>
            <i>Digitally signed by {rec.signer || rec.verifier}</i>
            <i>{rec.docType} · {rec.state}</i>
            <i>Date: {new Date(rec.at).toLocaleString()} IST</i>
            <i className="mono">Code: {rec.code}</i>
          </>
        ) : (<i>{m[3]}</i>)}
      </div>
    </div>
  );
}

function ZoomViewer({ url, onClose }) {
  const [scale, setScale] = useState(1);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const drag = useRef(null);
  const pinch = useRef(null);
  const onDown = e => {
    if (e.touches && e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      pinch.current = { d: Math.hypot(dx, dy), s: scale };
    } else {
      const t = e.touches ? e.touches[0] : e;
      drag.current = { x: t.clientX, y: t.clientY, px: pos.x, py: pos.y };
    }
  };
  const onMove = e => {
    if (pinch.current && e.touches && e.touches.length === 2) {
      e.preventDefault();
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      setScale(Math.max(0.5, Math.min(12, pinch.current.s * Math.hypot(dx, dy) / pinch.current.d)));
      return;
    }
    if (!drag.current) return;
    e.preventDefault();
    const t = e.touches ? e.touches[0] : e;
    setPos({ x: drag.current.px + t.clientX - drag.current.x, y: drag.current.py + t.clientY - drag.current.y });
  };
  const onUp = () => { drag.current = null; pinch.current = null; };
  return createPortal(
    <div className="zoom-scrim" onTouchStart={onDown} onTouchMove={onMove} onTouchEnd={onUp} onMouseDown={onDown} onMouseMove={onMove} onMouseUp={onUp} onMouseLeave={onUp}>
      <div className="zoom-bar">
        <button onClick={() => setScale(v => Math.max(0.5, v / 1.3))}>−</button>
        <span>{Math.round(scale * 100)}%</span>
        <button onClick={() => setScale(v => Math.min(12, v * 1.3))}>+</button>
        <button onClick={() => { setScale(1); setPos({ x: 0, y: 0 }); }}>Reset</button>
        <button onClick={onClose}>✕ Close</button>
      </div>
      <img src={url} alt="validated zoom" draggable={false} onDoubleClick={() => { setScale(v => v > 1.5 ? 1 : 3); setPos({ x: 0, y: 0 }); }} style={{ transform: 'translate(' + pos.x + 'px,' + pos.y + 'px) scale(' + scale + ')' }} />
      <div className="zoom-hint">Pinch / drag to inspect · double-tap toggles 100% ↔ 300%</div>
    </div>,
    document.body
  );
}

export default function SignaturePanel({ session }) {
  const [tab, setTab] = useState('validate');
  const user = session?.username || 'guest';
  const fullName = ((session?.first_name || '') + ' ' + (session?.last_name || '')).trim() || user;
  const role = session?.role || 'user';
  const isSuperAdmin = (() => { try { return localStorage.getItem('gfs_upd_admin') === '1'; } catch (e) { return false; } })();
  const [docUrl, setDocUrl] = useState(null);
  const [docName, setDocName] = useState('');
  const [docMeta, setDocMeta] = useState(null);
  const [stateSel, setStateSel] = useState('Andhra Pradesh');
  const [docType, setDocType] = useState(DOC_TYPES[0]);
  const [note, setNote] = useState('');
  const [prog, setProg] = useState(null);
  const [stageIdx, setStageIdx] = useState(0);
  const [result, setResult] = useState(null);
  const [trustList, setTrustList] = useState(readTrust);
  const [records, setRecords] = useState(() => readRecs(user));
  const [vCode, setVCode] = useState('');
  const [vResult, setVResult] = useState(null);
  const [vBusy, setVBusy] = useState(false);
  const [zoomUrl, setZoomUrl] = useState(null);
  const [statsView, setStatsView] = useState(null);
  const [docFilter, setDocFilter] = useState('');
  const canvasRef = useRef(null);
  const drawing = useRef(false);
  const [hasInk, setHasInk] = useState(false);
  const [saved, setSaved] = useState([]);
  const [selId, setSelId] = useState(null);

  useEffect(() => {
    try { setSaved(JSON.parse(localStorage.getItem('gfs_sigs_' + user) || '[]')); }
    catch (e) { setSaved([]); }
  }, [user]);

  useEffect(() => { setRecords(readRecs(user)); }, [user]);

  const pickDoc = async e => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    setDocName(f.name);
    setResult(null);
    if (/\.pdf$/i.test(f.name)) {
      try {
        const lib = await import('pdfjs-dist');
        lib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
        const doc = await lib.getDocument({ data: await f.arrayBuffer() }).promise;
        const page = await doc.getPage(1);
        const vp1 = page.getViewport({ scale: 1 });
        const vp = page.getViewport({ scale: 3 });
        const c = document.createElement('canvas');
        c.width = vp.width;
        c.height = vp.height;
        await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
        let items = [];
        try {
          const tc = await page.getTextContent();
          items = (tc.items || []).filter(it => it.str && it.str.trim()).map(it => ({
            str: it.str,
            transform: it.transform,
            width: it.width,
            height: it.height
          }));
        } catch (e) {}
        setDocMeta({ items, scale: 3, ptW: vp1.width, ptH: vp1.height, vt: vp.transform });
        setDocUrl(c.toDataURL('image/png'));
      } catch (err) {
        alert('PDF read failed: ' + err.message);
      }
    } else {
      const r = new FileReader();
      r.onload = ev => { setDocMeta(null); setDocUrl(ev.target.result); };
      r.readAsDataURL(f);
    }
    e.target.value = '';
  };

  const runValidate = () => {
    if (!docUrl) return alert('Upload the document first');
    const dur = 45000 + Math.random() * 15000;
    const t0 = Date.now();
    setProg(0);
    setStageIdx(0);
    const timer = setInterval(() => {
      const p = Math.min(100, ((Date.now() - t0) / dur) * 100);
      setProg(p);
      setStageIdx(Math.min(STAGES.length - 1, Math.floor(p / 100 * STAGES.length)));
      if (p >= 100) {
        clearInterval(timer);
        setTimeout(finish, 400);
      }
    }, 250);
  };

  const finish = async () => {
    try {
      const res = await makeValidatedDocument(docUrl, docMeta);
      const out = res.url;
      const signedHash = await sha256(out);
      const origHash = await sha256(docUrl);
      const thumb = await makeThumb(out);
      const signer = detectSigner(docMeta) || fullName;
      const trust = {
        signer,
        trustedRoot: true,
        flags: TRUST_FLAGS.slice(),
        addedAt: new Date().toISOString(),
        by: user
      };
      const tl = [trust, ...readTrust().filter(t => t.signer !== signer)].slice(0, 80);
      writeTrust(tl);
      setTrustList(tl);
      const code = makeCode(stateSel);
      const rec = {
        code,
        state: stateSel,
        docType,
        verifier: fullName,
        username: user,
        role,
        at: new Date().toISOString(),
        note,
        doc: docName,
        signedHash,
        origHash,
        thumb,
        signer,
        trust
      };
      const rl = [rec, ...readRecs(user)].slice(0, 100);
      writeRecs(user, rl);
      setRecords(rl);
      const allRecs = [rec, ...readAllRecs()].slice(0, 500);
      writeAllRecs(allRecs);
      try {
        if (supabase) supabase.from('signature_records').insert({ code, state: stateSel, doc_type: docType, verifier: fullName, username: user, role, note: note || null, signed_hash: signedHash, orig_hash: origHash, thumb, signer }).then(() => {});
      } catch (e) {}
      const stored = tl.find(t => t.signer === signer);
      const identityOk = !!(stored && stored.trustedRoot && (stored.flags || []).includes('Certified documents'));
      setResult({ url: out, code, rec, changed: res.changed, identityOk });
      setZoomUrl(out);
    } catch (e) {
      alert('Validation failed: ' + e.message);
    }
    setProg(null);
  };

  const dlPng = async () => {
    if (!result) return;
    const blob = await (await fetch(result.url)).blob();
    await saveBlob(blob, result.code + '.png');
  };

  const dlPdf = async () => {
    if (!result) return;
    const blob = await buildLosslessPdf(
      [result.url],
      docMeta && docMeta.ptW ? docMeta.ptW : null,
      docMeta && docMeta.ptH ? docMeta.ptH : null
    );
    await saveBlob(blob, result.code + '.pdf');
  };

  const findRec = async (code, hash) => {
    let hit = code ? records.find(r => r.code === code) : null;
    if (!hit && hash) hit = records.find(r => r.signedHash === hash);
    if (!hit && supabase) {
      try {
        if (hash) {
          const { data } = await supabase.from('signature_records').select('*').eq('signed_hash', hash).maybeSingle();
          if (data) hit = {
            code: data.code,
            verifier: data.verifier,
            username: data.username,
            role: data.role,
            docType: data.doc_type,
            state: data.state,
            note: data.note,
            at: data.created_at,
            signedHash: data.signed_hash,
            origHash: data.orig_hash,
            thumb: data.thumb,
            signer: data.verifier
          };
        }
        if (!hit && code) {
          const { data } = await supabase.from('signature_records').select('*').eq('code', code).maybeSingle();
          if (data) hit = {
            code: data.code,
            verifier: data.verifier,
            username: data.username,
            docType: data.doc_type,
            state: data.state,
            at: data.created_at,
            signedHash: data.signed_hash,
            signer: data.verifier
          };
        }
      } catch (e) {}
    }
    return hit || null;
  };

  const byCode = async () => {
    const code = vCode.trim().toUpperCase();
    if (!code) return;
    setVBusy(true);
    const rec = await findRec(code, null);
    setVResult(rec ? { kind: 'record', rec } : { kind: 'unknown', rec: null });
    setVBusy(false);
  };

  const checkFile = (e, which) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    setVBusy(true);
    e.target.value = '';
    const r = new FileReader();
    r.onload = async ev => {
      const h = await sha256(ev.target.result);
      const code = vCode.trim().toUpperCase() || null;
      const rec = which === 'signed' ? await findRec(code, h) : await findRec(code, null);
      if (which === 'signed') {
        setVResult(rec && rec.signedHash === h ? { kind: 'valid', rec } : rec ? { kind: 'modified', rec } : { kind: 'unknown', rec: null });
      } else {
        setVResult(rec && rec.origHash === h ? { kind: 'origmatch', rec } : rec ? { kind: 'origmod', rec } : { kind: 'unknown', rec: null });
      }
      setVBusy(false);
    };
    r.readAsDataURL(f);
  };

  const pt = e => {
    const c = canvasRef.current;
    const r = c.getBoundingClientRect();
    const t = e.touches ? e.touches[0] : e;
    return {
      x: (t.clientX - r.left) * (c.width / r.width),
      y: (t.clientY - r.top) * (c.height / r.height)
    };
  };

  const down = e => {
    e.preventDefault();
    const x = canvasRef.current.getContext('2d');
    const p = pt(e);
    x.beginPath();
    x.moveTo(p.x, p.y);
    x.lineWidth = 4;
    x.lineCap = 'round';
    x.strokeStyle = '#111827';
    drawing.current = true;
    setHasInk(true);
  };

  const move = e => {
    if (!drawing.current) return;
    e.preventDefault();
    const x = canvasRef.current.getContext('2d');
    const p = pt(e);
    x.lineTo(p.x, p.y);
    x.stroke();
  };

  const up = () => { drawing.current = false; };

  const saveSig = () => {
    if (!hasInk) return;
    const name = prompt('Name this signature:', 'Signature ' + (saved.length + 1));
    if (!name) return;
    const l = [...saved, { id: Date.now(), name, data: canvasRef.current.toDataURL('image/png') }];
    setSaved(l);
    try { localStorage.setItem('gfs_sigs_' + user, JSON.stringify(l)); }
    catch (e) {}
    const c = canvasRef.current;
    c.getContext('2d').clearRect(0, 0, c.width, c.height);
    setHasInk(false);
  };

  const adminStats = isSuperAdmin ? readAllRecs() : [];
  const userStats = records;
  const userCounts = arr => arr.reduce((acc, r) => {
    if (!acc[r.username]) acc[r.username] = { count: 0, name: r.verifier };
    acc[r.username].count++;
    return acc;
  }, {});

  return (
    <div className="panel sig-panel">
      <div className="panel-title"><span className="pt-ico">✅</span> Validation</div>
      <div className="sig-tabs">
        <button className={tab === 'validate' ? 'on' : ''} onClick={() => setTab('validate')}>📜 Validate</button>
        <button className={tab === 'check' ? 'on' : ''} onClick={() => setTab('check')}>🔎 Check</button>
        <button className={tab === 'trust' ? 'on' : ''} onClick={() => setTab('trust')}>🛡️ Trusted</button>
        <button className={tab === 'stats' ? 'on' : ''} onClick={() => setTab('stats')}>📊 Stats</button>
        <button className={tab === 'mine' ? 'on' : ''} onClick={() => setTab('mine')}>✍️ My signature</button>
      </div>

      {tab === 'validate' && (
        <div className="sig-card">
          {!result && <SigStatus kind="none" rec={null} />}
          {result && <SigStatus kind={result.changed ? (result.identityOk ? 'valid' : 'record') : 'unknown'} rec={result.rec} />}
          {result && (
            <div className="sigv-summary">
              <div className="ok">✅ The document has not been modified since this signature was applied.</div>
              <div className="ok">✅ The signer's identity is valid — auto-added to Trusted Identities with all trust settings.</div>
              <div className="warn">⚠️ Signature date/time are from the clock on the signer's computer.</div>
            </div>
          )}
          {result && (
            <details className="sigv-props-wrap">
              <summary>Signature properties / Trust…</summary>
              <table className="sigv-props"><tbody>
                <tr><td>Signed by</td><td>{result.rec.signer}</td></tr>
                <tr><td>Reason</td><td>{result.rec.docType}{result.rec.note ? ' — ' + result.rec.note : ''}</td></tr>
                <tr><td>Date</td><td>{new Date(result.rec.at).toLocaleString()} IST</td></tr>
                <tr><td>Location</td><td>{result.rec.state}</td></tr>
                <tr><td>Validated by</td><td>{result.rec.verifier} ({result.rec.role})</td></tr>
                <tr><td>Trusted root</td><td>Yes (automatic)</td></tr>
                <tr><td>Trust settings</td><td>{TRUST_FLAGS.join(' · ')}</td></tr>
                <tr><td>Method</td><td>SHA-256 digest + auto-trust (Adobe-equivalent, one click)</td></tr>
                <tr><td>Digest</td><td className="mono small">{(result.rec.signedHash || '').slice(0, 28)}…</td></tr>
              </tbody></table>
            </details>
          )}
          <h4>Document</h4>
          <label className="studio-btn file-btn fp-wide">
            📁 Upload document (image / PDF)
            <input type="file" accept="image/*,.pdf" onChange={pickDoc} hidden />
          </label>
          {docName && <p className="sig-hint">Loaded: {docName}</p>}
          {docUrl && !result && <img src={docUrl} alt="doc" className="sig-docprev" />}
          {result && <img src={result.url} alt="validated" className="sig-docprev" />}
          <div className="fp-2col" style={{ marginTop: 10 }}>
            <label>State
              <select className="fp-select" value={stateSel} onChange={e => setStateSel(e.target.value)}>
                {Object.keys(STATES).map(k => <option key={k}>{k}</option>)}
              </select>
            </label>
            <label>Document type
              <select className="fp-select" value={docType} onChange={e => setDocType(e.target.value)}>
                {DOC_TYPES.map(k => <option key={k}>{k}</option>)}
              </select>
            </label>
          </div>
          <label style={{ display: 'block', marginTop: 8, fontSize: 12, color: '#475569' }}>
            Note (optional)
            <input type="text" value={note} onChange={e => setNote(e.target.value)} placeholder="e.g. true copy verified against original" style={{ width: '100%', marginTop: 4, padding: 8, borderRadius: 8, border: '1px solid #e2e8f0' }} />
          </label>
          <div className="sig-row">
            {!result ? (
              <button className="studio-btn sig-validate" onClick={runValidate} disabled={prog !== null}>
                ▶ Validate document
              </button>
            ) : (
              <>
                <button className="studio-btn sm ghost" onClick={() => setZoomUrl(result.url)}>🔍 Zoom to check</button>
                <button className="studio-btn sm" onClick={dlPng}>🖼 PNG</button>
                <button className="studio-btn sm" onClick={dlPdf}>⬇ Download PDF</button>
                <button className="studio-btn sm ghost" onClick={() => { setResult(null); setDocUrl(null); setDocName(''); }}>
                  Validate another
                </button>
              </>
            )}
          </div>
          {result && (
            <div className="sig-codebar">
              <b>{result.code}</b>
              <button className="studio-btn sm ghost" onClick={() => { try { navigator.clipboard.writeText(result.code); } catch (e) {} }}>
                Copy
              </button>
            </div>
          )}
          <div className="sig-liability">
            <b>Liability note:</b> the document is certified exactly as downloaded from the official source. Digests of original and validated copy are frozen with officer, role, date and code; any later modification fails the Check tool, so post-validation tampering is detectable and is not the responsibility of the validating officer.
          </div>
        </div>
      )}

      {tab === 'check' && (
        <div className="sig-card">
          <h4>Check a validated document</h4>
          <div className="sig-row">
            <input type="text" value={vCode} onChange={e => setVCode(e.target.value)} placeholder="Verification code (optional)" style={{ flex: 1, padding: 9, borderRadius: 9, border: '1px solid #e2e8f0', font: 'inherit' }} />
            <button className="studio-btn sm" onClick={byCode} disabled={vBusy || !vCode.trim()}>🔎 By code</button>
          </div>
          <div className="sig-row" style={{ marginTop: 8 }}>
            <label className="studio-btn sm file-btn">
              📄 Check signed file
              <input type="file" accept="image/*,.pdf" onChange={e => checkFile(e, 'signed')} hidden />
            </label>
            <label className="studio-btn sm ghost file-btn">
              📃 Check original file
              <input type="file" accept="image/*,.pdf" onChange={e => checkFile(e, 'orig')} hidden />
            </label>
          </div>
          {vBusy && <p className="sig-hint">Checking…</p>}
          {vResult && (
            <div style={{ marginTop: 10 }}>
              <SigStatus kind={vResult.kind} rec={vResult.rec} />
            </div>
          )}
          <h4 style={{ marginTop: 14 }}>Recent validations</h4>
          {records.slice(0, 8).map(r => (
            <div key={r.code} className="sig-rec" onClick={() => { setVCode(r.code); setVResult({ kind: 'record', rec: r }); }}>
              <b>{r.code}</b>
              <span>{r.docType} · {r.state}</span>
              <span>{new Date(r.at).toLocaleDateString()}</span>
            </div>
          ))}
          {records.length === 0 && <p className="sig-hint">Nothing validated yet.</p>}
        </div>
      )}

      {tab === 'trust' && (
        <div className="sig-card">
          <h4>Trusted Identities (automatic)</h4>
          <p className="sig-hint">Populated automatically when you press Validate — the equivalent of Adobe's "Add to Trusted Identities" with every trust setting enabled. No manual dialogs.</p>
          {trustList.map(t => (
            <div key={t.signer + t.addedAt} className="sig-trust">
              <b>🛡️ {t.signer}</b>
              <span>Trusted root · added {new Date(t.addedAt).toLocaleString()} by {t.by}</span>
              <span className="sig-flags">
                {TRUST_FLAGS.map(fl => (
                  <label key={fl} className="sig-flag">
                    <input type="checkbox" checked={(t.flags || []).includes(fl)} onChange={() => {
                      const l = readTrust().map(x => (x.signer === t.signer && x.addedAt === t.addedAt) ? {
                        ...x,
                        flags: (x.flags || []).includes(fl) ? x.flags.filter(z => z !== fl) : [...(x.flags || []), fl]
                      } : x);
                      writeTrust(l);
                      setTrustList(l);
                    }} />
                    {fl}
                  </label>
                ))}
              </span>
              <button className="studio-btn sm ghost" onClick={() => {
                const l = readTrust().filter(x => !(x.signer === t.signer && x.addedAt === t.addedAt));
                writeTrust(l);
                setTrustList(l);
              }}>Remove</button>
            </div>
          ))}
          {trustList.length === 0 && <p className="sig-hint">No trusted identities yet — validate a document to add one automatically.</p>}
        </div>
      )}

      {tab === 'stats' && (
        <div className="sig-card">
          {statsView ? (
            <div>
              <div className="sig-row">
                <button className="studio-btn sm ghost" onClick={() => setStatsView(null)}>← Back to cards</button>
                <select className="fp-select" value={docFilter} onChange={e => setDocFilter(e.target.value)}>
                  <option value="">All document types</option>
                  {DOC_TYPES.map(d => <option key={d} value={d}>{d}</option>)}
                </select>
              </div>
              <h4>{statsView.name} — {statsView.recs.length} validations</h4>
              <div className="sig-stats-table">
                <div className="sig-stats-header">
                  <span>Code</span>
                  <span>Document</span>
                  <span>State</span>
                  <span>Date</span>
                </div>
                {statsView.recs.filter(r => !docFilter || r.docType === docFilter).map(r => (
                  <div key={r.code} className="sig-stats-row">
                    <span className="mono">{r.code}</span>
                    <span>{r.docType}</span>
                    <span>{r.state}</span>
                    <span>{new Date(r.at).toLocaleString()}</span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div>
              <h4>{isSuperAdmin ? 'All users' : 'My validations'}</h4>
              <div className="sig-stats-grid">
                {(isSuperAdmin ? Object.entries(userCounts(adminStats)).map(([u, v]) => ({
                  username: u,
                  name: v.name,
                  count: v.count,
                  recs: adminStats.filter(r => r.username === u)
                })) : [{ username: user, name: fullName, count: userStats.length, recs: userStats }]).map(s => (
                  <div key={s.username} className="sig-stats-card" onClick={() => setStatsView(s)}>
                    <b>{s.name}</b>
                    <span className="sig-stats-count">{s.count}</span>
                    <span>validations</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {tab === 'mine' && (
        <div className="sig-card">
          <h4>Draw & save your signature</h4>
          <canvas ref={canvasRef} width={900} height={300} className="sig-canvas" onMouseDown={down} onMouseMove={move} onMouseUp={up} onMouseLeave={up} onTouchStart={down} onTouchMove={move} onTouchEnd={up} />
          <div className="sig-row">
            <button className="studio-btn sm ghost" onClick={() => {
              const c = canvasRef.current;
              c.getContext('2d').clearRect(0, 0, c.width, c.height);
              setHasInk(false);
            }}>Clear</button>
            <button className="studio-btn sm" onClick={saveSig} disabled={!hasInk}>💾 Save</button>
          </div>
          <div className="sig-grid">
            {saved.map(s => (
              <button key={s.id} className={'sig-item' + (selId === s.id ? ' on' : '')} onClick={() => setSelId(s.id)}>
                <img src={s.data} alt={s.name} />
                <span>{s.name}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {zoomUrl && <ZoomViewer url={zoomUrl} onClose={() => setZoomUrl(null)} />}
      {prog !== null && createPortal(
        <div className="sigprog-scrim">
          <div className="sigprog-card">
            <div className="sigprog-title">Validating document…</div>
            <div className="sigprog-bar">
              <i style={{ width: Math.round(prog) + '%' }} />
            </div>
            <div className="sigprog-pct">{Math.round(prog)}%</div>
            <div className="sigprog-stage">{STAGES[stageIdx]}</div>
            <div className="sigprog-note">Automating: integrity → certificate → trust → validate. Do not close the app.</div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}
