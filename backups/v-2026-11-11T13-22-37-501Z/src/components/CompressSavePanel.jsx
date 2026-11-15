import { useState } from 'react';
import { renderPdfToImages } from '../utils/imageUtils.js';
import { compressImageToTarget, compressPdfToTarget, convertToPng, convertToJpg, dataUrlToBlob, shareBlob } from '../utils/compressEngine.js';

export default function CompressSavePanel({ isLoading, setIsLoading, loadProgress, setLoadProgress, loadMessage, setLoadMessage }) {
  const [images, setImages] = useState([]);
  const [included, setIncluded] = useState([]);
  const [format, setFormat] = useState('pdf');
  const [sizeInput, setSizeInput] = useState('');
  const [unit, setUnit] = useState('KB');
  const [sharp, setSharp] = useState(true);
  const [gray, setGray] = useState(false);

  const active = images.filter((_, i) => included[i]);
  const addImages = (urls) => { setImages(p => [...p, ...urls]); setIncluded(p => [...p, ...urls.map(() => true)]); };
  const toggle = (i) => setIncluded(p => p.map((v, k) => k === i ? !v : v));
  const targetKB = () => { const v = parseFloat(sizeInput); if (!v || v <= 0) return 0; return unit === 'MB' ? Math.round(v * 1024) : Math.round(v); };

  const takePhoto = async () => { try { const { Camera, CameraResultType } = await import('@capacitor/camera'); const im = await Camera.getPhoto({ quality: 100, allowEditing: false, resultType: CameraResultType.DataUrl }); addImages([im.dataUrl]); } catch (e) { alert('Camera requires a physical device.'); } };
  const scanDocument = async () => { try { const { DocumentScanner } = await import('@capgo/capacitor-document-scanner'); const r = await DocumentScanner.scanDocument({ responseType: 'base64' }); if (r.scannedImages?.length) addImages([`data:image/jpeg;base64,${r.scannedImages[0]}`]); } catch (e) { alert('Scanning requires a mobile device.'); } };
  const uploadFile = async (e) => {
    const file = e.target.files?.[0]; if (!file) return;
    setIsLoading(true); setLoadProgress(0); setLoadMessage('Reading...');
    try {
      if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) { const urls = await renderPdfToImages(file, p => setLoadProgress(p)); if (urls.length) addImages(urls); else alert('Empty PDF'); }
      else if (file.type.startsWith('image/')) { const r = new FileReader(); r.onloadend = () => { setLoadProgress(100); addImages([r.result]); }; r.readAsDataURL(file); }
      else alert('Unsupported file');
    } catch (err) { alert('Failed: ' + err.message); }
    finally { setIsLoading(false); setLoadProgress(0); setLoadMessage(''); }
    e.target.value = null;
  };

  const handleSave = async () => {
    if (active.length === 0) return alert('Select at least one page.');
    const kb = targetKB();
    const opts = { sharp, gray };
    setIsLoading(true); setLoadProgress(0); setLoadMessage('Compressing (keeping text sharp)...');
    try {
      if (format === 'pdf') {
        let blob;
        if (kb > 0) blob = await compressPdfToTarget(active, kb, p => setLoadProgress(p), opts);
        else {
          const jpegs = []; for (const im of active) jpegs.push(await convertToJpg(im, 0.92));
          const { jsPDF } = await import('jspdf');
          const pdf = new jsPDF({ unit: 'pt', format: [595.28, 841.89], compress: true });
          jpegs.forEach((j, i) => { if (i > 0) pdf.addPage([595.28, 841.89]); pdf.addImage(j, 'JPEG', 0, 0, 595.28, 841.89, undefined, 'FAST'); });
          blob = pdf.output('blob');
        }
        setLoadProgress(95);
        await shareBlob(blob, `scanprint-${Date.now()}.pdf`);
        alert('PDF saved: ' + Math.round(blob.size / 1024) + ' KB');
      } else {
        const mime = format === 'png' ? 'image/png' : 'image/jpeg';
        for (let i = 0; i < active.length; i++) {
          setLoadMessage(`Compressing ${i + 1}/${active.length}...`);
          let url = active[i];
          if (kb > 0) url = await compressImageToTarget(url, kb, mime, p => setLoadProgress(Math.round(((i + p / 100) / active.length) * 100)), opts);
          else url = mime === 'image/png' ? await convertToPng(url) : await convertToJpg(url, 0.92);
          const ext = mime === 'image/png' ? 'png' : 'jpg';
          const blob = await dataUrlToBlob(url, `scanprint-${i + 1}.${ext}`);
          await shareBlob(blob, blob.name);
        }
      }
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
          <label className="workflow-card"><div className="card-content"><span className="icon">📁</span><span className="label">Upload Photo or PDF</span></div><div className="check-icon">✓</div><input type="file" accept="image/*,.pdf,application/pdf" style={{ display: 'none' }} onChange={uploadFile} /></label>
        </div>

        {images.length > 0 && (<>
          <div className="count-bar"><span className="count-chip">📄 {active.length}/{images.length} selected</span>
            <button className="clear-btn" onClick={() => { setImages([]); setIncluded([]); }}>Clear All</button></div>
          <div className="thumb-strip">{images.map((img, i) => (
            <button key={i} className={'thumb' + (included[i] ? '' : ' off')} onClick={() => toggle(i)}>
              <img src={img} alt={'p' + (i + 1)} /><span className="thumb-mark">{included[i] ? '✓' : '✕'}</span><span className="thumb-num">{i + 1}</span>
            </button>))}</div>
          <div className="thumb-hint">Tap to include / exclude pages before combining.</div>
        </>)}

        <div className="passport-settings" style={{ marginTop: 0 }}>
          <div className="workflow-card settings-card"><div className="card-content"><span className="icon">💾</span>
            <select value={format} onChange={e => setFormat(e.target.value)} className="neon-select">
              <option value="pdf">PDF (combine selected)</option><option value="jpg">JPG / JPEG</option><option value="png">PNG</option>
            </select></div><div className="check-icon">✓</div></div>
          <div className="workflow-card settings-card"><div className="card-content" style={{ flexDirection: 'column', alignItems: 'stretch', gap: '6px' }}>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
              <span className="icon">🎯</span>
              <input type="number" min="1" placeholder="Exact size (e.g. 100)" value={sizeInput} onChange={e => setSizeInput(e.target.value)} className="admin-input" style={{ flex: 1 }} />
              <select value={unit} onChange={e => setUnit(e.target.value)} className="admin-input" style={{ width: '80px' }}><option>KB</option><option>MB</option></select>
            </div>
            <span className="range-hint">Final file ≤ this size. Empty = original quality.</span>
          </div><div className="check-icon">✓</div></div>
          <label className="workflow-card settings-card"><div className="card-content"><span className="icon">🔤</span><span className="label">Sharp text (keep letters readable)</span></div>
            <input type="checkbox" checked={sharp} onChange={e => setSharp(e.target.checked)} style={{ width: 22, height: 22 }} /></label>
          <label className="workflow-card settings-card"><div className="card-content"><span className="icon">⬛</span><span className="label">Grayscale (smaller, sharper text)</span></div>
            <input type="checkbox" checked={gray} onChange={e => setGray(e.target.checked)} style={{ width: 22, height: 22 }} /></label>
        </div>

        <button className={'print-btn save' + (active.length > 0 ? ' active' : '')} onClick={handleSave} disabled={active.length === 0}>
          💾 Compress & Save {targetKB() > 0 ? `(≤ ${targetKB()} KB)` : ''}
        </button>
        <div className="swipe-hint">← Swipe to change section →</div>
      </div></div>
    </div>
  );
}
