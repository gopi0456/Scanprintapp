import { loadImage, dataUrlKB } from './imageUtils.js';
export { dataUrlKB } from './imageUtils.js';

/* Three modes: quality floor + how far resolution may shrink */
export const MODES = {
  hc_hq: { label: 'High compress + High quality', qMin: 0.62, scaleFloor: 0.34, textFloor: 0.40 },
  hc_lq: { label: 'High compress + Low quality',  qMin: 0.34, scaleFloor: 0.20, textFloor: 0.24 },
  lc_hq: { label: 'Less compress + High quality', qMin: 0.80, scaleFloor: 0.60, textFloor: 0.66 }
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

/* ---- content detection: text-dominant vs photo ---- */
function sampleStats(img) {
  const s = 160; const c = document.createElement('canvas'); c.width = s; c.height = s;
  const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(img, 0, 0, s, s);
  const d = x.getImageData(0, 0, s, s).data;
  let white = 0, colored = 0;
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i], g = d[i + 1], b = d[i + 2];
    const lum = .299 * r + .587 * g + .114 * b;
    if (lum > 225) white++;
    if (Math.max(r, g, b) - Math.min(r, g, b) > 55) colored++;
  }
  const n = d.length / 4;
  return { white: white / n, colored: colored / n };
}

/* ---- Otsu threshold ---- */
function otsu(hist, total) {
  let sum = 0; for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0, wB = 0, max = -1, T = 127;
  for (let t = 0; t < 256; t++) {
    wB += hist[t]; if (!wB) continue;
    const wF = total - wB; if (!wF) break;
    sumB += t * hist[t];
    const mB = sumB / wB, mF = (sum - sumB) / wF;
    const v = wB * wF * (mB - mF) * (mB - mF);
    if (v > max) { max = v; T = t; }
  }
  return T;
}
/* build a 1-bit matrix (1 = ink) at width w */
function bilevelMatrix(img, w) {
  const h = Math.max(16, Math.round(img.height * (w / img.width)));
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const x = c.getContext('2d', { willReadFrequently: true });
  x.fillStyle = '#fff'; x.fillRect(0, 0, w, h);
  x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high';
  x.drawImage(img, 0, 0, w, h);
  const d = x.getImageData(0, 0, w, h).data;
  const hist = new Float64Array(256);
  for (let i = 0; i < d.length; i += 4) hist[(.299 * d[i] + .587 * d[i + 1] + .114 * d[i + 2]) | 0]++;
  const T = otsu(hist, d.length / 4);
  const m = new Uint8Array(w * h);
  for (let i = 0, p = 0; i < d.length; i += 4, p++) m[p] = (.299 * d[i] + .587 * d[i + 1] + .114 * d[i + 2]) < T ? 1 : 0;
  return { m, w, h };
}
/* downscale a 1-bit matrix keeping any ink (strokes stay connected) */
function shrinkMatrix(src, factor) {
  const w = Math.max(16, Math.round(src.w * factor)), h = Math.max(16, Math.round(src.h * factor));
  const out = new Uint8Array(w * h);
  const rx = src.w / w, ry = src.h / h;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const x0 = Math.floor(x * rx), x1 = Math.min(src.w, Math.ceil((x + 1) * rx));
    const y0 = Math.floor(y * ry), y1 = Math.min(src.h, Math.ceil((y + 1) * ry));
    let ink = 0;
    for (let yy = y0; yy < y1 && !ink; yy++) for (let xx = x0; xx < x1; xx++) if (src.m[yy * src.w + xx]) { ink = 1; break; }
    out[y * w + x] = ink;
  }
  return { m: out, w, h };
}
function matrixToPng(mat) {
  const c = document.createElement('canvas'); c.width = mat.w; c.height = mat.h;
  const x = c.getContext('2d'); const id = x.createImageData(mat.w, mat.h); const d = id.data;
  for (let i = 0, p = 0; i < mat.m.length; i++, p += 4) {
    const v = mat.m[i] ? 0 : 255;
    d[p] = v; d[p + 1] = v; d[p + 2] = v; d[p + 3] = 255;
  }
  x.putImageData(id, 0, 0);
  const url = c.toDataURL('image/png');
  return { url, kb: dataUrlKB(url) };
}
/* text page: crisp bi-level PNG, shrink until it fits budget */
function compressText(img, budgetKB, cfg) {
  const full = bilevelMatrix(img, img.width);
  const scales = [1, 0.85, 0.72, 0.6, 0.5, 0.42, 0.34, 0.28, 0.22].filter(s => s >= cfg.textFloor);
  if (!scales.length) scales.push(cfg.textFloor);
  let best = null;
  for (const s of scales) {
    const mat = s === 1 ? full : shrinkMatrix(full, s);
    const enc = matrixToPng(mat);
    if (!best || enc.kb < best.kb) best = enc;
    if (enc.kb <= budgetKB) return enc;
  }
  return best;
}
/* photo page: JPEG quality+resolution search with a quality floor */
function jpegAt(img, width, q, gray) {
  const w = Math.max(48, Math.round(Math.min(width, img.width)));
  const h = Math.max(48, Math.round(img.height * (w / img.width)));
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, w, h);
  if (gray) x.filter = 'grayscale(1)';
  x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high';
  x.drawImage(img, 0, 0, w, h);
  const url = c.toDataURL('image/jpeg', q);
  return { url, kb: dataUrlKB(url) };
}
function compressPhoto(img, budgetKB, cfg, gray) {
  const scales = [1, 0.85, 0.7, 0.55, 0.4, 0.3, 0.22].filter(s => s >= cfg.scaleFloor);
  if (!scales.length) scales.push(cfg.scaleFloor);
  let best = null;
  for (const s of scales) {
    const w = img.width * s;
    let lo = cfg.qMin, hi = 0.92, fit = null;
    for (let i = 0; i < 7; i++) { const mid = (lo + hi) / 2; const e = jpegAt(img, w, mid, gray); if (e.kb <= budgetKB) { fit = e; lo = mid; } else hi = mid; }
    if (fit) return fit;
    const low = jpegAt(img, w, cfg.qMin, gray);
    if (!best || low.kb < best.kb) best = low;
    if (low.kb <= budgetKB) return low;
  }
  return best;
}
/* THE single compressor used by preview AND save */
export function compressRasterPage(img, budgetKB, mode = 'hc_hq', gray = false) {
  const cfg = MODES[mode] || MODES.hc_hq;
  const st = sampleStats(img);
  const isText = st.white > 0.45 && st.colored < 0.06;
  if (isText) return compressText(img, budgetKB, cfg);
  return compressPhoto(img, budgetKB, cfg, gray);
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
    const isPng = r.url.startsWith('data:image/png');
    const emb = isPng ? await out.embedPng(r.url) : await out.embedJpg(r.url);
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
    const st = sampleStats(img);
    if (st.white > 0.45 && st.colored < 0.06) { const r = compressText(img, targetKB || dataUrlKB(dataUrl), MODES[mode] || MODES.hc_hq); onProgress && onProgress(100); return r.url; }
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
