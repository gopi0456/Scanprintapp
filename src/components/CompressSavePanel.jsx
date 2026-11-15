import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { renderPdfToImages } from '../utils/imageUtils.js';
import {
  MODES, analyzePdfPages, compressRasterPage, computeBudgets, pageImage, compressPdfWithMode,
  compressImageToTarget, dataUrlToBlob, shareBlob, dataUrlKB,
  readableMinimum, clarityFor, measurePage, originalPdf
} from '../utils/compressEngine.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

function ZoomViewer({ src }) {
  const boxRef = useRef(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const zRef = useRef(1), panRef = useRef({ x: 0, y: 0 });
  const pts = useRef(new Map()), gest = useRef(null), lastTap = useRef(0);
  const setZ = z => { zRef.current = z; setZoom(z); };
  const setP = p => { panRef.current = p; setPan(p); };
  const bounds = (z, p) => { const b = boxRef.current; if (!b) return p; const mx = (z - 1) * b.clientWidth / 2, my = (z - 1) * b.clientHeight / 2; return { x: clamp(p.x, -mx, mx), y: clamp(p.y, -my, my) }; };
  const zoomAt = useCallback((nz, cx, cy) => {
    const b = boxRef.current; if (!b) return; const r = b.getBoundingClientRect();
    const px = (cx ?? (r.left + r.width / 2)) - r.left - r.width / 2;
    const py = (cy ?? (r.top + r.height / 2)) - r.top - r.height / 2;
    const z = clamp(nz, 1, 10), k = z / zRef.current;
    setZ(z); setP(z <= 1 ? { x: 0, y: 0 } : bounds(z, { x: px - k * (px - panRef.current.x), y: py - k * (py - panRef.current.y) }));
  }, []);
  const down = e => {
    e.preventDefault(); try { boxRef.current.setPointerCapture(e.pointerId); } catch (err) {}
    pts.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.current.size === 1) {
      const now = Date.now(); if (now - lastTap.current < 300) zoomAt(zRef.current > 1 ? 1 : 4, e.clientX, e.clientY); lastTap.current = now;
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
      const nz = clamp(g.z * d / g.d, 1, 10); const r = boxRef.current.getBoundingClientRect();
      const cx = g.cx - r.left - r.width / 2, cy = g.cy - r.top - r.height / 2, k = nz / g.z;
      setZ(nz); setP(bounds(nz, { x: cx - k * (cx - g.px), y: cy - k * (cy - g.py) }));
    } else if (g.t === 'pan' && pts.current.size === 1 && zRef.current > 1) {
      setP(bounds(zRef.current, { x: g.px + (e.clientX - g.sx), y: g.py + (e.clientY - g.sy) }));
    }
  };
  const up = e => {
    pts.current.delete(e.pointerId);
    if (pts.current.size === 1) { const [a] = [...pts.current.values()]; gest.current = { t: 'pan', sx: a.x, sy: a.y, px: panRef.current.x, py: panRef.current.y }; }
    else if (pts.current.size === 0) { gest.current = null; if (zRef.current <= 1.02) { setZ(1); setP({ x: 0, y: 0 }); } }
  };
  return (
    <div className="pv-wrap">
      <div className="pv-box" ref={boxRef} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
        onWheel={e => { e.preventDefault(); zoomAt(zRef.current + (e.deltaY < 0 ? .5 : -.5), e.clientX, e.clientY); }}>
        <img src={src} alt="Compressed page preview" draggable={false} style={{ transform: `translate(${pan.x}px,${pan.y}px) scale(${zoom})` }} />
        <div className="pv-hint">{zoom > 1 ? 'drag to pan · pinch to zoom' : 'pinch · double-tap · wheel'}</div>
      </div>
      <div className="pv-bar">
        <button className="pv-step" onClick={() => zoomAt(zRef.current - .5)} aria-label="Zoom out">−</button>
        <input type="range" min="1" max="10" step="0.1" value={zoom} onChange={e => zoomAt(parseFloat(e.target.value))} aria-label="Zoom level" />
        <button className="pv-step" onClick={() => zoomAt(zRef.current + .5)} aria-label="Zoom in">+</button>
        <button className="pv-step wide" onClick={() => { setZ(1); setP({ x: 0, y: 0 }); }}>Fit</button>
        <span className="pv-val">{zoom.toFixed(1)}×</span>
      </div>
    </div>
  );
}

