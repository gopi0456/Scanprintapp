import { useState, useEffect, useRef } from 'react';
import { PRINT_SIZES, renderPdfToImages, cssToMm } from '../utils/imageUtils.js';
import { composePrintPages, printImage, DEFAULT_ADJ } from '../utils/printEngine.js';
import EditModal, { ANCHORS } from './EditModal.jsx';
import { sendMessage } from '../services/messageService.js';

function parseRange(str, max) {
  if (!str || !str.trim()) return Array.from({ length: max }, (_, i) => i);
  const set = new Set();
  str.split(',').forEach(part => {
    const t = part.trim(); if (!t) return;
    if (t.includes('-')) { const [a, b] = t.split('-').map(x => parseInt(x.trim(), 10)); if (!isNaN(a) && !isNaN(b)) { const s = Math.min(a, b), e = Math.max(a, b); for (let i = s; i <= e; i++) if (i >= 1 && i <= max) set.add(i - 1); } }
    else { const n = parseInt(t, 10); if (!isNaN(n) && n >= 1 && n <= max) set.add(n - 1); }
  });
  return [...set].sort((a, b) => a - b);
}
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const r2 = v => Math.round(v * 100) / 100;

export default function ScanPrintPanel({ isExpiredSession, session, isLoading, setIsLoading, loadProgress, setLoadProgress, loadMessage, setLoadMessage }) {
  const [printImages, setPrintImages] = useState([]);
  const [included, setIncluded] = useState([]);
  const [selectedSize, setSelectedSize] = useState('ID Card (CR80)');
  const [sideMode, setSideMode] = useState('single');
  const [passportPaperSize, setPassportPaperSize] = useState('A4');
  const [passportCols, setPassportCols] = useState(6);
  const [passportPerPage, setPassportPerPage] = useState(36);
  const [passportPad, setPassportPad] = useState(1);
  const [stampPad, setStampPad] = useState(0.5);
  const [mixedMode, setMixedMode] = useState(false);
  const [stampMode, setStampMode] = useState(false);
  const [stampPerPage, setStampPerPage] = useState(24);
  const [mixStamp, setMixStamp] = useState('none');
  const [gridCols, setGridCols] = useState(6);
  const [gridRows, setGridRows] = useState(6);
  const [fillSheet, setFillSheet] = useState(true);
  const [previewPages, setPreviewPages] = useState([]);
  const [previewIdx, setPreviewIdx] = useState(0);
  const [previewTotal, setPreviewTotal] = useState(0);
  const touchX = useRef(null);
  const [pagesPerSheet, setPagesPerSheet] = useState(1);
  const [copies, setCopies] = useState(1);
  const [printDpi, setPrintDpi] = useState(300);
  const [rangeInput, setRangeInput] = useState('');
  const [adj, setAdj] = useState({ ...DEFAULT_ADJ });
  const [anchor, setAnchor] = useState('c');
  const [preview, setPreview] = useState(null);
  const [trialBlocked, setTrialBlocked] = useState(false);
  const [renewSent, setRenewSent] = useState(false);
  const [previewMeta, setPreviewMeta] = useState('');
  const [editOpen, setEditOpen] = useState(false);
  const debounceRef = useRef(null);
  const renderToken = useRef(0);

  const isFullPageMode = selectedSize === 'A4' || selectedSize === '4x6 Photo';
  const isDoubleA4 = selectedSize === 'A4' && sideMode === 'double';
  const activeImages = printImages.filter((_, i) => included[i]);
  const previewPageKey = (selectedSize === 'ID Card (CR80)' || selectedSize === 'Passport (2x2)' || selectedSize.startsWith('Stamp') || selectedSize === '4x6 Photo' || selectedSize === 'Passport + Stamp Mix') ? (selectedSize === 'ID Card (CR80)' ? 'A4' : passportPaperSize) : selectedSize;
  const pwMm = cssToMm(PRINT_SIZES[previewPageKey].cssWidth);
  const phMm = cssToMm(PRINT_SIZES[previewPageKey].cssHeight);

  const opts = (forPreview) => ({ sizeKey: selectedSize, sideMode, passportPaper: passportPaperSize, passportCols, passportPerPage, passportPad, stampPad, stampPerPage, mixStamp, stampMode, mixedMode, pagesPerSheet, copies: forPreview ? 1 : copies, dpi: forPreview ? Math.min(printDpi, 150) : printDpi, adj, grid: { cols: gridCols, rows: gridRows, fill: selectedSize === '4x6 Photo' ? false : fillSheet } });

  useEffect(() => {
    if (activeImages.length === 0) { setPreview(null); setPreviewTotal(0); return; }
    clearTimeout(debounceRef.current);
    const token = ++renderToken.current;
    debounceRef.current = setTimeout(async () => {
      try {
        const idx = parseRange(rangeInput, activeImages.length);
        const imgs = idx.map(i => activeImages[i]);
        const isFullSingle = selectedSize === 'A4';
        if (isFullSingle) {
          const total = imgs.length;
          const at = Math.max(0, Math.min(previewIdx, total - 1));
          const { pages } = await composePrintPages(imgs.slice(at, at + 1), opts(true));
          if (token !== renderToken.current) return;
          setPreviewTotal(total);
          setPreview(pages[0] || null);
          setPreviewMeta(total + (total > 1 ? ' sheets • ' : ' sheet • ') + 'edits apply to all ' + imgs.length + ' pages');
        } else {
          const limit = selectedSize === 'ID Card (CR80)' ? 2
            : (selectedSize.startsWith('Stamp') || selectedSize === 'Passport (2x2)' || selectedSize === '4x6 Photo') ? Math.min(activeImages.length, 24)
            : Math.max(2, pagesPerSheet);
          const { pages } = await composePrintPages(imgs.slice(0, limit), opts(true));
          if (token !== renderToken.current) return;
          setPreviewTotal(pages.length);
          setPreview(pages[Math.max(0, Math.min(previewIdx, pages.length - 1))] || null);
          setPreviewMeta(pages.length + (pages.length > 1 ? ' sheets • ' : ' sheet • ') + 'edits apply to all ' + imgs.length + ' pages');
        }
      } catch (e) { console.warn('preview', e); }
    }, 120);
    return () => clearTimeout(debounceRef.current);
  }, [printImages, included, selectedSize, sideMode, passportPaperSize, passportCols, passportPerPage, passportPad, stampPad, stampPerPage, mixStamp, stampMode, mixedMode, pagesPerSheet, printDpi, rangeInput, adj, previewIdx, gridCols, gridRows, fillSheet]);

  const set = (k, v) => setAdj(a => ({ ...a, [k]: v }));
  const applyZoom = (nz) => setAdj(a => { const z = clamp(nz, 0.2, 4); const [ax, ay] = ANCHORS[anchor]; return { ...a, zoom: r2(z), x: Math.round(clamp(a.x + ax * (a.zoom - z) * 100, -60, 60)), y: Math.round(clamp(a.y + ay * (a.zoom - z) * 100, -60, 60)) }; });
  const addImages = (urls) => { setPrintImages(p => [...p, ...urls]); setIncluded(p => [...p, ...urls.map(() => true)]); setAdj({ ...DEFAULT_ADJ }); setPreviewIdx(0); };
  const toggle = (i) => setIncluded(p => p.map((v, k) => k === i ? !v : v));

  const takePhoto = async () => { try { const { Camera, CameraResultType } = await import('@capacitor/camera'); const im = await Camera.getPhoto({ quality: 100, allowEditing: false, resultType: CameraResultType.DataUrl }); addImages([im.dataUrl]); } catch (e) { alert('Camera requires a physical device.'); } };
  const scanDocument = async () => { try { const { DocumentScanner } = await import('@capgo/capacitor-document-scanner'); const r = await DocumentScanner.scanDocument({ responseType: 'base64' }); if (r.scannedImages?.length) addImages([`data:image/jpeg;base64,${r.scannedImages[0]}`]); } catch (e) { alert('Scanning requires a mobile device.'); } };
  const uploadFile = async (e) => {
    const file = e.target.files?.[0]; if (!file) return;
    setIsLoading(true); setLoadProgress(0); setLoadMessage('Processing file...');
    try {
      if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) { const urls = await renderPdfToImages(file, p => setLoadProgress(p)); if (urls.length) addImages(urls); else alert('Empty PDF'); }
      else if (file.type.startsWith('image/')) { const r = new FileReader(); r.onloadend = () => { setLoadProgress(100); addImages([r.result]); }; r.readAsDataURL(file); }
      else alert('Unsupported file');
    } catch (err) { alert('Failed: ' + err.message); }
    finally { setIsLoading(false); setLoadProgress(0); setLoadMessage(''); }
    e.target.value = null;
  };

  const handlePrint = async () => {
    if (isExpiredSession) { setTrialBlocked(true); return; }
    if (activeImages.length === 0) return alert('Select at least one photo.');
    const idx = parseRange(rangeInput, activeImages.length); if (idx.length === 0) return alert('Invalid range.');
    setIsLoading(true); setLoadProgress(0); setLoadMessage('Composing pages...');
    try {
      const imgs = idx.map(i => activeImages[i]);
      const { pages, cssW, cssH } = await composePrintPages(imgs, opts(false));
      setLoadProgress(80); setLoadMessage('Opening printer...');
      await printImage(pages, cssW, cssH); setLoadProgress(100);
    } catch (e) { alert('Print failed: ' + e.message); }
    finally { setIsLoading(false); setLoadProgress(0); setLoadMessage(''); }
  };

  const inlineControl = (label, key, min, max, st, unit, isZoom) => (
    <div className="adj-row">
      <span className="adj-label">{label}</span>
      <input type="range" min={min} max={max} step={st} value={adj[key]} onChange={e => isZoom ? applyZoom(parseFloat(e.target.value)) : set(key, parseFloat(e.target.value))} />
      <button className="em-step" onClick={() => isZoom ? applyZoom(adj[key] - st) : set(key, clamp(r2(adj[key] - st), min, max))}>−</button>
      <input type="number" className="adj-num" min={min} max={max} step={st} value={adj[key]} onChange={e => isZoom ? applyZoom(parseFloat(e.target.value) || min) : set(key, clamp(parseFloat(e.target.value) || 0, min, max))} />
      <button className="em-step" onClick={() => isZoom ? applyZoom(adj[key] + st) : set(key, clamp(r2(adj[key] + st), min, max))}>+</button>
      <span className="adj-unit">{unit}</span>
    </div>
  );

  return (
    <div className="panel">
      {isLoading && (
        <div className="loading-overlay"><div className="progress-card">
          <div className="progress-ball">😊</div>
          <div className="progress-bar-container"><div className="progress-bar" style={{ width: loadProgress + '%' }} /></div>
          <div className="progress-text">{loadMessage || 'Loading...'}</div>
          <div className="progress-percent">{loadProgress}%</div>
        </div></div>
      )}
      <div className="glass-frame"><div className="logo-chip">🖨️</div><div className="main-card">
        <div className="header"><h2>Scan & Print</h2></div>
        <div className="workflow-cards">
          <div className="workflow-card" onClick={takePhoto}><div className="card-content"><span className="icon">📷</span><span className="label">Take Photo</span></div><div className="check-icon">✓</div></div>
          <div className="workflow-card" onClick={scanDocument}><div className="card-content"><span className="icon">✨</span><span className="label">Scan Document</span></div><div className="check-icon">✓</div></div>
          <label className="workflow-card"><div className="card-content"><span className="icon">📁</span><span className="label">Upload Photo or PDF</span></div><div className="check-icon">✓</div><input type="file" accept="image/*,.pdf,application/pdf" style={{ display: 'none' }} onChange={uploadFile} /></label>
        </div>

        {printImages.length > 0 && (
          <div>
            <div className="count-bar"><span className="count-chip">📄 {activeImages.length}/{printImages.length} selected</span>
              <button className="clear-btn" onClick={() => { setPrintImages([]); setIncluded([]); setRangeInput(''); setPreview(null); }}>Clear All</button></div>
            <div className="thumb-strip hscroll">{printImages.map((img, i) => (
              <button key={i} className={'thumb' + (included[i] ? '' : ' off')} onClick={() => toggle(i)}>
                <img src={img} alt={'p' + (i + 1)} /><span className="thumb-mark">{included[i] ? '✓' : '✕'}</span><span className="thumb-num">{i + 1}</span>
              </button>))}</div>
            <div className="thumb-hint">Tap to include / exclude — remaining pages re-arrange automatically.</div>
          </div>
        )}

        {activeImages.length > 1 && (
          <div className="passport-settings" style={{ marginTop: 0, marginBottom: '14px' }}>
            <div className="workflow-card settings-card">
              <div className="card-content" style={{ flexDirection: 'column', alignItems: 'stretch', gap: '4px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}><span className="icon">🔖</span>
                  <input className="neon-input wide" placeholder="All pages (e.g. 1-3, 5, 7-9)" value={rangeInput} onChange={e => setRangeInput(e.target.value)} />
                </div>
                <span className="range-hint">Leave empty = all selected</span>
              </div>
              <div className="check-icon">✓</div>
            </div>
        <div className="workflow-card settings-card">
          <div className="card-content"><span className="icon">🔢</span>
            <div className="parity-chips">
                  <button className={'pc' + (rangeInput === '' ? ' on' : '')} onClick={() => setRangeInput('')}>All</button>
                  <button className="pc" onClick={() => setRangeInput(Array.from({ length: activeImages.length }, (_, i) => i + 1).filter(n => n % 2 === 1).join(','))}>Odd pages</button>
                  <button className="pc" onClick={() => setRangeInput(Array.from({ length: activeImages.length }, (_, i) => i + 1).filter(n => n % 2 === 0).join(','))}>Even pages</button>
                </div>
          </div>
          <div className="check-icon">✓</div>
        </div>
          </div>
        )}

        {isExpiredSession && (
          <div className="trial-strip">
            <span className="ts-ico">⏳</span>
            <div className="ts-txt"><b>Your trial has ended</b><i>You can still sign in and preview. Printing unlocks once your admin extends access.</i></div>
            <button className="ts-btn" disabled={renewSent} onClick={async () => {
              try {
                await sendMessage(session ? session.username : 'user', 'admin@scanprint.app', '[ACCESS] Please extend my printing access.');
                setRenewSent(true);
              } catch (e) { setRenewSent(true); }
            }}>{renewSent ? 'Request sent ✓' : 'Request access'}</button>
          </div>
        )}
        {trialBlocked && (
          <div className="trial-modal" onClick={() => setTrialBlocked(false)}>
            <div className="tm-card" onClick={e => e.stopPropagation()}>
              <span className="tm-ico">🔒</span>
              <b>Printing is locked</b>
              <i>Your {session && session.expiry_date ? 'trial ended on ' + new Date(session.expiry_date).toLocaleDateString() : 'trial has ended'}. Ask your admin to extend access — everything else keeps working.</i>
              <div className="tm-acts">
                <button onClick={() => setTrialBlocked(false)}>Keep previewing</button>
                <button className="ghost" onClick={async () => {
                  try {
                    await sendMessage(session ? session.username : 'user', 'admin@scanprint.app', '[ACCESS] Please extend my printing access.');
                  } catch (e) {}
                  setRenewSent(true); setTrialBlocked(false);
                }}>{renewSent ? 'Already requested' : 'Message admin'}</button>
              </div>
            </div>
          </div>
        )}
        <div className="workflow-cards" style={{ marginBottom: 0 }}>
          <div className="workflow-card settings-card">
            <div className="card-content"><span className="icon">📄</span>
              <select value={selectedSize} onChange={e => { const v = e.target.value; setSelectedSize(v); setAdj({ ...DEFAULT_ADJ }); setPreviewIdx(0); if (v === 'Stamp (20x25)') { setStampPerPage(110); setGridCols(10); setGridRows(11); } else if (v === 'Stamp (25x30)') { setStampPerPage(72); setGridCols(8); setGridRows(9); } else if (v === 'Passport (2x2)') { setPassportPerPage(36); setMixStamp('none'); setStampPerPage(0); setGridCols(6); setGridRows(6); } }} className="neon-select">{Object.keys(PRINT_SIZES).map(s => <option key={s} value={s}>{s}</option>)}</select>
            </div>
            <div className="check-icon">✓</div>
          </div>
        </div>

        {(selectedSize === 'Stamp (20x25)' || selectedSize === 'Stamp (25x30)' || selectedSize === '4x6 Photo') && (
          <div className="passport-settings">
            <div className="sheet-bank">
              <div className="sheet-bank-head"><span>🧭 Sheet layout</span><i>{fillSheet ? 'fill one sheet' : 'exact ISO · spills to more sheets'}</i></div>
              <label className="sb-paper">
                <span>Paper</span>
                <select value={passportPaperSize} onChange={e => setPassportPaperSize(e.target.value)}>
                  <option value="A4">A4 · 210 × 297 mm</option>
                  <option value="4x6 Photo">4x6 Photo · 102 × 152 mm</option>
                </select>
              </label>
              <div className="sheet-bank-grid">
                <label className="sb-field">
                  <span>Per line</span>
                  <div className="sb-step">
                    <button onClick={() => { const c = Math.max(1, gridCols - 1); setGridCols(c); setPassportPerPage(c * gridRows); setStampPerPage(c * gridRows); }}>−</button>
                    <input type="number" min="1" max="24" value={gridCols} onChange={e => { const c = Math.max(1, Math.min(24, parseInt(e.target.value) || 1)); setGridCols(c); setPassportPerPage(c * gridRows); setStampPerPage(c * gridRows); }} />
                    <button onClick={() => { const c = Math.min(24, gridCols + 1); setGridCols(c); setPassportPerPage(c * gridRows); setStampPerPage(c * gridRows); }}>+</button>
                  </div>
                </label>
                <label className="sb-field">
                  <span>Rows</span>
                  <div className="sb-step">
                    <button onClick={() => { const r = Math.max(1, gridRows - 1); setGridRows(r); setPassportPerPage(gridCols * r); setStampPerPage(gridCols * r); }}>−</button>
                    <input type="number" min="1" max="24" value={gridRows} onChange={e => { const r = Math.max(1, Math.min(24, parseInt(e.target.value) || 1)); setGridRows(r); setPassportPerPage(gridCols * r); setStampPerPage(gridCols * r); }} />
                    <button onClick={() => { const r = Math.min(24, gridRows + 1); setGridRows(r); setPassportPerPage(gridCols * r); setStampPerPage(gridCols * r); }}>+</button>
                  </div>
                </label>
                <label className="sb-field">
                  <span>Padding mm</span>
                  <div className="sb-step">
                    <button onClick={() => setPassportPad(Math.max(0, Math.round((passportPad - 0.25) * 100) / 100))}>−</button>
                    <input type="number" min="0" max="4" step="0.25" value={passportPad} onChange={e => setPassportPad(Math.max(0, Math.min(4, parseFloat(e.target.value) || 0)))} />
                    <button onClick={() => setPassportPad(Math.min(4, Math.round((passportPad + 0.25) * 100) / 100))}>+</button>
                  </div>
                </label>
                <label className="sb-field">
                  <span>Copies</span>
                  <div className="sb-step">
                    <button onClick={() => setCopies(Math.max(1, copies - 1))}>−</button>
                    <input type="number" min="1" max="99" value={copies} onChange={e => setCopies(Math.max(1, Math.min(99, parseInt(e.target.value) || 1)))} />
                    <button onClick={() => setCopies(Math.min(99, copies + 1))}>+</button>
                  </div>
                </label>
              </div>
              <div className="sheet-bank-foot">
                <button className={'sb-toggle' + (fillSheet ? ' on' : '')} onClick={() => setFillSheet(v => !v)}>
                  <span className="sb-dot" />{fillSheet ? 'Fill sheet ON' : 'Fill sheet OFF'}
                </button>
                <button className="sb-iso" onClick={() => {
                  if (selectedSize === 'Stamp (20x25)') { setGridCols(10); setGridRows(11); setStampPerPage(110); }
                  else if (selectedSize === 'Stamp (25x30)') { setGridCols(8); setGridRows(9); setStampPerPage(72); }
                  else { setGridCols(6); setGridRows(6); setPassportPerPage(36); }
                  setFillSheet(false); setPassportPad(1);
                }}>Exact ISO</button>
                <span className="sb-read">
                  {(() => {
                    const pp = PRINT_SIZES[passportPaperSize] || PRINT_SIZES['A4'];
                    const wmm = cssToMm(pp.cssWidth), hmm = cssToMm(pp.cssHeight);
                    const isoW = selectedSize === 'Stamp (20x25)' ? 20 : selectedSize === 'Stamp (25x30)' ? 25 : selectedSize === '4x6 Photo' ? 101.6 : 35;
                    const isoH = selectedSize === 'Stamp (20x25)' ? 25 : selectedSize === 'Stamp (25x30)' ? 30 : selectedSize === '4x6 Photo' ? 152.4 : 45;
                    const iCols = Math.max(1, Math.floor(wmm / isoW + 1e-4));
                    const iRows = Math.max(1, Math.floor(hmm / isoH + 1e-4));
                    const cw = fillSheet ? wmm / gridCols : isoW;
                    const ch = fillSheet ? hmm / gridRows : isoH;
                    const cap = fillSheet ? gridCols * gridRows : iCols * iRows;
                    const want = selectedSize.startsWith('Stamp') ? stampPerPage : (mixStamp !== 'none' ? passportPerPage + stampPerPage : passportPerPage);
                    const sheets = Math.max(1, Math.ceil(want / Math.max(1, cap)));
                    return (cw - 2 * passportPad).toFixed(1) + ' × ' + (ch - 2 * passportPad).toFixed(1) + ' mm · ' + cap + ' up · ' + sheets + (sheets > 1 ? ' sheets' : ' sheet');
                  })()}
                </span>
              </div>
            </div>
            <div className="workflow-card settings-card">
              <div className="card-content"><span className="icon">📄</span>
                <select value={passportPaperSize} onChange={e => setPassportPaperSize(e.target.value)} className="neon-select"><option value="A4">A4 Paper</option><option value="4x6 Photo">4x6 Photo</option></select>
              </div>
              <div className="check-icon">✓</div>
            </div>
            <div className="workflow-card settings-card">
              <div className="card-content"><span className="icon">🔢</span>
                <input type="number" min="1" max="200" value={stampPerPage} onChange={e => setStampPerPage(Math.max(1, parseInt(e.target.value) || 1))} className="neon-input" />
                <span style={{ fontSize: '12px', color: '#6b7280', marginLeft: '8px' }}>stamps total</span>
              </div>
              <div className="check-icon">✓</div>
            </div>
            <div className="workflow-card settings-card">
              <div className="card-content"><span className="icon">⬜</span>
                <input type="number" min="0" max="3" step="0.25" value={passportPad} onChange={e => setPassportPad(Math.max(0, Math.min(3, parseFloat(e.target.value) || 0)))} className="neon-input" />
                <span style={{ fontSize: '12px', color: '#6b7280', marginLeft: '8px' }}>mm padding</span>
                <span style={{ fontSize: '11px', color: '#047857', marginLeft: '10px', fontWeight: 700 }}>
                  {selectedSize === 'Stamp (20x25)'
                    ? ((20 - 2 * passportPad).toFixed(1) + ' × ' + (25 - 2 * passportPad).toFixed(1) + ' mm')
                    : ((25 - 2 * passportPad).toFixed(1) + ' × ' + (30 - 2 * passportPad).toFixed(1) + ' mm')}
                </span>
              </div>
              <div className="check-icon">✓</div>
            </div>
          </div>
        )}

        {selectedSize === 'Passport + Stamp Mix' && (
          <div className="passport-settings">
            <div className="workflow-card settings-card">
              <div className="card-content"><span className="icon">📄</span>
                <select value={passportPaperSize} onChange={e => setPassportPaperSize(e.target.value)} className="neon-select"><option value="A4">A4 Paper</option></select>
              </div>
              <div className="check-icon">✓</div>
            </div>
            <div className="workflow-card settings-card">
              <div className="card-content"><span className="icon">🛂</span>
                <input type="number" min="0" max="60" value={passportPerPage} onChange={e => setPassportPerPage(Math.max(0, parseInt(e.target.value) || 0))} className="neon-input" />
                <span style={{ fontSize: '12px', color: '#6b7280', marginLeft: '8px' }}>passport (35×45 mm)</span>
              </div>
              <div className="check-icon">✓</div>
            </div>
            <div className="workflow-card settings-card">
              <div className="card-content"><span className="icon">📮</span>
                <input type="number" min="0" max="120" value={stampPerPage} onChange={e => setStampPerPage(Math.max(0, parseInt(e.target.value) || 0))} className="neon-input" />
                <span style={{ fontSize: '12px', color: '#6b7280', marginLeft: '8px' }}>stamp (20×25 mm)</span>
              </div>
              <div className="check-icon">✓</div>
            </div>
            <div className="workflow-card settings-card">
              <div className="card-content"><span className="icon">⬜</span>
                <input type="number" min="0" max="3" step="0.25" value={passportPad} onChange={e => setPassportPad(Math.max(0, Math.min(3, parseFloat(e.target.value) || 0)))} className="neon-input" />
                <span style={{ fontSize: '12px', color: '#6b7280', marginLeft: '8px' }}>mm padding (both)</span>
              </div>
              <div className="check-icon">✓</div>
            </div>
          </div>
        )}

        {selectedSize === 'A4' && (
          <div className="passport-settings">
            <div className="workflow-card settings-card">
              <div className="card-content"><span className="icon">🔄</span>
                <select value={sideMode} onChange={e => setSideMode(e.target.value)} className="neon-select"><option value="single">Single Side</option><option value="double">Double Side (Front + Back)</option></select>
              </div>
              <div className="check-icon">✓</div>
            </div>
          </div>
        )}

        {selectedSize === 'Passport (2x2)' && (
          <div className="passport-settings">
            <div className="sheet-bank">
              <div className="sheet-bank-head"><span>🧭 Sheet layout</span><i>{fillSheet ? 'edge-to-edge fill' : 'exact ISO cells'}</i></div>
              <div className="sheet-bank-grid">
                <label className="sb-field">
                  <span>Per line</span>
                  <div className="sb-step">
                    <button onClick={() => { const c = Math.max(1, gridCols - 1); setGridCols(c); setPassportPerPage(c * gridRows); setStampPerPage(c * gridRows); }}>−</button>
                    <input type="number" min="1" max="24" value={gridCols} onChange={e => { const c = Math.max(1, Math.min(24, parseInt(e.target.value) || 1)); setGridCols(c); setPassportPerPage(c * gridRows); setStampPerPage(c * gridRows); }} />
                    <button onClick={() => { const c = Math.min(24, gridCols + 1); setGridCols(c); setPassportPerPage(c * gridRows); setStampPerPage(c * gridRows); }}>+</button>
                  </div>
                </label>
                <label className="sb-field">
                  <span>Rows</span>
                  <div className="sb-step">
                    <button onClick={() => { const r = Math.max(1, gridRows - 1); setGridRows(r); setPassportPerPage(gridCols * r); setStampPerPage(gridCols * r); }}>−</button>
                    <input type="number" min="1" max="24" value={gridRows} onChange={e => { const r = Math.max(1, Math.min(24, parseInt(e.target.value) || 1)); setGridRows(r); setPassportPerPage(gridCols * r); setStampPerPage(gridCols * r); }} />
                    <button onClick={() => { const r = Math.min(24, gridRows + 1); setGridRows(r); setPassportPerPage(gridCols * r); setStampPerPage(gridCols * r); }}>+</button>
                  </div>
                </label>
                <label className="sb-field">
                  <span>Padding mm</span>
                  <div className="sb-step">
                    <button onClick={() => setPassportPad(Math.max(0, Math.round((passportPad - 0.25) * 100) / 100))}>−</button>
                    <input type="number" min="0" max="4" step="0.25" value={passportPad} onChange={e => setPassportPad(Math.max(0, Math.min(4, parseFloat(e.target.value) || 0)))} />
                    <button onClick={() => setPassportPad(Math.min(4, Math.round((passportPad + 0.25) * 100) / 100))}>+</button>
                  </div>
                </label>
                <label className="sb-field">
                  <span>Copies</span>
                  <div className="sb-step">
                    <button onClick={() => setCopies(Math.max(1, copies - 1))}>−</button>
                    <input type="number" min="1" max="99" value={copies} onChange={e => setCopies(Math.max(1, Math.min(99, parseInt(e.target.value) || 1)))} />
                    <button onClick={() => setCopies(Math.min(99, copies + 1))}>+</button>
                  </div>
                </label>
              </div>
              <div className="sheet-bank-foot">
                <button className={'sb-toggle' + (fillSheet ? ' on' : '')} onClick={() => setFillSheet(v => !v)}>
                  <span className="sb-dot" />{fillSheet ? 'Fill sheet ON' : 'Fill sheet OFF'}
                </button>
                <button className="sb-iso" onClick={() => {
                  if (selectedSize === 'Stamp (20x25)') { setGridCols(10); setGridRows(11); setStampPerPage(110); }
                  else if (selectedSize === 'Stamp (25x30)') { setGridCols(8); setGridRows(9); setStampPerPage(72); }
                  else { setGridCols(6); setGridRows(6); setPassportPerPage(36); }
                  setFillSheet(false); setPassportPad(1);
                }}>Exact ISO</button>
                <span className="sb-read">
                  {(() => {
                    const p = PRINT_SIZES[passportPaperSize] || PRINT_SIZES['A4'];
                    const wmm = cssToMm(p.cssWidth), hmm = cssToMm(p.cssHeight);
                    const isoW = selectedSize === 'Stamp (20x25)' ? 20 : selectedSize === 'Stamp (25x30)' ? 25 : 35;
                    const isoH = selectedSize === 'Stamp (20x25)' ? 25 : selectedSize === 'Stamp (25x30)' ? 30 : 45;
                    const cw = fillSheet ? wmm / gridCols : isoW;
                    const ch = fillSheet ? hmm / gridRows : isoH;
                    return (cw - 2 * passportPad).toFixed(1) + ' × ' + (ch - 2 * passportPad).toFixed(1) + ' mm · ' + (gridCols * gridRows) + ' up';
                  })()}
                </span>
              </div>
            </div>
            <div className="workflow-card settings-card">
              <div className="card-content"><span className="icon">📮</span>
                <select value={mixStamp} onChange={e => { const v = e.target.value; setMixStamp(v); if (v !== 'none' && (!stampPerPage || stampPerPage < 1)) setStampPerPage(10); }} className="neon-select">
                  <option value="none">No stamp — passport only</option>
                  <option value="20x25">Add stamp 20 × 25 mm</option>
                  <option value="25x30">Add stamp 25 × 30 mm</option>
                </select>
              </div>
              <div className="check-icon">✓</div>
            </div>
            {mixStamp !== 'none' && (
              <div className="workflow-card settings-card">
                <div className="card-content"><span className="icon">🔢</span>
                  <input type="number" min="0" max="120" value={stampPerPage} onChange={e => setStampPerPage(Math.max(0, parseInt(e.target.value) || 0))} className="neon-input" />
                  <span style={{ fontSize: '12px', color: '#6b7280', marginLeft: '8px' }}>{mixStamp === '25x30' ? 'stamps (25×30 mm)' : 'stamps (20×25 mm)'}</span>
                  <span style={{ fontSize: '11px', color: '#047857', marginLeft: '10px', fontWeight: 700 }}>
                    {mixStamp === '25x30' ? ((25 - 2 * passportPad).toFixed(1) + ' × ' + (30 - 2 * passportPad).toFixed(1) + ' mm') : ((20 - 2 * passportPad).toFixed(1) + ' × ' + (25 - 2 * passportPad).toFixed(1) + ' mm')}
                  </span>
                  <button className="em-step" style={{ marginLeft: '10px' }} onClick={() => { setMixStamp('none'); setStampPerPage(0); }}>clear</button>
                </div>
                <div className="check-icon">✓</div>
              </div>
            )}
            <div className="workflow-card settings-card">
              <div className="card-content"><span className="icon">📐</span>
                <select value={passportPaperSize} onChange={e => setPassportPaperSize(e.target.value)} className="neon-select"><option value="A4">A4 Paper</option><option value="4x6 Photo">4x6 Photo</option></select>
              </div>
              <div className="check-icon">✓</div>
            </div>
            <div className="workflow-card settings-card">
              <div className="card-content"><span className="icon">🔢</span>
                <input type="number" min="1" max="12" value={passportCols} onChange={e => setPassportCols(parseInt(e.target.value) || 1)} className="neon-input" />
                <span style={{ fontSize: '12px', color: '#6b7280', marginLeft: '8px' }}>per line</span>
                <input type="number" min="1" max="60" value={passportPerPage} onChange={e => setPassportPerPage(parseInt(e.target.value) || 1)} className="neon-input" style={{ marginLeft: '12px' }} />
                <span style={{ fontSize: '12px', color: '#6b7280', marginLeft: '8px' }}>per page</span>
              </div>
              <div className="check-icon">✓</div>
            </div>
            <div className="workflow-card settings-card">
              <div className="card-content"><span className="icon">⬜</span>
                <input type="number" min="0" max="4" step="0.25" value={passportPad} onChange={e => setPassportPad(Math.max(0, Math.min(4, parseFloat(e.target.value) || 0)))} className="neon-input" />
                <span style={{ fontSize: '12px', color: '#6b7280', marginLeft: '8px' }}>mm padding each side</span>
                <span style={{ fontSize: '11px', color: '#047857', marginLeft: '10px', fontWeight: 700 }}>
                  {'photo prints ' + (35 - 2 * passportPad).toFixed(1) + ' × ' + (45 - 2 * passportPad).toFixed(1) + ' mm'}
                </span>
              </div>
              <div className="check-icon">✓</div>
            </div>
          </div>
        )}

        {isFullPageMode && (
          <div className="passport-settings">
            <div className="workflow-card settings-card">
              <div className="card-content"><span className="icon">🗂️</span>
                <select value={pagesPerSheet} onChange={e => setPagesPerSheet(parseInt(e.target.value, 10))} className="neon-select">
                  {isDoubleA4 ? <><option value={2}>2 / sheet</option><option value={4}>4 / sheet</option><option value={6}>6 / sheet</option><option value={8}>8 / sheet</option></>
                    : <><option value={1}>1 / sheet</option><option value={2}>2 / sheet</option><option value={4}>4 / sheet</option><option value={6}>6 / sheet</option><option value={8}>8 / sheet</option><option value={9}>9 / sheet</option><option value={16}>16 / sheet</option></>}
                </select>
              </div>
              <div className="check-icon">✓</div>
            </div>
          </div>
        )}

        <div className="passport-settings">
          <div className="workflow-card settings-card">
            <div className="card-content"><span className="icon">🔢</span>
              <input type="number" min="1" max="500" value={copies} onChange={e => setCopies(parseInt(e.target.value) || 1)} className="neon-input" />
              <span style={{ fontSize: '12px', color: '#6b7280', marginLeft: '10px' }}>copies</span>
            </div>
            <div className="check-icon">✓</div>
          </div>
        </div>

        <div className="passport-settings">
          <div className="workflow-card settings-card">
            <div className="card-content"><span className="icon">🎚️</span>
              <select value={printDpi} onChange={e => setPrintDpi(parseInt(e.target.value, 10))} className="neon-select">
                <option value={150}>150 DPI · draft, smallest file</option>
                <option value={200}>200 DPI · standard office</option>
                <option value={300}>300 DPI · photo-lab clarity</option>
                <option value={400}>400 DPI · high clarity</option>
                <option value={600}>600 DPI · maximum clarity</option>
              </select>
            </div>
            <div className="check-icon">✓</div>
          </div>
        </div>

        {preview && (
          <div className="preview-card">
            <div className="preview-head"><span>👁️ Live preview</span><span className="preview-meta">{previewMeta}</span></div>
            <div className="preview-stage" style={{ aspectRatio: pwMm + ' / ' + phMm }}
              onTouchStart={e => { touchX.current = e.touches[0].clientX; }}
              onTouchEnd={e => {
                if (touchX.current == null) return;
                const dx = e.changedTouches[0].clientX - touchX.current;
                touchX.current = null;
                if (Math.abs(dx) < 40) return;
                setPreviewIdx(i => Math.max(0, Math.min(previewPages.length - 1, i + (dx < 0 ? 1 : -1))));
              }}>
              <img src={preview} alt="Print preview" style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }} />
            </div>
            {previewTotal > 1 && (
              <div className="sheet-nav">
                <button className="sn-arrow" disabled={previewIdx === 0} onClick={() => setPreviewIdx(i => Math.max(0, i - 1))}>‹</button>
                <div className="sn-dots">
                  {Array.from({ length: previewTotal }, (_, i) => (
                    <button key={i} className={'sn-dot' + (i === previewIdx ? ' on' : '')} onClick={() => setPreviewIdx(i)} aria-label={'Sheet ' + (i + 1)} />
                  ))}
                </div>
                <span className="sn-label">Sheet {previewIdx + 1} / {previewTotal}</span>
                <button className="sn-arrow" disabled={previewIdx >= previewTotal - 1} onClick={() => setPreviewIdx(i => Math.min(previewTotal - 1, i + 1))}>›</button>
              </div>
            )}

            <div className="inline-tools">
              <div className="em-block-title">Rotate</div>
              <div className="adj-row">
                <span className="adj-label">Angle</span>
                <select className="adj-select" value={adj.rot} onChange={e => set('rot', parseInt(e.target.value, 10))}>
                  {[0, 45, 90, 135, 180, 225, 270, 315, 360].map(d => <option key={d} value={d}>{d}°</option>)}
                </select>
              </div>
              <div className="em-block-title" style={{ marginTop: '10px' }}>Fixed anchor</div>
              <div className="em-anchor-grid">
                {Object.keys(ANCHORS).map(k => <button key={k} className={'em-anchor' + (anchor === k ? ' on' : '')} onClick={() => setAnchor(k)} title={k} />)}
              </div>
              {<div className="adj-row">
      <span className="adj-label">Zoom</span>
      <input type="range" min="-80" max="200" step="5" value={Math.round((adj.zoom - 1) * 100)} onChange={e => setAdj(a => ({ ...a, zoom: Math.max(0.2, Math.min(3, 1 + parseFloat(e.target.value) / 100)) }))} />
      <button className="em-step" onClick={() => applyZoom(adj.zoom - 0.05)}>−</button>
      <input type="number" className="adj-num" min="-80" max="200" step="5" value={Math.round((adj.zoom - 1) * 100)} onChange={e => setAdj(a => ({ ...a, zoom: Math.max(0.2, Math.min(3, 1 + (parseFloat(e.target.value) || 0) / 100)) }))} />
      <button className="em-step" onClick={() => applyZoom(adj.zoom + 0.05)}>+</button>
      <span className="adj-unit">% · 0 = original</span>
      <button className="em-step" title="Reset to original" onClick={() => setAdj({ ...DEFAULT_ADJ })}>⟲</button>
    </div>}
              {inlineControl('Move X', 'x', -60, 60, 1, '%')}
              {inlineControl('Move Y', 'y', -60, 60, 1, '%')}
              {inlineControl('Rotate', 'rot', -180, 180, 1, '°')}
              {inlineControl('Bright', 'brightness', 50, 150, 1, '%')}
              {inlineControl('Contrast', 'contrast', 50, 150, 1, '%')}
              <div className="adj-row">
                <span className="adj-label">Fit</span>
                <select className="adj-select" value={adj.fit} onChange={e => set('fit', e.target.value)}><option value="cover">Fill (crop)</option><option value="contain">Fit (no crop)</option></select>
                <button className="adj-reset" onClick={() => setAdj({ ...DEFAULT_ADJ })}>Reset</button>
              </div>
              <button className="open-editor" onClick={() => setEditOpen(true)}>🛠 Open full editor (drag corners / crop)</button>
            </div>
            <div className="preview-note">Every adjustment applies to all pages. Anchor stays fixed while you resize.</div>
          </div>
        )}

        <button className={'print-btn' + (activeImages.length > 0 ? ' active' : '')} onClick={handlePrint} disabled={activeImages.length === 0}>🖨️ Print ({selectedSize})</button>
        <div className="swipe-hint">← Swipe to change section →</div>
      </div></div>

      <EditModal open={editOpen} onClose={() => setEditOpen(false)} adj={adj} setAdj={setAdj} anchor={anchor} setAnchor={setAnchor}
        source={activeImages[0]} preview={preview} aspectW={pwMm} aspectH={phMm} />
    </div>
  );
}
