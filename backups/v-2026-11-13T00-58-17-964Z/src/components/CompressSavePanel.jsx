import { useState, useEffect } from 'react';
import { renderPdfToImages } from '../utils/imageUtils.js';
import {
  compressImageToTarget, compressPdfToTarget, convertToPng, convertToJpg,
  dataUrlToBlob, shareBlob, estimatePageKB, dataUrlKB, FLOOR_DOC, FLOOR_PHOTO
} from '../utils/compressEngine.js';

export default function CompressSavePanel({ setIsLoading, setLoadProgress, setLoadMessage }) {
  const [images, setImages] = useState([]);
  const [included, setIncluded] = useState([]);
  const [origPdf, setOrigPdf] = useState(null);
  const [origPdfKB, setOrigPdfKB] = useState(0);
  const [format, setFormat] = useState('pdf');
  const [sizeInput, setSizeInput] = useState('');
  const [unit, setUnit] = useState('KB');
  const [readable, setReadable] = useState(true);
  const [gray, setGray] = useState(false);
  const [lastSize, setLastSize] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [recommended, setRecommended] = useState(0);
  const [origTotal, setOrigTotal] = useState(0);

  const active = images.filter((_, i) => included[i]);
  const indices = included.reduce((a, v, i) => (v ? [...a, i] : a), []);
  const addImages = (urls, fromPdf) => { if (!fromPdf) { setOrigPdf(null); setOrigPdfKB(0); } setImages(p => [...p, ...urls]); setIncluded(p => [...p, ...urls.map(() => true)]); };
  const toggle = (i) => setIncluded(p => p.map((v, k) => k === i ? !v : v));
  const targetKB = () => { const v = parseFloat(sizeInput); if (!v || v <= 0) return 0; return unit === 'MB' ? Math.round(v * 1024) : Math.round(v); };

  useEffect(() => { setOrigTotal(active.reduce((s, u) => s + dataUrlKB(u), 0)); }, [images, included]);
  useEffect(() => {
    if (active.length === 0) { setRecommended(0); return; }
    let on = true;
    (async () => { let sum = 0; for (const im of active) sum += await estimatePageKB(im); if (on) setRecommended(sum); })();
    return () => { on = false; };
  }, [images, included]);

  const takePhoto = async () => { try { const { Camera, CameraResultType } = await import('@capacitor/camera'); const im = await Camera.getPhoto({ quality: 100, allowEditing: false, resultType: CameraResultType.DataUrl }); addImages([im.dataUrl], false); } catch (e) { alert('Camera requires a physical device.'); } };
  const scanDocument = async () => { try { const { DocumentScanner } = await import('@capgo/capacitor-document-scanner'); const r = await DocumentScanner.scanDocument({ responseType: 'base64' }); if (r.scannedImages?.length) addImages([`data:image/jpeg;base64,${r.scannedImages[0]}`], false); } catch (e) { alert('Scanning requires a mobile device.'); } };
  const uploadFile = async (e) => {
    const file = e.target.files?.[0]; if (!file) return;
    setIsLoading(true); setLoadProgress(0); setLoadMessage('Reading (original kept)...');
    try {
      if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
        const buf = await file.arrayBuffer();
        setOrigPdf(buf); setOrigPdfKB(Math.round(buf.byteLength / 1024));
        const urls = await renderPdfToImages(file, p => setLoadProgress(p));
        if (urls.length) { setImages(urls); setIncluded(urls.map(() => true)); } else alert('Empty PDF');
      } else if (file.type.startsWith('image/')) {
        const r = new FileReader(); r.onloadend = () => { setLoadProgress(100); addImages([r.result], false); }; r.readAsDataURL(file);
      } else alert('Unsupported file');
    } catch (err) { alert('Failed: ' + err.message); }
    finally { setIsLoading(false); setLoadProgress(0); setLoadMessage(''); }
    e.target.value = null;
  };

  
  const handlePreview = async () => {
    if (active.length === 0) return alert('Select at least one page.');
    setIsLoading(true); setLoadProgress(0); setLoadMessage('Generating preview...');
    try {
      const kb = targetKB();
      const opts = { readable, gray };
      const r = await compressPageToTarget(active[0], kb > 0 ? kb : 200, opts);
      setPreviewUrl(r.url);
      setLoadProgress(100);
    } catch (e) { alert('Preview failed: ' + e.message); }
    finally { setIsLoading(false); setLoadProgress(0); setLoadMessage(''); }
  };


  const handlePreview = async () => {
    if (active.length === 0) return alert('Select at least one page.');
    setIsLoading(true); setLoadProgress(0); setLoadMessage('Generating preview...');
    try {
      const kb = targetKB();
      const opts = { readable, gray };
      const r = await compressPageToTarget(active[0], kb > 0 ? kb : 200, opts);
      setPreviewUrl(r.url);
      setLoadProgress(100);
    } catch (e) { alert('Preview failed: ' + e.message); }
    finally { setIsLoading(false); setLoadProgress(0); setLoadMessage(''); }
  };

