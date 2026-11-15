import { useState, useEffect, useRef } from 'react';
import { PRINT_SIZES, renderPdfToImages, cssToMm, loadImage } from '../utils/imageUtils.js';
import { composePrintPages, printImage, DEFAULT_ADJ } from '../utils/printEngine.js';

function parseRange(str, max) {
  if (!str || !str.trim()) return Array.from({ length: max }, (_, i) => i);
  const set = new Set();
  str.split(',').forEach((part) => {
    const t = part.trim(); if (!t) return;
    if (t.includes('-')) {
      const [a, b] = t.split('-').map(x => parseInt(x.trim(), 10));
      if (!isNaN(a) && !isNaN(b)) { const s = Math.min(a, b), e = Math.max(a, b); for (let i = s; i <= e; i++) if (i >= 1 && i <= max) set.add(i - 1); }
    } else { const n = parseInt(t, 10); if (!isNaN(n) && n >= 1 && n <= max) set.add(n - 1); }
  });
  return [...set].sort((a, b) => a - b);
}
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const r2 = (v) => Math.round(v * 100) / 100;

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
  const [preview, setPreview] = useState(null);
  const [previewMeta, setPreviewMeta] = useState('');
  const [editMode, setEditMode] = useState(null); // null | 'crop' | 'size'
  const [srcDims, setSrcDims] = useState({ w: 1, h: 1 });
  const debounceRef = useRef(null);
  const cropBoxRef = useRef(null);
  const cropDragRef = useRef(null);
  const sizeBoxRef = useRef(null);
  const sizeDragRef = useRef(null);

  const isFullPageMode = selectedSize === 'A4' || selectedSize === '4x6 Photo';
  const isDoubleA4 = selectedSize === 'A4' && sideMode === 'double';
  const activeImages = printImages.filter((_, i) => included[i]);

  const previewPageKey = selectedSize === 'ID Card (CR80)' ? 'A4' : (selectedSize === 'Passport (2x2)' ? passportPaperSize : selectedSize);
  const pwMm = cssToMm(PRINT_SIZES[previewPageKey].cssWidth);
  const phMm = cssToMm(PRINT_SIZES[previewPageKey].cssHeight);

  const opts = (forPreview) => ({
    sizeKey: selectedSize, sideMode, passportPaper: passportPaperSize,
    passportCols, passportPerPage, pagesPerSheet, copies: forPreview ? 1 : copies, adj
  });

  useEffect(() => {
    if (!editMode || !activeImages[0]) return;
    loadImage(activeImages[0]).then(im => setSrcDims({ w: im.width, h: im.height })).catch(() => {});
  }, [editMode, activeImages]);

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
  const addImages = (urls) => { setPrintImages(p => [...p, ...urls]); setIncluded(p => [...p, ...urls.map(() => true)]); };
  const toggle = (i) => setIncluded(p => p.map((v, k) => k === i ? !v : v));

  const takePhoto = async () => {
    try {
      const { Camera, CameraResultType } = await import('@capacitor/camera');
      const image = await Camera.getPhoto({ quality: 100, allowEditing: false, resultType: CameraResultType.DataUrl });
      addImages([image.dataUrl]);
    } catch (e) { alert('Camera requires a physical device.'); }
  };
  const uploadFile = async (event) => {
    const file = event.target.files?.[0]; if (!file) return;
    setIsLoading(true); setLoadProgress(0); setLoadMessage('Processing file...');
    try {
      if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
        const urls = await renderPdfToImages(file, p => setLoadProgress(p));
        if (urls.length) addImages(urls); else alert('Empty or corrupted PDF');
      } else if (file.type.startsWith('image/')) {
        const r = new FileReader();
        r.onloadend = () => { setLoadProgress(100); addImages([r.result]); };
        r.readAsDataURL(file);
      } else alert('Unsupported file');
    } catch (err) { alert('Failed: ' + err.message); }
    finally { setIsLoading(false); setLoadProgress(0); setLoadMessage(''); }
    event.target.value = null;
  };
  const scanDocument = async () => {
    try {
      const { DocumentScanner } = await import('@capgo/capacitor-document-scanner');
      const r = await DocumentScanner.scanDocument({ responseType: 'base64' });
      if (r.scannedImages?.length) addImages([`data:image/jpeg;base64,${r.scannedImages[0]}`]);
    } catch (e) { alert('Scanning requires a mobile device.'); }
  };

  const handlePrint = async () => {
    if (activeImages.length === 0) return alert('Select at least one photo.');
    const idx = parseRange(rangeInput, activeImages.length);
    if (idx.length === 0) return alert('Invalid page range.');
    setIsLoading(true); setLoadProgress(0); setLoadMessage('Composing pages...');
    try {
      const imgs = idx.map(i => activeImages[i]);
      const { pages, cssW, cssH } = await composePrintPages(imgs, opts(false));
      setLoadProgress(80); setLoadMessage('Opening printer...');
      await printImage(pages, cssW, cssH);
      setLoadProgress(100);
    } catch (e) { alert('Print failed: ' + e.message); }
    finally { setIsLoading(false); setLoadProgress(0); setLoadMessage(''); }
  };

  // ---- CROP: move + resize crop window ----
  const cropDown = (e) => {
    const box = cropBoxRef.current?.getBoundingClientRect(); if (!box) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    cropDragRef.current = { handle: e.target.dataset.handle || 'move', sx: e.clientX, sy: e.clientY, box, start: { ...adj.crop } };
  };
  const cropMove = (e) => {
    const d = cropDragRef.current; if (!d) return;
    const dx = (e.clientX - d.sx) / d.box.width, dy = (e.clientY - d.sy) / d.box.height;
    const s = d.start; let { x, y, w, h } = s; const MIN = 0.05;
    if (d.handle === 'move') { x = clamp(s.x + dx, 0, 1 - s.w); y = clamp(s.y + dy, 0, 1 - s.h); }
    if (d.handle === 'se') { w = clamp(s.w + dx, MIN, 1 - s.x); h = clamp(s.h + dy, MIN, 1 - s.y); }
    if (d.handle === 'ne') { w = clamp(s.w + dx, MIN, 1 - s.x); const ny = clamp(s.y + dy, 0, s.y + s.h - MIN); h = s.h + (s.y - ny); y = ny; }
    if (d.handle === 'sw') { const nx = clamp(s.x + dx, 0, s.x + s.w - MIN); w = s.w + (s.x - nx); x = nx; h = clamp(s.h + dy, MIN, 1 - s.y); }
    if (d.handle === 'nw') { const nx = clamp(s.x + dx, 0, s.x + s.w - MIN); w = s.w + (s.x - nx); x = nx; const ny = clamp(s.y + dy, 0, s.y + s.h - MIN); h = s.h + (s.y - ny); y = ny; }
    set('crop', { x: r2(x), y: r2(y), w: r2(w), h: r2(h) });
  };
  const cropUp = () => { cropDragRef.current = null; };

  // ---- SIZE: corner drag = enlarge/shrink (zoom), inside drag = pan ----
  const sizeDown = (e) => {
    const box = sizeBoxRef.current?.getBoundingClientRect(); if (!box) return;
    const cx = box.left + box.width / 2, cy = box.top + box.height / 2;
    e.currentTarget.setPointerCapture(e.pointerId);
    sizeDragRef.current = {
      handle: e.target.dataset.handle || 'pan', cx, cy,
      startDist: Math.hypot(e.clientX - cx, e.clientY - cy) || 1,
      startZoom: adj.zoom, sx: e.clientX, sy: e.clientY, startX: adj.x, startY: adj.y, box
    };
  };
  const sizeMove = (e) => {
    const d = sizeDragRef.current; if (!d) return;
    if (d.handle !== 'pan') {
      const dist = Math.hypot(e.clientX - d.cx, e.clientY - d.cy) || 1;
      set('zoom', r2(clamp(d.startZoom * (dist / d.startDist), 0.2, 4)));
    } else {
      const dx = ((e.clientX - d.sx) / d.box.width) * 100;
      const dy = ((e.clientY - d.sy) / d.box.height) * 100;
      setAdj(a => ({ ...a, x: Math.round(clamp(d.startX + dx, -50, 50)), y: Math.round(clamp(d.startY + dy, -50, 50)) }));
    }
  };
  const sizeUp = () => { sizeDragRef.current = null; };

  // slider + numeric stepper (arrows) together
  const control = (label, key, min, max, step, unit) => (
    <div className="adj-row">
      <span className="adj-label">{label}</span>
      <input type="range" min={min} max={max} step={step} value={adj[key]} onChange={(e) => set(key, parseFloat(e.target.value))} />
      <input type="number" className="adj-num" min={min} max={max} step={step} value={adj[key]}
        onChange={(e) => set(key, clamp(parseFloat(e.target.value) || 0, min, max))} />
      <span className="adj-unit">{unit}</span>
    </div>
  );

  const cr = adj.crop;

  return (
    <div className="panel">
      {isLoading && (
        <div className="loading-overlay">
          <div className="progress-card">
            <div className="progress-ball">😊</div>
            <div className="progress-bar-container"><div className="progress-bar" style={{ width: loadProgress + '%' }}></div></div>
            <div className="progress-text">{loadMessage || 'Loading...'}</div>
            <div className="progress-percent">{loadProgress}%</div>
          </div>
        </div>
      )}
      <div className="glass-frame">
        <div className="logo-chip">🖨️</div>
        <div className="main-card">
          <div className="header"><h2>Scan & Print</h2></div>

          <div className="workflow-cards">
            <div className="workflow-card" onClick={takePhoto}><div className="card-content"><span className="icon">📷</span><span className="label">Take Photo</span></div><div className="check-icon">✓</div></div>
            <div className="workflow-card" onClick={scanDocument}><div className="card-content"><span className="icon">✨</span><span className="label">Scan Document</span></div><div className="check-icon">✓</div></div>
            <label className="workflow-card"><div className="card-content"><span className="icon">📁</span><span className="label">Upload Photo or PDF</span></div><div className="check-icon">✓</div><input type="file" accept="image/*,.pdf,application/pdf" style={{ display: 'none' }} onChange={uploadFile} /></label>
          </div>

          {printImages.length > 0 && (
            <>
              <div className="count-bar">
                <span className="count-chip">📄 {activeImages.length}/{printImages.length} selected</span>
                <button className="clear-btn" onClick={() => { setPrintImages([]); setIncluded([]); setRangeInput(''); setPreview(null); }}>Clear All</button>
              </div>
              <div className="thumb-strip">
                {printImages.map((img, i) => (
                  <button key={i} className={'thumb' + (included[i] ? '' : ' off')} onClick={() => toggle(i)}>
                    <img src={img} alt={'page ' + (i + 1)} />
                    <span className="thumb-mark">{included[i] ? '✓' : '✕'}</span>
                    <span className="thumb-num">{i + 1}</span>
                  </button>
                ))}
              </div>
              <div className="thumb-hint">Tap a photo to include / exclude — the rest re-arrange automatically.</div>
            </>
          )}

          {activeImages.length > 1 && (
            <div className="passport-settings" style={{ marginTop: 0, marginBottom: '14px' }}>
              <div className="workflow-card settings-card">
                <div className="card-content" style={{ flexDirection: 'column', alignItems: 'stretch', gap: '4px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <span className="icon">🔖</span>
                    <input className="neon-input wide" placeholder="All pages (e.g. 1-3, 5, 7-9)" value={rangeInput} onChange={(e) => setRangeInput(e.target.value)} />
                  </div>
                  <span className="range-hint">Leave empty = all selected</span>
                </div>
                <div className="check-icon">✓</div>
              </div>
            </div>
          )}

          <div className="workflow-cards" style={{ marginBottom: 0 }}>
            <div className="workflow-card settings-card">
              <div className="card-content"><span className="icon">📄</span>
                <select value={selectedSize} onChange={(e) => setSelectedSize(e.target.value)} className="neon-select">
                  {Object.keys(PRINT_SIZES).map(s => (<option key={s} value={s}>{s}</option>))}
                </select>
              </div><div className="check-icon">✓</div>
            </div>
          </div>

          {selectedSize === 'A4' && (
            <div className="passport-settings">
              <div className="workflow-card settings-card">
                <div className="card-content"><span className="icon">🔄</span>
                  <select value={sideMode} onChange={(e) => setSideMode(e.target.value)} className="neon-select">
                    <option value="single">Single Side</option><option value="double">Double Side (Front + Back)</option>
                  </select>
                </div><div className="check-icon">✓</div>
              </div>
            </div>
          )}

          {selectedSize === 'Passport (2x2)' && (
            <div className="passport-settings">
              <div className="workflow-card settings-card">
                <div className="card-content"><span className="icon">📐</span>
                  <select value={passportPaperSize} onChange={(e) => setPassportPaperSize(e.target.value)} className="neon-select">
                    <option value="A4">A4 Paper</option><option value="4x6 Photo">4x6 Photo</option>
                  </select>
                </div><div className="check-icon">✓</div>
              </div>
              <div className="workflow-card settings-card">
                <div className="card-content"><span className="icon">🔢</span>
                  <input type="number" min="1" max="12" value={passportCols} onChange={(e) => setPassportCols(parseInt(e.target.value) || 1)} className="neon-input" />
                  <span style={{ fontSize: '12px', color: '#6b7280', marginLeft: '8px' }}>per line</span>
                  <input type="number" min="1" max="60" value={passportPerPage} onChange={(e) => setPassportPerPage(parseInt(e.target.value) || 1)} className="neon-input" style={{ marginLeft: '12px' }} />
                  <span style={{ fontSize: '12px', color: '#6b7280', marginLeft: '8px' }}>per page</span>
                </div><div className="check-icon">✓</div>
              </div>
            </div>
          )}

          {isFullPageMode && (
            <div className="passport-settings">
              <div className="workflow-card settings-card">
                <div className="card-content"><span className="icon">🗂️</span>
                  <select value={pagesPerSheet} onChange={(e) => setPagesPerSheet(parseInt(e.target.value, 10))} className="neon-select">
                    {isDoubleA4 ? (<><option value={2}>2 / sheet</option><option value={4}>4 / sheet</option><option value={6}>6 / sheet</option><option value={8}>8 / sheet</option></>)
                      : (<><option value={1}>1 / sheet</option><option value={2}>2 / sheet</option><option value={4}>4 / sheet</option><option value={6}>6 / sheet</option><option value={8}>8 / sheet</option><option value={9}>9 / sheet</option><option value={16}>16 / sheet</option></>)}
                  </select>
                </div><div className="check-icon">✓</div>
              </div>
            </div>
          )}

          <div className="passport-settings">
            <div className="workflow-card settings-card">
              <div className="card-content"><span className="icon">🔢</span>
                <input type="number" min="1" max="500" value={copies} onChange={(e) => setCopies(parseInt(e.target.value) || 1)} className="neon-input" />
                <span style={{ fontSize: '12px', color: '#6b7280', marginLeft: '10px' }}>copies</span>
              </div><div className="check-icon">✓</div>
            </div>
          </div>

          {preview && (
            <div className="preview-card">
              <div className="preview-head">
                <span>👁️ {editMode === 'crop' ? 'Crop window' : editMode === 'size' ? 'Size / enlarge' : 'Live preview'}</span>
                <span className="preview-meta">{previewMeta}</span>
              </div>

              <div className="preview-stage" style={{ aspectRatio: editMode ? (srcDims.w + ' / ' + srcDims.h) : (pwMm + ' / ' + phMm) }}>
                {editMode === 'crop' ? (
                  <div className="crop-box" ref={cropBoxRef} onPointerDown={cropDown} onPointerMove={cropMove} onPointerUp={cropUp}>
                    <img src={activeImages[0]} alt="crop source" />
                    <div className="crop-rect" data-handle="move" style={{ left: cr.x * 100 + '%', top: cr.y * 100 + '%', width: cr.w * 100 + '%', height: cr.h * 100 + '%' }}>
                      <span className="crop-handle nw" data-handle="nw"></span>
                      <span className="crop-handle ne" data-handle="ne"></span>
                      <span className="crop-handle sw" data-handle="sw"></span>
                      <span className="crop-handle se" data-handle="se"></span>
                    </div>
                  </div>
                ) : editMode === 'size' ? (
                  <div className="size-box" ref={sizeBoxRef} onPointerDown={sizeDown} onPointerMove={sizeMove} onPointerUp={sizeUp}>
                    <img src={activeImages[0]} alt="size source" style={{ transform: `translate(${adj.x}%, ${adj.y}%) scale(${adj.zoom}) rotate(${adj.rot}deg)`, filter: `brightness(${adj.brightness}%) contrast(${adj.contrast}%)` }} />
                    <span className="size-handle nw" data-handle="nw"></span>
                    <span className="size-handle ne" data-handle="ne"></span>
                    <span className="size-handle sw" data-handle="sw"></span>
                    <span className="size-handle se" data-handle="se"></span>
                    <div className="size-hint">drag a corner to enlarge / shrink • drag inside to move</div>
                  </div>
                ) : (
                  <img src={preview} alt="Print preview" />
                )}
              </div>

              <div className="crop-toolbar">
                <button className={'crop-toggle' + (editMode === 'size' ? ' on' : '')} onClick={() => setEditMode(m => m === 'size' ? null : 'size')}>↔️ Size</button>
                <button className={'crop-toggle' + (editMode === 'crop' ? ' on' : '')} onClick={() => setEditMode(m => m === 'crop' ? null : 'crop')}>✂️ Crop</button>
                <button className="adj-reset" onClick={() => { set('crop', { x: 0, y: 0, w: 1, h: 1 }); set('zoom', 1); set('x', 0); set('y', 0); }}>Reset</button>
              </div>

              <div className="adj-grid">
                {control('Zoom', 'zoom', 0.2, 4, 0.05, '×')}
                {control('Move X', 'x', -50, 50, 1, '%')}
                {control('Move Y', 'y', -50, 50, 1, '%')}
                {control('Rotate', 'rot', -180, 180, 1, '°')}
                {control('Bright', 'brightness', 50, 150, 1, '%')}
                {control('Contrast', 'contrast', 50, 150, 1, '%')}
                <div className="adj-row">
                  <span className="adj-label">Fit</span>
                  <select className="adj-select" value={adj.fit} onChange={(e) => set('fit', e.target.value)}>
                    <option value="cover">Fill (crop)</option><option value="contain">Fit (no crop)</option>
                  </select>
                  <button className="adj-reset" onClick={() => setAdj({ ...DEFAULT_ADJ })}>Reset all</button>
                </div>
              </div>
              <div className="preview-note">Size / crop once — applied to every photo, cell and page. Use arrows or the bar for exact values.</div>
            </div>
          )}

          <button className={'print-btn' + (activeImages.length > 0 ? ' active' : '')} onClick={handlePrint} disabled={activeImages.length === 0}>
            🖨️ Print ({selectedSize})
          </button>
          <div className="swipe-hint">← Swipe to change section →</div>
        </div>
      </div>
    </div>
  );
}
