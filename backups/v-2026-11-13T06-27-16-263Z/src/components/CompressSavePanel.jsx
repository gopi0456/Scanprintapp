import { useState, useEffect, useRef } from 'react';
import { renderPdfToImages } from '../utils/imageUtils.js';
import {
  compressImageToTarget, compressPdfToTarget, compressPageToTarget, pdfMergeLossless,
  convertToPng, convertToJpg, dataUrlToBlob, shareBlob, estimatePageKB, dataUrlKB,
  FLOOR_DOC, FLOOR_PHOTO
} from '../utils/compressEngine.js';

const moveItem = (arr, from, to) => {
  const c = arr.slice();
  const [x] = c.splice(from, 1);
  c.splice(to, 0, x);
  return c;
};

export default function CompressSavePanel({ setIsLoading, setLoadProgress, setLoadMessage }) {
  const [images, setImages] = useState([]);
  const [included, setIncluded] = useState([]);
  const [pageRefs, setPageRefs] = useState([]);   // {src,page} for pdf pages, null for photos
  const [pdfBytes, setPdfBytes] = useState([]);  // original bytes per uploaded pdf
  const [format, setFormat] = useState('pdf');
  const [sizeInput, setSizeInput] = useState('');
  const [unit, setUnit] = useState('KB');
  const [readable, setReadable] = useState(true);
  const [gray, setGray] = useState(false);
  const [lastSize, setLastSize] = useState(null);
  const [recommended, setRecommended] = useState(0);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [dragIdx, setDragIdx] = useState(null);

  const stripRef = useRef(null);
  const dragRef = useRef(null);

  const active = images.filter((_, i) => included[i]);
  const activeIdx = images.reduce((a, v, i) => (included[i] ? [...a, i] : a), []);
  const targetKB = () => { const v = parseFloat(sizeInput); if (!v || v <= 0) return 0; return unit === 'MB' ? Math.round(v * 1024) : Math.round(v); };

  const originalKB = pdfBytes.reduce((s, b) => s + b.byteLength, 0) / 1024
    + images.reduce((s, u, i) => (pageRefs[i] ? s : s + dataUrlKB(u)), 0);

  useEffect(() => {
    if (active.length === 0) { setRecommended(0); return; }
    let on = true;
    (async () => { let sum = 0; for (const im of active) sum += await estimatePageKB(im); if (on) setRecommended(sum); })();
    return () => { on = false; };
  }, [images, included]);

  const appendImages = (urls, refs) => {
    setImages(p => [...p, ...urls]);
    setIncluded(p => [...p, ...urls.map(() => true)]);
    setPageRefs(p => [...p, ...refs]);
  };

  const takePhoto = async () => { try { const { Camera, CameraResultType } = await import('@capacitor/camera'); const im = await Camera.getPhoto({ quality: 100, allowEditing: false, resultType: CameraResultType.DataUrl }); appendImages([im.dataUrl], [null]); } catch (e) { alert('Camera requires a physical device.'); } };
  const scanDocument = async () => { try { const { DocumentScanner } = await import('@capgo/capacitor-document-scanner'); const r = await DocumentScanner.scanDocument({ responseType: 'base64' }); if (r.scannedImages?.length) appendImages([`data:image/jpeg;base64,${r.scannedImages[0]}`], [null]); } catch (e) { alert('Scanning requires a mobile device.'); } };

  const uploadFile = async (e) => {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    setIsLoading(true); setLoadProgress(0); setLoadMessage('Reading (originals kept)...');
    try {
      for (const file of files) {
        if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
          const buf = await file.arrayBuffer();
          const srcIdx = pdfBytes.length;
          setPdfBytes(p => [...p, buf]);
          const urls = await renderPdfToImages(file, p => setLoadProgress(p));
          if (urls.length) appendImages(urls, urls.map((_, i) => ({ src: srcIdx, page: i })));
        } else if (file.type.startsWith('image/')) {
          const dataUrl = await new Promise(res => { const r = new FileReader(); r.onloadend = () => res(r.result); r.readAsDataURL(file); });
          appendImages([dataUrl], [null]);
        }
      }
    } catch (err) { alert('Failed: ' + err.message); }
    finally { setIsLoading(false); setLoadProgress(0); setLoadMessage(''); }
    e.target.value = null;
  };

  // ---- drag to reorder (long-press then drag left/right) ----
  const onDown = (i) => (e) => {
    dragRef.current = { i, t: Date.now(), x: e.clientX, y: e.clientY, moved: false, el: e.currentTarget, active: false };
    dragRef.current.timer = setTimeout(() => {
      if (dragRef.current && !dragRef.current.moved) {
        dragRef.current.active = true;
        dragRef.current.el.setPointerCapture(e.pointerId);
        setDragIdx(i);
        if (navigator.vibrate) navigator.vibrate(20);
      }
    }, 260);
  };
  const onMove = (e) => {
    const d = dragRef.current; if (!d) return;
    if (!d.active) {
      if (Math.abs(e.clientX - d.x) > 8 || Math.abs(e.clientY - d.y) > 8) { d.moved = true; clearTimeout(d.timer); }
      return;
    }
    const el = document.elementFromPoint(e.clientX, e.clientY);
    const thumb = el && el.closest ? el.closest('.thumb') : null;
    if (thumb && thumb.dataset.idx != null) {
      const to = parseInt(thumb.dataset.idx, 10);
      if (to !== d.i) {
        setImages(p => moveItem(p, d.i, to));
        setIncluded(p => moveItem(p, d.i, to));
        setPageRefs(p => moveItem(p, d.i, to));
        d.i = to;
        setDragIdx(to);
      }
    }
  };
  const onUp = (i) => () => {
    const d = dragRef.current;
    if (d) clearTimeout(d.timer);
    if (d && d.active) { setDragIdx(null); }
    else if (d && !d.moved) { setIncluded(p => p.map((v, k) => k === i ? !v : v)); }
    dragRef.current = null;
  };

  const handlePreview = async () => {
    if (active.length === 0) return alert('Select at least one page.');
    setIsLoading(true); setLoadProgress(0); setLoadMessage('Generating preview...');
    try {
      const kb = targetKB();
      const per = kb > 0 ? Math.max(1, Math.floor((kb * 0.94) / Math.max(1, active.length))) : 200;
      const r = await compressPageToTarget(active[0], per, { readable, gray });
      setPreviewUrl(r.url);
      setLoadProgress(100);
    } catch (e) { alert('Preview failed: ' + e.message); }
    finally { setIsLoading(false); setLoadProgress(0); setLoadMessage(''); }
  };

  const handleSave = async () => {
    if (active.length === 0) return alert('Select at least one page.');
    const kb = targetKB();
    const opts = { readable, gray };
    const selRefs = activeIdx.map(i => pageRefs[i]);
    const allPdf = selRefs.length > 0 && selRefs.every(r => r);
    setIsLoading(true); setLoadProgress(0); setLoadMessage('Compressing...');
    try {
      let blob; let total = 0;
      if (format === 'pdf') {
        if (kb > 0 && allPdf) {
          const merged = await pdfMergeLossless(pdfBytes, selRefs);
          blob = merged.size <= kb * 1024 ? merged : await compressPdfToTarget(active, kb, p => setLoadProgress(p), opts, null, []);
        } else if (kb > 0) {
          blob = await compressPdfToTarget(active, kb, p => setLoadProgress(p), opts, null, []);
        } else if (allPdf) {
          blob = await pdfMergeLossless(pdfBytes, selRefs);
        } else {
          blob = await compressPdfToTarget(active, Infinity, p => setLoadProgress(p), { readable: true }, null, []);
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
      const before = Math.round(originalKB);
      const red = before > 0 ? Math.max(0, Math.round((1 - savedKB / before) * 100)) : 0;
      alert(`Saved ${savedKB} KB` + (before ? `  (was ${before} KB, −${red}%)` : '') + (kb ? `  • target ${kb} KB` : ''));
    } catch (e) { alert('Save failed: ' + e.message); }
    finally { setIsLoading(false); setLoadProgress(0); setLoadMessage(''); }
  };

  const tooSmall = targetKB() > 0 && recommended > 0 && targetKB() < recommended;

  return (
    <div className="panel">
      <div className="glass-frame"><div className="logo-chip">💾</div><div className="main-card">
        <div className="header"><h2>Compress & Save</h2></div>
        <div className="workflow-cards">
          <div className="workflow-card" onClick={takePhoto}><div className="card-content"><span className="icon">📷</span><span className="label">Take Photo</span></div><div className="check-icon">✓</div></div>
          <div className="workflow-card" onClick={scanDocument}><div className="card-content"><span className="icon">✨</span><span className="label">Scan Document</span></div><div className="check-icon">✓</div></div>
          <label className="workflow-card"><div className="card-content"><span className="icon">📁</span><span className="label">Upload Photos or PDFs (multi)</span></div><div className="check-icon">✓</div>
            <input type="file" multiple accept="image/*,.pdf,application/pdf" style={{ display: 'none' }} onChange={uploadFile} /></label>
        </div>

        {images.length > 0 && (<>
          <div className="count-bar">
            <span className="count-chip">📄 {active.length}/{images.length} pages • {pdfBytes.length} PDF(s) • ≈{Math.round(originalKB)} KB</span>
            <button className="clear-btn" onClick={() => { setImages([]); setIncluded([]); setPageRefs([]); setPdfBytes([]); setLastSize(null); setPreviewUrl(null); }}>Clear All</button>
          </div>
          <div className="thumb-strip" ref={stripRef}>
            {images.map((img, i) => (
              <button key={i} data-idx={i}
                className={'thumb' + (included[i] ? '' : ' off') + (dragIdx === i ? ' dragging' : '')}
                onPointerDown={onDown(i)} onPointerMove={onMove} onPointerUp={onUp(i)} onPointerCancel={onUp(i)}>
                <img src={img} alt={'p' + (i + 1)} />
                <span className="thumb-mark">{included[i] ? '✓' : '✕'}</span>
                <span className="thumb-num">{i + 1}</span>
                {pageRefs[i] && <span className="thumb-src">PDF{pageRefs[i].src + 1}</span>}
              </button>
            ))}
          </div>
          <div className="thumb-hint">Tap = include/exclude • long-press & drag left/right = reorder pages across PDFs.</div>
        </>)}

        <div className="passport-settings" style={{ marginTop: 0 }}>
          <div className="workflow-card settings-card"><div className="card-content"><span className="icon">💾</span>
            <select value={format} onChange={e => setFormat(e.target.value)} className="neon-select">
              <option value="pdf">PDF (combine selected in order)</option><option value="jpg">JPG / JPEG</option><option value="png">PNG</option>
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
                  <span>Readable min ≈ <b>{recommended} KB</b> ({FLOOR_DOC} text / {FLOOR_PHOTO} photo per page).</span>
                  <button className="auto-btn" onClick={() => { setUnit('KB'); setSizeInput(String(recommended)); }}>Use it</button>
                </div>
              )}
              {tooSmall && <span className="target-warn">Below readable minimum the text will blur for {active.length} page(s).</span>}
            </div>
          </div>

          <label className="workflow-card settings-card"><div className="card-content"><span className="icon">🔤</span><span className="label">Boost text contrast</span></div>
            <input type="checkbox" checked={readable} onChange={e => setReadable(e.target.checked)} style={{ width: 22, height: 22 }} /></label>
          <label className="workflow-card settings-card"><div className="card-content"><span className="icon">⬛</span><span className="label">Grayscale (photos)</span></div>
            <input type="checkbox" checked={gray} onChange={e => setGray(e.target.checked)} style={{ width: 22, height: 22 }} /></label>
        </div>

        {previewUrl && (
          <div className="preview-card" style={{ marginTop: '12px' }}>
            <div className="preview-head"><span>👁️ Preview (page 1 compressed)</span>
              <button className="clear-btn" onClick={() => setPreviewUrl(null)}>Close</button></div>
            <div className="preview-stage" style={{ maxHeight: '300px' }}>
              <img src={previewUrl} alt="Compressed preview" style={{ maxWidth: '100%', maxHeight: '300px', objectFit: 'contain' }} />
            </div>
            <div className="preview-note">Text should appear crisp black & white.</div>
          </div>
        )}

        <button className="print-btn" onClick={handlePreview} disabled={active.length === 0}
          style={{ marginBottom: '12px', background: 'rgba(16,185,129,0.12)', color: '#047857', cursor: 'pointer' }}>
          👁️ Preview First Page
        </button>

        {lastSize != null && (
          <div className="count-bar"><span className="count-chip">✅ Saved {lastSize} KB (was ≈{Math.round(originalKB)} KB)</span></div>
        )}

        <button className={'print-btn save' + (active.length > 0 ? ' active' : '')} onClick={handleSave} disabled={active.length === 0}>
          💾 Compress & Save {targetKB() > 0 ? `(≤ ${targetKB()} KB)` : ''}
        </button>
        <div className="swipe-hint">← Swipe to change section →</div>
      </div></div>
    </div>
  );
}
