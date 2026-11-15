import { useState, useEffect, useRef } from 'react';
import { renderPdfToImages } from '../utils/imageUtils.js';
import {
  MODES, analyzePdfPages, renderPageCanvas, compressRasterPage, computeBudgets, pageImage,
  compressPdfWithMode, compressImageToTarget, readableMinimum, convertToJpg, convertToPng, dataUrlToBlob, shareBlob, dataUrlKB
} from '../utils/compressEngine.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/* Reliable two-finger pinch + one-finger pan + wheel + double-tap + buttons */
function ZoomViewer({ src }) {
  const boxRef = useRef(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const zRef = useRef(1), panRef = useRef({ x: 0, y: 0 });
  const pts = useRef(new Map()), gest = useRef(null), lastTap = useRef(0);
  const setZ = z => { zRef.current = z; setZoom(z); };
  const setP = p => { panRef.current = p; setPan(p); };
  const clampPan = (z, p) => { const b = boxRef.current; if (!b) return p; const mx = (z - 1) * b.clientWidth / 2, my = (z - 1) * b.clientHeight / 2; return { x: clamp(p.x, -mx, mx), y: clamp(p.y, -my, my) }; };
  const zoomAt = (nz, cx, cy) => {
    const b = boxRef.current; if (!b) return; const r = b.getBoundingClientRect();
    const px = (cx ?? (r.left + r.width / 2)) - r.left - r.width / 2;
    const py = (cy ?? (r.top + r.height / 2)) - r.top - r.height / 2;
    const z = clamp(nz, 1, 8), k = z / zRef.current;
    const np = clampPan(z, { x: px - k * (px - panRef.current.x), y: py - k * (py - panRef.current.y) });
    setZ(z); setP(z <= 1 ? { x: 0, y: 0 } : np);
  };
  const down = e => {
    e.preventDefault(); boxRef.current.setPointerCapture(e.pointerId);
    pts.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.current.size === 1) {
      const now = Date.now(); if (now - lastTap.current < 300) zoomAt(zRef.current > 1 ? 1 : 3, e.clientX, e.clientY); lastTap.current = now;
      gest.current = { t: 'pan', sx: e.clientX, sy: e.clientY, px: panRef.current.x, py: panRef.current.y };
    } else if (pts.current.size === 2) {
      const [a, b] = [...pts.current.values()];
      gest.current = { t: 'pinch', d: Math.hypot(a.x - b.x, a.y - b.y) || 1, z: zRef.current, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, px: panRef.current.x, py: panRef.current.y };
    }
  };
  const move = e => {
    if (!pts.current.has(e.pointerId)) return;
    pts.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = gest.current; if (!g) return;
    if (g.t === 'pinch' && pts.current.size >= 2) {
      const [a, b] = [...pts.current.values()]; const d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      const nz = clamp(g.z * d / g.d, 1, 8); const r = boxRef.current.getBoundingClientRect();
      const cx = g.cx - r.left - r.width / 2, cy = g.cy - r.top - r.height / 2, k = nz / g.z;
      setZ(nz); setP(clampPan(nz, { x: cx - k * (cx - g.px), y: cy - k * (cy - g.py) }));
    } else if (g.t === 'pan' && pts.current.size === 1 && zRef.current > 1) {
      setP(clampPan(zRef.current, { x: g.px + (e.clientX - g.sx), y: g.py + (e.clientY - g.sy) }));
    }
  };
  const up = e => {
    pts.current.delete(e.pointerId);
    if (pts.current.size === 1) { const [a] = [...pts.current.values()]; gest.current = { t: 'pan', sx: a.x, sy: a.y, px: panRef.current.x, py: panRef.current.y }; }
    else if (pts.current.size === 0) { gest.current = null; if (zRef.current <= 1.02) { setZ(1); setP({ x: 0, y: 0 }); } }
  };
  const wheel = e => { e.preventDefault(); zoomAt(zRef.current + (e.deltaY < 0 ? 0.4 : -0.4), e.clientX, e.clientY); };
  return (
    <div className="pv-wrap">
      <div className="pv-box" ref={boxRef} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onWheel={wheel}>
        <img src={src} alt="preview" draggable={false} style={{ transform: `translate(${pan.x}px,${pan.y}px) scale(${zoom})` }} />
        <div className="pv-hint">{zoom > 1 ? 'one finger pan • pinch zoom' : 'pinch • double-tap • wheel to zoom'}</div>
      </div>
      <div className="pv-bar">
        <button className="em-step" onClick={() => zoomAt(zRef.current - 0.5)}>−</button>
        <input type="range" min="1" max="8" step="0.1" value={zoom} onChange={e => zoomAt(parseFloat(e.target.value))} />
        <button className="em-step" onClick={() => zoomAt(zRef.current + 0.5)}>+</button>
        <button className="em-step" onClick={() => { setZ(1); setP({ x: 0, y: 0 }); }}>1×</button>
        <span className="adj-val">{zoom.toFixed(1)}×</span>
      </div>
    </div>
  );
}

