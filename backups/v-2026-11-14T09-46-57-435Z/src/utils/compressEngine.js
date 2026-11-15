import { loadImage, dataUrlKB } from './imageUtils.js';
export { dataUrlKB } from './imageUtils.js';

/* textFloor = smallest resolution fraction allowed for text pages */
export const MODES = {
  hc_hq: { label: 'High compress + High quality', qMin: 0.55, minScale: 0.14, textFloor: 0.26 },
  hc_lq: { label: 'High compress + Low quality',  qMin: 0.32, minScale: 0.10, textFloor: 0.16 },
  lc_hq: { label: 'Less compress + High quality', qMin: 0.75, minScale: 0.45, textFloor: 0.55 }
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
function stats(img) {
  const s = 150; const c = document.createElement('canvas'); c.width = s; c.height = s;
  const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(img, 0, 0, s, s);
  const d = x.getImageData(0, 0, s, s).data;
  let white = 0, colored = 0;
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i], g = d[i + 1], b = d[i + 2];
    if (.299 * r + .587 * g + .114 * b > 220) white++;
    if (Math.max(r, g, b) - Math.min(r, g, b) > 55) colored++;
  }
  const n = d.length / 4;
  return { white: white / n, colored: colored / n };
}
/* --- 1-bit matrix at full resolution (Otsu) --- */
function binarize(img) {
  const w = img.width, h = img.height;
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const x = c.getContext('2d', { willReadFrequently: true });
  x.fillStyle = '#fff'; x.fillRect(0, 0, w, h);
  x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high';
  x.drawImage(img, 0, 0);
  const d = x.getImageData(0, 0, w, h).data;
  const hist = new Float64Array(256);
  for (let i = 0; i < d.length; i += 4) hist[(.299 * d[i] + .587 * d[i + 1] + .114 * d[i + 2]) | 0]++;
  const total = d.length / 4;
  let sum = 0; for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sb = 0, wb = 0, mx = -1, T = 128;
  for (let t = 0; t < 256; t++) {
    wb += hist[t]; if (!wb) continue;
    const wf = total - wb; if (!wf) break;
    sb += t * hist[t];
    const a = sb / wb, b = (sum - sb) / wf, v = wb * wf * (a - b) * (a - b);
    if (v > mx) { mx = v; T = t; }
  }
  const m = new Uint8Array(w * h);
  for (let i = 0, p = 0; i < d.length; i += 4, p++) m[p] = (.299 * d[i] + .587 * d[i + 1] + .114 * d[i + 2]) < T ? 1 : 0;
  return { m, w, h };
}
/* COVERAGE downscale: black only if >=50% of source pixels are ink.
   This keeps stroke weight natural (NOT fat/black like any-black). */
