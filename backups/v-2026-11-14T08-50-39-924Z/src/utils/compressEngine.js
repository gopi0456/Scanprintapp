import { loadImage, dataUrlKB } from './imageUtils.js';
export { dataUrlKB } from './imageUtils.js';

/* Three modes. textFloor = min resolution for text; qMin = quality floor; light = text darkness (higher=lighter) */
export const MODES = {
  hc_hq: { label: 'High compress + High quality', qMin: 0.66, scaleFloor: 0.34, textFloor: 0.42, light: 70 },
  hc_lq: { label: 'High compress + Low quality',  qMin: 0.40, scaleFloor: 0.20, textFloor: 0.26, light: 60 },
  lc_hq: { label: 'Less compress + High quality', qMin: 0.82, scaleFloor: 0.60, textFloor: 0.70, light: 80 }
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
export async function renderPageCanvas(bytes, pageIdx, scale = 3) {
  const pdfjs = await import('pdfjs-dist');
  const task = pdfjs.getDocument({ data: bytes.slice(0) }); const doc = await task.promise;
  const page = await doc.getPage(pageIdx + 1);
  const vp = page.getViewport({ scale });
  const c = document.createElement('canvas'); c.width = Math.round(vp.width); c.height = Math.round(vp.height);
  await page.render({ canvasContext: c.getContext('2d'), viewport: vp }).promise;
  try { await task.destroy(); } catch (e) {}
  return c;
}
function sampleStats(img) {
  const s = 160; const c = document.createElement('canvas'); c.width = s; c.height = s;
  const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(img, 0, 0, s, s);
  const d = x.getImageData(0, 0, s, s).data;
  let white = 0, colored = 0;
  for (let i = 0; i < d.length; i += 4) { const r = d[i], g = d[i + 1], b = d[i + 2]; const lum = .299 * r + .587 * g + .114 * b; if (lum > 225) white++; if (Math.max(r, g, b) - Math.min(r, g, b) > 55) colored++; }
  const n = d.length / 4; return { white: white / n, colored: colored / n };
}
/* Grayscale + auto-levels (white bg, lighter text) + unsharp = crisp, natural-weight text */
function enhanced(img, w, isText, gray, light) {
  const h = Math.max(48, Math.round(img.height * (w / img.width)));
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const x = c.getContext('2d', { willReadFrequently: true });
  x.fillStyle = '#fff'; x.fillRect(0, 0, w, h);
  x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high';
  x.drawImage(img, 0, 0, w, h);
  if (isText || gray) {
    const id = x.getImageData(0, 0, w, h); const d = id.data;
    const hist = new Float64Array(256);
    for (let i = 0; i < d.length; i += 4) hist[(.299 * d[i] + .587 * d[i + 1] + .114 * d[i + 2]) | 0]++;
    const total = d.length / 4;
    let acc = 0, lo = 0, hi = 255;
    for (let t = 0; t < 256; t++) { acc += hist[t]; if (acc >= total * 0.02) { lo = t; break; } }
    acc = 0; for (let t = 255; t >= 0; t--) { acc += hist[t]; if (acc >= total * 0.10) { hi = t; break; } }
    if (hi <= lo) hi = lo + 1;
    const span = hi - lo;
    for (let i = 0; i < d.length; i += 4) {
      let v = (.299 * d[i] + .587 * d[i + 1] + .114 * d[i + 2]);
      v = (v - lo) / span; v = v < 0 ? 0 : v > 1 ? 1 : v;
      // map to [light..255]: text stays dark-gray (lighter), bg pure white
      const o = Math.round(light + v * (255 - light));
      d[i] = o; d[i + 1] = o; d[i + 2] = o;
    }
    x.putImageData(id, 0, 0);
    if (isText) sharpen(x, w, h);
  }
  return c;
}
function sharpen(x, w, h) {
  const id = x.getImageData(0, 0, w, h); const s = id.data;
  const out = new Uint8ClampedArray(s.length);
  const k = [0, -0.6, 0, -0.6, 3.4, -0.6, 0, -0.6, 0];
  for (let y = 1; y < h - 1; y++) for (let xx = 1; xx < w - 1; xx++) {
    for (let ch = 0; ch < 3; ch++) {
      let sum = 0, ki = 0;
      for (let ky = -1; ky <= 1; ky++) for (let kx = -1; kx <= 1; kx++) sum += s[((y + ky) * w + (xx + kx)) * 4 + ch] * k[ki++];
      out[(y * w + xx) * 4 + ch] = sum;
    }
    out[(y * w + xx) * 4 + 3] = 255;
  }
  x.putImageData(new ImageData(out, w, h), 0, 0);
}
/* THE single compressor for preview AND save */
export function compressRasterPage(img, budgetKB, mode = 'hc_hq', gray = false) {
  const cfg = MODES[mode] || MODES.hc_hq;
  const st = sampleStats(img);
  const isText = st.white > 0.45 && st.colored < 0.06;
  const floor = isText ? cfg.textFloor : cfg.scaleFloor;
  const scales = [1, 0.8, 0.65, 0.5, 0.4, 0.3, 0.22].filter(s => s >= floor);
  if (!scales.length) scales.push(floor);
  let best = null;
  for (const s of scales) {
    const w = Math.max(64, Math.round(img.width * s));
    const cv = enhanced(img, w, isText, gray, cfg.light);
    let lo = cfg.qMin, hi = 0.92, fit = null;
    for (let i = 0; i < 6; i++) { const mid = (lo + hi) / 2; const url = cv.toDataURL('image/jpeg', mid); const kb = dataUrlKB(url); if (kb <= budgetKB) { fit = { url, kb }; lo = mid; } else hi = mid; }
    if (fit) return fit;
    const url = cv.toDataURL('image/jpeg', cfg.qMin); const kb = dataUrlKB(url);
    if (!best || kb < best.kb) best = { url, kb };
    if (kb <= budgetKB) return best;
  }
  return best;
}
export function computeBudgets(count, targetKB, origKB) {
  const n = Math.max(1, count);
  const eff = targetKB > 0 ? Math.min(targetKB, origKB || targetKB) : (origKB || 400);
  return Array.from({ length: n }, () => Math.max(2, eff / n));
}
export async function pageImage(entry) {
  if (entry.bytes && entry.pageIdx != null) return renderPageCanvas(entry.bytes, entry.pageIdx, 3);
  return loadImage(entry.dataUrl);
}
export async function compressPdfWithMode(entries, targetKB, origKB, mode, gray, onProgress) {
  const { PDFDocument } = await import('pdf-lib');
  const budgets = computeBudgets(entries.length, targetKB, origKB);
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
  const blob = new Blob([await out.save({ useObjectStreams: true })], { type: 'application/pdf' });
  return { blob, per };
}
export async function compressImageToTarget(dataUrl, targetKB, mime, mode, gray, onProgress) {
  const img = await loadImage(dataUrl);
  if (mime === 'image/png') {
    let s = 1, best = null;
    while (s >= 0.15) { const w = Math.round(img.width * s), h = Math.round(img.height * s); const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, w, h); x.drawImage(img, 0, 0, w, h); const url = c.toDataURL('image/png'); const kb = dataUrlKB(url); if (!targetKB || kb <= targetKB) { onProgress && onProgress(100); return url; } if (!best || kb < best.kb) best = { url, kb }; s *= 0.8; }
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