export default function CompressSavePanel({ setIsLoading, setLoadProgress, setLoadMessage }) {
  const [images, setImages] = useState([]);
  const [entries, setEntries] = useState([]);   // {bytes,pageIdx,w,h,dataUrl}
  const [included, setIncluded] = useState([]);
  const [origKB, setOrigKB] = useState(0);
  const [format, setFormat] = useState('pdf');
  const [mode, setMode] = useState('hc_hq');
  const [gray, setGray] = useState(false);
  const [sizeInput, setSizeInput] = useState('');
  const [unit, setUnit] = useState('KB');
  const [previewUrl, setPreviewUrl] = useState(null);
  const [lastSize, setLastSize] = useState(null);
  const [dragIdx, setDragIdx] = useState(null);
  const [scrollPos, setScrollPos] = useState(0);
  const [scrollMax, setScrollMax] = useState(0);
  const stripRef = useRef(null);
  const drag = useRef({ idx: null, active: false, sx: 0, lx: 0, raf: null, suppress: false });

  const activeIdx = included.reduce((a, v, i) => (v ? [...a, i] : a), []);
  const targetKB = () => { const v = parseFloat(sizeInput); if (!v || v <= 0) return 0; return unit === 'MB' ? Math.round(v * 1024) : Math.round(v); };

  useEffect(() => () => { if (drag.current.raf) cancelAnimationFrame(drag.current.raf); }, []);
  const syncScroll = () => { const s = stripRef.current; if (!s) return; setScrollPos(s.scrollLeft); setScrollMax(Math.max(0, s.scrollWidth - s.clientWidth)); };
  useEffect(() => { syncScroll(); }, [images, previewUrl]);

  const addBatch = (urls, ents, addedKB) => {
    setImages(p => [...p, ...urls]);
    setEntries(p => [...p, ...ents]);
    setIncluded(p => [...p, ...urls.map(() => true)]);
    setOrigKB(k => k + addedKB);
  };
  const uploadFiles = async (e) => {
    const files = Array.from(e.target.files || []); if (!files.length) return;
    setIsLoading(true); setLoadProgress(0);
    try {
      for (let f = 0; f < files.length; f++) {
        const file = files[f]; setLoadMessage(`Reading ${f + 1}/${files.length}: ${file.name}`);
        if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
          const buf = await file.arrayBuffer();
          const urls = await renderPdfToImages(file, p => setLoadProgress(Math.round(((f + p / 100) / files.length) * 100)));
          const dims = await analyzePdfPages(buf);
          addBatch(urls, urls.map((u, i) => ({ bytes: buf, pageIdx: dims[i].pageIdx, w: dims[i].w, h: dims[i].h, dataUrl: u })), Math.round(buf.byteLength / 1024));
        } else if (file.type.startsWith('image/')) {
          const url = await new Promise(res => { const r = new FileReader(); r.onloadend = () => res(r.result); r.readAsDataURL(file); });
          addBatch([url], [{ bytes: null, pageIdx: null, w: null, h: null, dataUrl: url }], dataUrlKB(url));
        }
      }
    } catch (err) { alert('Failed: ' + err.message); }
    finally { setIsLoading(false); setLoadProgress(0); setLoadMessage(''); }
    e.target.value = null;
  };
  const takePhoto = async () => { try { const { Camera, CameraResultType } = await import('@capacitor/camera'); const im = await Camera.getPhoto({ quality: 100, allowEditing: false, resultType: CameraResultType.DataUrl }); addBatch([im.dataUrl], [{ bytes: null, pageIdx: null, w: null, h: null, dataUrl: im.dataUrl }], dataUrlKB(im.dataUrl)); } catch (e) { alert('Camera requires a physical device.'); } };
  const scanDocument = async () => { try { const { DocumentScanner } = await import('@capgo/capacitor-document-scanner'); const r = await DocumentScanner.scanDocument({ responseType: 'base64' }); if (r.scannedImages?.length) { const u = `data:image/jpeg;base64,${r.scannedImages[0]}`; addBatch([u], [{ bytes: null, pageIdx: null, w: null, h: null, dataUrl: u }], dataUrlKB(u)); } } catch (e) { alert('Scanning requires a mobile device.'); } };

  const reorder = (from, to) => {
    const mv = a => { const n = [...a]; const [m] = n.splice(from, 1); n.splice(to, 0, m); return n; };
    setImages(mv); setEntries(mv); setIncluded(mv);
  };
  const overAt = x => { const d = drag.current, s = stripRef.current; if (!s || d.idx == null) return; const r = s.getBoundingClientRect(); const t = clamp(Math.floor((x - r.left + s.scrollLeft) / 72), 0, images.length - 1); if (t !== d.idx) { reorder(d.idx, t); d.idx = t; } };
  const startAuto = () => { const step = () => { const d = drag.current, s = stripRef.current; if (s && d.active) { const r = s.getBoundingClientRect(); if (d.lx < r.left + 64) s.scrollLeft -= 18; else if (d.lx > r.right - 64) s.scrollLeft += 18; overAt(d.lx); } d.raf = requestAnimationFrame(step); }; drag.current.raf = requestAnimationFrame(step); };
  const stopAuto = () => { if (drag.current.raf) cancelAnimationFrame(drag.current.raf); drag.current.raf = null; };
  const onDown = i => e => { const d = drag.current; d.idx = i; d.active = false; d.sx = e.clientX; d.lx = e.clientX; d.suppress = false; stripRef.current?.setPointerCapture?.(e.pointerId); setDragIdx(i); };
  const onMove = e => { const d = drag.current; if (d.idx == null) return; d.lx = e.clientX; if (!d.active && Math.abs(e.clientX - d.sx) > 10) { d.active = true; startAuto(); } if (d.active) overAt(e.clientX); };
  const onUp = () => { const d = drag.current; if (d.active) { d.suppress = true; stopAuto(); } d.idx = null; d.active = false; setDragIdx(null); };
  const onClick = i => () => { const d = drag.current; if (d.suppress) { d.suppress = false; return; } setIncluded(p => p.map((v, k) => k === i ? !v : v)); };

  /* PREVIEW uses the exact same budget + compressor as SAVE */
  const handlePreview = async () => {
    if (!activeIdx.length) return alert('Select at least one page.');
    setIsLoading(true); setLoadProgress(0); setLoadMessage('Rendering preview (same as save)...');
    try {
      const first = activeIdx[0];
      const budgets = computeBudgets(activeIdx.length, targetKB(), origKB);
      const img = await pageImage(entries[first]);
      const r = compressRasterPage(img, budgets[0], mode, gray);
      setPreviewUrl(r.url); setLoadProgress(100);
    } catch (e) { alert('Preview failed: ' + e.message); }
    finally { setIsLoading(false); setLoadProgress(0); setLoadMessage(''); }
  };

  const handleSave = async () => {
    if (!activeIdx.length) return alert('Select at least one page.');
    setIsLoading(true); setLoadProgress(0); setLoadMessage('Compressing (' + MODES[mode].label + ')...');
    try {
      let total = 0;
      if (format === 'pdf') {
        const ents = activeIdx.map(i => entries[i]);
        const { blob } = await compressPdfWithMode(ents, targetKB(), origKB, mode, gray, p => setLoadProgress(p));
        total = blob.size; await shareBlob(blob, `compressed-${Date.now()}.pdf`);
      } else {
        const mime = format === 'png' ? 'image/png' : 'image/jpeg';
        for (let k = 0; k < activeIdx.length; k++) {
          const i = activeIdx[k]; setLoadMessage(`Compressing ${k + 1}/${activeIdx.length}...`);
          const url = await compressImageToTarget(entries[i].dataUrl, targetKB(), mime, mode, gray, p => setLoadProgress(Math.round(((k + p / 100) / activeIdx.length) * 100)));
          const b = await dataUrlToBlob(url, `compressed-${k + 1}.${mime === 'image/png' ? 'png' : 'jpg'}`);
          total += b.size; await shareBlob(b, b.name);
        }
      }
      const savedKB = Math.round(total / 1024); setLastSize(savedKB);
      alert(`Saved ${savedKB} KB (original ${origKB} KB, target ${targetKB() || '—'} KB) • ${MODES[mode].label}`);
      try { await handlePreview(); } catch (e) {}
    } catch (e) { alert('Save failed: ' + e.message); }
    finally { setIsLoading(false); setLoadProgress(0); setLoadMessage(''); }
  };

  return (
    <div className="panel">
      <div className="glass-frame"><div className="logo-chip">💾</div><div className="main-card">
        <div className="header"><h2>Compress & Save</h2></div>
        <div className="workflow-cards">
          <div className="workflow-card" onClick={takePhoto}><div className="card-content"><span className="icon">📷</span><span className="label">Take Photo</span></div><div className="check-icon">✓</div></div>
          <div className="workflow-card" onClick={scanDocument}><div className="card-content"><span className="icon">✨</span><span className="label">Scan Document</span></div><div className="check-icon">✓</div></div>
          <label className="workflow-card"><div className="card-content"><span className="icon">📁</span><span className="label">Upload Photos / PDFs</span></div><div className="check-icon">✓</div>
            <input type="file" accept="image/*,.pdf,application/pdf" multiple style={{ display: 'none' }} onChange={uploadFiles} /></label>
        </div>

        {images.length > 0 && (<>
          <div className="count-bar"><span className="count-chip">📄 {activeIdx.length}/{images.length} • original ≈ {origKB} KB</span>
            <button className="clear-btn" onClick={() => { setImages([]); setEntries([]); setIncluded([]); setOrigKB(0); setPreviewUrl(null); setLastSize(null); }}>Clear All</button></div>
          <div className="thumb-strip" ref={stripRef} onScroll={syncScroll} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
            {images.map((img, i) => (
              <button key={i} className={'thumb' + (included[i] ? '' : ' off') + (dragIdx === i ? ' dragging' : '')} onPointerDown={onDown(i)} onClick={onClick(i)}>
                <img src={img} alt={'p' + (i + 1)} draggable={false} /><span className="thumb-mark">{included[i] ? '✓' : '✕'}</span><span className="thumb-num">{i + 1}</span>
              </button>))}
          </div>
          {scrollMax > 0 && <div className="strip-scroll-wrap"><input type="range" className="strip-scroll" min={0} max={scrollMax} value={scrollPos} onChange={e => { const v = parseInt(e.target.value, 10) || 0; if (stripRef.current) stripRef.current.scrollLeft = v; setScrollPos(v); }} /></div>}
          <div className="thumb-hint">Tap = include/exclude • drag = reorder • slider = scroll.</div>
          {activeIdx.length > 0 && (
            <div className="target-meta" style={{ marginTop: 6 }}>
              <span>Readable minimum for {activeIdx.length} pages ≈ <b>{readableMinimum(activeIdx.length, origKB)} KB</b></span>
              <button className="auto-btn" onClick={() => { setUnit('KB'); setSizeInput(String(readableMinimum(activeIdx.length, origKB))); }}>Use it</button>
            </div>
          )}
        </>)}

        <div className="mode-grid">
          {Object.entries(MODES).map(([key, m]) => (
            <button key={key} className={'mode-card' + (mode === key ? ' on' : '')} onClick={() => setMode(key)}>
              <span className="mode-ico">{key === 'hc_hq' ? '⚖️' : key === 'hc_lq' ? '🗜️' : '💎'}</span>
              <span className="mode-label">{m.label}</span>
            </button>
          ))}
        </div>

        <div className="passport-settings" style={{ marginTop: 12 }}>
          <div className="workflow-card settings-card"><div className="card-content"><span className="icon">💾</span>
            <select value={format} onChange={e => setFormat(e.target.value)} className="neon-select"><option value="pdf">PDF</option><option value="jpg">JPG / JPEG</option><option value="png">PNG</option></select>
          </div><div className="check-icon">✓</div></div>
          <div className="workflow-card settings-card"><div className="card-content" style={{ gap: 8 }}>
            <span className="icon">🎯</span>
            <input type="number" min="1" placeholder="Expected size" value={sizeInput} onChange={e => setSizeInput(e.target.value)} className="target-input" />
            <select value={unit} onChange={e => setUnit(e.target.value)} className="target-unit"><option>KB</option><option>MB</option></select>
          </div><div className="check-icon">✓</div></div>
          <label className="workflow-card settings-card"><div className="card-content"><span className="icon">⬛</span><span className="label">Grayscale</span></div>
            <input type="checkbox" checked={gray} onChange={e => setGray(e.target.checked)} style={{ width: 22, height: 22 }} /></label>
        </div>

        {previewUrl && (
          <div className="preview-card" style={{ marginTop: 12 }}>
            <div className="preview-head"><span>👁️ Preview = saved result</span><button className="clear-btn" onClick={() => setPreviewUrl(null)}>Close</button></div>
            <ZoomViewer src={previewUrl} />
            <div className="preview-note">This exact image is what gets written to the file. Pinch / wheel / double-tap to zoom.</div>
          </div>
        )}
        <button className="print-btn" onClick={handlePreview} disabled={!activeIdx.length} style={{ marginBottom: 12, background: 'rgba(16,185,129,0.12)', color: '#047857' }}>👁️ Preview First Page</button>
        {lastSize != null && <div className="count-bar"><span className="count-chip">✅ Saved {lastSize} KB (was {origKB} KB)</span></div>}
        <button className={'print-btn save' + (activeIdx.length ? ' active' : '')} onClick={handleSave} disabled={!activeIdx.length}>💾 Compress & Save {targetKB() ? `(≤ ${targetKB()} KB)` : ''}</button>
        <div className="swipe-hint">← Swipe to change section →</div>
      </div></div>
    </div>
  );
}