function shrink(src, f) {
  const w = Math.max(24, Math.round(src.w * f)), h = Math.max(24, Math.round(src.h * f));
  const out = new Uint8Array(w * h);
  const rx = src.w / w, ry = src.h / h;
  for (let y = 0; y < h; y++) {
    const y0 = Math.floor(y * ry), y1 = Math.max(y0 + 1, Math.min(src.h, Math.ceil((y + 1) * ry)));
    for (let x = 0; x < w; x++) {
      const x0 = Math.floor(x * rx), x1 = Math.max(x0 + 1, Math.min(src.w, Math.ceil((x + 1) * rx)));
      let ink = 0, n = 0;
      for (let yy = y0; yy < y1; yy++) { const row = yy * src.w; for (let xx = x0; xx < x1; xx++) { ink += src.m[row + xx]; n++; } }
      out[y * w + x] = (ink / n) >= 0.5 ? 1 : 0;
    }
  }
  return { m: out, w, h };
}
function toPng(mat) {
  const c = document.createElement('canvas'); c.width = mat.w; c.height = mat.h;
  const x = c.getContext('2d'); const id = x.createImageData(mat.w, mat.h); const d = id.data;
  for (let i = 0, p = 0; i < mat.m.length; i++, p += 4) { const v = mat.m[i] ? 0 : 255; d[p] = v; d[p + 1] = v; d[p + 2] = v; d[p + 3] = 255; }
  x.putImageData(id, 0, 0);
  const url = c.toDataURL('image/png');
  return { url, kb: dataUrlKB(url) };
}
function textPage(img, budget, cfg) {
  const full = binarize(img);
  const scales = [1, 0.8, 0.65, 0.52, 0.42, 0.34, 0.28, 0.22, 0.18].filter(s => s >= cfg.textFloor);
  if (!scales.length) scales.push(cfg.textFloor);
  let best = null;
  for (const s of scales) {
    const enc = toPng(s === 1 ? full : shrink(full, s));
    if (!best || enc.kb < best.kb) best = enc;
    if (enc.kb <= budget) return enc;
  }
  return best;
}
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
function photoPage(img, budget, cfg, gray) {
  const scales = [1, 0.85, 0.7, 0.58, 0.48, 0.38, 0.3, 0.24, 0.18, 0.14].filter(s => s >= cfg.minScale);
  if (!scales.length) scales.push(cfg.minScale);
  let best = null;
  for (const s of scales) {
    const w = img.width * s;
    const low = jpegAt(img, w, cfg.qMin, gray);
    if (!best || low.kb < best.kb) best = low;
    if (low.kb > budget) continue;
    let lo = cfg.qMin, hi = 0.92, fit = low;
    for (let i = 0; i < 5; i++) { const mid = (lo + hi) / 2; const e = jpegAt(img, w, mid, gray); if (e.kb <= budget) { fit = e; lo = mid; } else hi = mid; }
    return fit;
  }
  return best;
}
/* SAME function for preview and save */
export function compressRasterPage(img, budgetKB, mode = 'hc_hq', gray = false) {
  const cfg = MODES[mode] || MODES.hc_hq;
  const st = stats(img);
  const isText = st.white > 0.45 && st.colored < 0.06;
  return isText ? textPage(img, Math.max(1, budgetKB), cfg) : photoPage(img, Math.max(1, budgetKB), cfg, gray);
}
export function computeBudgets(count, targetKB, origKB) {
  const n = Math.max(1, count);
  const base = targetKB > 0 ? Math.min(targetKB, origKB || targetKB) : (origKB || 400);
  return Array.from({ length: n }, () => Math.max(1, (base * 0.97) / n));
}
/* realistic minimum for readable output */
export function readableMinimum(count, origKB) {
  return Math.min(origKB || Infinity, Math.round(count * 22));
}
export async function pageImage(entry) {
  if (entry.bytes && entry.pageIdx != null) return renderPageCanvas(entry.bytes, entry.pageIdx, 3);
  return loadImage(entry.dataUrl);
}
export async function compressPdfWithMode(entries, targetKB, origKB, mode, gray, onProgress) {
  const { PDFDocument } = await import('pdf-lib');
  const build = async (budgets) => {
    const out = await PDFDocument.create();
    for (let i = 0; i < entries.length; i++) {
      const img = await pageImage(entries[i]);
      const r = compressRasterPage(img, budgets[i], mode, gray);
      const emb = r.url.startsWith('data:image/png') ? await out.embedPng(r.url) : await out.embedJpg(r.url);
      const w = entries[i].w || 595.28, h = entries[i].h || 841.89;
      const pg = out.addPage([w, h]);
      pg.drawImage(emb, { x: 0, y: 0, width: w, height: h });
      onProgress && onProgress(Math.round(((i + 1) / entries.length) * 100));
    }
    return new Blob([await out.save({ useObjectStreams: true })], { type: 'application/pdf' });
  };
  let blob = await build(computeBudgets(entries.length, targetKB, origKB));
  if (origKB && blob.size > origKB * 1024) blob = await build(computeBudgets(entries.length, origKB * 0.9, origKB));
  return { blob };
}
export async function compressImageToTarget(dataUrl, targetKB, mime, mode, gray, onProgress) {
  const img = await loadImage(dataUrl);
  if (mime === 'image/png') { const r = compressRasterPage(img, targetKB || dataUrlKB(dataUrl), mode, gray); onProgress && onProgress(100); return r.url; }
  const cfg = MODES[mode] || MODES.hc_hq;
  const r = photoPage(img, targetKB || dataUrlKB(dataUrl), cfg, gray);
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