export default function CompressSavePanel({ setIsLoading, setLoadProgress, setLoadMessage }) {
  const [images, setImages] = useState([]);
  const [entries, setEntries] = useState([]);
  const [included, setIncluded] = useState([]);
  const [origKB, setOrigKB] = useState(0);
  const [format, setFormat] = useState('pdf');
  const [mode, setMode] = useState('hc_hq');
  const [gray, setGray] = useState(false);
  const [sizeInput, setSizeInput] = useState('');
  const [unit, setUnit] = useState('KB');
  const [previewUrl, setPreviewUrl] = useState(null);
  const [previewMeta, setPreviewMeta] = useState(null);
  const [result, setResult] = useState(null);
  const [dragIdx, setDragIdx] = useState(null);
  const [scrollPos, setScrollPos] = useState(0);
  const [scrollMax, setScrollMax] = useState(0);
  const [dropping, setDropping] = useState(false);
  const [measure, setMeasure] = useState(null);
  const [measuring, setMeasuring] = useState(false);
  const stripRef = useRef(null);
  const drag = useRef({ idx: null, active: false, sx: 0, lx: 0, raf: null, suppress: false });

  const activeIdx = useMemo(() => included.reduce((a, v, i) => (v ? [...a, i] : a), []), [included]);
  const targetKB = () => { const v = parseFloat(sizeInput); if (!v || v <= 0) return 0; return unit === 'MB' ? Math.round(v * 1024) : Math.round(v); };
  const effKB = targetKB() > 0 ? Math.min(targetKB(), origKB || targetKB()) : origKB;
  const perPage = activeIdx.length ? effKB / activeIdx.length : 0;
  const passthrough = origKB > 0 && (targetKB() === 0 || targetKB() >= origKB);
  const widthPx = measure ? measure.px : 0;
  const band = passthrough ? { key: 'high', label: 'Original', note: 'No recompression — bytes copied straight from your file.' } : (measure ? clarityFor(measure.px) : { key: 'ok', label: 'Measuring…', note: 'Encoding page 1 to read its real width.' });
  const minKB = readableMinimum(activeIdx.length);

  useEffect(() => () => { if (drag.current.raf) cancelAnimationFrame(drag.current.raf); }, []);
  const syncScroll = () => { const s = stripRef.current; if (!s) return; setScrollPos(s.scrollLeft); setScrollMax(Math.max(0, s.scrollWidth - s.clientWidth)); };
  useEffect(() => { syncScroll(); }, [images, previewUrl]);
  useEffect(() => {
    if (!activeIdx.length || passthrough) { setMeasure(null); return; }
    let alive = true;
    setMeasuring(true);
    const t = setTimeout(async () => {
      try {
        const b = computeBudgets(activeIdx.length, targetKB(), origKB);
        const m = await measurePage(entries[activeIdx[0]], b[0], mode, gray);
        if (alive) setMeasure(m);
      } catch (e) { if (alive) setMeasure(null); }
      finally { if (alive) setMeasuring(false); }
    }, 450);
    return () => { alive = false; clearTimeout(t); };
  }, [images, included, sizeInput, unit, mode, gray, origKB]);

  const addBatch = (urls, ents, kb) => {
    setImages(p => [...p, ...urls]); setEntries(p => [...p, ...ents]);
    setIncluded(p => [...p, ...urls.map(() => true)]); setOrigKB(k => k + kb);
    setResult(null);
  };
  const ingest = async (files) => {
    if (!files.length) return;
    setIsLoading(true); setLoadProgress(0);
    try {
      for (let f = 0; f < files.length; f++) {
        const file = files[f]; setLoadMessage(`Reading ${f + 1}/${files.length} · ${file.name}`);
        if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
          const buf = await file.arrayBuffer();
          const urls = await renderPdfToImages(file, p => setLoadProgress(Math.round(((f + p / 100) / files.length) * 100)));
          const dims = await analyzePdfPages(buf);
          addBatch(urls, urls.map((u, i) => ({ bytes: buf, pageIdx: dims[i].pageIdx, w: dims[i].w, h: dims[i].h, dataUrl: u })), Math.round(buf.byteLength / 1024));
        } else if (file.type.startsWith('image/')) {
          const url = await new Promise(res => { const r = new FileReader(); r.onloadend = () => res(r.result); r.readAsDataURL(file); });
          addBatch([url], [{ bytes: null, pageIdx: null, w: null, h: null, dataUrl: url }], Math.round(dataUrlKB(url)));
        }
      }
    } catch (err) { alert('Could not read file: ' + err.message); }
    finally { setIsLoading(false); setLoadProgress(0); setLoadMessage(''); }
  };
  const uploadFiles = async e => { await ingest(Array.from(e.target.files || [])); e.target.value = null; };
  const takePhoto = async () => { try { const { Camera, CameraResultType } = await import('@capacitor/camera'); const im = await Camera.getPhoto({ quality: 100, allowEditing: false, resultType: CameraResultType.DataUrl }); addBatch([im.dataUrl], [{ bytes: null, pageIdx: null, w: null, h: null, dataUrl: im.dataUrl }], Math.round(dataUrlKB(im.dataUrl))); } catch (e) { alert('Camera needs a physical device.'); } };
  const scanDocument = async () => { try { const { DocumentScanner } = await import('@capgo/capacitor-document-scanner'); const r = await DocumentScanner.scanDocument({ responseType: 'base64' }); if (r.scannedImages?.length) { const u = `data:image/jpeg;base64,${r.scannedImages[0]}`; addBatch([u], [{ bytes: null, pageIdx: null, w: null, h: null, dataUrl: u }], Math.round(dataUrlKB(u))); } } catch (e) { alert('Scanner needs a mobile device.'); } };

  const reorder = (from, to) => { const mv = a => { const n = [...a]; const [m] = n.splice(from, 1); n.splice(to, 0, m); return n; }; setImages(mv); setEntries(mv); setIncluded(mv); };
  const overAt = x => { const d = drag.current, s = stripRef.current; if (!s || d.idx == null) return; const r = s.getBoundingClientRect(); const t = clamp(Math.floor((x - r.left + s.scrollLeft) / 76), 0, images.length - 1); if (t !== d.idx) { reorder(d.idx, t); d.idx = t; } };
  const startAuto = () => { const step = () => { const d = drag.current, s = stripRef.current; if (s && d.active) { const r = s.getBoundingClientRect(); if (d.lx < r.left + 64) s.scrollLeft -= 18; else if (d.lx > r.right - 64) s.scrollLeft += 18; overAt(d.lx); } d.raf = requestAnimationFrame(step); }; drag.current.raf = requestAnimationFrame(step); };
  const stopAuto = () => { if (drag.current.raf) cancelAnimationFrame(drag.current.raf); drag.current.raf = null; };
  const onDown = i => e => { const d = drag.current; d.idx = i; d.active = false; d.sx = e.clientX; d.lx = e.clientX; d.suppress = false; try { stripRef.current.setPointerCapture(e.pointerId); } catch (err) {} setDragIdx(i); };
  const onMove = e => { const d = drag.current; if (d.idx == null) return; d.lx = e.clientX; if (!d.active && Math.abs(e.clientX - d.sx) > 10) { d.active = true; startAuto(); } if (d.active) overAt(e.clientX); };
  const onUp = () => { const d = drag.current; if (d.active) { d.suppress = true; stopAuto(); } d.idx = null; d.active = false; setDragIdx(null); };
  const onClick = i => () => { const d = drag.current; if (d.suppress) { d.suppress = false; return; } setIncluded(p => p.map((v, k) => k === i ? !v : v)); };

  const handlePreview = async () => {
    if (!activeIdx.length) return alert('Select at least one page.');
    setIsLoading(true); setLoadProgress(0); setLoadMessage('Encoding preview · identical to the saved file');
    try {
      const first = activeIdx[0];
      const budgets = computeBudgets(activeIdx.length, targetKB(), origKB);
      const r = compressRasterPage(await pageImage(entries[first]), budgets[0], mode, gray);
      setPreviewUrl(r.url);
      setPreviewMeta({ kb: Math.round(r.kb), px: r.px, q: Math.round(r.q * 100), band: clarityFor(r.px) });
      setLoadProgress(100);
    } catch (e) { alert('Preview failed: ' + e.message); }
    finally { setIsLoading(false); setLoadProgress(0); setLoadMessage(''); }
  };

  const handleSave = async () => {
    if (!activeIdx.length) return alert('Select at least one page.');
    const kb = targetKB();
    setIsLoading(true); setLoadProgress(0); setLoadMessage(MODES[mode].label + '…');
    try {
      let total = 0, widths = [];
      if (format === 'pdf') {
        const { blob, per, passthrough: kept } = await compressPdfWithMode(activeIdx.map(i => entries[i]), kb || Infinity, origKB, mode, gray, p => setLoadProgress(p));
        total = blob.size; widths = per.map(p => p.px);
        await shareBlob(blob, `compressed-${Date.now()}.pdf`);
      } else {
        const mime = format === 'png' ? 'image/png' : 'image/jpeg';
        for (let k = 0; k < activeIdx.length; k++) {
          setLoadMessage(`Compressing ${k + 1}/${activeIdx.length}…`);
          const url = await compressImageToTarget(entries[activeIdx[k]].dataUrl, kb, mime, mode, gray, p => setLoadProgress(Math.round(((k + p / 100) / activeIdx.length) * 100)));
          const b = await dataUrlToBlob(url, `compressed-${k + 1}.${mime === 'image/png' ? 'png' : 'jpg'}`);
          total += b.size; await shareBlob(b, b.name);
        }
      }
      const savedKB = Math.round(total / 1024);
      const avgW = widths.length ? Math.round(widths.reduce((a, b) => a + b, 0) / widths.length) : widthPx;
      setResult({ savedKB, targetKB: kb, origKB, pages: activeIdx.length, mode: kept ? 'Original — no recompression' : MODES[mode].label, hit: kb > 0 ? savedKB <= kb : true, width: avgW, band: kept ? { key: 'high', label: 'Original quality' } : clarityFor(avgW), kept });
      setLoadProgress(100);
    } catch (e) { alert('Save failed: ' + e.message); }
    finally { setIsLoading(false); setLoadProgress(0); setLoadMessage(''); }
  };

  const clearAll = () => { setImages([]); setEntries([]); setIncluded([]); setOrigKB(0); setPreviewUrl(null); setPreviewMeta(null); setResult(null); };
  const savedPct = result && result.origKB ? clamp(Math.round((result.savedKB / result.origKB) * 100), 0, 100) : 0;
  const gaugePct = passthrough ? 100 : clamp((widthPx / 1300) * 100, 3, 100);

  return (
    <div className="panel">
      <div className="glass-frame"><div className="logo-chip">💾</div><div className="main-card">
        <div className="header"><h2>Compress &amp; Save</h2></div>

        <div className="workflow-cards">
          <div className="workflow-card" onClick={takePhoto}><div className="card-content"><span className="icon">📷</span><span className="label">Take Photo</span></div><div className="check-icon">✓</div></div>
          <div className="workflow-card" onClick={scanDocument}><div className="card-content"><span className="icon">✨</span><span className="label">Scan Document</span></div><div className="check-icon">✓</div></div>
          <label className={'workflow-card dropzone' + (dropping ? ' over' : '')}
            onDragOver={e => { e.preventDefault(); setDropping(true); }}
            onDragLeave={() => setDropping(false)}
            onDrop={e => { e.preventDefault(); setDropping(false); ingest(Array.from(e.dataTransfer.files || [])); }}>
            <div className="card-content"><span className="icon">📁</span><span className="label">Upload PDFs / Photos</span></div><div className="check-icon">✓</div>
            <input type="file" accept="image/*,.pdf,application/pdf" multiple style={{ display: 'none' }} onChange={uploadFiles} /></label>
        </div>

        {images.length > 0 && (<>
          <div className="count-bar">
            <span className="count-chip">📄 {activeIdx.length}/{images.length} pages · original {origKB} KB</span>
            <button className="clear-btn" onClick={clearAll}>Clear All</button>
          </div>
          <div className="thumb-strip" ref={stripRef} onScroll={syncScroll} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
            {images.map((img, i) => (
              <button key={i} className={'thumb' + (included[i] ? '' : ' off') + (dragIdx === i ? ' dragging' : '')} onPointerDown={onDown(i)} onClick={onClick(i)}>
                <img src={img} alt={'Page ' + (i + 1)} draggable={false} />
                <span className="thumb-mark">{included[i] ? '✓' : '✕'}</span><span className="thumb-num">{i + 1}</span>
              </button>))}
          </div>
          {scrollMax > 0 && <div className="strip-scroll-wrap"><input type="range" className="strip-scroll" min={0} max={scrollMax} value={scrollPos} onChange={e => { const v = parseInt(e.target.value, 10) || 0; if (stripRef.current) stripRef.current.scrollLeft = v; setScrollPos(v); }} aria-label="Scroll pages" /></div>}
          <div className="thumb-hint">Tap to include · drag sideways to reorder · slider scrolls</div>
        </>)}

        <div className="mode-grid">
          {Object.entries(MODES).map(([key, m]) => (
            <button key={key} className={'mode-card' + (mode === key ? ' on' : '')} onClick={() => setMode(key)}>
              <span className="mode-ico">{m.icon}</span>
              <span className="mode-text"><span className="mode-label">{m.label}</span><span className="mode-hint">{m.hint}</span></span>
              {mode === key && <span className="mode-dot" />}
            </button>))}
        </div>

        <div className="passport-settings" style={{ marginTop: 12 }}>
          <div className="workflow-card settings-card"><div className="card-content"><span className="icon">💾</span>
            <select value={format} onChange={e => setFormat(e.target.value)} className="neon-select"><option value="pdf">PDF</option><option value="jpg">JPG / JPEG</option><option value="png">PNG</option></select>
          </div><div className="check-icon">✓</div></div>

          <div className="workflow-card settings-card"><div className="card-content" style={{ gap: 8 }}>
            <span className="icon">🎯</span>
            <input type="number" min="1" placeholder="Target size" value={sizeInput} onChange={e => setSizeInput(e.target.value)} className="target-input" />
            <select value={unit} onChange={e => setUnit(e.target.value)} className="target-unit"><option>KB</option><option>MB</option></select>
          </div><div className="check-icon">✓</div></div>

          <label className="workflow-card settings-card"><div className="card-content"><span className="icon">⬛</span><span className="label">Grayscale</span></div>
            <input type="checkbox" checked={gray} onChange={e => setGray(e.target.checked)} style={{ width: 22, height: 22 }} /></label>
        </div>

        {activeIdx.length > 0 && (
          <div className={'budget-card ' + band.key}>
            <div className="budget-top">
              <span className="budget-math">{effKB} KB ÷ {activeIdx.length} pages = <b>{perPage.toFixed(1)} KB / page</b></span>
              <span className={'quality-badge ' + band.key}>{band.label}</span>
            </div>
            <div className="budget-track"><div className="budget-fill" style={{ width: gaugePct + '%' }} /><span className="budget-marker" style={{ left: clamp((950 / 1300) * 100, 0, 100) + '%' }} /></div>
            <div className="budget-scale"><span>150 px</span><span>readable ≈ 950 px</span><span>1300 px</span></div>
            <div className="budget-note">{passthrough
              ? <span>Target covers the original — the file is copied <b>untouched</b>. Quality identical to your upload.</span>
              : <span>{measuring ? 'Measuring page 1…' : <>Measured page width <b>{widthPx} px</b> at <b>{measure ? Math.round(measure.kb) : 0} KB</b></>} — {band.note}</span>}</div>
            {!passthrough && !measuring && widthPx > 0 && widthPx < 950 && (
              <div className="budget-warn">
                <span>For readable table text this document needs ≈ <b>{minKB} KB</b>. Your {targetKB() || effKB} KB target will be met, but fine print stays soft.</span>
                <button className="auto-btn" onClick={() => { setUnit('KB'); setSizeInput(String(minKB)); }}>Use {minKB} KB</button>
                <button className="auto-btn" onClick={() => { setUnit('KB'); setSizeInput(String(origKB)); }}>Keep original</button>
              </div>)}
          </div>
        )}

        {previewUrl && (
          <div className="preview-card">
            <div className="preview-head"><span>👁️ Preview = saved result</span><button className="clear-btn" onClick={() => { setPreviewUrl(null); setPreviewMeta(null); }}>Close</button></div>
            <ZoomViewer src={previewUrl} />
            {previewMeta && (
              <div className="preview-meta">
                <span>{previewMeta.kb} KB</span><span>{previewMeta.px} px wide</span><span>quality {previewMeta.q}%</span>
                <span className={'pm-band ' + previewMeta.band.key}>{previewMeta.band.label}</span>
              </div>)}
            <div className="preview-note">These exact bytes are written into the file — no separate save path.</div>
          </div>
        )}

        <button className="print-btn ghost" onClick={handlePreview} disabled={!activeIdx.length}>👁️ Preview First Page</button>

        {result && (
          <div className={'result-card' + (result.hit ? ' hit' : ' miss')}>
            <div className="result-row"><span className="result-big">{result.savedKB} KB</span>
              <span className="result-sub">from {result.origKB} KB · {savedPct}% of original</span></div>
            <div className="result-track"><div className="result-fill" style={{ width: savedPct + '%' }} /></div>
            <div className="result-foot">
              <span>{result.targetKB ? (result.hit ? `✓ Target ${result.targetKB} KB met` : `Above ${result.targetKB} KB target`) : 'No target set'}</span>
              <span>{result.kept ? result.band.label : `${result.width} px avg · ${result.band.label}`}</span>
            </div>
          </div>
        )}

        <button className={'print-btn save' + (activeIdx.length ? ' active' : '')} onClick={handleSave} disabled={!activeIdx.length}>
          💾 Compress &amp; Save {targetKB() ? `· ${targetKB()} KB` : ''}
        </button>
        <div className="swipe-hint">← Swipe to change section →</div>
      </div></div>
    </div>
  );
}
