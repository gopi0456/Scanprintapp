import { useState, useEffect, useRef, useCallback } from 'react';
import { renderPdfToImages } from '../utils/imageUtils.js';
import {
  compressImageToTarget, compressPdfToTarget, compressPdfSmart, compressPageToTarget,
  pdfMergeLossless, renderPageCanvas, analyzePdfPages, convertToPng, convertToJpg,
  dataUrlToBlob, shareBlob, estimatePageKB, dataUrlKB, FLOOR_DOC, FLOOR_PHOTO, FLOOR_MIXED
} from '../utils/compressEngine.js';

const PITCH = 72;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/* True pinch-zoom + pan + wheel + double-tap viewer (transform based) */
function PreviewViewer({ src }) {
  const boxRef = useRef(null);
  const imgRef = useRef(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const pts = useRef(new Map());
  const g = useRef(null);
  const lastTap = useRef(0);

  const bounds = useCallback((z, p) => {
    const box = boxRef.current, img = imgRef.current;
    if (!box || !img) return p;
    const bw = box.clientWidth, bh = box.clientHeight;
    const iw = img.clientWidth * z, ih = img.clientHeight * z;
    const mx = Math.max(0, (iw - bw) / 2), my = Math.max(0, (ih - bh) / 2);
    return { x: clamp(p.x, -mx, mx), y: clamp(p.y, -my, my) };
  }, []);

  const applyZoom = (nz, cx, cy) => {
    const box = boxRef.current; if (!box) return;
    const r = box.getBoundingClientRect();
    const px = (cx ?? r.left + r.width / 2) - r.left - r.width / 2;
    const py = (cy ?? r.top + r.height / 2) - r.top - r.height / 2;
    setZoom(prev => {
      const z = clamp(nz, 1, 8);
      setPan(pp => bounds(z, { x: px - (z / prev) * (px - pp.x), y: py - (z / prev) * (py - pp.y) }));
      return z;
    });
  };

  const onDown = e => {
    e.preventDefault();
    boxRef.current.setPointerCapture(e.pointerId);
    pts.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.current.size === 1) {
      const now = Date.now();
      if (now - lastTap.current < 300) { applyZoom(zoom > 1 ? 1 : 3, e.clientX, e.clientY); if (zoom <= 1) setPan({ x: 0, y: 0 }); }
      lastTap.current = now;
      g.current = { t: 'pan', sx: e.clientX, sy: e.clientY, px: pan.x, py: pan.y };
    } else if (pts.current.size === 2) {
      const [a, b] = [...pts.current.values()];
      g.current = { t: 'pinch', d: Math.hypot(a.x - b.x, a.y - b.y), z: zoom, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, px: pan.x, py: pan.y };
    }
  };
  const onMove = e => {
    if (!pts.current.has(e.pointerId)) return;
    pts.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const gg = g.current; if (!gg) return;
    if (gg.t === 'pinch' && pts.current.size >= 2) {
      const [a, b] = [...pts.current.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const nz = clamp(gg.z * d / gg.d, 1, 8);
      const box = boxRef.current.getBoundingClientRect();
      const cx = gg.cx - box.left - box.width / 2, cy = gg.cy - box.top - box.height / 2;
      const k = nz / gg.z;
      setZoom(nz);
      setPan(bounds(nz, { x: cx - k * (cx - gg.px), y: cy - k * (cy - gg.py) }));
    } else if (gg.t === 'pan' && pts.current.size === 1 && zoom > 1) {
      setPan(bounds(zoom, { x: gg.px + (e.clientX - gg.sx), y: gg.py + (e.clientY - gg.sy) }));
    }
  };
  const onUp = e => {
    pts.current.delete(e.pointerId);
    if (pts.current.size === 1) { const [a] = [...pts.current.values()]; g.current = { t: 'pan', sx: a.x, sy: a.y, px: pan.x, py: pan.y }; }
    else if (pts.current.size === 0) { g.current = null; if (zoom <= 1.02) { setZoom(1); setPan({ x: 0, y: 0 }); } }
  };
  const onWheel = e => { e.preventDefault(); applyZoom(zoom + (e.deltaY < 0 ? 0.4 : -0.4), e.clientX, e.clientY); };

  return (
    <div className="pv-wrap">
      <div className="pv-box" ref={boxRef} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onWheel={onWheel}>
        <img ref={imgRef} src={src} alt="preview" draggable={false}
          style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }} />
        <div className="pv-hint">{zoom > 1 ? 'drag to pan • pinch to zoom' : 'pinch / double-tap / wheel to zoom'}</div>
      </div>
      <div className="pv-bar">
        <button className="em-step" onClick={() => applyZoom(zoom - 0.5)}>−</button>
        <input type="range" min="1" max="8" step="0.1" value={zoom} onChange={e => applyZoom(parseFloat(e.target.value))} />
        <button className="em-step" onClick={() => applyZoom(zoom + 0.5)}>+</button>
        <button className="em-step" onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }}>1×</button>
        <span className="adj-val">{zoom.toFixed(1)}×</span>
      </div>
    </div>
  );
}

