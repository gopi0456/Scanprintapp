import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { renderPdfToImages } from '../utils/imageUtils.js';
import {
  MODES, PAPER_SIZES, DPI_OPTIONS, FIT_MODES, analyzePdfPages, compressRasterPage, computeBudgets,
  pageImage, compressPdfWithMode, compressImageToTarget, dataUrlToBlob, shareBlob, dataUrlKB,
  readableMinimum, clarityFor, measurePage, paperPixels, compressPdfKeepText, inspectPdf
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
        <img src={src} alt="Compressed output preview" draggable={false} style={{ transform: `translate(${pan.x}px,${pan.y}px) scale(${zoom})` }} />
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
  const [mode, setMode] = useState('keep_text');
  const [info, setInfo] = useState(null);
  const [gray, setGray] = useState(false);
  const [paper, setPaper] = useState('default');
  const [dpi, setDpi] = useState(300);
  const [fit, setFit] = useState('contain');
  const [sizeInput, setSizeInput] = useState('');
  const [unit, setUnit] = useState('KB');
  const [previewUrl, setPreviewUrl] = useState(null);
  const [previewMeta, setPreviewMeta] = useState(null);
  const [result, setResult] = useState(null);
  const [measure, setMeasure] = useState(null);
  const [measuring, setMeasuring] = useState(false);
  const [dragIdx, setDragIdx] = useState(null);
  const [scrollPos, setScrollPos] = useState(0);
  const [scrollMax, setScrollMax] = useState(0);
  const [dropping, setDropping] = useState(false);
  const stripRef = useRef(null);
  const drag = useRef({ idx: null, active: false, sx: 0, lx: 0, raf: null, suppress: false });

  const isImage = format !== 'pdf';
  const activeIdx = useMemo(() => included.reduce((a, v, i) => (v ? [...a, i] : a), []), [included]);
  const targetKB = () => { const v = parseFloat(sizeInput); if (!v || v <= 0) return 0; return unit === 'MB' ? Math.round(v * 1024) : Math.round(v); };
  const sheet = useMemo(() => (isImage ? paperPixels(paper, dpi) : null), [isImage, paper, dpi]);
  const passthrough = !isImage && origKB > 0 && (targetKB() === 0 || targetKB() >= origKB);
  const perPage = activeIdx.length ? (targetKB() > 0 ? targetKB() : origKB) / (isImage ? 1 : activeIdx.length) : 0;
  const widthPx = measure ? measure.px : 0;
  const band = passthrough
    ? { key: 'high', label: 'Original', note: 'No recompression — bytes copied from your file.' }
    : (measure ? clarityFor(measure.px) : { key: 'ok', label: 'Measuring…', note: 'Encoding a sample to read its real width.' });
  const minKB = readableMinimum(activeIdx.length, origKB);

  useEffect(() => () => { if (drag.current.raf) cancelAnimationFrame(drag.current.raf); }, []);
  const syncScroll = () => { const s = stripRef.current; if (!s) return; setScrollPos(s.scrollLeft); setScrollMax(Math.max(0, s.scrollWidth - s.clientWidth)); };
  useEffect(() => { syncScroll(); }, [images, previewUrl]);

  useEffect(() => {
    if (!activeIdx.length || passthrough) { setMeasure(null); return; }
    let alive = true; setMeasuring(true);
    const t = setTimeout(async () => {
      try {
        if (isImage) {
          const r = await compressImageToTarget(entries[activeIdx[0]].dataUrl, targetKB(), format === 'png' ? 'image/png' : 'image/jpeg', mode, gray, { paper, dpi, fit });
          if (alive) setMeasure({ px: r.px, kb: r.kb, q: r.q, exact: r.exact, ph: r.ph });
        } else {
          const b = computeBudgets(activeIdx.length, targetKB(), origKB);
          const m = await measurePage(entries[activeIdx[0]], b[0], mode, gray);
          if (alive) setMeasure(m);
        }
      } catch (e) { if (alive) setMeasure(null); }
      finally { if (alive) setMeasuring(false); }
    }, 420);
    return () => { alive = false; clearTimeout(t); };
  }, [images, included, sizeInput, unit, mode, gray, origKB, format, paper, dpi, fit]);

  const addBatch = (urls, ents, kb) => {
    setImages(p => [...p, ...urls]); setEntries(p => [...p, ...ents]);
    setIncluded(p => [...p, ...urls.map(() => true)]); setOrigKB(k => k + kb); setResult(null);
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
          try { setInfo(await inspectPdf(buf)); } catch (err) {}
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
      if (isImage) {
        const r = await compressImageToTarget(entries[first].dataUrl, targetKB(), format === 'png' ? 'image/png' : 'image/jpeg', mode, gray, { paper, dpi, fit });
        setPreviewUrl(r.url);
        setPreviewMeta({ kb: Math.round(r.kb), px: r.px, ph: r.ph, q: Math.round(r.q * 100), exact: r.exact, framed: r.framed, band: clarityFor(r.px) });
      } else if (passthrough || mode === 'keep_text') {
        setPreviewUrl(images[first]);
        setPreviewMeta({ kb: 0, px: 0, ph: 0, q: 100, exact: true, framed: false, band: { key: 'high', label: 'Original quality' }, kept: true });
      } else {
        const b = computeBudgets(activeIdx.length, targetKB(), origKB);
        const r = compressRasterPage(await pageImage(entries[first]), b[0], mode, gray);
        setPreviewUrl(r.url);
        setPreviewMeta({ kb: Math.round(r.kb), px: r.px, ph: Math.round(r.px * 1.414), q: Math.round(r.q * 100), exact: false, framed: false, band: clarityFor(r.px) });
      }
      setLoadProgress(100);
    } catch (e) { alert('Preview failed: ' + e.message); }
    finally { setIsLoading(false); setLoadProgress(0); setLoadMessage(''); }
  };

  const handleSave = async () => {
    if (!activeIdx.length) return alert('Select at least one page.');
    const kb = targetKB();
    setIsLoading(true); setLoadProgress(0); setLoadMessage(MODES[mode].label + '…');
    try {
      let total = 0, widths = [], kept = false, exactAll = true;
      if (!isImage) {
        let blob, per = [], k = false;
        if (mode === 'keep_text' && entries[0] && entries[0].bytes) {
          const r = await compressPdfKeepText(entries[0].bytes, kb || Infinity, p => setLoadProgress(p));
          blob = r.blob; k = true;
        } else {
          const r = await compressPdfWithMode(activeIdx.map(i => entries[i]), kb || Infinity, origKB, mode, gray, p => setLoadProgress(p));
          blob = r.blob; per = r.per; k = !!r.passthrough;
        }
        total = blob.size; widths = per.map(p => p.px); kept = !!k;
        await shareBlob(blob, `compressed-${Date.now()}.pdf`);
      } else {
        const mime = format === 'png' ? 'image/png' : 'image/jpeg';
        const ext = format === 'png' ? 'png' : 'jpg';
        const tag = paper !== 'default' ? `${paper}-${dpi}dpi-` : '';
        for (let k = 0; k < activeIdx.length; k++) {
          setLoadMessage(`Encoding ${k + 1}/${activeIdx.length} · ${PAPER_SIZES[paper].label}`);
          const r = await compressImageToTarget(entries[activeIdx[k]].dataUrl, kb, mime, mode, gray, { paper, dpi, fit },
            p => setLoadProgress(Math.round(((k + p / 100) / activeIdx.length) * 100)));
          if (!r.exact && r.framed) exactAll = false;
          widths.push(r.px);
          const b = await dataUrlToBlob(r.url, `${tag}scan-${k + 1}.${ext}`);
          total += b.size; await shareBlob(b, b.name);
        }
      }
      const savedKB = Math.round(total / 1024);
      const avgW = widths.length ? Math.round(widths.reduce((a, b) => a + b, 0) / widths.length) : widthPx;
      setResult({
        savedKB, targetKB: kb, origKB, pages: activeIdx.length, kept, exactAll,
        format: isImage ? `${format.toUpperCase()} · ${PAPER_SIZES[paper].label}${sheet ? ` · ${dpi} DPI` : ''}` : 'PDF · A4',
        mode: kept ? 'Original — no recompression' : MODES[mode].label,
        hit: kb > 0 ? savedKB <= kb : true, width: avgW, band: kept ? { key: 'high', label: 'Original quality' } : clarityFor(avgW)
      });
      setLoadProgress(100);
    } catch (e) { alert('Save failed: ' + e.message); }
    finally { setIsLoading(false); setLoadProgress(0); setLoadMessage(''); }
  };

  const clearAll = () => { setImages([]); setEntries([]); setIncluded([]); setOrigKB(0); setPreviewUrl(null); setPreviewMeta(null); setResult(null); setMeasure(null); };
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
            onDragOver={e => { e.preventDefault(); setDropping(true); }} onDragLeave={() => setDropping(false)}
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
          {!isImage && (
            <button className={'mode-card' + (mode === 'keep_text' ? ' on' : '')} onClick={() => setMode('keep_text')}>
              <span className="mode-ico">🧠</span>
              <span className="mode-text"><span className="mode-label">Smart · keep text, shrink pictures</span>
              <span className="mode-hint">Text stays perfect vector · only photos are re-compressed</span></span>
              {mode === 'keep_text' && <span className="mode-dot" />}
            </button>)}
          {Object.entries(MODES).map(([key, m]) => (
            <button key={key} className={'mode-card' + (mode === key ? ' on' : '')} onClick={() => setMode(key)}>
              <span className="mode-ico">{m.icon}</span>
              <span className="mode-text"><span className="mode-label">{m.label}</span><span className="mode-hint">{m.hint}</span></span>
              {mode === key && <span className="mode-dot" />}
            </button>))}
        </div>

        <div className="passport-settings" style={{ marginTop: 12 }}>
          <div className="workflow-card settings-card"><div className="card-content"><span className="icon">💾</span>
            <select value={format} onChange={e => { setFormat(e.target.value); setResult(null); }} className="neon-select">
              <option value="pdf">PDF · A4 document</option><option value="jpg">JPG / JPEG image</option><option value="png">PNG image</option>
            </select></div><div className="check-icon">✓</div></div>

          <div className="workflow-card settings-card"><div className="card-content" style={{ gap: 8 }}>
            <span className="icon">🎯</span>
            <input type="number" min="1" placeholder={isImage ? 'Size per image' : 'Total size'} value={sizeInput} onChange={e => setSizeInput(e.target.value)} className="target-input" />
            <select value={unit} onChange={e => setUnit(e.target.value)} className="target-unit"><option>KB</option><option>MB</option></select>
          </div><div className="check-icon">✓</div></div>

          <label className="workflow-card settings-card"><div className="card-content"><span className="icon">⬛</span><span className="label">Grayscale</span></div>
            <input type="checkbox" checked={gray} onChange={e => setGray(e.target.checked)} style={{ width: 22, height: 22 }} /></label>
        </div>

        {!isImage ? (
          <div className="pdf-auto">
            <span className="pdf-auto-shape" />
            <div className="pdf-auto-text">
              <b>A4 · 210 × 297 mm</b>
              <span>PDF output is always A4. Every page is centred and scaled to the sheet automatically — no size option needed.</span>
            </div>
            <span className="pdf-auto-tag">AUTO</span>
          </div>
        ) : (
          <div className="paper-block">
            <div className="paper-head">
              <span className="paper-title">📐 Sheet size for {format.toUpperCase()}</span>
              <span className="paper-dims">{sheet ? `${sheet.w} × ${sheet.h} px` : 'original pixels'}</span>
            </div>
            <div className="paper-grid">
              {Object.entries(PAPER_SIZES).map(([k, p]) => {
                const px = paperPixels(k, dpi);
                return (
                  <button key={k} className={'paper-card' + (paper === k ? ' on' : '')} onClick={() => setPaper(k)}>
                    <span className={'paper-shape' + (k === 'default' ? ' dashed' : '')} style={{ aspectRatio: p.w ? `${p.w} / ${p.h}` : '3 / 4' }} />
                    <span className="paper-name">{p.label}</span>
                    <span className="paper-sub">{p.sub}</span>
                    <span className="paper-px">{px ? `${px.w}×${px.h}` : p.note}</span>
                  </button>);
              })}
            </div>
            <div className="paper-controls">
              <label className="pc-field"><span>Resolution</span>
                <select value={dpi} onChange={e => setDpi(parseInt(e.target.value, 10))} disabled={paper === 'default'}>
                  {DPI_OPTIONS.map(d => <option key={d} value={d}>{d} DPI</option>)}
                </select></label>
              <label className="pc-field"><span>Placement</span>
                <select value={fit} onChange={e => setFit(e.target.value)} disabled={paper === 'default'}>
                  {Object.entries(FIT_MODES).map(([k, f]) => <option key={k} value={k}>{f.label}</option>)}
                </select></label>
            </div>
            <div className="paper-note">{paper === 'default' ? 'Keeps each image at its uploaded pixel size.' : `${FIT_MODES[fit].hint}. Exact ${sheet ? sheet.w + '×' + sheet.h : ''} px is held whenever the size target allows.`}</div>
          </div>
        )}

        {activeIdx.length > 0 && (
          <div className={'budget-card ' + band.key}>
            <div className="budget-top">
              <span className="budget-math">
                {isImage
                  ? <>{targetKB() > 0 ? `${targetKB()} KB` : 'no limit'} per image · {activeIdx.length} file{activeIdx.length > 1 ? 's' : ''}</>
                  : <>{targetKB() > 0 ? `${targetKB()} KB` : `${origKB} KB`} ÷ {activeIdx.length} pages = <b>{perPage.toFixed(1)} KB / page</b></>}
              </span>
              <span className={'quality-badge ' + band.key}>{band.label}</span>
            </div>
            <div className="budget-track"><div className="budget-fill" style={{ width: gaugePct + '%' }} /><span className="budget-marker" style={{ left: '73%' }} /></div>
            <div className="budget-scale"><span>150 px</span><span>readable ≈ 950 px</span><span>1300 px</span></div>
            {!isImage && info && (
              <div className="budget-note" style={{ marginBottom: 6 }}>
                Your PDF: <b>{Math.round(info.shellBytes / 1024)} KB</b> text/layout + <b>{Math.round(info.imageBytes / 1024)} KB</b> pictures ({info.imageCount}).
                {mode === 'keep_text' ? ' Smart mode keeps the text untouched and shrinks only the pictures.' : ''}
              </div>)}
            <div className="budget-note">
              {passthrough
                ? <span>Target covers the original — the PDF is copied <b>untouched</b>.</span>
                : <span>{measuring ? 'Measuring a sample…' : <>Measured <b>{widthPx} px</b>{measure && measure.ph ? ` × ${measure.ph} px` : ''} at <b>{measure ? Math.round(measure.kb) : 0} KB</b>{measure && measure.framed ? (measure.exact ? ' · exact sheet size held' : ' · scaled down to meet target') : ''}</>} — {band.note}</span>}
            </div>
            {!isImage && mode !== 'keep_text' && !passthrough && !measuring && widthPx > 0 && widthPx < 950 && (
              <div className="budget-warn">
                <span>Readable table text needs ≈ <b>{minKB} KB</b> for {activeIdx.length} pages.</span>
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
                {previewMeta.kept ? <span>Original bytes</span> : <>
                  <span>{previewMeta.kb} KB</span>
                  <span>{previewMeta.px} × {previewMeta.ph} px</span>
                  <span>quality {previewMeta.q}%</span>
                  {previewMeta.framed && <span className={previewMeta.exact ? 'pm-band ok' : 'pm-band low'}>{previewMeta.exact ? 'exact sheet' : 'scaled to fit'}</span>}
                  <span className={'pm-band ' + previewMeta.band.key}>{previewMeta.band.label}</span>
                </>}
              </div>)}
            <div className="preview-note">These exact bytes are written to the file — preview and save share one encoder.</div>
          </div>
        )}

        <button className="print-btn ghost" onClick={handlePreview} disabled={!activeIdx.length}>👁️ Preview First {isImage ? 'Image' : 'Page'}</button>

        {result && (
          <div className={'result-card' + (result.hit ? ' hit' : ' miss')}>
            <div className="result-row"><span className="result-big">{result.savedKB} KB</span>
              <span className="result-sub">from {result.origKB} KB · {savedPct}% of original</span></div>
            <div className="result-track"><div className="result-fill" style={{ width: savedPct + '%' }} /></div>
            <div className="result-foot">
              <span>{result.targetKB ? (result.hit ? `✓ Target ${result.targetKB} KB met` : `Above ${result.targetKB} KB target`) : 'No target set'}</span>
              <span>{result.format}</span>
            </div>
            <div className="result-foot second">
              <span>{result.pages} {isImage ? 'image' : 'page'}{result.pages > 1 ? 's' : ''} · {result.mode}</span>
              <span>{result.kept ? result.band.label : `${result.width} px · ${result.band.label}`}</span>
            </div>
            {isImage && paper !== 'default' && !result.exactAll && (
              <div className="result-warn">Some images were scaled below {sheet ? `${sheet.w}×${sheet.h}` : 'the sheet'} to meet the size target. Raise the target or pick <b>Less compress</b> to hold exact {dpi} DPI pixels.</div>)}
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
