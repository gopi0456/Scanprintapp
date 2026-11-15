import { useState } from 'react';
import { renderPdfToImages } from '../utils/imageUtils.js';
import { compressToTarget, convertToPng, convertToJpg, dataUrlToBlob, compressPdfLossless, shareBlob } from '../utils/compressEngine.js';
import { buildPdfBlob } from '../utils/printEngine.js';
import { Share } from '@capacitor/share';
import { Filesystem, Directory } from '@capacitor/filesystem';

export default function CompressSavePanel({ isLoading, setIsLoading, loadProgress, setLoadProgress, loadMessage, setLoadMessage }) {
  const [saveImages, setSaveImages] = useState([]);
  const [saveFormat, setSaveFormat] = useState('pdf');
  const [saveKBInput, setSaveKBInput] = useState('');
  const [saveUnit, setSaveUnit] = useState('KB');

  const takePhoto = async (addFn) => {
    try {
      const { Camera, CameraResultType } = await import('@capacitor/camera');
      const image = await Camera.getPhoto({ quality: 100, allowEditing: false, resultType: CameraResultType.DataUrl });
      addFn(image.dataUrl);
    } catch (e) { alert('Camera requires a physical device.'); }
  };

  const uploadFile = async (event, addFn, addMultiFn) => {
    const file = event.target.files?.[0]; if (!file) return;
    setIsLoading(true); setLoadProgress(0); setLoadMessage('Processing file...');
    try {
      if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
        setLoadMessage('Converting PDF pages...');
        const urls = await renderPdfToImages(file, (p) => setLoadProgress(p));
        if (urls.length) { setLoadMessage('Loading images...'); addMultiFn(urls); }
        else alert('Empty or corrupted PDF');
      } else if (file.type.startsWith('image/')) {
        setLoadMessage('Reading image...');
        const r = new FileReader();
        r.onloadend = () => { setLoadProgress(100); addFn(r.result); };
        r.onerror = () => alert('Read failed');
        r.readAsDataURL(file);
      } else alert('Unsupported file');
    } catch (err) { alert('Failed: ' + err.message); }
    finally { setIsLoading(false); setLoadProgress(0); setLoadMessage(''); }
    event.target.value = null;
  };

  const scanDocument = async (addFn) => {
    try {
      const { DocumentScanner } = await import('@capgo/capacitor-document-scanner');
      const r = await DocumentScanner.scanDocument({ responseType: 'base64' });
      if (r.scannedImages?.length) addFn(`data:image/jpeg;base64,${r.scannedImages[0]}`);
    } catch (e) { alert('Scanning requires a mobile device.'); }
  };

  
  const computeKB = () => {
    const v = parseFloat(saveKBInput);
    if (!v || v <= 0) return 0;
    return saveUnit === 'MB' ? Math.round(v * 1024) : Math.round(v);
  };

  const onPdfCompressFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = null;
    if (!file) return;
    const target = computeKB();
    setIsLoading(true); setLoadProgress(10); setLoadMessage('Compressing PDF (keeping text)...');
    try {
      const buf = await file.arrayBuffer();
      let outBlob = await compressPdfLossless(buf);   // lossless: text & format untouched
      setLoadProgress(50);
      if (target > 0 && outBlob.size > target * 1024) {
        // lossless not enough -> raster fallback sized per page
        setLoadMessage('Deep compressing pages...');
        const imgs = await renderPdfToImages(file, (pr) => setLoadProgress(50 + Math.round(pr * 0.2)));
        const perPage = Math.max(8, Math.floor(target / Math.max(1, imgs.length)));
        const comp = await Promise.all(imgs.map(u => compressToTarget(u, perPage)));
        outBlob = await buildPdfBlob(comp, '8.27in', '11.69in');
      }
      setLoadProgress(90); setLoadMessage('Saving...');
      const name = file.name.replace(/\.pdf$/i, '') + '-compressed.pdf';
      await shareBlob(outBlob, name);
      setLoadProgress(100);
      alert('Done! New size: ' + Math.round(outBlob.size / 1024) + ' KB');
    } catch (err) {
      alert('PDF compress failed: ' + err.message);
    } finally {
      setIsLoading(false); setLoadProgress(0); setLoadMessage('');
    }
  };

  const handleSave = async () => {
    if (saveImages.length === 0) return alert('Please add at least one image or PDF.');
    setIsLoading(true); setLoadProgress(0); setLoadMessage('Compressing...');
    try {
      const inputVal = parseFloat(saveKBInput);
      const kb = saveUnit === 'MB' ? Math.round(inputVal * 1024) : Math.round(inputVal);
      let processed = saveImages;
      if (kb > 0) {
        const totalImages = saveImages.length;
        processed = await Promise.all(saveImages.map(async (u, idx) => {
          setLoadMessage(`Compressing image ${idx + 1}/${totalImages}...`);
          const startProgress = Math.round((idx / totalImages) * 90);
          const endProgress = Math.round(((idx + 1) / totalImages) * 90);
          return await compressToTarget(u, kb, (p) => {
            const overallProgress = startProgress + Math.round((p / 100) * (endProgress - startProgress));
            setLoadProgress(overallProgress);
          });
        }));
      }
      setLoadMessage('Preparing download...');
      setLoadProgress(95);
      if (saveFormat === 'pdf') {
        const blob = await buildPdfBlob(processed, '8.27in', '11.69in');
        setLoadProgress(100);
        const b64 = await new Promise((res) => {
          const reader = new FileReader();
          reader.onload = () => res(String(reader.result).split(',')[1]);
          reader.readAsDataURL(blob);
        });
        const filename = `scanprint-${Date.now()}.pdf`;
        const uriResult = await Filesystem.writeFile({ path: filename, data: b64, directory: Directory.Cache, recursive: true });
        await Share.share({ title: 'Save PDF', text: filename, url: uriResult.uri, dialogTitle: 'Save or Share' });
      } else {
        for (let i = 0; i < processed.length; i++) {
          let url = processed[i];
          if (saveFormat === 'png' && kb === 0 && !url.startsWith('data:image/png')) url = await convertToPng(url);
          if (saveFormat === 'jpg' && !url.startsWith('data:image/jpeg')) url = await convertToJpg(url, 0.92);
          const ext = (saveFormat === 'png' && kb === 0) ? 'png' : 'jpg';
          const blob = await dataUrlToBlob(url, `scanprint-${i + 1}.${ext}`);
          const b64 = await new Promise((res) => {
            const reader = new FileReader();
            reader.onload = () => res(String(reader.result).split(',')[1]);
            reader.readAsDataURL(blob);
          });
          const filename = `scanprint-${i + 1}.${ext}`;
          const uriResult = await Filesystem.writeFile({ path: filename, data: b64, directory: Directory.Cache, recursive: true });
          await Share.share({ title: 'Save Image', text: filename, url: uriResult.uri, dialogTitle: 'Save or Share' });
          await new Promise((r) => setTimeout(r, 350));
        }
      }
    } catch (e) { alert('Save failed: ' + e.message); }
    finally { setIsLoading(false); setLoadProgress(0); setLoadMessage(''); }
  };

  const inputButtons = (addFn, addMultiFn) => (
    <div className="workflow-cards">
      <div className="workflow-card" onClick={() => takePhoto(addFn)}>
        <div className="card-content"><span className="icon">📷</span><span className="label">Take Photo</span></div>
        <div className="check-icon">✓</div>
      </div>
      <div className="workflow-card" onClick={() => scanDocument(addFn)}>
        <div className="card-content"><span className="icon">✨</span><span className="label">Scan Document</span></div>
        <div className="check-icon">✓</div>
      </div>
      <label className="workflow-card">
        <div className="card-content"><span className="icon">📁</span><span className="label">Upload Photo or PDF</span></div>
        <div className="check-icon">✓</div>
        <input type="file" accept="image/*,.pdf,application/pdf" style={{ display: 'none' }} onChange={(e) => uploadFile(e, addFn, addMultiFn)} />
      </label>
    </div>
  );

  return (
    <div className="panel">
      <div className="glass-frame">
        <div className="logo-chip">💾</div>
        <div className="main-card">
          <div className="header"><h2>Compress & Save</h2></div>
          {inputButtons((u) => setSaveImages(p => [...p, u]), (urls) => setSaveImages(p => [...p, ...urls]))}
          {saveImages.length > 0 && (
            <div className="count-bar">
              <span className="count-chip">📄 {saveImages.length} file{saveImages.length > 1 ? 's' : ''} loaded</span>
              <button className="clear-btn" onClick={() => setSaveImages([])}>Clear All</button>
            </div>
          )}
                    <label className="workflow-card" style={{ marginBottom: '14px' }}>
            <div className="card-content"><span className="icon">📄</span><span className="label">Compress PDF (keeps text & format)</span></div>
            <div className="check-icon">✓</div>
            <input type="file" accept="application/pdf,.pdf" style={{ display: 'none' }} onChange={onPdfCompressFile} />
          </label>
          <div className="passport-settings" style={{ marginTop: 0 }}>
            <div className="workflow-card settings-card">
              <div className="card-content">
                <span className="icon">💾</span>
                <select value={saveFormat} onChange={(e) => setSaveFormat(e.target.value)} className="neon-select">
                  <option value="pdf">Save as PDF (all in one file)</option>
                  <option value="jpg">Save as JPG images</option>
                  <option value="png">Save as PNG images</option>
                </select>
              </div>
              <div className="check-icon">✓</div>
            </div>
            <div className="workflow-card settings-card">
              <div className="card-content" style={{ flexDirection: 'column', alignItems: 'stretch', gap: '4px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <span className="icon">🗜️</span>
                  <div style={{ display: 'flex', gap: '8px', marginTop: '6px', alignItems: 'center', flex: 1 }}>
                    <input
                      type="number"
                      min="1"
                      max="9999"
                      placeholder="Enter size (e.g. 100)"
                      value={saveKBInput}
                      onChange={(e) => setSaveKBInput(e.target.value)}
                      className="admin-input"
                      style={{ flex: 1 }}
                    />
                    <select
                      value={saveUnit}
                      onChange={(e) => setSaveUnit(e.target.value)}
                      className="admin-input"
                      style={{ width: '80px' }}
                    >
                      <option value="KB">KB</option>
                      <option value="MB">MB</option>
                    </select>
                  </div>
                </div>
                <span className="range-hint">Enter exact size (e.g. 50 KB or 2 MB). Leave empty for original quality.</span>
              </div>
              <div className="check-icon">✓</div>
            </div>
          </div>
          <button className={'print-btn save' + (saveImages.length > 0 ? ' active' : '')} onClick={handleSave} disabled={saveImages.length === 0}>
            💾 Compress & Save
          </button>
          <div className="swipe-hint">← Swipe to change section →</div>
        </div>
      </div>
    </div>
  );
}
