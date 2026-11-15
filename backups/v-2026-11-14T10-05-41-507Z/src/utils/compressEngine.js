import { loadImage, dataUrlKB } from './imageUtils.js';
export { dataUrlKB } from './imageUtils.js';

/* Grayscale JPEG only — no thresholding (that caused the dark/blocky text). */
export const MODES = {
  hc_hq: { label: 'High compress + High quality', qMin: 0.50, minScale: 0.20 },
  hc_lq: { label: 'High compress + Low quality',  qMin: 0.32, minScale: 0.14 },
  lc_hq: { label: 'Less compress + High quality', qMin: 0.72, minScale: 0.50 }
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
  const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height);
  await page.render({ canvasContext: x, viewport: vp }).promise;
  try { await task.destroy(); } catch (e) {}
  return c;
}

/* WIN #1: trim empty white margins -> ~20% more pixels spent on actual content
   for the SAME file size. Box is kept so alignment is restored exactly on the page. */
function contentBox(img) {
  const s = 240;
  const c = document.createElement('canvas'); c.width = s; c.height = s;
  const x = c.getContext('2d', { willReadFrequently: true });
  x.fillStyle = '#fff'; x.fillRect(0, 0, s, s); x.drawImage(img, 0, 0, s, s);
  const d = x.getImageData(0, 0, s, s).data;
  let x0 = s, y0 = s, x1 = -1, y1 = -1;
  for (let yy = 0; yy < s; yy++) for (let xx = 0; xx < s; xx++) {
    const i = (yy * s + xx) * 4;
    if (.299 * d[i] + .587 * d[i + 1] + .114 * d[i + 2] < 238) {
      if (xx < x0) x0 = xx; if (xx > x1) x1 = xx;
      if (yy < y0) y0 = yy; if (yy > y1) y1 = yy;
    }
  }
  if (x1 < 0) return { sx: 0, sy: 0, sw: img.width, sh: img.height, rx: 0, ry: 0, rw: 1, rh: 1 };
  const pad = 2;
  x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad);
  x1 = Math.min(s - 1, x1 + pad); y1 = Math.min(s - 1, y1 + pad);
  const rx = x0 / s, ry = y0 / s, rw = (x1 - x0 + 1) / s, rh = (y1 - y0 + 1) / s;
  return {
    sx: Math.round(rx * img.width), sy: Math.round(ry * img.height),
    sw: Math.max(16, Math.round(rw * img.width)), sh: Math.max(16, Math.round(rh * img.height)),
    rx, ry, rw, rh
  };
}
function cropTo(img, b) {
  const c = document.createElement('canvas'); c.width = b.sw; c.height = b.sh;
  const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, b.sw, b.sh);
  x.drawImage(img, b.sx, b.sy, b.sw, b.sh, 0, 0, b.sw, b.sh);
  return c;
}
function isTextPage(img) {
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
  return white / n > 0.45 && colored / n < 0.06;
}
/* WIN #2: grayscale for text (≈30% smaller than colour at same quality)
   + mild contrast so background is clean white but strokes keep natural weight. */
function jpegAt(img, width, q, gray, textMode) {
  const w = Math.max(64, Math.round(Math.min(width, img.width)));
  const h = Math.max(64, Math.round(img.height * (w / img.width)));
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const x = c.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, w, h);
  const f = [];
  if (gray || textMode) f.push('grayscale(1)');
  if (textMode) f.push('contrast(1.12)', 'brightness(1.04)');
  if (f.length) x.filter = f.join(' ');
  x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high';
  x.drawImage(img, 0, 0, w, h);
  const url = c.toDataURL('image/jpeg', q);
  return { url, kb: dataUrlKB(url) };
}
/* SAME function for preview and save. Returns crop box so the page layout is preserved. */
export function compressRasterPage(img, budgetKB, mode = 'hc_hq', gray = false) {
  const cfg = MODES[mode] || MODES.hc_hq;
  const box = contentBox(img);
  const src = cropTo(img, box);
  const textMode = isTextPage(src);
  const budget = Math.max(1, budgetKB);
  const scales = [1, 0.88, 0.76, 0.66, 0.56, 0.48, 0.4, 0.34, 0.28, 0.24, 0.2, 0.16].filter(s => s >= cfg.minScale);
  if (!scales.length) scales.push(cfg.minScale);
  let best = null;
  for (const s of scales) {
    const w = Math.max(64, src.width * s);
    const low = jpegAt(src, w, cfg.qMin, gray, textMode);
    if (!best || low.kb < best.kb) best = { ...low, box };
    if (low.kb > budget) continue;
    let lo = cfg.qMin, hi = 0.94, fit = low;
    for (let i = 0; i < 6; i++) {
      const mid = (lo + hi) / 2;
      const e = jpegAt(src, w, mid, gray, textMode);
      if (e.kb <= budget) { fit = e; lo = mid; } else hi = mid;
    }
    return { ...fit, box };
  }
  return best;
}
export function computeBudgets(count, targetKB, origKB) {
  const n = Math.max(1, count);
  const base = targetKB > 0 ? Math.min(targetKB, origKB || targetKB) : (origKB || 400);
  return Array.from({ length: n }, () => Math.max(1, (base * 0.97) / n));
}
/* honest: dense price-list tables need ~45 KB/page to stay readable */
export function readableMinimum(count, origKB) {
  return Math.min(origKB || Infinity, Math.round(count * 45));
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
      const emb = await out.embedJpg(r.url);
      const W = entries[i].w || 595.28, H = entries[i].h || 841.89;
      const pg = out.addPage([W, H]);
      const b = r.box || { rx: 0, ry: 0, rw: 1, rh: 1 };
      // place the trimmed content back at its exact original position -> alignment unchanged
      pg.drawImage(emb, { x: b.rx * W, y: (1 - b.ry - b.rh) * H, width: b.rw * W, height: b.rh * H });
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
  if (mime === 'image/png') {
    let s = 1, best = null;
    while (s >= 0.12) {
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