export default function CompressSavePanel({ setIsLoading, setLoadProgress, setLoadMessage }) {
  const [images, setImages] = useState([]);
  const [meta, setMeta] = useState([]);
  const [included, setIncluded] = useState([]);
  const [sources, setSources] = useState([]);
  const [format, setFormat] = useState('pdf');
  const [sizeInput, setSizeInput] = useState('');
  const [unit, setUnit] = useState('KB');
  const [gray, setGray] = useState(false);
  const [convertText, setConvertText] = useState(false);
  const [lastSize, setLastSize] = useState(null);
  const [recommended, setRecommended] = useState(0);
  const [beforeKB, setBeforeKB] = useState(0);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [previewNote, setPreviewNote] = useState('');
  const [dragIdx, setDragIdx] = useState(null);
  const [scrollPos, setScrollPos] = useState(0);
  const [scrollMax, setScrollMax] = useState(0);
  const stripRef = useRef(null);
  const drag = useRef({ idx: null, active: false, sx: 0, sy: 0, lx: 0, raf: null, suppress: false });

  const activeIdx = included.reduce((a, v, i) => (v ? [...a, i] : a), []);
  const active = activeIdx.map(i => images[i]);
  const targetKBv = () => { const v = parseFloat(sizeInput); if (!v || v <= 0) return 0; return unit === 'MB' ? Math.round(v * 1024) : Math.round(v); };
  const hasPdfSrc = sources.some(s => s.isPdf);
  const textCount = activeIdx.filter(i => meta[i] && meta[i].kind === 'text').length;

  useEffect(() => { setBeforeKB(sources.reduce((s, x) => x.isPdf ? s + Math.round(x.bytes.byteLength / 1024) : s + dataUrlKB(images[x.start]), 0)); }, [images, included, sources]);
  useEffect(() => {
    if (!active.length) { setRecommended(0); return; }
    let on = true;
    (async () => { let sum = 0; for (const i of activeIdx) { const m = meta[i]; sum += (m && m.kind === 'text' && !convertText) ? 2 : await estimatePageKB(images[i]); } if (on) setRecommended(sum); })();
    return () => { on = false; };
  }, [images, included, meta, convertText]);
  useEffect(() => () => { if (drag.current.raf) cancelAnimationFrame(drag.current.raf); }, []);
  const syncScroll = () => { const s = stripRef.current; if (!s) return; setScrollPos(s.scrollLeft); setScrollMax(Math.max(0, s.scrollWidth - s.clientWidth)); };
  useEffect(() => { syncScroll(); }, [images, included, previewUrl]);

  const addSources = (entries) => {
    const base = sources.length; const next = [...sources]; let cur = images.length;
    entries.forEach((en, k) => { next.push({ isPdf: en.isPdf, bytes: en.bytes || null, start: cur, count: en.urls.length }); cur += en.urls.length; en.srcIdx = base + k; });
    setSources(next);
    setImages(p => [...p, ...entries.flatMap(e => e.urls)]);
    setMeta(p => [...p, ...entries.flatMap(e => e.metaArr)]);
    setIncluded(p => [...p, ...entries.flatMap(e => e.urls.map(() => true))]);
  };
  const uploadFiles = async (e) => {
    const files = Array.from(e.target.files || []); if (!files.length) return;
    setIsLoading(true); setLoadProgress(0); const entries = [];
    try {
      for (let f = 0; f < files.length; f++) {
        const file = files[f]; setLoadMessage(`Reading ${f + 1}/${files.length}: ${file.name}`);
        if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
          const buf = await file.arrayBuffer();
          const urls = await renderPdfToImages(file, p => setLoadProgress(Math.round(((f + p / 100) / files.length) * 70)));
          const analyzed = await analyzePdfPages(buf);
          entries.push({ isPdf: true, bytes: buf, urls, metaArr: analyzed.map(a => ({ ...a, srcIdx: f })) });
        } else if (file.type.startsWith('image/')) {
          const url = await new Promise(res => { const r = new FileReader(); r.onloadend = () => res(r.result); r.readAsDataURL(file); });
          entries.push({ isPdf: false, bytes: null, urls: [url], metaArr: [{ kind: 'image' }] });
        }
      }
      if (entries.length) addSources(entries);
    } catch (err) { alert('Failed: ' + err.message); }
    finally { setIsLoading(false); setLoadProgress(0); setLoadMessage(''); }
    e.target.value = null;
  };
  const takePhoto = async () => { try { const { Camera, CameraResultType } = await import('@capacitor/camera'); const im = await Camera.getPhoto({ quality: 100, allowEditing: false, resultType: CameraResultType.DataUrl }); addSources([{ isPdf: false, bytes: null, urls: [im.dataUrl], metaArr: [{ kind: 'image' }] }]); } catch (e) { alert('Camera requires a physical device.'); } };
  const scanDocument = async () => { try { const { DocumentScanner } = await import('@capgo/capacitor-document-scanner'); const r = await DocumentScanner.scanDocument({ responseType: 'base64' }); if (r.scannedImages?.length) addSources([{ isPdf: false, bytes: null, urls: [`data:image/jpeg;base64,${r.scannedImages[0]}`], metaArr: [{ kind: 'image' }] }]); } catch (e) { alert('Scanning requires a mobile device.'); } };

  const reorder = (from, to) => {
    setImages(a => { const n = [...a]; const [m] = n.splice(from, 1); n.splice(to, 0, m); return n; });
    setIncluded(a => { const n = [...a]; const [m] = n.splice(from, 1); n.splice(to, 0, m); return n; });
    setMeta(a => { const n = [...a]; const [m] = n.splice(from, 1); n.splice(to, 0, m); return n; });
  };
  const overAt = (x) => { const d = drag.current, s = stripRef.current; if (!s || d.idx == null) return; const r = s.getBoundingClientRect(); const t = clamp(Math.floor((x - r.left + s.scrollLeft) / PITCH), 0, images.length - 1); if (t !== d.idx) { reorder(d.idx, t); d.idx = t; } };
  const startAuto = () => { const step = () => { const d = drag.current, s = stripRef.current; if (s && d.active) { const r = s.getBoundingClientRect(); if (d.lx < r.left + 64) s.scrollLeft -= 18; else if (d.lx > r.right - 64) s.scrollLeft += 18; overAt(d.lx); } d.raf = requestAnimationFrame(step); }; drag.current.raf = requestAnimationFrame(step); };
  const stopAuto = () => { if (drag.current.raf) cancelAnimationFrame(drag.current.raf); drag.current.raf = null; };
  const onDown = i => e => { const d = drag.current; d.idx = i; d.active = false; d.sx = e.clientX; d.sy = e.clientY; d.lx = e.clientX; d.suppress = false; stripRef.current?.setPointerCapture?.(e.pointerId); setDragIdx(i); };
  const onMove = e => { const d = drag.current; if (d.idx == null) return; d.lx = e.clientX; if (!d.active && Math.hypot(e.clientX - d.sx, e.clientY - d.sy) > 10) { d.active = true; startAuto(); } if (d.active) overAt(e.clientX); };
  const onUp = () => { const d = drag.current; if (d.active) { d.suppress = true; stopAuto(); } d.idx = null; d.active = false; setDragIdx(null); };
  const onClick = i => () => { const d = drag.current; if (d.suppress) { d.suppress = false; return; } setIncluded(p => p.map((v, k) => k === i ? !v : v)); };

  const buildEntries = () => activeIdx.map(i => {
    const m = meta[i]; const src = m && m.srcIdx != null ? sources[m.srcIdx] : null;
    return { kind: m ? m.kind : 'image', dataUrl: images[i], bytes: src ? src.bytes : null, pageIdx: m ? m.pageIdx : null, w: m && m.w, h: m && m.h };
  });

  const handlePreview = async () => {
    if (!active.length) return alert('Select at least one page.');
    setIsLoading(true); setLoadProgress(0); setLoadMessage('Rendering preview...');
    try {
      const first = activeIdx[0]; const m = meta[first];
      if (m && m.kind === 'text' && !convertText) { setPreviewUrl(images[first]); setPreviewNote('Real vector text — stays sharp & selectable, exactly like the original.'); }
      else {
        const kb = targetKBv(); const budgets = await allocatePreview();
        let override = null; const src = m && m.srcIdx != null ? sources[m.srcIdx] : null;
        if (m && m.kind !== 'text' && src && src.bytes) { try { override = await renderPageCanvas(src.bytes, m.pageIdx, 3); } catch (e) {} }
        const r = await compressPageToTarget(images[first], budgets, { gray }, override);
        setPreviewUrl(r.url); setPreviewNote('Image page compressed to its budget.');
      }
      setLoadProgress(100);
    } catch (e) { alert('Preview failed: ' + e.message); }
    finally { setIsLoading(false); setLoadProgress(0); setLoadMessage(''); }
  };
  const allocatePreview = async () => { const kb = targetKBv(); const raster = buildEntries().filter(e => !(e.kind === 'text' && !convertText)); return Math.max(2, (kb > 0 ? kb : 200) / Math.max(1, raster.length)); };

  const handleSave = async () => {
    if (!active.length) return alert('Select at least one page.');
    const kb = targetKBv(); const opts = { gray, convertText };
    setIsLoading(true); setLoadProgress(0); setLoadMessage('Compressing...');
    try {
      let blob, total = 0;
      if (format === 'pdf') {
        const entries = buildEntries();
        const allText = entries.length > 0 && entries.every(e => e.kind === 'text') && !convertText;
        if (allText) { blob = await pdfMergeLossless(sources.map(s => ({ bytes: s.bytes, indices: included.slice(s.start, s.start + s.count).map((v, i) => v ? i : -1).filter(i => i >= 0) }))); }
        else if (hasPdfSrc) blob = await compressPdfSmart(entries, kb > 0 ? kb : Infinity, p => setLoadProgress(p), opts);
        else blob = await compressPdfToTarget(active, kb > 0 ? kb : Infinity, p => setLoadProgress(p), opts);
        total = blob.size; await shareBlob(blob, `scanprint-${Date.now()}.pdf`);
      } else {
        const mime = format === 'png' ? 'image/png' : 'image/jpeg';
        for (let i = 0; i < active.length; i++) {
          setLoadMessage(`Compressing ${i + 1}/${active.length}...`);
          let url = active[i];
          if (kb > 0) url = await compressImageToTarget(url, kb, mime, p => setLoadProgress(Math.round(((i + p / 100) / active.length) * 100)), opts);
          else url = mime === 'image/png' ? await convertToPng(url) : await convertToJpg(url, 0.92);
          const b = await dataUrlToBlob(url, `scanprint-${i + 1}.${mime === 'image/png' ? 'png' : 'jpg'}`);
          total += b.size; await shareBlob(b, b.name);
        }
      }
      const savedKB = Math.round(total / 1024); setLastSize(savedKB);
      const keptText = textCount > 0 && !convertText;
      alert(`Saved ${savedKB} KB (was ${beforeKB} KB).` + (keptText ? ' Text pages kept as real text.' : '') + (kb && savedKB > kb ? ` Over ${kb} KB target to preserve quality.` : ''));
      try { await handlePreview(); } catch (e) {}
    } catch (e) { alert('Save failed: ' + e.message); }
    finally { setIsLoading(false); setLoadProgress(0); setLoadMessage(''); }
  };

  const tooSmall = targetKBv() > 0 && recommended > 0 && targetKBv() < recommended;

  return (
    <div className="panel">
      <div className="glass-frame"><div className="logo-chip">💾</div><div className="main-card">
        <div className="header"><h2>Compress & Save</h2></div>
        <div className="workflow-cards">
          <div className="workflow-card" onClick={takePhoto}><div className="card-content"><span className="icon">📷</span><span className="label">Take Photo</span></div><div className="check-icon">✓</div></div>
          <div className="workflow-card" onClick={scanDocument}><div className="card-content"><span className="icon">✨</span><span className="label">Scan Document</span></div><div className="check-icon">✓</div></div>
          <label className="workflow-card"><div className="card-content"><span className="icon">📁</span><span className="label">Upload Photos / PDFs (multi)</span></div><div className="check-icon">✓</div>
            <input type="file" accept="image/*,.pdf,application/pdf" multiple style={{ display: 'none' }} onChange={uploadFiles} /></label>
        </div>

        {images.length > 0 && (<>
          <div className="count-bar"><span className="count-chip">📄 {active.length}/{images.length} • was ≈ {beforeKB} KB{textCount ? ` • ${textCount} text pages` : ''}</span>
            <button className="clear-btn" onClick={() => { setImages([]); setMeta([]); setIncluded([]); setSources([]); setLastSize(null); setPreviewUrl(null); }}>Clear All</button></div>
          <div className="thumb-strip" ref={stripRef} onScroll={syncScroll} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
            {images.map((img, i) => (
              <button key={i} data-idx={i} className={'thumb' + (included[i] ? '' : ' off') + (dragIdx === i ? ' dragging' : '')} onPointerDown={onDown(i)} onClick={onClick(i)}>
                <img src={img} alt={'p' + (i + 1)} draggable={false} />
                <span className="thumb-mark">{included[i] ? '✓' : '✕'}</span><span className="thumb-num">{i + 1}</span>
                {meta[i] && meta[i].kind === 'text' && <span className="thumb-tag">TXT</span>}
              </button>))}
          </div>
          {scrollMax > 0 && <div className="strip-scroll-wrap"><input type="range" className="strip-scroll" min={0} max={scrollMax} value={scrollPos} onChange={e => { const v = parseInt(e.target.value, 10) || 0; if (stripRef.current) stripRef.current.scrollLeft = v; setScrollPos(v); }} /></div>}
          <div className="thumb-hint">Tap = include/exclude • drag = reorder • slider = scroll. TXT pages stay real text.</div>
        </>)}

        <div className="passport-settings" style={{ marginTop: 0 }}>
          <div className="workflow-card settings-card"><div className="card-content"><span className="icon">💾</span>
            <select value={format} onChange={e => setFormat(e.target.value)} className="neon-select"><option value="pdf">PDF (combine selected)</option><option value="jpg">JPG / JPEG</option><option value="png">PNG</option></select>
          </div><div className="check-icon">✓</div></div>
          <div className="workflow-card settings-card"><div className="card-content" style={{ flexDirection: 'column', alignItems: 'stretch', gap: '8px' }}>
            <div className="target-row"><span className="icon">🎯</span>
              <input type="number" min="1" placeholder="Target size" value={sizeInput} onChange={e => setSizeInput(e.target.value)} className="target-input" />
              <select value={unit} onChange={e => setUnit(e.target.value)} className="target-unit"><option>KB</option><option>MB</option></select></div>
            {recommended > 0 && <div className={'target-meta' + (tooSmall ? ' warn' : '')}><span>Readable min ≈ <b>{recommended} KB</b>.</span><button className="auto-btn" onClick={() => { setUnit('KB'); setSizeInput(String(recommended)); }}>Use it</button></div>}
            {tooSmall && <span className="target-warn">Below readable minimum quality drops.</span>}
          </div></div>
          <label className="workflow-card settings-card"><div className="card-content"><span className="icon">⬛</span><span className="label">Grayscale (image pages)</span></div><input type="checkbox" checked={gray} onChange={e => setGray(e.target.checked)} style={{ width: 22, height: 22 }} /></label>
          <label className="workflow-card settings-card"><div className="card-content" style={{ flexDirection: 'column', alignItems: 'stretch', gap: '4px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}><span className="icon">🔁</span><span className="label">Convert text→image (smaller, loses real text)</span><input type="checkbox" checked={convertText} onChange={e => setConvertText(e.target.checked)} style={{ width: 22, height: 22, marginLeft: 'auto' }} /></div>
            <span className="range-hint">OFF = text stays crisp & selectable like the original. ON = text becomes image to shrink further.</span>
          </div></label>
        </div>

        {previewUrl && (
          <div className="preview-card" style={{ marginTop: 12 }}>
            <div className="preview-head"><span>👁️ Preview (page 1)</span><button className="clear-btn" onClick={() => setPreviewUrl(null)}>Close</button></div>
            <PreviewViewer src={previewUrl} />
            <div className="preview-note">{previewNote}</div>
          </div>
        )}
        <button className="print-btn" onClick={handlePreview} disabled={active.length === 0} style={{ marginBottom: 12, background: 'rgba(16,185,129,0.12)', color: '#047857' }}>👁️ Preview First Page</button>
        {lastSize != null && <div className="count-bar"><span className="count-chip">✅ Saved {lastSize} KB (was {beforeKB} KB)</span></div>}
        <button className={'print-btn save' + (active.length > 0 ? ' active' : '')} onClick={handleSave} disabled={active.length === 0}>💾 Compress & Save {targetKBv() > 0 ? `(≤ ${targetKBv()} KB)` : ''}</button>
        <div className="swipe-hint">← Swipe to change section →</div>
      </div></div>
    </div>
  );
}
