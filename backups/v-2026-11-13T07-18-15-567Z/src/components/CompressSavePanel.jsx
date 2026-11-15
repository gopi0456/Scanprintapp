import { useState, useEffect, useRef } from 'react';
import { renderPdfToImages } from '../utils/imageUtils.js';
import {
  compressImageToTarget, compressPdfToTarget, compressPageToTarget, allocateBudgets, pdfMergeLossless,
  convertToPng, convertToJpg, dataUrlToBlob, shareBlob, estimatePageKB, dataUrlKB, FLOOR_DOC, FLOOR_PHOTO, FLOOR_MIXED
} from '../utils/compressEngine.js';

const PITCH = 72;

export default function CompressSavePanel({ setIsLoading, setLoadProgress, setLoadMessage }) {
  const [images, setImages] = useState([]);
  const [included, setIncluded] = useState([]);
  const [sources, setSources] = useState([]);
  const [reordered, setReordered] = useState(false);
  const [format, setFormat] = useState('pdf');
  const [sizeInput, setSizeInput] = useState('');
  const [unit, setUnit] = useState('KB');
  const [readable, setReadable] = useState(true);
  const [gray, setGray] = useState(false);
  const [lastSize, setLastSize] = useState(null);
  const [recommended, setRecommended] = useState(0);
  const [beforeKB, setBeforeKB] = useState(0);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [dragIdx, setDragIdx] = useState(null);

  const stripRef = useRef(null);
  const drag = useRef({ idx: null, active: false, sx: 0, sy: 0, lx: 0, raf: null, suppress: false });

  const active = images.filter((_, i) => included[i]);
  const indices = included.reduce((a, v, i) => (v ? [...a, i] : a), []);
  const targetKBv = () => { const v = parseFloat(sizeInput); if (!v || v <= 0) return 0; return unit === 'MB' ? Math.round(v * 1024) : Math.round(v); };
  const canLossless = sources.length > 0 && !reordered && sources.every(s => s.isPdf);

  useEffect(() => {
    setBeforeKB(sources.reduce((s, x) => x.isPdf ? s + Math.round(x.bytes.byteLength / 1024) : s + dataUrlKB(images[x.start]), 0));
  }, [images, included, sources]);

  useEffect(() => {
    if (!active.length) { setRecommended(0); return; }
    let on = true;
    (async () => { let sum = 0; for (const u of active) sum += await estimatePageKB(u); if (on) setRecommended(sum); })();
    return () => { on = false; };
  }, [images, included]);

  useEffect(() => () => { if (drag.current.raf) cancelAnimationFrame(drag.current.raf); }, []);

  const addSources = (entries) => {
    let cursor = images.length;
    const next = [...sources];
    for (const en of entries) { next.push({ isPdf: en.isPdf, bytes: en.bytes || null, start: cursor, count: en.urls.length }); cursor += en.urls.length; }
    setSources(next);
    const urls = entries.flatMap(e => e.urls);
    setImages(p => [...p, ...urls]);
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
          const urls = await renderPdfToImages(file, p => setLoadProgress(Math.round(((f + p / 100) / files.length) * 100)));
          if (urls.length) entries.push({ isPdf: true, bytes: buf, urls });
        } else if (file.type.startsWith('image/')) {
          const url = await new Promise(res => { const r = new FileReader(); r.onloadend = () => res(r.result); r.readAsDataURL(file); });
          entries.push({ isPdf: false, bytes: null, urls: [url] });
        }
      }
      if (entries.length) addSources(entries);
    } catch (err) { alert('Failed: ' + err.message); }
    finally { setIsLoading(false); setLoadProgress(0); setLoadMessage(''); }
    e.target.value = null;
  };
  const takePhoto = async () => { try { const { Camera, CameraResultType } = await import('@capacitor/camera'); const im = await Camera.getPhoto({ quality: 100, allowEditing: false, resultType: CameraResultType.DataUrl }); addSources([{ isPdf: false, bytes: null, urls: [im.dataUrl] }]); } catch (e) { alert('Camera requires a physical device.'); } };
  const scanDocument = async () => { try { const { DocumentScanner } = await import('@capgo/capacitor-document-scanner'); const r = await DocumentScanner.scanDocument({ responseType: 'base64' }); if (r.scannedImages?.length) addSources([{ isPdf: false, bytes: null, urls: [`data:image/jpeg;base64,${r.scannedImages[0]}`] }]); } catch (e) { alert('Scanning requires a mobile device.'); } };

  const reorder = (from, to) => {
    setImages(a => { const n = [...a]; const [m] = n.splice(from, 1); n.splice(to, 0, m); return n; });
    setIncluded(a => { const n = [...a]; const [m] = n.splice(from, 1); n.splice(to, 0, m); return n; });
    setSources([]); setReordered(true);
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
  const onUp = () => {
    const d = drag.current;
    if (d.active) { d.suppress = true; stopAuto(); }
    d.idx = null; d.active = false;
    setDragIdx(null);
  };
  const onClick = (i) => () => {
    const d = drag.current;
    if (d.suppress) { d.suppress = false; return; }
    setIncluded(p => p.map((v, k) => k === i ? !v : v));
  };

  const handlePreview = async () => {
    if (!active.length) return alert('Select at least one page.');
    setIsLoading(true); setLoadProgress(0); setLoadMessage('Generating true-quality preview...');
    try {
      const kb = targetKBv();
      const budgets = await allocateBudgets(active, kb > 0 ? kb : 200);
      const r = await compressPageToTarget(active[0], budgets[0], { readable, gray });
      setPreviewUrl(r.url);
      setLoadProgress(100);
    } catch (e) { alert('Preview failed: ' + e.message); }
    finally { setIsLoading(false); setLoadProgress(0); setLoadMessage(''); }
  };

  const handleSave = async () => {
    if (!active.length) return alert('Select at least one page.');
    const kb = targetKBv();
    const opts = { readable, gray };
    setIsLoading(true); setLoadProgress(0); setLoadMessage('Analysing all pages...');
    try {
      let blob; let total = 0;
      if (format === 'pdf') {
        if (canLossless) {
          const merged = await pdfMergeLossless(sources.map(s => ({ bytes: s.bytes, indices: included.slice(s.start, s.start + s.count).map((v, i) => v ? i : -1).filter(i => i >= 0) })));
          setLoadProgress(50);
          if (!isFinite(kb) || merged.size <= kb * 1024) blob = merged;
          else blob = await compressPdfToTarget(active, kb, p => setLoadProgress(50 + Math.round(p * 0.5)), opts, null, undefined);
        } else {
          blob = await compressPdfToTarget(active, kb > 0 ? kb : Infinity, p => setLoadProgress(p), opts, null, undefined);
        }
        total = blob.size;
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
      const savedKB = Math.round(total / 1024);
      setLastSize(savedKB);
      const red = beforeKB > 0 ? Math.max(0, Math.round((1 - savedKB / beforeKB) * 100)) : 0;
      alert(`Saved ${savedKB} KB` + (beforeKB ? `  (was ${beforeKB} KB, −${red}%)` : '') + (kb ? `  • target ${kb} KB` : ''));
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
          <div className="count-bar">
            <span className="count-chip">📄 {active.length}/{images.length} • was ≈ {beforeKB} KB{canLossless ? ' • lossless ready' : ''}</span>
            <button className="clear-btn" onClick={() => { setImages([]); setIncluded([]); setSources([]); setReordered(false); setLastSize(null); setPreviewUrl(null); }}>Clear All</button>
          </div>
          <div className="thumb-strip" ref={stripRef} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
            {images.map((img, i) => (
              <button key={i} data-idx={i} className={'thumb' + (included[i] ? '' : ' off') + (dragIdx === i ? ' dragging' : '')}
                onPointerDown={onDown(i)} onClick={onClick(i)}>
                <img src={img} alt={'p' + (i + 1)} draggable={false} />
                <span className="thumb-mark">{included[i] ? '✓' : '✕'}</span>
                <span className="thumb-num">{i + 1}</span>
              </button>))}
          </div>
          <div className="thumb-hint">Tap = include/exclude • press & drag left/right = reorder (edges auto-scroll).</div>
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
                  <span>Readable min ≈ <b>{recommended} KB</b> ({FLOOR_DOC} text / {FLOOR_MIXED} mixed / {FLOOR_PHOTO} photo per page).</span>
                  <button className="auto-btn" onClick={() => { setUnit('KB'); setSizeInput(String(recommended)); }}>Use it</button>
                </div>
              )}
              {tooSmall && <span className="target-warn">Below readable minimum, images/text will degrade for {active.length} page(s).</span>}
            </div>
          </div>

          <label className="workflow-card settings-card"><div className="card-content"><span className="icon">🔤</span><span className="label">Boost text contrast</span></div>
            <input type="checkbox" checked={readable} onChange={e => setReadable(e.target.checked)} style={{ width: 22, height: 22 }} /></label>
          <label className="workflow-card settings-card"><div className="card-content"><span className="icon">⬛</span><span className="label">Grayscale (photos)</span></div>
            <input type="checkbox" checked={gray} onChange={e => setGray(e.target.checked)} style={{ width: 22, height: 22 }} /></label>
        </div>

        {previewUrl && (
          <div className="preview-card" style={{ marginTop: '12px' }}>
            <div className="preview-head"><span>👁️ Preview (page 1 at its smart budget)</span>
              <button className="clear-btn" onClick={() => setPreviewUrl(null)}>Close</button></div>
            <div className="preview-stage" style={{ maxHeight: '300px' }}>
              <img src={previewUrl} alt="Compressed preview" style={{ maxWidth: '100%', maxHeight: '300px', objectFit: 'contain' }} />
            </div>
            <div className="preview-note">Exactly what page 1 will look like in the saved file.</div>
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
