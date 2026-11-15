import { loadImage, dataUrlKB } from './imageUtils.js';
export { dataUrlKB } from './imageUtils.js';

/* qMin = quality floor. minScale = how far resolution may shrink to reach the target.
   hc modes can reach small targets; lc_hq stays larger but clearer. */
export const MODES = {
  hc_hq: { label: 'High compress + High quality', qMin: 0.55, minScale: 0.12 },
  hc_lq: { label: 'High compress + Low quality',  qMin: 0.30, minScale: 0.10 },
  lc_hq: { label: 'Less compress + High quality', qMin: 0.72, minScale: 0.45 }
};

export async function analyzePdfPages(bytes) {
  const pdfjs = await import('pdfjs-dist');
  const task = pdfjs.getDocument({ data: bytes.slice(0) }); const doc = await task.promise;
  const out = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const vp = (await doc.getPage(p)).getViewport({ scale: 1 });
    out.push({ pageIdx: p - 1, w: vp.width, h: vp.height });
  }
  try { await task.destroy(); } catch (e) {}
  return out;
}
export async function renderPageCanvas(bytes, pageIdx, scale = 2.5) {
  const pdfjs = await import('pdfjs-dist');
  const task = pdfjs.getDocument({ data: bytes.slice(0) }); const doc = await task.promise;
  const page = await doc.getPage(pageIdx + 1);
  const vp = page.getViewport({ scale });
  const c = document.createElement('canvas'); c.width = Math.round(vp.width); c.height = Math.round(vp.height);
  await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
  try { await task.destroy(); } catch (e) {}
  return c;
}
/* Plain JPEG encode — NO sharpen / NO contrast stretch (those inflate size 3-5x) */
function jpegAt(img, width, q, gray) {
  const w = Math.max(32, Math.round(Math.min(width, img.width)));
  const h = Math.max(32, Math.round(img.height * (w / img.width)));
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, w, h);
  if (gray) x.filter = 'grayscale(1)';
  x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high';
  x.drawImage(img, 0, 0, w, h);
  const url = c.toDataURL('image/jpeg', q);
  return { url, kb: dataUrlKB(url) };
}
/* Always reaches the budget when physically possible. Same fn for preview AND save. */
export function compressRasterPage(img, budgetKB, mode = 'hc_hq', gray = false) {
  const cfg = MODES[mode] || MODES.hc_hq;
  const budget = Math.max(1, budgetKB);
  const scales = [1, 0.85, 0.7, 0.58, 0.48, 0.38, 0.3, 0.24, 0.18, 0.14, 0.12, 0.1]
    .filter(s => s >= cfg.minScale);
  if (!scales.length) scales.push(cfg.minScale);
  let best = null;
  for (const s of scales) {
    const w = Math.max(32, img.width * s);
    const low = jpegAt(img, w, cfg.qMin, gray);
    if (!best || low.kb < best.kb) best = low;
    if (low.kb > budget) continue;              // this resolution can't fit -> go smaller
    let lo = cfg.qMin, hi = 0.92, fit = low;    // find best quality that still fits
    for (let i = 0; i < 5; i++) {
      const mid = (lo + hi) / 2;
      const e = jpegAt(img, w, mid, gray);
      if (e.kb <= budget) { fit = e; lo = mid; } else hi = mid;
    }
    return fit;
  }
  return best;
}
/* 3% headroom for PDF structure overhead */
export function computeBudgets(count, targetKB, origKB) {
  const n = Math.max(1, count);
  const base = targetKB > 0 ? Math.min(targetKB, origKB || targetKB) : (origKB || 400);
  const eff = base * 0.97;
  return Array.from({ length: n }, () => Math.max(1, eff / n));
}
export async function pageImage(entry) {
  if (entry.bytes && entry.pageIdx != null) return renderPageCanvas(entry.bytes, entry.pageIdx, 2.5);
  return loadImage(entry.dataUrl);
}
export async function compressPdfWithMode(entries, targetKB, origKB, mode, gray, onProgress) {
  const { PDFDocument } = await import('pdf-lib');
  const build = async (budgets) => {
    const out = await PDFDocument.create();
    const per = [];
    for (let i = 0; i < entries.length; i++) {
      const img = await pageImage(entries[i]);
      const r = compressRasterPage(img, budgets[i], mode, gray);
      per.push(r.kb);
      const emb = await out.embedJpg(r.url);
      const w = entries[i].w || 595.28, h = entries[i].h || 841.89;
      const pg = out.addPage([w, h]);
      pg.drawImage(emb, { x: 0, y: 0, width: w, height: h });
      onProgress && onProgress(Math.round(((i + 1) / entries.length) * 100));
    }
    return new Blob([await out.save({ useObjectStreams: true })], { type: 'application/pdf' });
  };
  let budgets = computeBudgets(entries.length, targetKB, origKB);
  let blob = await build(budgets);
  // HARD CAP: never larger than the original upload
  if (origKB && blob.size > origKB * 1024) {
    budgets = computeBudgets(entries.length, origKB * 0.9, origKB);
    blob = await build(budgets);
  }
  return { blob, per: budgets };
}
export async function compressImageToTarget(dataUrl, targetKB, mime, mode, gray, onProgress) {
  const img = await loadImage(dataUrl);
  if (mime === 'image/png') {
    let s = 1, best = null;
    while (s >= 0.1) {
      const w = Math.round(img.width * s), h = Math.round(img.height * s);
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, w, h); x.drawImage(img, 0, 0, w, h);
      const url = c.toDataURL('image/png'); const kb = dataUrlKB(url);
      if (!targetKB || kb <= targetKB) { onProgress && onProgress(100); return url; }
      if (!best || kb < best.kb) best = { url, kb }; s *= 0.8;
    }
    onProgress && onProgress(100); return best ? best.url : dataUrl;
  }
  const r = compressRasterPage(img, targetKB || dataUrlKB(dataUrl), mode, gray);
  onProgress && onProgress(100); return r.url;
}
export async function convertToJpg(d, q = .92) { const i = await loadImage(d); const c = document.createElement('canvas'); c.width = i.width; c.height = i.height; const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height); x.drawImage(i, 0, 0); return c.toDataURL('image/jpeg', q); }
export async function convertToPng(d) { const i = await loadImage(d); const c = document.createElement('canvas'); c.width = i.width; c.height = i.height; c.getContext('2d').drawImage(i, 0, 0); return c.toDataURL('image/png'); }
export async function dataUrlToBlob(d, n) { const r = await fetch(d); const b = await r.blob(); return new File([b], n, { type: b.type || 'application/octet-stream' }); }
export function blobToBase64(b) { return new Promise(res => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.readAsDataURL(b); }); }
export async function shareBlob(blob, filename) {
  try { const { Share } = await import('@capacitor/share'); const { Filesystem, Directory } = await import('@capacitor/filesystem'); const b64 = await blobToBase64(blob); const uri = await Filesystem.writeFile({ path: filename, data: b64, directory: Directory.Cache, recursive: true }); await Share.share({ title: filename, text: filename, url: uri.uri, dialogTitle: 'Save / Share' }); return; } catch (e) { console.warn('share fallback', e); }
  if (blob instanceof Blob) { const u = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = u; a.download = filename; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(u), 1000); }
}