const handleSave = async () => {
    if (active.length === 0) return alert('Select at least one page.');
    const kb = targetKB();
    const opts = { readable, gray };
    const before = origPdf ? origPdfKB : origTotal;
    setIsLoading(true); setLoadProgress(0); setLoadMessage('Compressing...');
    try {
      let blob; let total = 0;
      if (format === 'pdf') {
        if (kb > 0) blob = await compressPdfToTarget(active, kb, p => setLoadProgress(p), opts, origPdf, indices);
        else if (origPdf) blob = await compressPdfToTarget(active, Infinity, p => setLoadProgress(p), { readable: true }, origPdf, indices);
        else {
          const jpegs = []; for (const im of active) jpegs.push(await convertToJpg(im, 0.92));
          const { jsPDF } = await import('jspdf');
          const pdf = new jsPDF({ unit: 'pt', format: [595.28, 841.89], compress: true });
          jpegs.forEach((j, i) => { if (i > 0) pdf.addPage([595.28, 841.89]); pdf.addImage(j, 'JPEG', 0, 0, 595.28, 841.89, undefined, 'FAST'); });
          blob = pdf.output('blob');
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
      const red = before > 0 ? Math.max(0, Math.round((1 - savedKB / before) * 100)) : 0;
      alert(`Saved ${savedKB} KB` + (before ? `  (was ${before} KB, −${red}%)` : '') + (kb ? `  • target ${kb} KB` : ''));
    } catch (e) { alert('Save failed: ' + e.message); }
    finally { setIsLoading(false); setLoadProgress(0); setLoadMessage(''); }
  };

  const tooSmall = targetKB() > 0 && recommended > 0 && targetKB() < recommended;
  const beforeKB = origPdf ? origPdfKB : origTotal;

  return (
    <div className="panel">
      <div className="glass-frame"><div className="logo-chip">💾</div><div className="main-card">
        <div className="header"><h2>Compress & Save</h2></div>
        <div className="workflow-cards">
          <div className="workflow-card" onClick={takePhoto}><div className="card-content"><span className="icon">📷</span><span className="label">Take Photo</span></div><div className="check-icon">✓</div></div>
          <div className="workflow-card" onClick={scanDocument}><div className="card-content"><span className="icon">✨</span><span className="label">Scan Document</span></div><div className="check-icon">✓</div></div>
          <label className="workflow-card"><div className="card-content"><span className="icon">📁</span><span className="label">Upload Photo or PDF</span></div><div className="check-icon">✓</div><input type="file" accept="image/*,.pdf,application/pdf" style={{ display: 'none' }} onChange={uploadFile} /></label>
        </div>

        {images.length > 0 && (<>
          <div className="count-bar">
            <span className="count-chip">📄 {active.length}/{images.length} • original ≈ {beforeKB} KB</span>
            <button className="clear-btn" onClick={() => { setImages([]); setIncluded([]); setOrigPdf(null); setOrigPdfKB(0); setLastSize(null); }}>Clear All</button>
          </div>
          <div className="thumb-strip">{images.map((img, i) => (
            <button key={i} className={'thumb' + (included[i] ? '' : ' off')} onClick={() => toggle(i)}>
              <img src={img} alt={'p' + (i + 1)} /><span className="thumb-mark">{included[i] ? '✓' : '✕'}</span><span className="thumb-num">{i + 1}</span>
            </button>))}</div>
          <div className="thumb-hint">Upload keeps your exact file; only Save re-encodes. Text→crisp B/W, photos→colour.</div>
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
                  <span>Readable min ≈ <b>{recommended} KB</b> ({FLOOR_DOC} KB text / {FLOOR_PHOTO} KB photo per page).</span>
                  <button className="auto-btn" onClick={() => { setUnit('KB'); setSizeInput(String(recommended)); }}>Use it</button>
                </div>
              )}
              {tooSmall && <span className="target-warn">Below readable minimum the text will blur — that size is very small for {active.length} page(s).</span>}
            </div>
          </div>

          <label className="workflow-card settings-card"><div className="card-content"><span className="icon">🔤</span><span className="label">Boost text contrast</span></div>
            <input type="checkbox" checked={readable} onChange={e => setReadable(e.target.checked)} style={{ width: 22, height: 22 }} /></label>
          <label className="workflow-card settings-card"><div className="card-content"><span className="icon">⬛</span><span className="label">Grayscale (photos)</span></div>
            <input type="checkbox" checked={gray} onChange={e => setGray(e.target.checked)} style={{ width: 22, height: 22 }} /></label>
        </div>

        {lastSize != null && (
          <div className="count-bar">
            <span className="count-chip">✅ Saved {lastSize} KB{beforeKB ? ` (was ${beforeKB} KB, −${Math.max(0, Math.round((1 - lastSize / beforeKB) * 100))}%)` : ''}</span>
          </div>
        )}

        
        {previewUrl && (
          <div className="preview-card" style={{ marginTop: '12px' }}>
            <div className="preview-head"><span>👁️ Preview (page 1 compressed)</span>
              <button className="clear-btn" onClick={() => setPreviewUrl(null)}>Close</button>
            </div>
            <div className="preview-stage" style={{ maxHeight: '300px' }}>
              <img src={previewUrl} alt="Compressed preview" style={{ maxWidth: '100%', maxHeight: '300px', objectFit: 'contain' }} />
            </div>
            <div className="preview-note">This is what your first page will look like. Text should be crisp black & white.</div>
          </div>
        )}

        <button className="print-btn" onClick={handlePreview} disabled={active.length === 0} style={{ marginBottom: '12px', background: 'rgba(16,185,129,0.12)', color: '#047857' }}>
          👁️ Preview First Page
        </button>

        
        {previewUrl && (
          <div className="preview-card" style={{ marginTop: '12px' }}>
            <div className="preview-head"><span>👁️ Preview (page 1 compressed)</span>
              <button className="clear-btn" onClick={() => setPreviewUrl(null)}>Close</button>
            </div>
            <div className="preview-stage" style={{ maxHeight: '300px' }}>
              <img src={previewUrl} alt="Compressed preview" style={{ maxWidth: '100%', maxHeight: '300px', objectFit: 'contain' }} />
            </div>
            <div className="preview-note">This is what your first page will look like. Text should be crisp black & white.</div>
          </div>
        )}

        <button className="print-btn" onClick={handlePreview} disabled={active.length === 0} style={{ marginBottom: '12px', background: 'rgba(16,185,129,0.12)', color: '#047857' }}>
          👁️ Preview First Page
        </button>

        <button className={'print-btn save' + (active.length > 0 ? ' active' : '')} onClick={handleSave} disabled={active.length === 0}>
          💾 Compress & Save {targetKB() > 0 ? `(≤ ${targetKB()} KB)` : ''}
        </button>
        <div className="swipe-hint">← Swipe to change section →</div>
      </div></div>
    </div>
  );
}
