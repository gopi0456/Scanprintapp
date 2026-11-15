import { useState, useEffect, useRef } from 'react';
import { PRINT_SIZES, renderPdfToImages, cssToMm } from '../utils/imageUtils.js';
import { composePrintPages, printImage, DEFAULT_ADJ } from '../utils/printEngine.js';
import EditModal, { ANCHORS } from './EditModal.jsx';

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

export default function ScanPrintPanel({ isLoading, setIsLoading, loadProgress, setLoadProgress, loadMessage, setLoadMessage }) {
  const [printImages, setPrintImages] = useState([]);
  const [included, setIncluded] = useState([]);
  const [selectedSize, setSelectedSize] = useState('ID Card (CR80)');
  const [sideMode, setSideMode] = useState('single');
  const [passportPaperSize, setPassportPaperSize] = useState('A4');
  const [passportCols, setPassportCols] = useState(4);
  const [passportPerPage, setPassportPerPage] = useState(8);
  const [pagesPerSheet, setPagesPerSheet] = useState(1);
  const [copies, setCopies] = useState(1);
  const [rangeInput, setRangeInput] = useState('');
  const [adj, setAdj] = useState({ ...DEFAULT_ADJ });
  const [anchor, setAnchor] = useState('c');
  const [preview, setPreview] = useState(null);
  const [previewMeta, setPreviewMeta] = useState('');
  const [editOpen, setEditOpen] = useState(false);
  const debounceRef = useRef(null);

  const isFullPageMode = selectedSize === 'A4' || selectedSize === '4x6 Photo';
  const isDoubleA4 = selectedSize === 'A4' && sideMode === 'double';
  const activeImages = printImages.filter((_, i) => included[i]);
  const previewPageKey = selectedSize === 'ID Card (CR80)' ? 'A4' : (selectedSize === 'Passport (2x2)' ? passportPaperSize : selectedSize);
  const pwMm = cssToMm(PRINT_SIZES[previewPageKey].cssWidth);
  const phMm = cssToMm(PRINT_SIZES[previewPageKey].cssHeight);

  const opts = (forPreview) => ({ sizeKey: selectedSize, sideMode, passportPaper: passportPaperSize, passportCols, passportPerPage, pagesPerSheet, copies: forPreview ? 1 : copies, adj });

  useEffect(() => {
    if (activeImages.length === 0) { setPreview(null); return; }
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      try {
        const idx = parseRange(rangeInput, activeImages.length);
        const imgs = idx.map(i => activeImages[i]);
        const limit = selectedSize === 'ID Card (CR80)' ? 2 : Math.max(2, pagesPerSheet);
        const { pages } = await composePrintPages(imgs.slice(0, limit), opts(true));
        setPreview(pages[0] || null);
        setPreviewMeta(selectedSize === 'ID Card (CR80)' ? 'Side-by-side • edits apply to every sheet' : 'First page • edits apply to all ' + imgs.length + ' pages');
      } catch (e) { console.warn('preview', e); }
    }, 140);
    return () => clearTimeout(debounceRef.current);
  }, [printImages, included, selectedSize, sideMode, passportPaperSize, passportCols, passportPerPage, pagesPerSheet, rangeInput, adj]);

  const set = (k, v) => setAdj(a => ({ ...a, [k]: v }));
  const applyZoom = (nz) => setAdj(a => { const z = clamp(nz, 0.2, 4); const [ax, ay] = ANCHORS[anchor]; return { ...a, zoom: r2(z), x: Math.round(clamp(a.x + ax * (a.zoom - z) * 100, -60, 60)), y: Math.round(clamp(a.y + ay * (a.zoom - z) * 100, -60, 60)) }; });
  const addImages = (urls) => { setPrintImages(p => [...p, ...urls]); setIncluded(p => [...p, ...urls.map(() => true)]); };
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

        {printImages.length > 0 && (<>
          <div className="count-bar"><span className="count-chip">📄 {activeImages.length}/{printImages.length} selected</span>
            <button className="clear-btn" onClick={() => { setPrintImages([]); setIncluded([]); setRangeInput(''); setPreview(null); }}>Clear All</button></div>
          <div className="thumb-strip">{printImages.map((img, i) => (
            <button key={i} className={'thumb' + (included[i] ? '' : ' off')} onClick={() => toggle(i)}>
              <img src={img} alt={'p' + (i + 1)} /><span className="thumb-mark">{included[i] ? '✓' : '✕'}</span><span className="thumb-num">{i + 1}</span>
            </button>))}</div>
          <div className="thumb-hint">Tap to include / exclude — remaining pages re-arrange automatically.</div>
        </>)}

        {activeImages.length > 1 && (
          <div className="passport-settings" style={{ marginTop: 0, marginBottom: '14px' }}>
            <div className="workflow-card settings-card"><div className="card-content" style={{ flexDirection: 'column', alignItems: 'stretch', gap: '4px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}><span className="icon">🔖</span>
                <input className="neon-input wide" placeholder="All pages (e.g. 1-3, 5, 7-9)" value={rangeInput} onChange={e => setRangeInput(e.target.value)} /></div>
              <span className="range-hint">Leave empty = all selected</span>
            </div><div className="check-icon">✓</div></div>
          </div>
        )}

        <div className="workflow-cards" style={{ marginBottom: 0 }}>
          <div className="workflow-card settings-card"><div className="card-content"><span className="icon">📄</span>
            <select value={selectedSize} onChange={e => setSelectedSize(e.target.value)} className="neon-select">{Object.keys(PRINT_SIZES).map(s => <option key={s} value={s}>{s}</option>)}</select>
          </div><div className="check-icon">✓</div></div>
        </div>

        {selectedSize === 'A4' && (
          <div className="passport-settings"><div className="workflow-card settings-card"><div className="card-content"><span className="icon">🔄</span>
            <select value={sideMode} onChange={e => setSideMode(e.target.value)} className="neon-select"><option value="single">Single Side</option><option value="double">Double Side (Front + Back)</option></select>
          </div><div className="check-icon">✓</div></div></div>
        )}

        {selectedSize === 'Passport (2x2)' && (
          <div className="passport-settings">
            <div className="workflow-card settings-card"><div className="card-content"><span className="icon">📐</span>
              <select value={passportPaperSize} onChange={e => setPassportPaperSize(e.target.value)} className="neon-select"><option value="A4">A4 Paper</option><option value="4x6 Photo">4x6 Photo</option></select>
            </div><div className="check-icon">✓</div></div>
            <div className="workflow-card settings-card"><div className="card-content"><span className="icon">🔢</span>
              <input type="number" min="1" max="12" value={passportCols} onChange={e => setPassportCols(parseInt(e.target.value) || 1)} className="neon-input" />
              <span style={{ fontSize: '12px', color: '#6b7280', marginLeft: '8px' }}>per line</span>
              <input type="number" min="1" max="60" value={passportPerPage} onChange={e => setPassportPerPage(parseInt(e.target.value) || 1)} className="neon-input" style={{ marginLeft: '12px' }} />
              <span style={{ fontSize: '12px', color: '#6b7280', marginLeft: '8px' }}>per page</span>
            </div><div className="check-icon">✓</div></div>
          </div>
        )}

        {isFullPageMode && (
          <div className="passport-settings"><div className="workflow-card settings-card"><div className="card-content"><span className="icon">🗂️</span>
            <select value={pagesPerSheet} onChange={e => setPagesPerSheet(parseInt(e.target.value, 10))} className="neon-select">
              {isDoubleA4 ? <><option value={2}>2 / sheet</option><option value={4}>4 / sheet</option><option value={6}>6 / sheet</option><option value={8}>8 / sheet</option></>
                : <><option value={1}>1 / sheet</option><option value={2}>2 / sheet</option><option value={4}>4 / sheet</option><option value={6}>6 / sheet</option><option value={8}>8 / sheet</option><option value={9}>9 / sheet</option><option value={16}>16 / sheet</option></>}
            </select>
          </div><div className="check-icon">✓</div></div></div>
        )}

        <div className="passport-settings"><div className="workflow-card settings-card"><div className="card-content"><span className="icon">🔢</span>
          <input type="number" min="1" max="500" value={copies} onChange={e => setCopies(parseInt(e.target.value) || 1)} className="neon-input" />
          <span style={{ fontSize: '12px', color: '#6b7280', marginLeft: '10px' }}>copies</span>
        </div><div className="check-icon">✓</div></div></div>

        {preview && (
          <div className="preview-card">
            <div className="preview-head"><span>👁️ Live preview</span><span className="preview-meta">{previewMeta}</span></div>
            <div className="preview-stage" style={{ aspectRatio: pwMm + ' / ' + phMm }}><img src={preview} alt="Print preview" /></div>

            <div className="inline-tools">
              <div className="em-block-title">Rotate</div>
              <div className="em-chips">
                {[0, 45, 90, 135, 180].map(d => <button key={d} className={'em-chip' + (adj.rot === d ? ' on' : '')} onClick={() => set('rot', d)}>{d}°</button>)}
              </div>
              <div className="em-block-title" style={{ marginTop: '10px' }}>Fixed anchor</div>
              <div className="em-anchor-grid">
                {Object.keys(ANCHORS).map(k => <button key={k} className={'em-anchor' + (anchor === k ? ' on' : '')} onClick={() => setAnchor(k)} title={k} />)}
              </div>
              {inlineControl('Zoom', 'zoom', 0.2, 4, 0.05, '×', true)}
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
