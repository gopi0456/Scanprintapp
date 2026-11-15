import { useState, useEffect, useRef } from 'react';
import { renderPdfToImages } from '../utils/imageUtils.js';
import {
  compressImageToTarget, compressPdfToTarget, compressPdfSmart, compressPageToTarget, allocateBudgets,
  convertToPng, convertToJpg, dataUrlToBlob, shareBlob, estimatePageKB, dataUrlKB, renderPageCanvas, FLOOR_DOC, FLOOR_PHOTO, FLOOR_MIXED
} from '../utils/compressEngine.js';

const PITCH = 72;

export default function CompressSavePanel({ setIsLoading, setLoadProgress, setLoadMessage }) {
  const [images, setImages] = useState([]);
  const [meta, setMeta] = useState([]);
  const [included, setIncluded] = useState([]);
  const [sources, setSources] = useState([]);
  const [reordered, setReordered] = useState(false);
  const [format, setFormat] = useState('pdf');
  const [sizeInput, setSizeInput] = useState('');
  const [unit, setUnit] = useState('KB');
  const [readable, setReadable] = useState(true);
  const [gray, setGray] = useState(false);
  const [ultra, setUltra] = useState(false);
  const [allowRaster, setAllowRaster] = useState(false);
  const [lockClarity, setLockClarity] = useState(true);
  const [lastSize, setLastSize] = useState(null);
  const [recommended, setRecommended] = useState(0);
  const [beforeKB, setBeforeKB] = useState(0);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [previewZoom, setPreviewZoom] = useState(1);
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

  useEffect(() => {
    setBeforeKB(sources.reduce((s, x) => x.isPdf ? s + Math.round(x.bytes.byteLength / 1024) : s + dataUrlKB(images[x.start]), 0));
  }, [images, included, sources]);

  useEffect(() => {
    if (!active.length) { setRecommended(0); return; }
    let on = true;
    (async () => {
      let sum = 0;
      for (const i of activeIdx) {
        const m = meta[i];
        sum += (m && m.kind === 'vector' && !gray && !ultra) ? Math.max(2, Math.round((beforeKB / Math.max(1, images.length)) * 0.7)) : await estimatePageKB(images[i], ultra);
      }
      if (on) setRecommended(sum);
    })();
    return () => { on = false; };
  }, [images, included, meta, ultra, gray, beforeKB]);

  useEffect(() => () => { if (drag.current.raf) cancelAnimationFrame(drag.current.raf); }, []);

  const syncScroll = () => { const s = stripRef.current; if (!s) return; setScrollPos(s.scrollLeft); setScrollMax(Math.max(0, s.scrollWidth - s.clientWidth)); };
  useEffect(() => { syncScroll(); }, [images, included, previewUrl]);

  const addSources = (entries) => {
    const baseSrc = sources.length;
    const next = [...sources];
    let cursor = images.length;
    entries.forEach((en, k) => { next.push({ isPdf: en.isPdf, bytes: en.bytes || null, start: cursor, count: en.urls.length }); cursor += en.urls.length; en.srcIdx = baseSrc + k; });
    setSources(next);
    const urls = entries.flatMap(e => e.urls);
    const mt = entries.flatMap(e => e.metaArr);
    setImages(p => [...p, ...urls]);
    setMeta(p => [...p, ...mt]);
    setIncluded(p => [...p, ...urls.map(() => true)]);
  };

  const uploadFiles = async (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    setIsLoading(true); setLoadProgress(0);
    const entries = [];
    try {
      for (let f = 0; f < files.length; f++) {
        const file = files[f];
        setLoadMessage(`Reading ${f + 1}/${files.length}: ${file.name}`);
        if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
          const buf = await file.arrayBuffer();
          const urls = await renderPdfToImages(file, p => setLoadProgress(Math.round(((f + p / 100) / files.length) * 70)));
          const pdfjs = await import('pdfjs-dist');
          const doc = await pdfjs.getDocument({ data: buf.slice(0) }).promise;
          const metaArr = [];
          for (let pn = 1; pn <= doc.numPages; pn++) {
            const page = await doc.getPage(pn);
            const tc = await page.getTextContent();
            const chars = tc.items.reduce((s, it) => s + ((it.str || '').length), 0);
            const vp1 = page.getViewport({ scale: 1 });
            metaArr.push(chars > 80 ? { kind: 'vector', pageIdx: pn - 1, w: vp1.width, h: vp1.height } : { kind: 'scan', pageIdx: pn - 1, w: vp1.width, h: vp1.height });
          }
          if (urls.length) entries.push({ isPdf: true, bytes: buf, urls, metaArr });
        } else if (file.type.startsWith('image/')) {
          const url = await new Promise(res => { const r = new FileReader(); r.onloadend = () => res(r.result); r.readAsDataURL(file); });
          entries.push({ isPdf: false, bytes: null, urls: [url], metaArr: [{ kind: 'img' }] });
        }
      }
      if (entries.length) addSources(entries);
    } catch (err) { alert('Failed: ' + err.message); }
    finally { setIsLoading(false); setLoadProgress(0); setLoadMessage(''); }
    e.target.value = null;
  };
  const takePhoto = async () => { try { const { Camera, CameraResultType } = await import('@capacitor/camera'); const im = await Camera.getPhoto({ quality: 100, allowEditing: false, resultType: CameraResultType.DataUrl }); addSources([{ isPdf: false, bytes: null, urls: [im.dataUrl], metaArr: [{ kind: 'img' }] }]); } catch (e) { alert('Camera requires a physical device.'); } };
  const scanDocument = async () => { try { const { DocumentScanner } = await import('@capgo/capacitor-document-scanner'); const r = await DocumentScanner.scanDocument({ responseType: 'base64' }); if (r.scannedImages?.length) addSources([{ isPdf: false, bytes: null, urls: [`data:image/jpeg;base64,${r.scannedImages[0]}`], metaArr: [{ kind: 'img' }] }]); } catch (e) { alert('Scanning requires a mobile device.'); } };

  const reorder = (from, to) => {
    setImages(a => { const n = [...a]; const [m] = n.splice(from, 1); n.splice(to, 0, m); return n; });
    setIncluded(a => { const n = [...a]; const [m] = n.splice(from, 1); n.splice(to, 0, m); return n; });
    setMeta(a => { const n = [...a]; const [m] = n.splice(from, 1); n.splice(to, 0, m); return n; });
    setReordered(true);
  };
  const overAt = (clientX) => {
    const d = drag.current, s = stripRef.current;
    if (!s || d.idx == null) return;
    const r = s.getBoundingClientRect();
    const t = Math.max(0, Math.min(images.length - 1, Math.floor((clientX - r.left + s.scrollLeft) / PITCH)));
    if (t !== d.idx) { reorder(d.idx, t); d.idx = t; }
  };
  const startAuto = () => {
    const step = () => {
      const d = drag.current, s = stripRef.current;
      if (s && d.active) {
        const r = s.getBoundingClientRect();
        if (d.lx < r.left + 64) s.scrollLeft -= 18;
        else if (d.lx > r.right - 64) s.scrollLeft += 18;
        overAt(d.lx);
      }
      d.raf = requestAnimationFrame(step);
    };
    drag.current.raf = requestAnimationFrame(step);
  };
  const stopAuto = () => { if (drag.current.raf) cancelAnimationFrame(drag.current.raf); drag.current.raf = null; };
  const onDown = (i) => (e) => {
    const d = drag.current;
    d.idx = i; d.active = false; d.sx = e.clientX; d.sy = e.clientY; d.lx = e.clientX; d.suppress = false;
    if (stripRef.current && stripRef.current.setPointerCapture) stripRef.current.setPointerCapture(e.pointerId);
    setDragIdx(i);
  };
  const onMove = (e) => {
    const d = drag.current; if (d.idx == null) return;
    d.lx = e.clientX;
    if (!d.active && Math.hypot(e.clientX - d.sx, e.clientY - d.sy) > 10) { d.active = true; startAuto(); }
    if (d.active) overAt(e.clientX);
  };
  const onUp = () => { const d = drag.current; if (d.active) { d.suppress = true; stopAuto(); } d.idx = null; d.active = false; setDragIdx(null); };
  const onClick = (i) => () => { const d = drag.current; if (d.suppress) { d.suppress = false; return; } setIncluded(p => p.map((v, k) => k === i ? !v : v)); };

  const buildEntries = () => activeIdx.map(i => {
    const m = meta[i];
    const src = m && m.srcIdx != null ? sources[m.srcIdx] : null;
    const dims = { w: m && m.w, h: m && m.h };
    if (m && m.kind === 'vector' && src && src.bytes && !gray) return { kind: 'vector', bytes: src.bytes, pageIdx: m.pageIdx, dataUrl: images[i], ...dims };
    return { kind: 'image', dataUrl: images[i], ...dims };
  });

  const handlePreview = async () => {
    if (!active.length) return alert('Select at least one page.');
    setIsLoading(true); setLoadProgress(0); setLoadMessage('Generating true-quality preview...');
    try {
      const first = activeIdx[0];
      const m = meta[first];
      if (m && m.kind === 'vector' && !gray) {
        setPreviewUrl(images[first]);
        setPreviewNote('Vector text page — saved losslessly, stays perfectly sharp.');
      } else {
        const kb = targetKBv();
        const raster = buildEntries().filter(en => en.kind === 'image').map(en => en.dataUrl);
        const budgets = await allocateBudgets(raster.length ? raster : active, kb > 0 ? kb : 200);
        let override = null;
        const mSrc = m && m.srcIdx != null ? sources[m.srcIdx] : null;
        if (m && m.kind === 'scan' && mSrc && mSrc.bytes) { try { override = await renderPageCanvas(mSrc.bytes, m.pageIdx, 3); } catch (err) { override = null; } }
        const r = await compressPageToTarget(images[first], budgets[0] || 200, { readable, gray, ultra, allowRaster, lock: lockClarity }, override);
        setPreviewUrl(r.url);
        setPreviewNote('Scanned/image page at its exact smart budget.');
      }
      setLoadProgress(100);
    } catch (e) { alert('Preview failed: ' + e.message); }
    finally { setIsLoading(false); setLoadProgress(0); setLoadMessage(''); }
  };

  const handleSave = async () => {
    if (!active.length) return alert('Select at least one page.');
    const kb = targetKBv();
    const opts = { readable, gray, ultra, allowRaster, lock: lockClarity };
    setIsLoading(true); setLoadProgress(0); setLoadMessage('Analysing all pages...');
    try {
      let blob; let total = 0; let vectorKept = false;
      if (format === 'pdf') {
        const entries = buildEntries();
        const allVector = entries.length > 0 && entries.every(en => en.kind === 'vector');
        if (allVector && !gray && !ultra) {
          blob = await pdfMergeLossless(sources.map(s => ({ bytes: s.bytes, indices: included.slice(s.start, s.start + s.count).map((v, i) => v ? i : -1).filter(i => i >= 0) })));
          vectorKept = true;
        } else if (hasPdfSrc) {
          blob = await compressPdfSmart(entries, kb > 0 ? kb : Infinity, p => setLoadProgress(p), opts);
        } else {
          blob = await compressPdfToTarget(active, kb > 0 ? kb : Infinity, p => setLoadProgress(p), opts, null, undefined);
        }
        total = (blob && (blob.size || blob.byteLength)) || 0;
        await shareBlob(blob, `scanprint-${Date.now()}.pdf`);
      } else {
        const mime = format === 'png' ? 'image/png' : 'image/jpeg';
        for (let i = 0; i < active.length; i++) {
          setLoadMessage(`Compressing ${i + 1}/${active.length}...`);
          let url = active[i];
          if (kb > 0) url = await compressImageToTarget(url, kb, mime, p => setLoadProgress(Math.round(((i + p / 100) / active.length) * 100)), opts);
          else url = mime === 'image/png' ? await convertToPng(url) : await convertToJpg(url, 0.92);
          const ext = mime === 'image/png' ? 'png' : 'jpg';
          const b = await dataUrlToBlob(url, `scanprint-${i + 1}.${ext}`);
          total += b.size;
          await shareBlob(b, b.name);
        }
      }
      const savedKB = Math.round((total || 0) / 1024);
      setLastSize(savedKB);
      const red = beforeKB > 0 && savedKB > 0 ? Math.max(0, Math.round((1 - savedKB / beforeKB) * 100)) : 0;
      try { await handlePreview(); } catch (err) {}
      alert(`Saved ${savedKB} KB` + (beforeKB ? `  (was ${beforeKB} KB, −${red}%)` : '') + (kb ? `  • target ${kb} KB` : '') + (kb && savedKB > kb ? '  • vector text kept lossless (cannot shrink further without quality loss)' : ''));
    } catch (e) { alert('Save failed: ' + e.message); }
    finally { setIsLoading(false); setLoadProgress(0); setLoadMessage(''); }
  };

  const tooSmall = targetKBv() > 0 && recommended > 0 && targetKBv() < recommended;
  const vectorCount = activeIdx.filter(i => meta[i] && meta[i].kind === 'vector').length;

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
          <div className="count-bar">
            <span className="count-chip">📄 {active.length}/{images.length} • was ≈ {beforeKB} KB{vectorCount ? ` • ${vectorCount} vector (lossless)` : ''}</span>
            <button className="clear-btn" onClick={() => { setImages([]); setMeta([]); setIncluded([]); setSources([]); setReordered(false); setLastSize(null); setPreviewUrl(null); }}>Clear All</button>
          </div>
          <div className="thumb-strip" ref={stripRef} onScroll={syncScroll} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
            {images.map((img, i) => (
              <button key={i} data-idx={i} className={'thumb' + (included[i] ? '' : ' off') + (dragIdx === i ? ' dragging' : '')}
                onPointerDown={onDown(i)} onClick={onClick(i)}>
                <img src={img} alt={'p' + (i + 1)} draggable={false} />
                <span className="thumb-mark">{included[i] ? '✓' : '✕'}</span>
                <span className="thumb-num">{i + 1}</span>
                {meta[i] && meta[i].kind === 'vector' && <span className="thumb-tag">TXT</span>}
              </button>))}
          </div>
          {scrollMax > 0 && (
            <div className="strip-scroll-wrap">
              <input type="range" className="strip-scroll" min={0} max={scrollMax} value={scrollPos}
                onChange={(e) => { const v = parseInt(e.target.value, 10) || 0; if (stripRef.current) stripRef.current.scrollLeft = v; setScrollPos(v); }} />
            </div>
          )}
          <div className="thumb-hint">Tap = include/exclude • drag = reorder (edges auto-scroll) • slider = manual scroll. TXT pages stay vector-sharp.</div>
        </>)}

        <div className="passport-settings" style={{ marginTop: 0 }}>
          <div className="workflow-card settings-card"><div className="card-content"><span className="icon">💾</span>
            <select value={format} onChange={e => setFormat(e.target.value)} className="neon-select">
              <option value="pdf">PDF (combine selected)</option><option value="jpg">JPG / JPEG</option><option value="png">PNG</option>
            </select></div><div className="check-icon">✓</div></div>

          <div className="workflow-card settings-card">
            <div className="card-content" style={{ flexDirection: 'column', alignItems: 'stretch', gap: '8px' }}>
              <div className="target-row">
                <span className="icon">🎯</span>
                <input type="number" min="1" placeholder="Target size" value={sizeInput} onChange={e => setSizeInput(e.target.value)} className="target-input" />
                <select value={unit} onChange={e => setUnit(e.target.value)} className="target-unit"><option>KB</option><option>MB</option></select>
              </div>
              {recommended > 0 && (
                <div className={'target-meta' + (tooSmall ? ' warn' : '')}>
                  <span>Readable min ≈ <b>{recommended} KB</b> ({FLOOR_DOC} scan-text / {FLOOR_MIXED} mixed / {FLOOR_PHOTO} photo; vector ≈ 2).</span>
                  <button className="auto-btn" onClick={() => { setUnit('KB'); setSizeInput(String(recommended)); }}>Use it</button>
                </div>
              )}
              {ultra && recommended > 0 && (
                <div className="target-meta">
                  <span>Ultra min ≈ <b>{Math.round(recommended * 0.55)} KB</b> (some quality loss).</span>
                  <button className="auto-btn" onClick={() => { setUnit('KB'); setSizeInput(String(Math.round(recommended * 0.55))); }}>Use ultra</button>
                </div>
              )}
              {tooSmall && <span className="target-warn">Below readable minimum, scanned pages will degrade for {active.length} page(s).</span>}
            </div>
          </div>

          <label className="workflow-card settings-card"><div className="card-content"><span className="icon">🔤</span><span className="label">Boost text contrast</span></div>
            <input type="checkbox" checked={readable} onChange={e => setReadable(e.target.checked)} style={{ width: 22, height: 22 }} /></label>
          <label className="workflow-card settings-card"><div className="card-content"><span className="icon">⬛</span><span className="label">Grayscale (ALL pages)</span></div>
            <input type="checkbox" checked={gray} onChange={e => setGray(e.target.checked)} style={{ width: 22, height: 22 }} /></label>
          <label className="workflow-card settings-card"><div className="card-content"><span className="icon">🌫️</span><span className="label">Ultra small (below readable min)</span></div>
            <input type="checkbox" checked={ultra} onChange={e => setUltra(e.target.checked)} style={{ width: 22, height: 22 }} /></label>
          <label className="workflow-card settings-card"><div className="card-content" style={{ flexDirection: 'column', alignItems: 'stretch', gap: '4px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}><span className="icon">🔒</span><span className="label">Lock clarity (full-res; size may exceed target)</span>
              <input type="checkbox" checked={lockClarity} onChange={e => setLockClarity(e.target.checked)} style={{ width: 22, height: 22, marginLeft: 'auto' }} /></div>
            <span className="range-hint">ON = every page stays sharp & aligned; we report the real size. OFF = force the exact target (may blur).</span>
          </div></label>
          <label className="workflow-card settings-card"><div className="card-content" style={{ flexDirection: 'column', alignItems: 'stretch', gap: '4px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}><span className="icon">🔁</span><span className="label">Allow text→image conversion to hit target</span>
              <input type="checkbox" checked={allowRaster} onChange={e => setAllowRaster(e.target.checked)} style={{ width: 22, height: 22, marginLeft: 'auto' }} /></div>
            <span className="range-hint">OFF = fonts & alignment stay 100% original (size may exceed target). ON = pages may become images to reach the size.</span>
          </div></label>
        </div>

        {previewUrl && (
          <div className="preview-card" style={{ marginTop: '12px' }}>
            <div className="preview-head"><span>👁️ Preview (page 1)</span>
              <button className="clear-btn" onClick={() => setPreviewUrl(null)}>Close</button></div>
            <div className="preview-stage zoomable" style={{ maxHeight: '340px' }}>
              <div className="zoom-wrap" style={{ width: (previewZoom * 100) + '%' }}>
                <img src={previewUrl} alt="Compressed preview" style={{ width: '100%', display: 'block' }} />
              </div>
            </div>
            <div className="zoom-bar">
              <button className="em-step" onClick={() => setPreviewZoom(z => Math.max(1, Math.round((z - 0.5) * 100) / 100))}>−</button>
              <input type="range" min="1" max="5" step="0.25" value={previewZoom} onChange={(e) => setPreviewZoom(parseFloat(e.target.value))} />
              <button className="em-step" onClick={() => setPreviewZoom(z => Math.min(5, Math.round((z + 0.5) * 100) / 100))}>+</button>
              <button className="em-step" onClick={() => setPreviewZoom(1)}>1×</button>
              <span className="adj-val">{previewZoom}×</span>
            </div>
            <div className="preview-note">{previewNote || 'Exactly what page 1 will look like in the saved file.'}</div>
          </div>
        )}

        <button className="print-btn" onClick={handlePreview} disabled={active.length === 0}
          style={{ marginBottom: '12px', background: 'rgba(16,185,129,0.12)', color: '#047857' }}>
          👁️ Preview First Page
        </button>

        {lastSize != null && (
          <div className="count-bar"><span className="count-chip">✅ Saved {lastSize} KB{beforeKB ? ` (was ${beforeKB} KB, −${Math.max(0, Math.round((1 - lastSize / beforeKB) * 100))}%)` : ''}</span></div>
        )}

        <button className={'print-btn save' + (active.length > 0 ? ' active' : '')} onClick={handleSave} disabled={active.length === 0}>
          💾 Compress & Save {targetKBv() > 0 ? `(≤ ${targetKBv()} KB)` : ''}
        </button>
        <div className="swipe-hint">← Swipe to change section →</div>
      </div></div>
    </div>
  );
}
